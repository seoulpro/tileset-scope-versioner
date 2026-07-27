import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildScopedVersionMap,
  discoverExternalTilesets,
  publishScopedVersions,
} from "../src/index.js";

const writeJson = (file, value) => writeFile(
  file,
  `${JSON.stringify(value, null, 2)}\n`,
  "utf8",
);

const createFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tileset-scopes-"));
  await mkdir(path.join(root, "north"), { recursive: true });
  await mkdir(path.join(root, "south"), { recursive: true });
  await mkdir(path.join(root, "shared"), { recursive: true });
  await writeJson(path.join(root, "tileset.json"), {
    asset: { version: "1.1" },
    geometricError: 100,
    root: {
      boundingVolume: { sphere: [0, 0, 0, 10] },
      geometricError: 10,
      refine: "ADD",
      children: [
        { content: { uri: "north/tileset.json" } },
        { content: { uri: "south/tileset.json" } },
      ],
    },
  });
  for (const direction of ["north", "south"]) {
    await writeJson(path.join(root, direction, "tileset.json"), {
      asset: { version: "1.1" },
      geometricError: 0,
      root: {
        boundingVolume: { sphere: [0, 0, 0, 1] },
        geometricError: 0,
        content: { uri: "model.glb" },
      },
    });
    await writeFile(path.join(root, direction, "model.glb"), direction);
  }
  await writeFile(path.join(root, "shared", "surface.ktx2"), "shared-v1");
  return root;
};

const versionsById = (result) => Object.fromEntries(
  result.versionMap.scopes.map((scope) => [scope.id, scope.version]),
);

test("discovers local external tilesets recursively", async () => {
  const root = await createFixture();
  const discovered = await discoverExternalTilesets({ root });
  assert.deepEqual(
    discovered.map((item) => item.manifest),
    ["tileset.json", "north/tileset.json", "south/tileset.json"],
  );
});

test("emits 128-bit hexadecimal version tokens", async () => {
  const root = await createFixture();
  const result = await buildScopedVersionMap({ root });
  for (const scope of result.versionMap.scopes) {
    assert.match(scope.version, /^[a-f0-9]{32}$/);
  }
});

test("rotates only the changed directory scope", async () => {
  const root = await createFixture();
  const first = await publishScopedVersions({ root });
  await writeFile(path.join(root, "north", "model.glb"), "north-v2");
  const second = await publishScopedVersions({ root });
  const before = versionsById(first);
  const after = versionsById(second);

  assert.equal(after.root, before.root);
  assert.notEqual(after["external:north"], before["external:north"]);
  assert.equal(after["external:south"], before["external:south"]);
  assert.deepEqual(second.changedScopes, ["external:north"]);
});

test("standard manifest versions do not cause fingerprint churn", async () => {
  const root = await createFixture();
  const first = await publishScopedVersions({ root, writeStandard: true });
  const second = await publishScopedVersions({ root, writeStandard: true });
  assert.deepEqual(versionsById(second), versionsById(first));
  assert.deepEqual(second.changedScopes, []);

  const north = JSON.parse(
    await readFile(path.join(root, "north", "tileset.json"), "utf8"),
  );
  assert.equal(
    north.asset.tilesetVersion,
    versionsById(first)["external:north"],
  );
});

test("supports an explicit shared-asset scope", async () => {
  const root = await createFixture();
  const first = await buildScopedVersionMap({
    root,
    additionalScopes: [{ id: "shared-textures", path: "shared" }],
  });
  await writeFile(path.join(root, "shared", "surface.ktx2"), "shared-v2");
  const second = await buildScopedVersionMap({
    root,
    additionalScopes: [{ id: "shared-textures", path: "shared" }],
  });
  const before = versionsById(first);
  const after = versionsById(second);
  assert.notEqual(after["shared-textures"], before["shared-textures"]);
  assert.equal(after.root, before.root);
});

test("keeps nested explicit scopes independent", async () => {
  const root = await createFixture();
  await mkdir(path.join(root, "shared", "detail"));
  await writeFile(path.join(root, "shared", "detail", "normal.ktx2"), "normal-v1");
  const options = {
    root,
    additionalScopes: [
      { id: "shared", path: "shared" },
      { id: "shared-detail", path: "shared/detail" },
    ],
  };
  const before = versionsById(await buildScopedVersionMap(options));
  await writeFile(path.join(root, "shared", "detail", "normal.ktx2"), "normal-v2");
  const after = versionsById(await buildScopedVersionMap(options));

  assert.equal(after.root, before.root);
  assert.equal(after.shared, before.shared);
  assert.notEqual(after["shared-detail"], before["shared-detail"]);
});

test("rejects duplicate explicit and automatic scope paths", async () => {
  const root = await createFixture();
  await assert.rejects(
    buildScopedVersionMap({
      root,
      additionalScopes: [
        { id: "first", path: "shared", prefix: "first/" },
        { id: "second", path: "shared", prefix: "second/" },
      ],
    }),
    /duplicate additional scope path/,
  );
  await assert.rejects(
    buildScopedVersionMap({
      root,
      additionalScopes: [{
        id: "north-override",
        path: "north",
        prefix: "override/",
      }],
    }),
    /duplicates automatic scope path/,
  );
});

test("dry-run performs no writes", async () => {
  const root = await createFixture();
  const result = await publishScopedVersions({
    root,
    dryRun: true,
    writeStandard: true,
  });
  assert.deepEqual(result.writtenFiles, []);
  await assert.rejects(
    readFile(path.join(root, "asset-versions.json")),
    { code: "ENOENT" },
  );
  const rootManifest = JSON.parse(
    await readFile(path.join(root, "tileset.json"), "utf8"),
  );
  assert.equal(rootManifest.asset.tilesetVersion, undefined);
});

test("rejects misspelled mutation options instead of writing", async () => {
  const root = await createFixture();
  await assert.rejects(
    publishScopedVersions({ root, dryrun: true }),
    /unknown publish option/,
  );
  await assert.rejects(
    readFile(path.join(root, "asset-versions.json")),
    { code: "ENOENT" },
  );
});

test("rejects output paths that overlap each other or a manifest", async () => {
  const root = await createFixture();
  await assert.rejects(
    buildScopedVersionMap({
      root,
      stateFile: "metadata.json",
      sidecarFile: "metadata.json",
    }),
    /must not overlap/,
  );
  await assert.rejects(
    buildScopedVersionMap({ root, sidecarFile: "tileset.json" }),
    /must not overlap tileset manifest/,
  );
  await assert.rejects(
    buildScopedVersionMap({ root, stateFile: "north/tileset.json" }),
    /must not overlap tileset manifest/,
  );
});

test("rejects a generated output used as a file scope", async () => {
  const root = await createFixture();
  await writeFile(path.join(root, "asset-versions.json"), "{}\n");
  await assert.rejects(
    buildScopedVersionMap({
      root,
      additionalScopes: [{
        id: "generated-sidecar",
        path: "asset-versions.json",
      }],
    }),
    /must not overlap sidecarFile/,
  );
});

test("refuses to rewrite an invalid asset object", async () => {
  const root = await createFixture();
  const manifest = JSON.parse(
    await readFile(path.join(root, "north", "tileset.json"), "utf8"),
  );
  manifest.asset = [];
  await writeJson(path.join(root, "north", "tileset.json"), manifest);
  await assert.rejects(
    publishScopedVersions({ root, writeStandard: true }),
    /asset must be an object/,
  );
  const rootManifest = JSON.parse(
    await readFile(path.join(root, "tileset.json"), "utf8"),
  );
  assert.equal(rootManifest.asset.tilesetVersion, undefined);
  await assert.rejects(
    readFile(path.join(root, "asset-versions.json")),
    { code: "ENOENT" },
  );
});

test("rejects a state file that is a symbolic link", async () => {
  const root = await createFixture();
  const outside = path.join(
    await mkdtemp(path.join(os.tmpdir(), "tileset-state-")),
    "state.json",
  );
  await writeFile(outside, '{"fingerprints":{}}\n');
  await symlink(outside, path.join(root, ".scoped-version-state.json"));
  await assert.rejects(
    publishScopedVersions({ root }),
    /symbolic-link state/,
  );
});

test("rejects a sidecar link before updating manifests", async () => {
  const root = await createFixture();
  const outside = path.join(
    await mkdtemp(path.join(os.tmpdir(), "tileset-sidecar-")),
    "asset-versions.json",
  );
  await writeFile(outside, "{}\n");
  await symlink(outside, path.join(root, "asset-versions.json"));
  await assert.rejects(
    publishScopedVersions({ root, writeStandard: true }),
    /symbolic-link output/,
  );
  const rootManifest = JSON.parse(
    await readFile(path.join(root, "tileset.json"), "utf8"),
  );
  assert.equal(rootManifest.asset.tilesetVersion, undefined);
});

test("does not follow a manifest through an escaping directory link", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tileset-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "tileset-outside-"));
  await writeJson(path.join(root, "tileset.json"), {
    asset: { version: "1.1" },
    root: {
      boundingVolume: { sphere: [0, 0, 0, 1] },
      geometricError: 0,
      content: { uri: "linked/tileset.json" },
    },
  });
  await writeJson(path.join(outside, "tileset.json"), {
    asset: { version: "1.1" },
    root: {
      boundingVolume: { sphere: [0, 0, 0, 1] },
      geometricError: 0,
    },
  });
  await symlink(outside, path.join(root, "linked"));
  await assert.rejects(
    discoverExternalTilesets({ root }),
    /manifest escapes the asset root/,
  );
});

test("rejects references that escape the asset root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tileset-escape-"));
  await writeJson(path.join(root, "tileset.json"), {
    asset: { version: "1.1" },
    root: {
      boundingVolume: { sphere: [0, 0, 0, 1] },
      geometricError: 0,
      content: { uri: "../outside/tileset.json" },
    },
  });
  await assert.rejects(
    discoverExternalTilesets({ root }),
    /escapes the asset root/,
  );
});

test("rejects malformed additional scope configuration", async () => {
  const root = await createFixture();
  await assert.rejects(
    buildScopedVersionMap({ root, additionalScopes: null }),
    /additionalScopes must be an array/,
  );
  await assert.rejects(
    buildScopedVersionMap({
      root,
      additionalScopes: [{
        id: "shared",
        path: "shared",
        match: "starts-with",
      }],
    }),
    /match must be "prefix" or "exact"/,
  );
  await assert.rejects(
    buildScopedVersionMap({
      root,
      additionalScopes: [{
        id: "shared",
        path: "shared",
        prefix: "../outside",
      }],
    }),
    /prefix is invalid/,
  );
  for (const [scope, expected] of [
    [null, /must be an object/],
    [{ id: "", path: "shared" }, /non-empty id/],
    [{ id: "shared" }, /requires a path/],
    [{ id: "shared", path: "shared", prefix: 42 }, /prefix must be a string/],
    [{ id: "shared", path: "shared", recursive: true }, /unknown additional scope field/],
  ]) {
    await assert.rejects(
      buildScopedVersionMap({ root, additionalScopes: [scope] }),
      expected,
    );
  }
});

test("rejects duplicate ids, selectors, and direct scope links", async () => {
  const root = await createFixture();
  await assert.rejects(
    buildScopedVersionMap({
      root,
      additionalScopes: [
        { id: "duplicate", path: "shared" },
        { id: "duplicate", path: "north/model.glb" },
      ],
    }),
    /duplicate scope id/,
  );
  await assert.rejects(
    buildScopedVersionMap({
      root,
      additionalScopes: [
        { id: "shared-dir", path: "shared", prefix: "custom/" },
        {
          id: "north-model",
          path: "north/model.glb",
          prefix: "custom",
          match: "prefix",
        },
      ],
    }),
    /duplicate scope selector/,
  );
  await symlink(
    path.join(root, "shared"),
    path.join(root, "shared-link"),
  );
  await assert.rejects(
    buildScopedVersionMap({
      root,
      additionalScopes: [{ id: "linked", path: "shared-link" }],
    }),
    /cannot target a symbolic link/,
  );
});

test("rejects an additional scope beneath an escaping directory link", async () => {
  const root = await createFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "tileset-scope-outside-"));
  await writeFile(path.join(outside, "asset.bin"), "outside");
  await symlink(outside, path.join(root, "linked"));

  await assert.rejects(
    buildScopedVersionMap({
      root,
      additionalScopes: [{
        id: "outside",
        path: "linked/asset.bin",
      }],
    }),
    /resolves outside the asset root/,
  );
});

test("leaves remote and data references outside local discovery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tileset-remote-"));
  await writeJson(path.join(root, "tileset.json"), {
    asset: { version: "1.1" },
    root: {
      boundingVolume: { sphere: [0, 0, 0, 1] },
      geometricError: 0,
      contents: [
        { uri: "https://example.test/external.json" },
        { uri: "data:application/octet-stream;base64,AA==" },
      ],
    },
  });
  const discovered = await discoverExternalTilesets({ root });
  assert.deepEqual(discovered.map((item) => item.manifest), ["tileset.json"]);
});

test("rejects output paths beneath symbolic-link parents", async () => {
  const root = await createFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "tileset-output-outside-"));
  await symlink(outside, path.join(root, "metadata"));

  await assert.rejects(
    publishScopedVersions({
      root,
      stateFile: "metadata/state.json",
      sidecarFile: "metadata/versions.json",
    }),
    /parent cannot be a symbolic link/,
  );
  await assert.rejects(
    readFile(path.join(outside, "state.json")),
    { code: "ENOENT" },
  );
  await rm(outside, { recursive: true, force: true });
});

test("rejects malformed state instead of silently resetting it", async () => {
  const root = await createFixture();
  await writeFile(
    path.join(root, ".scoped-version-state.json"),
    '{"schemaVersion":1,"algorithm":"sha256","fingerprints":{"root":"bad"}}\n',
  );
  await assert.rejects(
    publishScopedVersions({ root }),
    /invalid fingerprint/,
  );
});

test("rejects invalid state signatures and non-file outputs", async () => {
  const root = await createFixture();
  const first = await publishScopedVersions({ root });
  await writeJson(path.join(root, ".scoped-version-state.json"), {
    schemaVersion: 1,
    algorithm: "sha256",
    fingerprints: Object.fromEntries(
      first.versionMap.scopes.map((scope) => [scope.id, scope.version.repeat(2)]),
    ),
    scopeSignatures: { root: "bad" },
  });
  await assert.rejects(
    publishScopedVersions({ root }),
    /invalid scope signature/,
  );

  const secondRoot = await createFixture();
  await mkdir(path.join(secondRoot, "state-directory"));
  await assert.rejects(
    publishScopedVersions({
      root: secondRoot,
      stateFile: "state-directory",
    }),
    /state path is not a regular file/,
  );

  const thirdRoot = await createFixture();
  await mkdir(path.join(thirdRoot, "sidecar-directory"));
  await assert.rejects(
    publishScopedVersions({
      root: thirdRoot,
      sidecarFile: "sidecar-directory",
    }),
    /output path is not a regular file/,
  );
});

test("reports removed scopes and selector-only changes", async () => {
  const root = await createFixture();
  await publishScopedVersions({
    root,
    additionalScopes: [{
      id: "shared-textures",
      path: "shared",
      prefix: "shared/",
    }],
  });

  const rootManifest = JSON.parse(
    await readFile(path.join(root, "tileset.json"), "utf8"),
  );
  rootManifest.root.children.pop();
  await writeJson(path.join(root, "tileset.json"), rootManifest);

  const result = await publishScopedVersions({
    root,
    additionalScopes: [{
      id: "shared-textures",
      path: "shared",
      prefix: "textures/",
    }],
  });
  assert.equal(result.changedScopes.includes("external:south"), true);
  assert.equal(result.changedScopes.includes("shared-textures"), true);
});

test("accepts legacy state without scope signatures", async () => {
  const root = await createFixture();
  await publishScopedVersions({ root });
  const stateFile = path.join(root, ".scoped-version-state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  delete state.scopeSignatures;
  await writeJson(stateFile, state);

  const result = await publishScopedVersions({ root });
  assert.deepEqual(result.changedScopes, []);
});

test("creates nested outputs and preserves an existing file mode", async () => {
  const root = await createFixture();
  const sidecar = path.join(root, "metadata", "asset-versions.json");
  await mkdir(path.dirname(sidecar));
  await writeFile(sidecar, "{}\n");
  await chmod(sidecar, 0o640);

  const result = await publishScopedVersions({
    root,
    sidecarFile: "metadata/asset-versions.json",
    stateFile: "state/scopes.json",
  });
  assert.deepEqual(result.writtenFiles, [
    "metadata/asset-versions.json",
    "state/scopes.json",
  ]);
  assert.equal((await stat(sidecar)).mode & 0o777, 0o640);
  assert.equal(
    JSON.parse(await readFile(sidecar, "utf8")).schemaVersion,
    1,
  );
});

test("validates top-level build and publish options", async () => {
  const root = await createFixture();
  await assert.rejects(buildScopedVersionMap(null), /options must be an object/);
  await assert.rejects(publishScopedVersions(null), /options must be an object/);
  await assert.rejects(
    buildScopedVersionMap({ root, unknown: true }),
    /unknown version-map option/,
  );
  await assert.rejects(
    publishScopedVersions({ root, dryRun: "yes" }),
    /dryRun must be a boolean/,
  );
  await assert.rejects(
    publishScopedVersions({ root, writeStandard: 1 }),
    /writeStandard must be a boolean/,
  );
  await assert.rejects(
    buildScopedVersionMap({ root, stateFile: "." }),
    /must name a file/,
  );
  await assert.rejects(
    buildScopedVersionMap({ root, stateFile: "../state.json" }),
    /must stay inside the asset root/,
  );
  await writeFile(path.join(root, "metadata-file"), "not a directory");
  await assert.rejects(
    buildScopedVersionMap({
      root,
      stateFile: "metadata-file/state.json",
    }),
    /parent is not a directory/,
  );
});

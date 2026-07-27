import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverExternalTilesets,
  resolveLocalReference,
} from "../src/index.js";

const temporaryRoot = async (context, prefix) => {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

const writeJson = (file, value) => writeFile(
  file,
  `${JSON.stringify(value, null, 2)}\n`,
  "utf8",
);

test("resolves local references and leaves non-local references alone", () => {
  const root = path.join(os.tmpdir(), "tileset-reference-root");
  assert.equal(resolveLocalReference({
    root,
    fromManifest: "regions/tileset.json",
    uri: "../shared/model%20one.glb?quality=high#mesh",
  }), "shared/model one.glb");

  for (const uri of [
    "",
    "?query-only",
    "/root/asset.glb",
    "//cdn.example.test/asset.glb",
    "https://cdn.example.test/asset.glb",
    "data:application/octet-stream;base64,AA==",
  ]) {
    assert.equal(resolveLocalReference({
      root,
      fromManifest: "tileset.json",
      uri,
    }), null);
  }
});

test("rejects malformed and escaping local references", () => {
  const root = path.join(os.tmpdir(), "tileset-reference-root");
  assert.throws(() => resolveLocalReference({
    root,
    fromManifest: "tileset.json",
    uri: "%ZZ",
  }), /invalid percent-encoding/);
  assert.throws(() => resolveLocalReference({
    root,
    fromManifest: "tileset.json",
    uri: "asset%00.glb",
  }), /null byte/);
  assert.throws(() => resolveLocalReference({
    root,
    fromManifest: "tileset.json",
    uri: "../outside.glb",
  }), /escapes the asset root/);
});

test("validates discovery options before reading files", async () => {
  await assert.rejects(discoverExternalTilesets(null), /options must be an object/);
  await assert.rejects(
    discoverExternalTilesets({ root: ".", recursive: true }),
    /unknown discovery option/,
  );
  await assert.rejects(discoverExternalTilesets({}), /root is required/);
  await assert.rejects(
    discoverExternalTilesets({ root: ".", rootTileset: "/tileset.json" }),
    /relative local path/,
  );
  await assert.rejects(
    discoverExternalTilesets({ root: ".", rootTileset: "." }),
    /must name a JSON file/,
  );
});

test("discovers legacy urls, multiple contents, cycles, and duplicate references", async (t) => {
  const root = await temporaryRoot(t, "tileset-discovery-");
  await mkdir(path.join(root, "nested"));
  await writeJson(path.join(root, "tileset.json"), {
    root: {
      content: { url: "nested/child.json" },
      contents: [
        { uri: "nested/child.json?cache=1" },
        { uri: "texture.ktx2" },
      ],
    },
  });
  await writeJson(path.join(root, "nested", "child.json"), {
    root: {
      content: { uri: "../tileset.json" },
      children: [
        { content: { uri: "model.glb" } },
        null,
      ],
    },
  });
  await writeFile(path.join(root, "nested", "model.glb"), "model");
  await writeFile(path.join(root, "texture.ktx2"), "texture");

  const discovered = await discoverExternalTilesets({ root });
  assert.deepEqual(
    discovered.map((entry) => entry.manifest),
    ["tileset.json", "nested/child.json"],
  );
  assert.deepEqual(discovered[0].externalManifests, ["nested/child.json"]);
  assert.deepEqual(discovered[0].references, [
    "nested/child.json",
    "texture.ktx2",
  ]);
  assert.deepEqual(discovered[1].externalManifests, ["tileset.json"]);
});

test("rejects a manifest that is itself a symbolic link", async (t) => {
  const root = await temporaryRoot(t, "tileset-link-root-");
  const outside = await temporaryRoot(t, "tileset-link-target-");
  await writeJson(path.join(outside, "tileset.json"), { root: {} });
  await symlink(
    path.join(outside, "tileset.json"),
    path.join(root, "tileset.json"),
  );
  await assert.rejects(
    discoverExternalTilesets({ root }),
    /manifest cannot be a symbolic link/,
  );
});

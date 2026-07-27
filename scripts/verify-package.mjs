import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "tileset-scope-versioner-package-"),
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const run = (command, args, cwd) => {
  const environment = {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  delete environment.npm_config_dry_run;
  delete environment.NPM_CONFIG_DRY_RUN;

  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed`,
        result.stdout,
        result.stderr,
      ].filter(Boolean).join("\n"),
    );
  }
  return result.stdout;
};

try {
  const packageDirectory = join(temporaryRoot, "package");
  const consumerDirectory = join(temporaryRoot, "consumer");
  await mkdir(packageDirectory);
  await mkdir(consumerDirectory);

  const [packed] = JSON.parse(run(
    npm,
    ["pack", "--json", "--pack-destination", packageDirectory],
    projectRoot,
  ));
  assert.ok(packed?.filename, "npm pack did not return a filename");

  const packedPaths = new Set(packed.files.map((file) => file.path));
  for (const expected of [
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "bin/tileset-scope-version.js",
    "docs/API.md",
    "package.json",
    "src/discover.d.ts",
    "src/discover.js",
    "src/index.d.ts",
    "src/index.js",
    "src/url.d.ts",
    "src/url.js",
    "src/versioner.d.ts",
    "src/versioner.js",
  ]) {
    assert.equal(
      packedPaths.has(expected),
      true,
      `package is missing ${expected}`,
    );
  }
  for (const packedPath of packedPaths) {
    assert.equal(packedPath.startsWith(".github/"), false);
    assert.equal(packedPath.startsWith("scripts/"), false);
    assert.equal(packedPath.startsWith("test/"), false);
    assert.equal(packedPath.startsWith("test-d/"), false);
  }

  const archive = join(packageDirectory, packed.filename);
  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  run(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive],
    consumerDirectory,
  );

  await writeFile(
    join(consumerDirectory, "smoke.mjs"),
    `import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendScopedVersion,
  buildScopedVersionMap,
  discoverExternalTilesets,
  publishScopedVersions,
} from "tileset-scope-versioner";
import { resolveLocalReference } from "tileset-scope-versioner/discover";
import { createUrlPreprocessor } from "tileset-scope-versioner/url";
import { publishScopedVersions as publishFromSubpath } from "tileset-scope-versioner/versioner";

assert.equal(typeof publishFromSubpath, "function");
assert.equal(
  resolveLocalReference({
    root: "/tmp/tiles",
    fromManifest: "region/tileset.json",
    uri: "model.glb",
  }),
  "region/model.glb",
);

const root = await mkdtemp(path.join(os.tmpdir(), "tileset-consumer-"));
await mkdir(path.join(root, "region"));
await writeFile(path.join(root, "tileset.json"), JSON.stringify({
  asset: { version: "1.1" },
  root: { content: { uri: "region/tileset.json" } },
}));
await writeFile(path.join(root, "region", "tileset.json"), JSON.stringify({
  asset: { version: "1.1" },
  root: { content: { uri: "model.glb" } },
}));
await writeFile(path.join(root, "region", "model.glb"), "model");

const discovered = await discoverExternalTilesets({ root });
assert.deepEqual(
  discovered.map((entry) => entry.manifest),
  ["tileset.json", "region/tileset.json"],
);
const built = await buildScopedVersionMap({ root });
const preprocess = createUrlPreprocessor(built.versionMap);
assert.match(preprocess("region/model.glb"), /[?&]v=[a-f0-9]{32}$/);
assert.match(
  appendScopedVersion("region/model.glb", built.versionMap),
  /[?&]v=[a-f0-9]{32}$/,
);
const published = await publishScopedVersions({ root });
assert.deepEqual(published.changedScopes, ["root", "external:region"]);
assert.equal(
  JSON.parse(await readFile(path.join(root, "asset-versions.json"), "utf8"))
    .schemaVersion,
  1,
);
`,
    "utf8",
  );
  run(process.execPath, ["smoke.mjs"], consumerDirectory);

  const installedManifest = JSON.parse(await readFile(
    join(
      consumerDirectory,
      "node_modules",
      "tileset-scope-versioner",
      "package.json",
    ),
    "utf8",
  ));
  assert.equal(installedManifest.version, packed.version);

  const executable = process.platform === "win32"
    ? join(consumerDirectory, "node_modules", ".bin", "tileset-scope-version.cmd")
    : join(consumerDirectory, "node_modules", ".bin", "tileset-scope-version");
  assert.equal(
    run(executable, ["--version"], consumerDirectory).trim(),
    packed.version,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const executable = fileURLToPath(
  new URL("../bin/tileset-scope-version.js", import.meta.url),
);

const run = (argumentsList, cwd = process.cwd()) => spawnSync(
  process.execPath,
  [executable, ...argumentsList],
  {
    cwd,
    encoding: "utf8",
  },
);

const createFixture = async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tileset-cli-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "tileset.json"), JSON.stringify({
    asset: { version: "1.1" },
    root: { content: { uri: "model.glb" } },
  }));
  await writeFile(path.join(root, "model.glb"), "model");
  return root;
};

test("prints help and the package version", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage:/);
  assert.match(help.stdout, /--write-standard/);
  assert.equal(help.stderr, "");

  const version = run(["--version"]);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
});

test("runs a dry publication without writing", async (t) => {
  const root = await createFixture(t);
  const result = run([
    "--root",
    root,
    "--scope",
    "model=model.glb",
    "--dry-run",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.deepEqual(output.writtenFiles, []);
  assert.equal(
    output.scopes.some((scope) => scope.id === "model"),
    true,
  );
  await assert.rejects(
    readFile(path.join(root, "asset-versions.json")),
    { code: "ENOENT" },
  );
});

test("supports custom output paths and standard manifest versions", async (t) => {
  const root = await createFixture(t);
  const result = run([
    "--root",
    root,
    "--state",
    "metadata/state.json",
    "--sidecar",
    "metadata/versions.json",
    "--write-standard",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, false);
  assert.deepEqual(output.writtenFiles, [
    "tileset.json",
    "metadata/versions.json",
    "metadata/state.json",
  ]);
  const manifest = JSON.parse(
    await readFile(path.join(root, "tileset.json"), "utf8"),
  );
  assert.match(manifest.asset.tilesetVersion, /^[a-f0-9]{32}$/);
});

test("reports invalid options without a stack trace", () => {
  for (const argumentsList of [
    ["--unknown"],
    ["--root"],
    ["--scope", "missing-separator"],
  ]) {
    const result = run(argumentsList);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
});

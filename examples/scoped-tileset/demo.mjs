import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildScopedVersionMap } from "tileset-scope-versioner";

const source = fileURLToPath(new URL("data", import.meta.url));
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "tileset-scope-versioner-example-"),
);
const root = path.join(temporaryRoot, "tiles");

const versionsById = (result) => Object.fromEntries(
  result.versionMap.scopes.map(({ id, version }) => [id, version]),
);

try {
  await cp(source, root, { recursive: true });
  const before = versionsById(await buildScopedVersionMap({ root }));

  const northManifestPath = path.join(root, "north", "tileset.json");
  const northManifest = JSON.parse(
    await readFile(northManifestPath, "utf8"),
  );
  northManifest.extras.revision = 2;
  await writeFile(
    northManifestPath,
    `${JSON.stringify(northManifest, null, 2)}\n`,
    "utf8",
  );

  const after = versionsById(await buildScopedVersionMap({ root }));
  process.stdout.write(`${JSON.stringify({
    before,
    after,
    changed: {
      root: before.root !== after.root,
      north: before["external:north"] !== after["external:north"],
      south: before["external:south"] !== after["external:south"],
    },
  }, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

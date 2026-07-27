import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";

const toPosix = (value) => value.split(path.sep).join("/");
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const isWithin = (root, candidate) => (
  candidate === root || candidate.startsWith(`${root}${path.sep}`)
);

const isRemoteReference = (uri) => (
  /^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith("//")
);

const withoutQueryOrFragment = (uri) => uri.split(/[?#]/, 1)[0];

export const resolveLocalReference = ({
  root,
  fromManifest,
  uri,
}) => {
  if (typeof uri !== "string" || uri.length === 0) return null;
  if (isRemoteReference(uri) || uri.startsWith("/")) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(withoutQueryOrFragment(uri));
  } catch {
    throw new TypeError(`invalid percent-encoding in tileset URI: ${uri}`);
  }
  if (decoded.length === 0) return null;
  if (decoded.includes("\0")) {
    throw new TypeError("tileset URI cannot contain a null byte");
  }

  const absoluteRoot = path.resolve(root);
  const manifestDirectory = path.dirname(fromManifest);
  const absolute = path.resolve(absoluteRoot, manifestDirectory, decoded);
  if (!isWithin(absoluteRoot, absolute)) {
    throw new RangeError(`tileset URI escapes the asset root: ${uri}`);
  }
  return toPosix(path.relative(absoluteRoot, absolute));
};

const contentUris = (rootTile) => {
  const output = [];
  const pending = [rootTile];
  while (pending.length > 0) {
    const tile = pending.pop();
    if (!tile || typeof tile !== "object") continue;
    const contents = [
      tile.content,
      ...(Array.isArray(tile.contents) ? tile.contents : []),
    ];
    for (const content of contents) {
      const uri = content?.uri ?? content?.url;
      if (typeof uri === "string") output.push(uri);
    }
    const children = Array.isArray(tile.children) ? tile.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return output;
};

const readJsonInsideRoot = async (root, relative) => {
  const file = path.join(root, relative);
  const metadata = await lstat(file);
  if (metadata.isSymbolicLink()) {
    throw new TypeError(`tileset manifest cannot be a symbolic link: ${relative}`);
  }
  const [realRoot, realFile] = await Promise.all([
    realpath(root),
    realpath(file),
  ]);
  if (!isWithin(realRoot, realFile)) {
    throw new RangeError(`tileset manifest escapes the asset root: ${relative}`);
  }
  return JSON.parse(await readFile(file, "utf8"));
};

/**
 * Discover local external tilesets by following JSON content references.
 * Network, data, and root-absolute references are intentionally left alone.
 */
export const discoverExternalTilesets = async (options = {}) => {
  if (
    typeof options !== "object"
    || options === null
    || Array.isArray(options)
  ) {
    throw new TypeError("discovery options must be an object");
  }
  for (const name of Object.keys(options)) {
    if (name !== "root" && name !== "rootTileset") {
      throw new TypeError(`unknown discovery option: ${name}`);
    }
  }
  const {
    root,
    rootTileset = "tileset.json",
  } = options;
  if (!root) throw new TypeError("root is required");
  const absoluteRoot = path.resolve(root);
  const rootReference = resolveLocalReference({
    root: absoluteRoot,
    fromManifest: "entry.json",
    uri: rootTileset,
  });
  if (rootReference === null) {
    throw new TypeError("rootTileset must be a relative local path");
  }
  if (rootReference === "" || rootReference === ".") {
    throw new TypeError("rootTileset must name a JSON file");
  }

  const queue = [rootReference];
  const manifests = new Map();
  while (queue.length > 0) {
    const manifest = queue.shift();
    if (manifests.has(manifest)) continue;

    const document = await readJsonInsideRoot(absoluteRoot, manifest);
    const references = [];
    const externalManifests = [];
    for (const uri of contentUris(document.root)) {
      const local = resolveLocalReference({
        root: absoluteRoot,
        fromManifest: manifest,
        uri,
      });
      if (!local) continue;
      references.push(local);
      if (/\.json$/i.test(local)) {
        externalManifests.push(local);
        queue.push(local);
      }
    }

    const directory = toPosix(path.dirname(manifest));
    manifests.set(manifest, {
      manifest,
      directory: directory === "." ? "." : directory,
      references: [...new Set(references)].sort(),
      externalManifests: [...new Set(externalManifests)].sort(),
    });
  }

  return [...manifests.values()].sort((left, right) => {
    if (left.manifest === rootReference) return -1;
    if (right.manifest === rootReference) return 1;
    return compareText(left.manifest, right.manifest);
  });
};

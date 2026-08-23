import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { discoverExternalTilesets } from "./discover.js";

const toPosix = (value) => value.split(path.sep).join("/");
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const isWithin = (root, candidate) => (
  candidate === root || candidate.startsWith(`${root}${path.sep}`)
);

const pathsOverlap = (left, right) => (
  left === right
  || left.startsWith(`${right}/`)
  || right.startsWith(`${left}/`)
);

const relativeInsideRoot = (root, value, label) => {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, value);
  if (!isWithin(absoluteRoot, absolute)) {
    throw new RangeError(`${label} must stay inside the asset root`);
  }
  const relative = toPosix(path.relative(absoluteRoot, absolute));
  return { absolute, relative: relative || "." };
};

const assertSafeOutputPath = async (root, file, label) => {
  const absoluteRoot = path.resolve(root);
  const absoluteFile = path.resolve(file);
  if (!isWithin(absoluteRoot, absoluteFile)) {
    throw new RangeError(`${label} must stay inside the asset root`);
  }

  const parent = path.dirname(absoluteFile);
  const relativeParent = path.relative(absoluteRoot, parent);
  let current = absoluteRoot;
  for (const part of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw new TypeError(
        `${label} parent cannot be a symbolic link: ${toPosix(path.relative(absoluteRoot, current))}`,
      );
    }
    if (!metadata.isDirectory()) {
      throw new TypeError(
        `${label} parent is not a directory: ${toPosix(path.relative(absoluteRoot, current))}`,
      );
    }
  }

  const [realRoot, realParent] = await Promise.all([
    realpath(absoluteRoot),
    realpath(parent),
  ]);
  if (!isWithin(realRoot, realParent)) {
    throw new RangeError(`${label} parent resolves outside the asset root`);
  }
};

const stableJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
};

const canonicalTilesetBytes = async (file) => {
  const document = JSON.parse(await readFile(file, "utf8"));
  if (document.asset && typeof document.asset === "object") {
    delete document.asset.tilesetVersion;
    if (Object.keys(document.asset).length === 0) delete document.asset;
  }
  return Buffer.from(stableJson(document));
};

const hashFile = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
};

const shouldSkipDirectory = (relative, excludedDirectories) => (
  excludedDirectories.some((excluded) => (
    relative === excluded || relative.startsWith(`${excluded}/`)
  ))
);

const walkFiles = async ({
  root,
  start,
  excludedDirectories = [],
  ignoredFiles = new Set(),
}) => {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = toPosix(path.relative(root, absolute));
      if (entry.name === ".DS_Store" || ignoredFiles.has(relative)) continue;
      if (entry.isSymbolicLink()) {
        throw new TypeError(`symbolic links are not accepted in version scopes: ${relative}`);
      }
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(relative, excludedDirectories)) {
          await visit(absolute);
        }
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };
  await visit(start);
  return files.sort();
};

const hashRecords = async ({ root, files, manifests = new Set() }) => {
  const scopeHash = createHash("sha256");
  for (const relative of files) {
    const absolute = path.join(root, relative);
    const contentHash = manifests.has(relative)
      ? createHash("sha256")
        .update(await canonicalTilesetBytes(absolute))
        .digest("hex")
      : await hashFile(absolute);
    scopeHash.update(relative);
    scopeHash.update("\0");
    scopeHash.update(contentHash);
    scopeHash.update("\n");
  }
  return scopeHash.digest("hex");
};

const scopeSignaturesFor = (versionMap, fingerprints) => Object.fromEntries(
  versionMap.scopes.map((scope) => {
    const signature = createHash("sha256")
      .update(stableJson({
        fingerprint: fingerprints[scope.id],
        prefix: scope.prefix,
        match: scope.match,
        manifests: scope.manifests ?? [],
      }))
      .digest("hex");
    return [scope.id, signature];
  }),
);

const groupDiscoveredScopes = (discovered, rootTileset) => {
  const groups = new Map();
  for (const item of discovered) {
    const group = groups.get(item.directory) ?? {
      id: item.manifest === rootTileset ? "root" : `external:${item.directory}`,
      path: item.directory,
      prefix: item.directory === "." ? "" : `${item.directory}/`,
      match: "prefix",
      manifests: [],
      automatic: true,
    };
    group.manifests.push(item.manifest);
    if (item.manifest === rootTileset) group.id = "root";
    groups.set(item.directory, group);
  }
  return [...groups.values()]
    .map((scope) => ({
      ...scope,
      manifests: scope.manifests.sort(),
    }))
    .sort((left, right) => {
      if (left.id === "root") return -1;
      if (right.id === "root") return 1;
      return compareText(left.path, right.path);
    });
};

const nestedScopeDirectories = (scope, automaticScopes) => {
  const base = scope.path === "." ? "" : `${scope.path}/`;
  return automaticScopes
    .filter((candidate) => candidate.path !== scope.path)
    .map((candidate) => candidate.path)
    .filter((candidate) => (
      scope.path === "." || candidate.startsWith(base)
    ));
};

const automaticFingerprint = async ({
  root,
  scope,
  automaticScopes,
  additionalScopes,
  ignoredFiles,
}) => {
  const start = scope.path === "." ? root : path.join(root, scope.path);
  const scopePrefix = scope.path === "." ? "" : `${scope.path}/`;
  const detachedDirectories = additionalScopes
    .filter((candidate) => candidate.isDirectory)
    .map((candidate) => candidate.path)
    .filter((candidate) => (
      scope.path === "." || candidate.startsWith(scopePrefix)
    ));
  const scopedIgnoredFiles = new Set(ignoredFiles);
  for (const candidate of additionalScopes.filter((item) => !item.isDirectory)) {
    if (scope.path === "." || candidate.path.startsWith(scopePrefix)) {
      scopedIgnoredFiles.add(candidate.path);
    }
  }
  const files = await walkFiles({
    root,
    start,
    excludedDirectories: [
      ...nestedScopeDirectories(scope, automaticScopes),
      ...detachedDirectories,
    ],
    ignoredFiles: scopedIgnoredFiles,
  });
  return hashRecords({
    root,
    files,
    manifests: new Set(scope.manifests),
  });
};

const inspectAdditionalScope = async ({ root, scope }) => {
  const location = relativeInsideRoot(root, scope.path, `scope ${scope.id}`);
  const metadata = await lstat(location.absolute);
  if (metadata.isSymbolicLink()) {
    throw new TypeError(`scope ${scope.id} cannot target a symbolic link`);
  }
  const [realRoot, realLocation] = await Promise.all([
    realpath(root),
    realpath(location.absolute),
  ]);
  if (!isWithin(realRoot, realLocation)) {
    throw new RangeError(`scope ${scope.id} resolves outside the asset root`);
  }
  return {
    path: location.relative,
    isDirectory: metadata.isDirectory(),
  };
};

const normalizeAdditionalScope = async ({ root, scope }) => {
  if (
    typeof scope !== "object"
    || scope === null
    || Array.isArray(scope)
  ) {
    throw new TypeError("each additional scope must be an object");
  }
  for (const name of Object.keys(scope)) {
    if (!["id", "path", "prefix", "match"].includes(name)) {
      throw new TypeError(`unknown additional scope field: ${name}`);
    }
  }
  if (typeof scope.id !== "string" || scope.id.length === 0) {
    throw new TypeError("each additional scope requires a non-empty id");
  }
  if (typeof scope.path !== "string" || scope.path.length === 0) {
    throw new TypeError(`scope ${scope.id} requires a path`);
  }
  const result = await inspectAdditionalScope({ root, scope });
  const defaultPrefix = result.isDirectory
    ? result.path === "." ? "" : `${result.path}/`
    : result.path;
  const prefix = scope.prefix ?? defaultPrefix;
  if (typeof prefix !== "string") {
    throw new TypeError(`scope ${scope.id} prefix must be a string`);
  }
  const normalizedPrefix = prefix.replace(/^\/+/, "");
  if (
    normalizedPrefix.includes("\\")
    || normalizedPrefix.includes("?")
    || normalizedPrefix.includes("#")
    || normalizedPrefix.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new TypeError(`scope ${scope.id} prefix is invalid`);
  }
  const match = scope.match ?? (result.isDirectory ? "prefix" : "exact");
  if (match !== "prefix" && match !== "exact") {
    throw new TypeError(`scope ${scope.id} match must be "prefix" or "exact"`);
  }
  return {
    id: scope.id,
    path: result.path,
    prefix: normalizedPrefix,
    match,
    manifests: [],
    automatic: false,
    isDirectory: result.isDirectory,
  };
};

const fingerprintAdditionalScope = async ({
  root,
  scope,
  automaticScopes,
  additionalScopes,
  ignoredFiles,
}) => {
  if (!scope.isDirectory) {
    return hashRecords({ root, files: [scope.path] });
  }

  const prefix = scope.path === "." ? "" : `${scope.path}/`;
  const nestedDirectories = [
    ...automaticScopes,
    ...additionalScopes,
  ]
    .filter((candidate) => candidate.path !== scope.path)
    .filter((candidate) => candidate.path.startsWith(prefix))
    .filter((candidate) => candidate.automatic || candidate.isDirectory)
    .map((candidate) => candidate.path);
  const scopedIgnoredFiles = new Set(ignoredFiles);
  for (const candidate of additionalScopes.filter((item) => !item.isDirectory)) {
    if (candidate.path.startsWith(prefix)) {
      scopedIgnoredFiles.add(candidate.path);
    }
  }
  const start = scope.path === "." ? root : path.join(root, scope.path);
  const files = await walkFiles({
    root,
    start,
    excludedDirectories: nestedDirectories,
    ignoredFiles: scopedIgnoredFiles,
  });
  return hashRecords({ root, files });
};

const ensureUniqueScopes = (scopes) => {
  const ids = new Set();
  const selectors = new Set();
  for (const scope of scopes) {
    if (ids.has(scope.id)) throw new TypeError(`duplicate scope id: ${scope.id}`);
    ids.add(scope.id);
    const normalizedSelector = scope.match === "prefix"
      ? scope.prefix.replace(/\/$/, "")
      : scope.prefix;
    const selector = `${scope.match}:${normalizedSelector}`;
    if (selectors.has(selector)) {
      throw new TypeError(`duplicate scope selector: ${selector}`);
    }
    selectors.add(selector);
  }
};

const ensureIndependentScopePaths = (automaticScopes, additionalScopes) => {
  const additionalPaths = new Set();
  for (const scope of additionalScopes) {
    if (additionalPaths.has(scope.path)) {
      throw new TypeError(`duplicate additional scope path: ${scope.path}`);
    }
    additionalPaths.add(scope.path);
    const automatic = automaticScopes.find(
      (candidate) => candidate.path === scope.path,
    );
    if (automatic) {
      throw new TypeError(
        `scope ${scope.id} duplicates automatic scope path ${scope.path}`,
      );
    }
  }
};

const readState = async (file) => {
  try {
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink()) {
      throw new TypeError(`refusing to read symbolic-link state: ${file}`);
    }
    if (!metadata.isFile()) {
      throw new TypeError(`state path is not a regular file: ${file}`);
    }
    const state = JSON.parse(await readFile(file, "utf8"));
    if (
      typeof state !== "object"
      || state === null
      || Array.isArray(state)
      || state.schemaVersion !== 1
      || state.algorithm !== "sha256"
      || typeof state.fingerprints !== "object"
      || state.fingerprints === null
      || Array.isArray(state.fingerprints)
    ) {
      throw new TypeError("state file has an unsupported format");
    }
    for (const [id, fingerprint] of Object.entries(state.fingerprints)) {
      if (id.length === 0 || !/^[a-f\d]{64}$/.test(fingerprint)) {
        throw new TypeError("state file contains an invalid fingerprint");
      }
    }
    if (
      state.scopeSignatures !== undefined
      && (
        typeof state.scopeSignatures !== "object"
        || state.scopeSignatures === null
        || Array.isArray(state.scopeSignatures)
      )
    ) {
      throw new TypeError("state file contains invalid scope signatures");
    }
    for (const [id, signature] of Object.entries(state.scopeSignatures ?? {})) {
      if (id.length === 0 || !/^[a-f\d]{64}$/.test(signature)) {
        throw new TypeError("state file contains an invalid scope signature");
      }
    }
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const existingFileMode = async (file) => {
  try {
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink()) {
      throw new TypeError(`refusing to replace symbolic-link output: ${file}`);
    }
    if (!metadata.isFile()) {
      throw new TypeError(`output path is not a regular file: ${file}`);
    }
    return metadata.mode & 0o777;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
};

const writeJsonAtomic = async ({
  root,
  file,
  value,
  label,
}) => {
  await assertSafeOutputPath(root, file, label);
  await mkdir(path.dirname(file), { recursive: true });
  await assertSafeOutputPath(root, file, label);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const mode = await existingFileMode(file);
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(value, null, 2)}\n`,
      mode === undefined ? "utf8" : { encoding: "utf8", mode },
    );
    await assertSafeOutputPath(root, file, label);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
};

const writeStandardVersions = async ({ root, scopes, versionMap }) => {
  const updates = [];
  const versions = new Map(versionMap.scopes.map((scope) => [scope.id, scope.version]));
  for (const scope of scopes.filter((item) => item.automatic)) {
    const version = versions.get(scope.id);
    for (const manifest of scope.manifests) {
      const file = path.join(root, manifest);
      const document = JSON.parse(await readFile(file, "utf8"));
      if (
        document.asset !== undefined
        && (
          document.asset === null
          || typeof document.asset !== "object"
          || Array.isArray(document.asset)
        )
      ) {
        throw new TypeError(`${manifest}: asset must be an object`);
      }
      document.asset ??= {};
      if (document.asset.tilesetVersion === version) continue;
      document.asset.tilesetVersion = version;
      updates.push({ file, manifest, document });
    }
  }
  await Promise.all(updates.map(({ file }) => existingFileMode(file)));
  const written = [];
  for (const update of updates) {
    await writeJsonAtomic({
      root,
      file: update.file,
      value: update.document,
      label: `tileset manifest ${update.manifest}`,
    });
    written.push(update.manifest);
  }
  return written;
};

const assertSafeOutputLocations = ({
  rootTileset,
  state,
  sidecar,
  manifests = [],
}) => {
  const outputs = [
    { label: "stateFile", location: state },
    { label: "sidecarFile", location: sidecar },
  ];
  for (const output of outputs) {
    if (output.location.relative === ".") {
      throw new RangeError(`${output.label} must name a file inside the asset root`);
    }
  }
  if (pathsOverlap(state.relative, sidecar.relative)) {
    throw new RangeError("stateFile and sidecarFile must not overlap");
  }
  const manifestPaths = new Set([
    rootTileset.relative,
    ...manifests.map((item) => item.manifest),
  ]);
  for (const output of outputs) {
    for (const manifest of manifestPaths) {
      if (pathsOverlap(output.location.relative, manifest)) {
        throw new RangeError(
          `${output.label} must not overlap tileset manifest ${manifest}`,
        );
      }
    }
  }
};

const assertScopeDoesNotConsumeOutput = (scope, outputs) => {
  for (const output of outputs) {
    if (!pathsOverlap(scope.path, output.location.relative)) continue;
    const containsOutput = scope.isDirectory && (
      scope.path === "."
      || output.location.relative.startsWith(`${scope.path}/`)
    );
    if (!containsOutput) {
      throw new RangeError(
        `scope ${scope.id} must not overlap ${output.label}`,
      );
    }
  }
};

/**
 * Read a tileset tree and calculate deterministic, directory-local versions.
 */
export const buildScopedVersionMap = async (options = {}) => {
  if (
    typeof options !== "object"
    || options === null
    || Array.isArray(options)
  ) {
    throw new TypeError("version-map options must be an object");
  }
  const allowedOptions = new Set([
    "root",
    "rootTileset",
    "stateFile",
    "sidecarFile",
    "additionalScopes",
    "now",
  ]);
  for (const name of Object.keys(options)) {
    if (!allowedOptions.has(name)) {
      throw new TypeError(`unknown version-map option: ${name}`);
    }
  }
  const {
    root,
    rootTileset = "tileset.json",
    stateFile = ".scoped-version-state.json",
    sidecarFile = "asset-versions.json",
    additionalScopes = [],
    now = new Date(),
  } = options;
  if (!root) throw new TypeError("root is required");
  if (!Array.isArray(additionalScopes)) {
    throw new TypeError("additionalScopes must be an array");
  }
  const absoluteRoot = path.resolve(root);
  const rootTilesetLocation = relativeInsideRoot(
    absoluteRoot,
    rootTileset,
    "rootTileset",
  );
  const stateLocation = relativeInsideRoot(absoluteRoot, stateFile, "stateFile");
  const sidecarLocation = relativeInsideRoot(
    absoluteRoot,
    sidecarFile,
    "sidecarFile",
  );
  assertSafeOutputLocations({
    rootTileset: rootTilesetLocation,
    state: stateLocation,
    sidecar: sidecarLocation,
  });
  await Promise.all([
    assertSafeOutputPath(absoluteRoot, stateLocation.absolute, "stateFile"),
    assertSafeOutputPath(absoluteRoot, sidecarLocation.absolute, "sidecarFile"),
  ]);
  const ignoredFiles = new Set([
    stateLocation.relative,
    sidecarLocation.relative,
  ]);
  const discovered = await discoverExternalTilesets({
    root: absoluteRoot,
    rootTileset: rootTilesetLocation.relative,
  });
  assertSafeOutputLocations({
    rootTileset: rootTilesetLocation,
    state: stateLocation,
    sidecar: sidecarLocation,
    manifests: discovered,
  });
  const automaticScopes = groupDiscoveredScopes(
    discovered,
    rootTilesetLocation.relative,
  );

  const extras = [];
  for (const scope of additionalScopes) {
    const normalized = await normalizeAdditionalScope({
      root: absoluteRoot,
      scope,
    });
    assertScopeDoesNotConsumeOutput(normalized, [
      { label: "stateFile", location: stateLocation },
      { label: "sidecarFile", location: sidecarLocation },
    ]);
    extras.push(normalized);
  }
  ensureUniqueScopes([...automaticScopes, ...extras]);
  ensureIndependentScopePaths(automaticScopes, extras);
  for (const scope of automaticScopes) {
    scope.fingerprint = await automaticFingerprint({
      root: absoluteRoot,
      scope,
      automaticScopes,
      additionalScopes: extras,
      ignoredFiles,
    });
  }
  for (const scope of extras) {
    scope.fingerprint = await fingerprintAdditionalScope({
      root: absoluteRoot,
      scope,
      automaticScopes,
      additionalScopes: extras,
      ignoredFiles,
    });
  }
  const scopes = [...automaticScopes, ...extras];

  const publicScopes = scopes.map((scope) => ({
    id: scope.id,
    prefix: scope.prefix,
    match: scope.match,
    version: scope.fingerprint.slice(0, 32),
    ...(scope.manifests.length > 0 ? { manifests: scope.manifests } : {}),
  }));
  const rootScope = publicScopes.find((scope) => scope.id === "root");
  const versionMap = {
    schemaVersion: 1,
    algorithm: "sha256-128",
    generatedAt: new Date(now).toISOString(),
    defaultVersion: rootScope?.version ?? null,
    scopes: publicScopes,
  };
  const fingerprints = Object.fromEntries(
    scopes.map((scope) => [scope.id, scope.fingerprint]),
  );

  return {
    root: absoluteRoot,
    stateFile: stateLocation.absolute,
    sidecarFile: sidecarLocation.absolute,
    versionMap,
    fingerprints,
    scopes,
  };
};

/**
 * Publish a sidecar map and state file, optionally updating the standard
 * `asset.tilesetVersion` field in each discovered manifest.
 */
export const publishScopedVersions = async (options = {}) => {
  if (
    typeof options !== "object"
    || options === null
    || Array.isArray(options)
  ) {
    throw new TypeError("publish options must be an object");
  }
  const allowedOptions = new Set([
    "root",
    "rootTileset",
    "stateFile",
    "sidecarFile",
    "additionalScopes",
    "now",
    "dryRun",
    "writeStandard",
  ]);
  for (const name of Object.keys(options)) {
    if (!allowedOptions.has(name)) {
      throw new TypeError(`unknown publish option: ${name}`);
    }
  }
  if (
    options.dryRun !== undefined
    && typeof options.dryRun !== "boolean"
  ) {
    throw new TypeError("dryRun must be a boolean");
  }
  if (
    options.writeStandard !== undefined
    && typeof options.writeStandard !== "boolean"
  ) {
    throw new TypeError("writeStandard must be a boolean");
  }
  const {
    dryRun = false,
    writeStandard = false,
    ...buildOptions
  } = options;
  const built = await buildScopedVersionMap(buildOptions);
  const previous = await readState(built.stateFile);
  const previousFingerprints = previous?.fingerprints ?? {};
  const scopeSignatures = scopeSignaturesFor(
    built.versionMap,
    built.fingerprints,
  );
  const previousSignatures = previous?.scopeSignatures;
  const changedScopes = Object.entries(built.fingerprints)
    .filter(([id, fingerprint]) => (
      previousSignatures && Object.hasOwn(previousSignatures, id)
        ? previousSignatures[id] !== scopeSignatures[id]
        : previousFingerprints[id] !== fingerprint
    ))
    .map(([id]) => id);
  for (const id of Object.keys(previousFingerprints).sort()) {
    if (!Object.hasOwn(built.fingerprints, id)) changedScopes.push(id);
  }
  const writtenFiles = [];

  if (!dryRun) {
    await Promise.all([
      existingFileMode(built.sidecarFile),
      existingFileMode(built.stateFile),
    ]);
  }
  if (!dryRun && writeStandard) {
    writtenFiles.push(...await writeStandardVersions({
      root: built.root,
      scopes: built.scopes,
      versionMap: built.versionMap,
    }));
  }
  if (!dryRun) {
    await writeJsonAtomic({
      root: built.root,
      file: built.sidecarFile,
      value: built.versionMap,
      label: "sidecarFile",
    });
    writtenFiles.push(toPosix(path.relative(built.root, built.sidecarFile)));
    await writeJsonAtomic({
      root: built.root,
      file: built.stateFile,
      label: "stateFile",
      value: {
        schemaVersion: 1,
        algorithm: "sha256",
        generatedAt: built.versionMap.generatedAt,
        fingerprints: built.fingerprints,
        scopeSignatures,
      },
    });
    writtenFiles.push(toPosix(path.relative(built.root, built.stateFile)));
  }

  return {
    versionMap: built.versionMap,
    changedScopes,
    writtenFiles,
    dryRun,
  };
};

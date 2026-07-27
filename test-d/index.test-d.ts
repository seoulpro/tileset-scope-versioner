import {
  appendScopedVersion,
  buildScopedVersionMap,
  createUrlPreprocessor,
  discoverExternalTilesets,
  publishScopedVersions,
  resolveLocalReference,
  resolveVersionForUrl,
  type BuildScopedVersionResult,
  type PublishScopedVersionResult,
  type ScopedVersionMap,
  type VersionMapInput,
} from "tileset-scope-versioner";
import {
  discoverExternalTilesets as discoverFromSubpath,
} from "tileset-scope-versioner/discover";
import {
  appendScopedVersion as appendFromSubpath,
} from "tileset-scope-versioner/url";
import {
  buildScopedVersionMap as buildFromSubpath,
} from "tileset-scope-versioner/versioner";

const inputMap: VersionMapInput = {
  defaultVersion: "root-v1",
  scopes: [{
    id: "region",
    prefix: "region/",
    match: "prefix",
    version: "region-v2",
  }],
};

const resolvedVersion: string | null = resolveVersionForUrl(
  "region/tile.glb",
  inputMap,
  { baseUrl: new URL("https://cdn.example.test/tiles/") },
);
const versionedUrl: string = appendScopedVersion(
  "region/tile.glb",
  inputMap,
  { parameter: "rev" },
);
const preprocess: (asset: string) => string = createUrlPreprocessor(inputMap);
preprocess(versionedUrl);

const reference: string | null = resolveLocalReference({
  root: "/tmp/tiles",
  fromManifest: "region/tileset.json",
  uri: "model.glb",
});
void reference;

const discovered: Promise<import(
  "tileset-scope-versioner"
).DiscoveredTileset[]> = discoverExternalTilesets({
  root: "/tmp/tiles",
});
const discoveredFromSubpath = discoverFromSubpath({ root: "/tmp/tiles" });
void discovered;
void discoveredFromSubpath;

const built: Promise<BuildScopedVersionResult> = buildScopedVersionMap({
  root: "/tmp/tiles",
  now: new Date(),
  additionalScopes: [{
    id: "shared-textures",
    path: "shared",
    match: "prefix",
  }],
});
const published: Promise<PublishScopedVersionResult> = publishScopedVersions({
  root: "/tmp/tiles",
  dryRun: true,
  writeStandard: false,
});
void built;
void published;
void buildFromSubpath;
void appendFromSubpath;

const fullMap: ScopedVersionMap = {
  schemaVersion: 1,
  algorithm: "sha256-128",
  generatedAt: new Date().toISOString(),
  defaultVersion: "root-v1",
  scopes: [{
    id: "root",
    prefix: "",
    match: "prefix",
    version: "root-v1",
  }],
};
appendScopedVersion("asset.glb", fullMap);

// @ts-expect-error root is required
buildScopedVersionMap({});
appendScopedVersion("asset.glb", {
  // @ts-expect-error match is intentionally constrained
  scopes: [{ prefix: "", match: "starts-with", version: "v1" }],
});

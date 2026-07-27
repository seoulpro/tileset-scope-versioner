export {
  discoverExternalTilesets,
  resolveLocalReference,
} from "./discover.js";
export type {
  DiscoverOptions,
  DiscoveredTileset,
  LocalReferenceOptions,
} from "./discover.js";

export {
  buildScopedVersionMap,
  publishScopedVersions,
} from "./versioner.js";
export type {
  AdditionalScope,
  BuildScopedVersionOptions,
  BuildScopedVersionResult,
  ComputedScope,
  PublishScopedVersionOptions,
  PublishScopedVersionResult,
  ScopedVersionMap,
  ScopeMatch,
  VersionScope,
} from "./versioner.js";

export {
  appendScopedVersion,
  createUrlPreprocessor,
  resolveVersionForUrl,
} from "./url.js";
export type {
  AppendUrlOptions,
  ResolveUrlOptions,
  UrlVersionScope,
  VersionMapInput,
} from "./url.js";

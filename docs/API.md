# API reference

`tileset-scope-versioner` is ESM-only. Every public function is available from
the package root and from the documented subpath shown below.

## Discovery

### `resolveLocalReference(options)`

Available from `tileset-scope-versioner/discover`.

Resolves a manifest-relative URI to a POSIX-style path beneath `options.root`.
`options.fromManifest` is also relative to the root. Query strings and
fragments are removed before resolution.

The function returns `null` for empty, network, data, protocol-relative, and
root-absolute references. It throws when percent encoding is malformed, a null
byte is present, or the decoded path escapes the root.

### `discoverExternalTilesets(options)`

Available from `tileset-scope-versioner/discover`.

Starts at `options.rootTileset` (default `tileset.json`) and follows local JSON
content references. The result is a deterministic array with the root first:

```ts
interface DiscoveredTileset {
  manifest: string;
  directory: string;
  references: string[];
  externalManifests: string[];
}
```

Cycles and repeated references are safe. Remote content is not fetched.
Manifest links and paths that resolve outside the root are rejected.

## Version maps

### `buildScopedVersionMap(options)`

Available from `tileset-scope-versioner/versioner`.

Reads the asset tree and returns fingerprints, computed scope details, and the
public version map without writing files. Required and optional fields are:

```ts
interface BuildScopedVersionOptions {
  root: string;
  rootTileset?: string;
  stateFile?: string;
  sidecarFile?: string;
  additionalScopes?: Array<{
    id: string;
    path: string;
    prefix?: string;
    match?: "exact" | "prefix";
  }>;
  now?: Date | string | number;
}
```

Directory scopes default to prefix matching. File scopes default to exact
matching. Nested automatic and explicit scopes are excluded from their parent
scope, so changing a nested scope does not rotate an ancestor. Two explicit
scopes cannot target the same path, and an explicit scope cannot replace an
automatic scope at the same path. Generated output paths are excluded from
fingerprints.

### `publishScopedVersions(options)`

Available from `tileset-scope-versioner/versioner`.

Accepts the build options plus:

```ts
interface PublishScopedVersionOptions extends BuildScopedVersionOptions {
  dryRun?: boolean;
  writeStandard?: boolean;
}
```

Unless `dryRun` is true, it writes the public sidecar and private state file.
When `writeStandard` is true, each discovered manifest also receives the
version for its automatic scope in `asset.tilesetVersion`.

The result contains `versionMap`, `changedScopes`, `writtenFiles`, and
`dryRun`. `changedScopes` includes new scopes, changed content, selector-only
changes, and IDs removed since the previous publication.

Each output is replaced atomically. A multi-file publication is not a
filesystem transaction; use a staged directory and an external atomic switch
when the complete tree must become visible at once.

## URL helpers

### `resolveVersionForUrl(asset, versionMap, options?)`

Available from `tileset-scope-versioner/url`.

Returns the longest matching version or the map's default version. Pass an
absolute HTTP(S) directory `baseUrl` when `asset` can be absolute. An exact
match wins when an exact and prefix selector have equal path length. Returns
`null` for assets the helper cannot place inside the root: non-HTTP schemes,
paths that escape the implicit root, and URLs outside `baseUrl`. In those cases
the default version is not applied.

### `appendScopedVersion(asset, versionMap, options?)`

Available from `tileset-scope-versioner/url`.

Adds or replaces the query parameter selected by `options.parameter`
(default `v`). Existing query parameters and fragments are preserved.
Non-HTTP schemes, root escapes, and URLs outside `baseUrl` are returned
unchanged. Malformed percent encoding and encoded path separators are rejected
because they cannot be mapped to one unambiguous scope.

When `baseUrl` is provided, the returned URL is absolute. Without it, relative,
root-absolute, absolute, and protocol-relative input forms are preserved.

### `createUrlPreprocessor(versionMap, options?)`

Available from `tileset-scope-versioner/url`.

Returns an `(asset: string) => string` function that applies
`appendScopedVersion` with the supplied map and options. This is useful for
renderer or loader URL-preprocessing hooks.

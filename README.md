# tileset-scope-versioner

[![npm](https://img.shields.io/npm/v/tileset-scope-versioner.svg)](https://www.npmjs.com/package/tileset-scope-versioner)

Content-addressed, scope-local cache versions for external 3D Tiles trees.

A single deployment-wide cache token is easy to implement, but changing one
small external tileset then invalidates every model and texture. This package
discovers local external tilesets, treats their directories as independent
version scopes, and hashes each scope without folding nested scopes into the
parent. One changed region can therefore receive one new token.

The implementation has no renderer, web framework, cloud provider, or
application schema dependency.

## Install

```sh
npm install tileset-scope-versioner
```

Node.js 22 or newer is required. The package is ESM-only, includes TypeScript
declarations, and has no runtime dependencies.

## What it produces

Given this tree:

```text
tileset.json
north/tileset.json
north/model.glb
south/tileset.json
south/model.glb
```

the sidecar contains a default root version and separate `north/` and `south/`
versions:

```json
{
  "schemaVersion": 1,
  "algorithm": "sha256-128",
  "generatedAt": "2026-07-27T00:00:00.000Z",
  "defaultVersion": "ca64d7e9fddcc93d512147f42d1e0d53",
  "scopes": [
    {
      "id": "root",
      "prefix": "",
      "match": "prefix",
      "version": "ca64d7e9fddcc93d512147f42d1e0d53",
      "manifests": ["tileset.json"]
    },
    {
      "id": "external:north",
      "prefix": "north/",
      "match": "prefix",
      "version": "db18b48153d50e421df5afb76911fc29",
      "manifests": ["north/tileset.json"]
    },
    {
      "id": "external:south",
      "prefix": "south/",
      "match": "prefix",
      "version": "7f3c0a51b9e264d8a1c6e0f4b2d78a90",
      "manifests": ["south/tileset.json"]
    }
  ]
}
```

Editing `south/model.glb` rotates only the `south/` version; the root and
`north/` tokens are unchanged. Tokens in this example are illustrative.

A runnable version of this tree ships in the package under
`examples/scoped-tileset`. From a repository clone, run:

```sh
node examples/scoped-tileset/demo.mjs
```

It edits one external tileset in a temporary copy and prints which scopes
changed. See [examples/scoped-tileset](./examples/scoped-tileset/README.md) for
the full walkthrough.

## CLI

```sh
tileset-scope-version --root ./public/tiles
```

This writes:

- `asset-versions.json`, the client-facing sidecar;
- `.scoped-version-state.json`, the previous fingerprint state.

Useful options:

```sh
# Preview only
tileset-scope-version --root ./public/tiles --dry-run

# Also set the standard field in every discovered manifest
tileset-scope-version --root ./public/tiles --write-standard

# Version shared assets independently
tileset-scope-version \
  --root ./public/tiles \
  --scope shared-textures=shared/textures

# Print the installed package version
tileset-scope-version --version
```

Generated `asset.tilesetVersion` values are removed before hashing, so writing
them does not create a self-invalidating loop. Output files and `.DS_Store`
files are excluded as well. Local references that escape the asset root and
symbolic links inside a scope are rejected.

## Library API

```js
import {
  appendScopedVersion,
  publishScopedVersions
} from "tileset-scope-versioner";

const { versionMap, changedScopes } = await publishScopedVersions({
  root: "./public/tiles",
  writeStandard: true,
  additionalScopes: [
    { id: "shared-textures", path: "shared/textures" }
  ]
});

const url = appendScopedVersion(
  "north/model.glb?quality=high",
  versionMap
);
```

For absolute asset URLs, pass the public asset base:

```js
appendScopedVersion(assetUrl, versionMap, {
  baseUrl: "https://cdn.example.test/tiles/"
});
```

`baseUrl` must be an absolute HTTP(S) directory URL ending in `/`. The URL
helper uses the longest matching prefix, and a file scope uses exact matching.
It leaves non-HTTP URLs, relative paths that escape the implicit root, and URLs
outside `baseUrl` unchanged. Protocol-relative HTTP(S) inputs remain
protocol-relative. Malformed maps, duplicate selectors, URL percent-encoding,
and encoded path separators are rejected instead of being interpreted
permissively.

See [the API reference](./docs/API.md) for all discovery, version-map, publish,
and URL helper options and return types.

## Boundaries

- Local `.json` content references are treated as external tilesets.
- Network, data, and root-absolute references are not fetched or rewritten.
- Versions are deterministic SHA-256 prefixes, not release counters.
- Directory scopes are a deployment policy layered on standard tileset
  structure; the sidecar format itself is package-specific.
- State and sidecar paths must be distinct files and cannot overlap a discovered
  manifest. Generated output used as a file scope is also rejected.
- Existing symbolic links in an output path are rejected, including links in
  parent directories.
- Each file replacement is atomic, but a publication that changes several
  manifests and sidecars is not a filesystem transaction. A process or storage
  failure can leave a subset updated; publish through a staged asset directory
  when all-or-nothing replacement is required.
- The sidecar schema and CLI may change during the `0.x` series.

Use `--dry-run` and review `changedScopes` before adding the command to a
deployment. Back up manifests when first enabling `--write-standard`.

## Standards context

This package implements cache-versioning behavior around the
[OGC 3D Tiles 1.1 Community Standard](https://docs.ogc.org/cs/22-025r4/22-025r4.html),
notably local `content.uri` references and the optional
`asset.tilesetVersion` field. 3D Tiles was created by Cesium and adopted by the
Open Geospatial Consortium.

No OGC specification text, schema, Cesium source code, or third-party runtime
is included. This is an independent implementation, is not affiliated with or
endorsed by OGC or Cesium, and does not claim conformance certification.

## Development

```sh
npm ci
npm run check
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for filesystem test expectations and
[SECURITY.md](./SECURITY.md) for private reporting.

## Related projects

- [atomic-quadtree-cut](https://github.com/seoulpro/atomic-quadtree-cut) — coherent
  refinement of streamed quadtrees, a neighbouring consistency problem.
- [render-handoff-contract](https://github.com/seoulpro/render-handoff-contract) —
  continuity policies for when tile content is exchanged mid-view.

## License

The package source is available under the [MIT license](./LICENSE). Tilesets
and other assets processed by the package remain subject to their own licenses.

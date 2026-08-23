# Contributing to tileset-scope-versioner

Issues and focused pull requests are welcome. Discuss changes to the sidecar
schema, hashing rules, scope precedence, or CLI flags before implementation;
these are compatibility-sensitive even during the `0.x` series.

## Development

Use Node.js 22 or newer:

```sh
npm ci
npm run check
```

The test suite creates disposable tileset trees in temporary directories.
Development dependencies provide declaration checking and package linting; the
published package has no runtime dependencies.

## Test expectations

Filesystem changes should cover successful output and rejection paths. In
particular, preserve these invariants:

- hashes are deterministic and exclude generated version fields;
- large non-manifest assets are hashed as streams without changing fingerprints;
- nested external scopes do not change a parent scope's hash;
- the longest matching URL prefix wins;
- `--dry-run` performs no writes;
- paths and symbolic links cannot escape the configured root;
- generated outputs cannot collide with one another, manifests, or file scopes;
- output paths cannot traverse symbolic-link parent directories;
- selector-only changes and removed scopes remain visible in `changedScopes`;
- each output replacement is atomic, while multi-file failure behavior remains
  documented and testable.

Public API changes must update the matching `.d.ts` file, the type fixture in
`test-d/`, and [docs/API.md](./docs/API.md). Package changes must keep the
installed-tarball smoke test passing.

Use small fabricated manifests and assets. Do not commit proprietary tilesets
or large binary fixtures.

Keep discovery local: fetching remote tilesets and uploading output belong in
separate deployment adapters. Any change that broadens filesystem access needs
a security-focused regression test.

See [SECURITY.md](./SECURITY.md) for private reporting. Contributions are
licensed under the [MIT license](./LICENSE).

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.1.3 - 2026-09-06

### Changed

- Hash non-manifest assets with bounded-memory streams while preserving the
  existing SHA-256 fingerprints and public version tokens.

### Added

- A worker-isolated scaling benchmark for asset hashing time and peak RSS.

## 0.1.2 - 2026-07-28

### Added

- A small, self-contained runnable example under `examples/scoped-tileset`: a
  three-scope 3D Tiles tree, a demo that shows a north-side edit rotating only
  the `north/` version, and a deterministic generator for its two tiny GLBs. The
  data is authored for this repository and validates cleanly against the 3D
  Tiles Validator.

## 0.1.1 - 2026-07-28

Metadata-only republish. No source, API, dependency, or behavior changes; the
installed code is identical to `0.1.0`.

### Changed

- Corrected the published package metadata so the release no longer carries
  build-origin fields from the initial publish.

## 0.1.0 - 2026-07-28

Initial release.

### Added

- Recursive discovery of local external 3D Tiles manifests through
  `content.uri`, legacy `content.url`, and multiple `contents` entries.
- Deterministic SHA-256 fingerprints and 128-bit public version tokens for the
  root tree, external-tileset directories, and explicit file or directory
  scopes.
- Scope-local change detection that reports content, selector, and removed
  scope changes without allowing generated outputs to invalidate themselves.
- Atomic sidecar and state-file replacement, optional updates to the standard
  `asset.tilesetVersion` field, and a write-free dry-run mode.
- URL helpers that apply the longest matching scope without changing non-HTTP,
  out-of-root, or out-of-base URLs.
- The `tileset-scope-version` CLI, including custom output paths, repeatable
  scopes, standard-field updates, dry runs, and version output.
- TypeScript declarations for every root and subpath export.
- Filesystem hardening against lexical traversal, symbolic-link escapes,
  output collisions, malformed state, and ambiguous encoded path separators.
- CI across supported Node.js releases, coverage gates, declaration and
  package linting, and an installed-tarball consumer smoke test.

# Scoped tileset example

A small, self-contained 3D Tiles tree that demonstrates scope-local versioning.
The top-level tileset references two external tilesets, `north/` and `south/`,
so the tree has three independent version scopes:

- `root` — the top-level `tileset.json`;
- `external:north` — everything under `north/`;
- `external:south` — everything under `south/`.

Editing an asset in one external directory rotates only that scope's token; the
root and the sibling directory keep their previous versions.

## Layout

```text
examples/scoped-tileset/
├── demo.mjs              # copies data to a temp dir, edits north/, rebuilds
├── generate-models.mjs   # regenerates the two tiny GLBs deterministically
└── data/
    ├── tileset.json      # root tileset → north/, south/
    ├── north/
    │   ├── tileset.json
    │   └── model.glb
    └── south/
        ├── tileset.json
        └── model.glb
```

Each `model.glb` is a deterministic 760-byte colored triangle. The data is
authored for this repository and is deliberately minimal and
renderer-independent — it is not a visual showcase or a conformance
certification.

## Run the demo

From a repository clone:

```sh
node examples/scoped-tileset/demo.mjs
```

The demo copies `data/` to a temporary directory, changes only
`north/tileset.json` there, rebuilds the version map before and after, and
prints the result. It never modifies the committed data. The `changed` block is
the point:

```json
"changed": {
  "root": false,
  "north": true,
  "south": false
}
```

Only `north` changed: a scope's version depends on that scope's own files, so a
north-side edit leaves the root and south tokens untouched.

## Inspect it with the CLI

A read-only dry run against the committed data prints the computed scopes
without writing anything:

```sh
node bin/tileset-scope-version.js --root examples/scoped-tileset/data --dry-run
```

## Regenerate the models

The GLBs are generated, not hand-authored. To recreate them byte-for-byte:

```sh
node examples/scoped-tileset/generate-models.mjs
```

The output is deterministic, so a clean regeneration produces identical files.

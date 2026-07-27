import assert from "node:assert/strict";
import test from "node:test";

import {
  appendScopedVersion,
  createUrlPreprocessor,
  resolveVersionForUrl,
} from "../src/index.js";

const versionMap = {
  defaultVersion: "root-v1",
  scopes: [
    { id: "root", prefix: "", match: "prefix", version: "root-v1" },
    { id: "region", prefix: "region/", match: "prefix", version: "region-v2" },
    {
      id: "detail",
      prefix: "region/detail/",
      match: "prefix",
      version: "detail-v3",
    },
    {
      id: "single",
      prefix: "shared/material.ktx2",
      match: "exact",
      version: "material-v4",
    },
  ],
};

test("chooses the longest matching scope", () => {
  assert.equal(
    resolveVersionForUrl("region/detail/tile.glb", versionMap),
    "detail-v3",
  );
  assert.equal(
    resolveVersionForUrl("region/coarse.glb", versionMap),
    "region-v2",
  );
  assert.equal(resolveVersionForUrl("other.glb", versionMap), "root-v1");
});

test("honors exact file scopes", () => {
  assert.equal(
    resolveVersionForUrl("shared/material.ktx2", versionMap),
    "material-v4",
  );
  assert.equal(
    resolveVersionForUrl("shared/material.ktx2.backup", versionMap),
    "root-v1",
  );
  assert.equal(
    resolveVersionForUrl("shared", {
      scopes: [
        { prefix: "shared/", match: "prefix", version: "directory" },
        { prefix: "shared", match: "exact", version: "file" },
      ],
    }),
    "file",
  );
});

test("appends versions without discarding existing query or fragment data", () => {
  assert.equal(
    appendScopedVersion("region/tile.glb?quality=high#mesh", versionMap),
    "region/tile.glb?quality=high&v=region-v2#mesh",
  );
  const preprocess = createUrlPreprocessor(versionMap, { parameter: "rev" });
  assert.equal(preprocess("other.glb"), "other.glb?rev=root-v1");
  assert.equal(
    appendScopedVersion("other.glb?v=old", versionMap),
    "other.glb?v=root-v1",
  );
});

test("can resolve paths relative to an absolute asset base", () => {
  assert.equal(
    resolveVersionForUrl(
      "https://cdn.example.test/assets/region/tile.glb",
      versionMap,
      { baseUrl: "https://cdn.example.test/assets/" },
    ),
    "region-v2",
  );
});

test("leaves URLs outside the configured HTTP asset tree unchanged", () => {
  const baseUrl = "https://cdn.example.test/assets/";
  for (const asset of [
    "https://other.example.test/assets/region/tile.glb",
    "https://cdn.example.test/assets-old/region/tile.glb",
    "../outside.glb",
    "data:application/octet-stream;base64,AA==",
    "blob:https://cdn.example.test/7e5f",
  ]) {
    assert.equal(
      appendScopedVersion(asset, versionMap, { baseUrl }),
      asset,
    );
  }
});

test("does not let relative URLs escape the implicit asset root", () => {
  for (const asset of [
    "../outside.glb",
    "region/../../outside.glb",
    "%2e%2e/outside.glb",
  ]) {
    assert.equal(appendScopedVersion(asset, versionMap), asset);
    assert.equal(resolveVersionForUrl(asset, versionMap), null);
  }
  assert.equal(
    appendScopedVersion("region/../inside.glb", versionMap),
    "inside.glb?v=root-v1",
  );
});

test("handles absolute and encoded URL paths without selector confusion", () => {
  assert.equal(
    appendScopedVersion("/region/tile.glb", versionMap),
    "/region/tile.glb?v=region-v2",
  );
  assert.equal(
    appendScopedVersion("region/my%20tile.glb", versionMap),
    "region/my%20tile.glb?v=region-v2",
  );
  assert.throws(
    () => appendScopedVersion("region%2Fdetail/tile.glb", versionMap),
    /encoded path separator/,
  );
  assert.equal(
    appendScopedVersion("mailto:maintainer@example.test", versionMap),
    "mailto:maintainer@example.test",
  );
});

test("preserves protocol-relative URLs", () => {
  assert.equal(
    appendScopedVersion("//cdn.example.test/region/tile.glb", versionMap),
    "//cdn.example.test/region/tile.glb?v=region-v2",
  );
});

test("requires an unambiguous directory base URL", () => {
  assert.throws(
    () => resolveVersionForUrl("region/tile.glb", versionMap, {
      baseUrl: "https://cdn.example.test/assets",
    }),
    /end with a slash/,
  );
  assert.throws(
    () => resolveVersionForUrl("region/tile.glb", versionMap, {
      baseUrl: "https://cdn.example.test/assets/?channel=next",
    }),
    /query or fragment/,
  );
  assert.throws(
    () => resolveVersionForUrl("region/tile.glb", versionMap, {
      baseUrl: "file:///tmp/assets/",
    }),
    /HTTP or HTTPS/,
  );
});

test("rejects malformed URL and version-map inputs", () => {
  assert.throws(
    () => resolveVersionForUrl("asset%ZZ.glb", versionMap),
    /invalid percent-encoding/,
  );
  assert.throws(
    () => resolveVersionForUrl("asset.glb", { scopes: {} }),
    /scopes array/,
  );
  assert.throws(
    () => resolveVersionForUrl("asset.glb", {
      scopes: [{ prefix: "", match: "starts-with", version: "v1" }],
    }),
    /each version scope/,
  );
  assert.throws(
    () => resolveVersionForUrl("asset.glb", {
      scopes: [
        { prefix: "assets/", match: "prefix", version: "v1" },
        { prefix: "/assets/", match: "prefix", version: "v2" },
      ],
    }),
    /duplicate version scope selector/,
  );
  assert.throws(
    () => resolveVersionForUrl("asset.glb", {
      defaultVersion: "",
      scopes: [],
    }),
    /defaultVersion/,
  );
  assert.throws(
    () => appendScopedVersion("asset.glb", versionMap, { parameter: "" }),
    /parameter/,
  );
  assert.throws(
    () => appendScopedVersion("asset.glb", versionMap, { baseURL: "/" }),
    /unknown URL option/,
  );
  assert.throws(
    () => resolveVersionForUrl(42, versionMap),
    /asset must be a string/,
  );
  assert.throws(
    () => createUrlPreprocessor(versionMap, null),
    /URL options must be an object/,
  );
});

test("supports an empty or default-free version map", () => {
  assert.equal(resolveVersionForUrl("asset.glb", undefined), null);
  assert.equal(
    appendScopedVersion("asset.glb", { defaultVersion: null, scopes: [] }),
    "asset.glb",
  );
});

const normalizePrefix = (value) => String(value ?? "")
  .replace(/^\/+/, "");

const normalizeSelector = (scope) => {
  const prefix = normalizePrefix(scope.prefix);
  return scope.match === "prefix" ? prefix.replace(/\/$/, "") : prefix;
};

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const FALLBACK_BASE = "https://version.invalid/";
const RELATIVE_BASE = "https://version.invalid/__tileset_scope_root__/";

const normalizeUrlOptions = (options, allowedKeys) => {
  if (
    typeof options !== "object"
    || options === null
    || Array.isArray(options)
  ) {
    throw new TypeError("URL options must be an object");
  }
  for (const name of Object.keys(options)) {
    if (!allowedKeys.includes(name)) {
      throw new TypeError(`unknown URL option: ${name}`);
    }
  }
  return { ...options };
};

const normalizeVersionMap = (versionMap) => {
  if (versionMap === undefined || versionMap === null) {
    return { defaultVersion: null, scopes: [] };
  }
  if (
    typeof versionMap !== "object"
    || Array.isArray(versionMap)
    || !Array.isArray(versionMap.scopes)
  ) {
    throw new TypeError("versionMap must contain a scopes array");
  }
  const selectors = new Set();
  const scopes = versionMap.scopes.map((scope) => {
    if (
      typeof scope !== "object"
      || scope === null
      || Array.isArray(scope)
      || typeof scope.prefix !== "string"
      || (scope.match !== "exact" && scope.match !== "prefix")
      || typeof scope.version !== "string"
      || scope.version.length === 0
    ) {
      throw new TypeError(
        "each version scope needs a prefix, exact or prefix match, and version",
      );
    }
    const selector = `${scope.match}:${normalizeSelector(scope)}`;
    if (selectors.has(selector)) {
      throw new TypeError(`duplicate version scope selector: ${selector}`);
    }
    selectors.add(selector);
    return scope;
  });
  if (
    versionMap.defaultVersion !== undefined
    && versionMap.defaultVersion !== null
    && (
      typeof versionMap.defaultVersion !== "string"
      || versionMap.defaultVersion.length === 0
    )
  ) {
    throw new TypeError("defaultVersion must be a non-empty string or null");
  }
  return {
    defaultVersion: versionMap.defaultVersion ?? null,
    scopes,
  };
};

const resolveAsset = (asset, baseUrl) => {
  if (typeof asset !== "string") {
    throw new TypeError("asset must be a string");
  }
  if (SCHEME.test(asset)) {
    const absolute = new URL(asset);
    if (!HTTP_PROTOCOLS.has(absolute.protocol)) return null;
  }

  let base = null;
  if (baseUrl !== undefined) {
    base = new URL(baseUrl);
    if (!HTTP_PROTOCOLS.has(base.protocol)) {
      throw new TypeError("baseUrl must use HTTP or HTTPS");
    }
    if (!base.pathname.endsWith("/")) {
      throw new TypeError("baseUrl must end with a slash");
    }
    if (base.search || base.hash) {
      throw new TypeError("baseUrl must not contain a query or fragment");
    }
  }

  const relativeInput = (
    !base
    && !SCHEME.test(asset)
    && !asset.startsWith("//")
    && !asset.startsWith("/")
  );
  const resolved = new URL(
    asset,
    base ?? (relativeInput ? RELATIVE_BASE : FALLBACK_BASE),
  );
  if (!HTTP_PROTOCOLS.has(resolved.protocol)) return null;

  let relativePath;
  if (base) {
    if (
      base.origin !== resolved.origin
      || !resolved.pathname.startsWith(base.pathname)
    ) {
      return null;
    }
    relativePath = resolved.pathname.slice(base.pathname.length);
  } else if (relativeInput) {
    const relativeBase = new URL(RELATIVE_BASE);
    if (
      resolved.origin !== relativeBase.origin
      || !resolved.pathname.startsWith(relativeBase.pathname)
    ) {
      return null;
    }
    relativePath = resolved.pathname.slice(relativeBase.pathname.length);
  } else {
    relativePath = resolved.pathname.replace(/^\/+/, "");
  }
  try {
    const decodedSegments = relativePath.split("/").map((segment) => {
      const decoded = decodeURIComponent(segment);
      if (decoded.includes("/") || decoded.includes("\\")) {
        throw new TypeError(
          "asset URL path contains an encoded path separator",
        );
      }
      return decoded;
    });
    return {
      resolved,
      relativePath: decodedSegments.join("/"),
    };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("path separator")) {
      throw error;
    }
    throw new TypeError("asset URL path contains invalid percent-encoding");
  }
};

export const resolveVersionForUrl = (
  asset,
  versionMap,
  options = {},
) => {
  const { baseUrl } = normalizeUrlOptions(options, ["baseUrl"]);
  const resolvedAsset = resolveAsset(asset, baseUrl);
  if (!resolvedAsset) return null;
  const normalizedMap = normalizeVersionMap(versionMap);
  const relative = resolvedAsset.relativePath;
  const matches = normalizedMap.scopes
    .filter((scope) => {
      const prefix = normalizePrefix(scope.prefix);
      if (scope.match === "exact") return relative === prefix;
      return prefix === ""
        || relative === prefix.replace(/\/$/, "")
        || relative.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
    })
    .sort((left, right) => (
      normalizeSelector(right).length - normalizeSelector(left).length
      || (left.match === right.match ? 0 : left.match === "exact" ? -1 : 1)
    ));
  return matches[0]?.version ?? normalizedMap.defaultVersion;
};

export const appendScopedVersion = (
  asset,
  versionMap,
  options = {},
) => {
  const {
    baseUrl,
    parameter = "v",
  } = normalizeUrlOptions(options, ["baseUrl", "parameter"]);
  if (typeof parameter !== "string" || parameter.length === 0) {
    throw new TypeError("parameter must be a non-empty string");
  }
  const version = resolveVersionForUrl(asset, versionMap, { baseUrl });
  if (!version) return asset;

  const absoluteInput = SCHEME.test(asset);
  const protocolRelativeInput = asset.startsWith("//");
  const rootAbsoluteInput = asset.startsWith("/");
  const resolved = new URL(asset, baseUrl ?? FALLBACK_BASE);
  resolved.searchParams.set(parameter, version);

  if (protocolRelativeInput) return resolved.href.slice(resolved.protocol.length);
  if (absoluteInput || baseUrl !== undefined) return resolved.href;
  const pathAndQuery = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  return rootAbsoluteInput ? pathAndQuery : pathAndQuery.replace(/^\//, "");
};

export const createUrlPreprocessor = (versionMap, options = {}) => {
  const normalizedOptions = normalizeUrlOptions(
    options,
    ["baseUrl", "parameter"],
  );
  return (asset) => appendScopedVersion(asset, versionMap, normalizedOptions);
};

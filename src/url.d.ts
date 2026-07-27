import type { ScopeMatch } from "./versioner.js";

export interface UrlVersionScope {
  id?: string;
  prefix: string;
  match: ScopeMatch;
  version: string;
  manifests?: string[];
}

export interface VersionMapInput {
  defaultVersion?: string | null;
  scopes: readonly UrlVersionScope[];
}

export interface ResolveUrlOptions {
  baseUrl?: string | URL;
}

export interface AppendUrlOptions extends ResolveUrlOptions {
  parameter?: string;
}

export function resolveVersionForUrl(
  asset: string,
  versionMap?: VersionMapInput | null,
  options?: ResolveUrlOptions,
): string | null;

export function appendScopedVersion(
  asset: string,
  versionMap?: VersionMapInput | null,
  options?: AppendUrlOptions,
): string;

export function createUrlPreprocessor(
  versionMap?: VersionMapInput | null,
  options?: AppendUrlOptions,
): (asset: string) => string;

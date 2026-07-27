export type ScopeMatch = "exact" | "prefix";

export interface AdditionalScope {
  id: string;
  path: string;
  prefix?: string;
  match?: ScopeMatch;
}

export interface VersionScope {
  id: string;
  prefix: string;
  match: ScopeMatch;
  version: string;
  manifests?: string[];
}

export interface ScopedVersionMap {
  schemaVersion: 1;
  algorithm: "sha256-128";
  generatedAt: string;
  defaultVersion: string | null;
  scopes: VersionScope[];
}

export interface BuildScopedVersionOptions {
  root: string;
  rootTileset?: string;
  stateFile?: string;
  sidecarFile?: string;
  additionalScopes?: AdditionalScope[];
  now?: Date | string | number;
}

export interface PublishScopedVersionOptions
  extends BuildScopedVersionOptions {
  dryRun?: boolean;
  writeStandard?: boolean;
}

export interface ComputedScope {
  id: string;
  path: string;
  prefix: string;
  match: ScopeMatch;
  manifests: string[];
  automatic: boolean;
  isDirectory?: boolean;
  fingerprint: string;
}

export interface BuildScopedVersionResult {
  root: string;
  stateFile: string;
  sidecarFile: string;
  versionMap: ScopedVersionMap;
  fingerprints: Record<string, string>;
  scopes: ComputedScope[];
}

export interface PublishScopedVersionResult {
  versionMap: ScopedVersionMap;
  changedScopes: string[];
  writtenFiles: string[];
  dryRun: boolean;
}

export function buildScopedVersionMap(
  options: BuildScopedVersionOptions,
): Promise<BuildScopedVersionResult>;

export function publishScopedVersions(
  options: PublishScopedVersionOptions,
): Promise<PublishScopedVersionResult>;

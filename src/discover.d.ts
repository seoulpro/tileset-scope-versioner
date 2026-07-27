export interface LocalReferenceOptions {
  root: string;
  fromManifest: string;
  uri: string;
}

export interface DiscoverOptions {
  root: string;
  rootTileset?: string;
}

export interface DiscoveredTileset {
  manifest: string;
  directory: string;
  references: string[];
  externalManifests: string[];
}

export function resolveLocalReference(
  options: LocalReferenceOptions,
): string | null;

export function discoverExternalTilesets(
  options: DiscoverOptions,
): Promise<DiscoveredTileset[]>;

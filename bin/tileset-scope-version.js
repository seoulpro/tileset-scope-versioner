#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { publishScopedVersions } from "../src/index.js";

const usage = `Usage:
  tileset-scope-version [options]

Options:
  --root <directory>          Asset root (default: current directory)
  --root-tileset <path>       Root tileset (default: tileset.json)
  --state <path>              State file inside root
  --sidecar <path>            Client version map inside root
  --scope <id=path>           Add a file or directory scope; repeatable
  --write-standard            Update asset.tilesetVersion in manifests
  --dry-run                   Calculate without writing
  --version                   Show the package version
  --help                      Show this help
`;

const valueAfter = (argumentsList, index, option) => {
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${option} requires a value`);
  }
  return value;
};

const parseScope = (value) => {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new TypeError("--scope must use id=path");
  }
  return {
    id: value.slice(0, separator),
    path: value.slice(separator + 1),
  };
};

const parseArguments = (argumentsList) => {
  const options = {
    root: process.cwd(),
    additionalScopes: [],
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help") return { help: true };
    if (argument === "--version") return { version: true };
    if (argument === "--write-standard") options.writeStandard = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--root") {
      options.root = valueAfter(argumentsList, index, argument);
      index += 1;
    } else if (argument === "--root-tileset") {
      options.rootTileset = valueAfter(argumentsList, index, argument);
      index += 1;
    } else if (argument === "--state") {
      options.stateFile = valueAfter(argumentsList, index, argument);
      index += 1;
    } else if (argument === "--sidecar") {
      options.sidecarFile = valueAfter(argumentsList, index, argument);
      index += 1;
    } else if (argument === "--scope") {
      options.additionalScopes.push(
        parseScope(valueAfter(argumentsList, index, argument)),
      );
      index += 1;
    } else {
      throw new TypeError(`unknown option: ${argument}`);
    }
  }
  return { help: false, options };
};

try {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(usage);
  } else if (parsed.version) {
    const packageManifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    process.stdout.write(`${packageManifest.version}\n`);
  } else {
    const result = await publishScopedVersions(parsed.options);
    process.stdout.write(`${JSON.stringify({
      defaultVersion: result.versionMap.defaultVersion,
      changedScopes: result.changedScopes,
      writtenFiles: result.writtenFiles,
      dryRun: result.dryRun,
      scopes: result.versionMap.scopes,
    }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage}`);
  process.exitCode = 1;
}

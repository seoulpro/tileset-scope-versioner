import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  open,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { buildScopedVersionMap } from "../src/versioner.js";

const MIB = 1024 * 1024;
const execFileAsync = promisify(execFile);
const script = fileURLToPath(import.meta.url);

const parsePositiveIntegers = (value, fallback, label) => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = value.split(",").map((item) => Number(item.trim()));
  if (
    parsed.length === 0
    || parsed.some((item) => !Number.isSafeInteger(item) || item <= 0)
  ) {
    throw new TypeError(`${label} must contain positive integers`);
  }
  return parsed;
};

const writeAsset = async (file, sizeBytes) => {
  const handle = await open(file, "w");
  const chunk = Buffer.alloc(Math.min(4 * MIB, sizeBytes), 0xa5);
  let remaining = sizeBytes;
  try {
    while (remaining > 0) {
      const length = Math.min(chunk.length, remaining);
      const { bytesWritten } = await handle.write(chunk, 0, length);
      assert.equal(bytesWritten, length);
      remaining -= bytesWritten;
    }
  } finally {
    await handle.close();
  }
};

const createFixture = async (sizeMiB) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scope-hash-benchmark-"));
  await writeFile(
    path.join(root, "tileset.json"),
    `${JSON.stringify({
      asset: { version: "1.1" },
      geometricError: 0,
      root: {
        boundingVolume: { sphere: [0, 0, 0, 1] },
        geometricError: 0,
        content: { uri: "asset.bin" },
      },
    })}\n`,
    "utf8",
  );
  await writeAsset(path.join(root, "asset.bin"), sizeMiB * MIB);
  return root;
};

const round = (value) => Math.round(value * 1000) / 1000;
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const runWorker = async (root) => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--expose-gc", script, "--worker", root],
    { maxBuffer: MIB },
  );
  if (stderr.trim() !== "") process.stderr.write(stderr);
  return JSON.parse(stdout);
};

const worker = async (root) => {
  globalThis.gc?.();
  const baselineRssBytes = process.memoryUsage().rss;
  const startedAt = performance.now();
  const result = await buildScopedVersionMap({ root });
  const durationMs = performance.now() - startedAt;
  globalThis.gc?.();
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;
  const fingerprint = result.fingerprints.root;
  assert.match(fingerprint, /^[a-f\d]{64}$/);
  process.stdout.write(JSON.stringify({
    durationMs,
    baselineRssBytes,
    peakRssBytes,
    peakRssDeltaBytes: Math.max(0, peakRssBytes - baselineRssBytes),
    fingerprint,
  }));
};

const benchmark = async () => {
  const sizesMiB = parsePositiveIntegers(
    process.env.ASSET_SIZES_MIB,
    [16, 64, 256],
    "ASSET_SIZES_MIB",
  );
  const [runs] = parsePositiveIntegers(
    process.env.BENCHMARK_RUNS,
    [3],
    "BENCHMARK_RUNS",
  );
  const cases = [];

  for (const sizeMiB of sizesMiB) {
    const root = await createFixture(sizeMiB);
    try {
      const samples = [];
      for (let index = 0; index < runs; index += 1) {
        samples.push(await runWorker(root));
      }
      assert.equal(new Set(samples.map((sample) => sample.fingerprint)).size, 1);
      cases.push({
        sizeMiB,
        runs,
        durationMs: {
          median: round(median(samples.map((sample) => sample.durationMs))),
          min: round(Math.min(...samples.map((sample) => sample.durationMs))),
          max: round(Math.max(...samples.map((sample) => sample.durationMs))),
        },
        peakRssDeltaMiB: {
          median: round(
            median(samples.map((sample) => sample.peakRssDeltaBytes / MIB)),
          ),
          max: round(
            Math.max(...samples.map((sample) => sample.peakRssDeltaBytes / MIB)),
          ),
        },
        fingerprint: samples[0].fingerprint,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  process.stdout.write(`${JSON.stringify({
    benchmark: "scope asset hashing",
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    fixtureCreationIncluded: false,
    workerIsolated: true,
    cases,
  }, null, 2)}\n`);
};

if (process.argv[2] === "--worker") {
  await worker(process.argv[3]);
} else {
  await benchmark();
}

#!/usr/bin/env node

import {
  lstat,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_MANIFEST_BYTES = 128 * 1024;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class FeedPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeedPolicyError";
  }
}

function parseSemVer(version) {
  if (typeof version !== "string") {
    throw new FeedPolicyError("update manifest version must be a string");
  }
  const match = SEMVER_PATTERN.exec(version);
  if (match === null) {
    throw new FeedPolicyError("update manifest version must be strict SemVer");
  }
  const prerelease = match[4]?.split(".") ?? [];
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      throw new FeedPolicyError("numeric prerelease identifiers must not have leading zeroes");
    }
  }
  return {
    build: match[5],
    core: [match[1], match[2], match[3]],
    prerelease,
    version,
  };
}

function compareNumericStrings(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function compareSemVer(leftVersion, rightVersion) {
  const left = parseSemVer(leftVersion);
  const right = parseSemVer(rightVersion);
  for (let index = 0; index < left.core.length; index += 1) {
    const comparison = compareNumericStrings(left.core[index], right.core[index]);
    if (comparison !== 0) return comparison;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return compareNumericStrings(leftIdentifier, rightIdentifier);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

async function readOptionalRegularFile(path, description) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new FeedPolicyError(`${description} must be a regular file`);
  }
  if (metadata.size > MAX_MANIFEST_BYTES) {
    throw new FeedPolicyError(`${description} exceeds ${MAX_MANIFEST_BYTES} bytes`);
  }
  return readFile(path);
}

async function ensureDirectory(path, description) {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new FeedPolicyError(`${description} must be a real directory`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(path);
  }
}

function validateManifest(bytes, channel, description) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new FeedPolicyError(`${description} must contain valid JSON`);
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new FeedPolicyError(`${description} must contain a JSON object`);
  }
  const parsedVersion = parseSemVer(manifest.version);
  if (channel === "stable" && (parsedVersion.prerelease.length > 0 || parsedVersion.build)) {
    throw new FeedPolicyError("stable feed versions must use MAJOR.MINOR.PATCH");
  }
  if (
    typeof manifest.pub_date !== "string"
    || !UTC_TIMESTAMP_PATTERN.test(manifest.pub_date)
    || Number.isNaN(Date.parse(manifest.pub_date))
    || new Date(manifest.pub_date).toISOString() !== manifest.pub_date
  ) {
    throw new FeedPolicyError(`${description} has a non-canonical pub_date`);
  }
  return { bytes, manifest, version: parsedVersion.version };
}

async function readManifest(path, channel, description, required) {
  const bytes = await readOptionalRegularFile(path, description);
  if (bytes === undefined) {
    if (required) throw new FeedPolicyError(`${description} does not exist`);
    return undefined;
  }
  return validateManifest(bytes, channel, description);
}

function requireIdentical(left, right, description) {
  if (!left.equals(right)) {
    throw new FeedPolicyError(`${description} must remain byte-identical`);
  }
}

export async function updateFeed({ candidatePath, channel, siteRoot }) {
  if (channel !== "preview" && channel !== "stable") {
    throw new FeedPolicyError("feed channel must be preview or stable");
  }
  const root = resolve(siteRoot);
  await ensureDirectory(root, "feed root");
  const channelRoot = join(root, channel);
  await ensureDirectory(channelRoot, "channel feed directory");
  const historyRoot = join(channelRoot, "releases");
  await ensureDirectory(historyRoot, "release history directory");

  const candidate = await readManifest(resolve(candidatePath), channel, "candidate manifest", true);
  const latestPath = join(channelRoot, "latest.json");
  const current = await readManifest(latestPath, channel, "current channel manifest", false);
  const historyPath = join(historyRoot, `${candidate.version}.json`);
  const history = await readManifest(historyPath, channel, "version history manifest", false);
  if (history !== undefined) {
    requireIdentical(candidate.bytes, history.bytes, `history for ${candidate.version}`);
  }

  if (current !== undefined) {
    const ordering = compareSemVer(candidate.version, current.version);
    if (ordering < 0) {
      throw new FeedPolicyError(
        `feed rollback rejected: ${candidate.version} is older than ${current.version}`,
      );
    }
    if (ordering === 0 && candidate.version !== current.version) {
      throw new FeedPolicyError(
        `feed versions ${candidate.version} and ${current.version} have equal precedence but different identities`,
      );
    }
    if (ordering === 0) {
      requireIdentical(candidate.bytes, current.bytes, `latest manifest for ${candidate.version}`);
      if (history === undefined) await writeFile(historyPath, candidate.bytes);
      return { status: "unchanged", version: candidate.version };
    }
  }

  if (history === undefined) await writeFile(historyPath, candidate.bytes);
  await writeFile(latestPath, candidate.bytes);
  return { status: "published", version: candidate.version };
}

async function main() {
  if (process.argv.length !== 5) {
    throw new FeedPolicyError("usage: update-feed.mjs CHANNEL CANDIDATE.json SITE_ROOT");
  }
  const result = await updateFeed({
    channel: process.argv[2],
    candidatePath: process.argv[3],
    siteRoot: process.argv[4],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`update-feed: ${error.message}`);
    process.exitCode = 1;
  });
}

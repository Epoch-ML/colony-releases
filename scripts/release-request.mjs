#!/usr/bin/env node

import { appendFile, lstat, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_FIELDS = [
  "channel",
  "product",
  "release_tag",
  "requested_at",
  "schema_version",
  "source_ref",
  "source_repository",
  "source_sha",
  "version",
];
const MAX_REQUEST_BYTES = 16 * 1024;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class ReleaseRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseRequestError";
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReleaseRequestError(`${field} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    throw new ReleaseRequestError(`${field} must not contain surrounding whitespace`);
  }
  return value;
}

function expectedReleaseTag(channel, version) {
  return channel === "stable"
    ? `colony-desktop-v${version}`
    : `colony-desktop-preview-v${version}`;
}

export function validateReleaseRequest(request, { requestFilename } = {}) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new ReleaseRequestError("release request must be a JSON object");
  }
  const actualFields = Object.keys(request).sort();
  const missing = EXPECTED_FIELDS.filter((field) => !actualFields.includes(field));
  if (missing.length > 0) {
    throw new ReleaseRequestError(`missing required field: ${missing[0]}`);
  }
  const unexpected = actualFields.filter((field) => !EXPECTED_FIELDS.includes(field));
  if (unexpected.length > 0) {
    throw new ReleaseRequestError(`unexpected field: ${unexpected[0]}`);
  }
  if (request.schema_version !== 1) {
    throw new ReleaseRequestError("schema_version must equal 1");
  }
  if (request.product !== "Colony") {
    throw new ReleaseRequestError("product must equal Colony");
  }
  if (request.source_repository !== "Epoch-ML/zerg") {
    throw new ReleaseRequestError("source_repository must equal Epoch-ML/zerg");
  }
  if (request.channel !== "preview" && request.channel !== "stable") {
    throw new ReleaseRequestError("channel must be preview or stable");
  }

  const version = requireString(request.version, "version");
  if (!SEMVER_PATTERN.test(version)) {
    throw new ReleaseRequestError("version must be strict SemVer without a v prefix");
  }
  if (request.channel === "stable" && !STABLE_SEMVER_PATTERN.test(version)) {
    throw new ReleaseRequestError("stable versions must use MAJOR.MINOR.PATCH");
  }

  const sourceSha = requireString(request.source_sha, "source_sha");
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) {
    throw new ReleaseRequestError(
      "source_sha must contain exactly 40 lowercase hexadecimal characters",
    );
  }
  const releaseTag = expectedReleaseTag(request.channel, version);
  if (request.release_tag !== releaseTag) {
    throw new ReleaseRequestError(`release_tag must equal ${releaseTag}`);
  }
  const sourceRef = `refs/tags/${releaseTag}`;
  if (request.source_ref !== sourceRef) {
    throw new ReleaseRequestError(`source_ref must equal ${sourceRef}`);
  }
  const requestedAt = requireString(request.requested_at, "requested_at");
  if (
    !UTC_TIMESTAMP_PATTERN.test(requestedAt) ||
    Number.isNaN(Date.parse(requestedAt)) ||
    new Date(requestedAt).toISOString() !== requestedAt
  ) {
    throw new ReleaseRequestError(
      "requested_at must be an ISO-8601 UTC timestamp with milliseconds",
    );
  }
  if (requestFilename !== undefined && requestFilename !== `${releaseTag}.json`) {
    throw new ReleaseRequestError(`request filename must equal ${releaseTag}.json`);
  }

  return {
    channel: request.channel,
    releaseTag,
    requestedAt,
    sourceRef,
    sourceRepository: "Epoch-ML/zerg",
    sourceSha,
    version,
  };
}

export async function validateRequestFile(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new ReleaseRequestError("release request path must not be a symbolic link");
  }
  if (!metadata.isFile()) {
    throw new ReleaseRequestError("release request path must identify a regular file");
  }
  if (metadata.size > MAX_REQUEST_BYTES) {
    throw new ReleaseRequestError(`release request exceeds ${MAX_REQUEST_BYTES} bytes`);
  }
  let request;
  try {
    request = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ReleaseRequestError("release request must contain valid JSON");
    }
    throw error;
  }
  return validateReleaseRequest(request, { requestFilename: basename(path) });
}

async function main() {
  if (process.argv.length !== 3) {
    throw new ReleaseRequestError("usage: release-request.mjs REQUEST.json");
  }
  const request = await validateRequestFile(process.argv[2]);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      `channel=${request.channel}`,
      `release_tag=${request.releaseTag}`,
      `requested_at=${request.requestedAt}`,
      `source_ref=${request.sourceRef}`,
      `source_repository=${request.sourceRepository}`,
      `source_sha=${request.sourceSha}`,
      `version=${request.version}`,
      "",
    ].join("\n"));
  }
  process.stdout.write(`${JSON.stringify(request)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`release-request: ${error.message}`);
    process.exitCode = 1;
  });
}

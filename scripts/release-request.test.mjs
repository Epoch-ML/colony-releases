import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";

import {
  ReleaseRequestError,
  validateReleaseRequest,
  validateRequestFile,
} from "./release-request.mjs";

const sourceSha = "0123456789abcdef0123456789abcdef01234567";
const temporaryDirectories = [];
const execFileAsync = promisify(execFile);

function makeRequest(overrides = {}) {
  return {
    schema_version: 1,
    product: "Colony",
    channel: "preview",
    version: "0.2.0-preview.1",
    release_tag: "colony-desktop-preview-v0.2.0-preview.1",
    source_repository: "Epoch-ML/zerg",
    source_sha: sourceSha,
    source_ref: "refs/tags/colony-desktop-preview-v0.2.0-preview.1",
    requested_at: "2026-08-05T20:00:00.000Z",
    ...overrides,
  };
}

function requestForVersion(version, channel = "preview") {
  const releaseTag = channel === "stable"
    ? `colony-desktop-v${version}`
    : `colony-desktop-preview-v${version}`;
  return makeRequest({
    channel,
    version,
    release_tag: releaseTag,
    source_ref: `refs/tags/${releaseTag}`,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Colony release request validation", () => {
  it("accepts a canonical preview request and derives immutable checkout metadata", () => {
    assert.deepEqual(
      validateReleaseRequest(makeRequest(), {
        requestFilename: "colony-desktop-preview-v0.2.0-preview.1.json",
      }),
      {
        channel: "preview",
        releaseTag: "colony-desktop-preview-v0.2.0-preview.1",
        sourceRef: "refs/tags/colony-desktop-preview-v0.2.0-preview.1",
        sourceRepository: "Epoch-ML/zerg",
        sourceSha,
        requestedAt: "2026-08-05T20:00:00.000Z",
        version: "0.2.0-preview.1",
      },
    );
  });

  it("accepts numeric stable versions and rejects prerelease or build metadata", () => {
    const stable = makeRequest({
      channel: "stable",
      version: "12.34.56",
      release_tag: "colony-desktop-v12.34.56",
      source_ref: "refs/tags/colony-desktop-v12.34.56",
    });
    assert.equal(validateReleaseRequest(stable).channel, "stable");

    for (const version of ["12.34.56-rc.1", "12.34.56+build.1"]) {
      assert.throws(
        () => validateReleaseRequest({
          ...stable,
          version,
          release_tag: `colony-desktop-v${version}`,
          source_ref: `refs/tags/colony-desktop-v${version}`,
        }),
        new ReleaseRequestError("stable versions must use MAJOR.MINOR.PATCH"),
      );
    }
    assert.equal(
      validateReleaseRequest(requestForVersion("123.456.789", "stable")).version,
      "123.456.789",
    );
  });

  it("accepts the complete preview SemVer surface and rejects partial matches", () => {
    for (const version of [
      "123.456.789",
      "1.2.3-123",
      "1.2.3-alpha.123",
      "1.2.3-123alpha-9",
      "1.2.3+build.123",
      "1.2.3-alpha.1+build.123",
    ]) {
      assert.equal(validateReleaseRequest(requestForVersion(version)).version, version);
    }
    for (const version of [
      "x1.2.3",
      "1.2.3suffix",
      "01.2.3",
      "1.02.3",
      "1.2.03",
      "1.2.3-01",
      "1.2.3-alpha..1",
      "1.2.3+build..1",
      "1.2.3_alpha",
    ]) {
      assert.throws(
        () => validateReleaseRequest(requestForVersion(version)),
        /strict SemVer/,
        version,
      );
    }
  });

  it("rejects non-object requests, missing fields, schema changes, and invalid channels", () => {
    for (const request of [null, [], "request", 7]) {
      assert.throws(
        () => validateReleaseRequest(request),
        /release request must be a JSON object/,
      );
    }

    const missing = makeRequest();
    delete missing.requested_at;
    assert.throws(() => validateReleaseRequest(missing), /missing required field: requested_at/);
    assert.throws(
      () => validateReleaseRequest(makeRequest({ schema_version: 2 })),
      /schema_version must equal 1/,
    );
    assert.throws(
      () => validateReleaseRequest(makeRequest({ channel: "nightly" })),
      /channel must be preview or stable/,
    );
  });

  it("rejects blank, non-string, and surrounding-whitespace identity fields", () => {
    for (const version of [null, "", "   ", " 0.2.0-preview.1"] ) {
      assert.throws(
        () => validateReleaseRequest(makeRequest({ version })),
        /version must (?:be a non-empty string|not contain surrounding whitespace)/,
      );
    }
    assert.throws(
      () => validateReleaseRequest(makeRequest({ source_sha: `${sourceSha} ` })),
      /source_sha must not contain surrounding whitespace/,
    );
    assert.throws(
      () => validateReleaseRequest(makeRequest({ requested_at: 1234 })),
      /requested_at must be a non-empty string/,
    );
  });

  it("rejects schema drift, wrong provenance, tag/ref mismatch, and malformed timestamps", () => {
    const invalidRequests = [
      [makeRequest({ unexpected: true }), /unexpected field: unexpected/],
      [makeRequest({ product: "Other" }), /product must equal Colony/],
      [makeRequest({ source_repository: "Epoch-ML/other" }), /source_repository must equal Epoch-ML\/zerg/],
      [makeRequest({ source_sha: "ABC" }), /40 lowercase hexadecimal/],
      [makeRequest({ source_sha: `0${sourceSha}` }), /40 lowercase hexadecimal/],
      [makeRequest({ source_sha: `${sourceSha}0` }), /40 lowercase hexadecimal/],
      [makeRequest({ release_tag: "colony-desktop-preview-v9.9.9" }), /release_tag must equal/],
      [makeRequest({ source_ref: "refs/heads/main" }), /source_ref must equal/],
      [makeRequest({ requested_at: "2026-08-05" }), /ISO-8601 UTC timestamp with milliseconds/],
      [makeRequest({ requested_at: "x2026-08-05T20:00:00.000Z" }), /ISO-8601 UTC timestamp/],
      [makeRequest({ requested_at: "2026-08-05T20:00:00.000Zx" }), /ISO-8601 UTC timestamp/],
      [makeRequest({ requested_at: "2026-02-30T20:00:00.000Z" }), /ISO-8601 UTC timestamp/],
      [makeRequest({ requested_at: "2026-08-05T20:00:00.000Z\nsource_sha=evil" }), /ISO-8601 UTC timestamp/],
      [makeRequest({ requested_at: "2026-08-05T20:00:00.000Z\rchannel=stable" }), /ISO-8601 UTC timestamp/],
    ];
    for (const [request, expected] of invalidRequests) {
      assert.throws(() => validateReleaseRequest(request), expected);
    }
  });

  it("binds the request filename to its release tag and rejects invalid JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "colony-release-request-"));
    temporaryDirectories.push(directory);
    const validPath = join(directory, "colony-desktop-preview-v0.2.0-preview.1.json");
    const wrongPath = join(directory, "wrong.json");
    const invalidPath = join(directory, "colony-desktop-preview-v0.2.0-preview.2.json");
    await writeFile(validPath, `${JSON.stringify(makeRequest())}\n`);
    await writeFile(wrongPath, `${JSON.stringify(makeRequest())}\n`);
    await writeFile(invalidPath, "{ invalid json\n");

    assert.equal((await validateRequestFile(validPath)).sourceSha, sourceSha);
    await assert.rejects(validateRequestFile(wrongPath), /filename must equal/);
    await assert.rejects(validateRequestFile(invalidPath), /valid JSON/);
  });

  it("accepts the exact file-size limit and rejects directories and oversized requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "colony-release-request-"));
    temporaryDirectories.push(directory);
    const filename = "colony-desktop-preview-v0.2.0-preview.1.json";
    const exactPath = join(directory, filename);
    const oversizedPath = join(directory, "oversized", filename);
    const json = JSON.stringify(makeRequest());
    await writeFile(exactPath, json + " ".repeat((16 * 1024) - Buffer.byteLength(json)));
    await mkdir(join(directory, "oversized"));
    await writeFile(oversizedPath, json + " ".repeat((16 * 1024) - Buffer.byteLength(json) + 1));

    assert.equal((await stat(exactPath)).size, 16 * 1024);
    assert.equal((await validateRequestFile(exactPath)).releaseTag, makeRequest().release_tag);
    await assert.rejects(validateRequestFile(directory), /regular file/);
    await assert.rejects(validateRequestFile(oversizedPath), /exceeds 16384 bytes/);
  });

  it("rejects a tracked request symlink even when its target is canonical", async () => {
    const directory = await mkdtemp(join(tmpdir(), "colony-release-request-"));
    temporaryDirectories.push(directory);
    const target = join(directory, "canonical-target.json");
    const link = join(directory, "colony-desktop-preview-v0.2.0-preview.1.json");
    await writeFile(target, `${JSON.stringify(makeRequest())}\n`);
    await symlink(target, link);

    await assert.rejects(validateRequestFile(link), /must not be a symbolic link/);
  });

  it("writes the validated request timestamp to the GitHub output boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "colony-release-request-cli-"));
    temporaryDirectories.push(directory);
    const requestPath = join(
      directory,
      "colony-desktop-preview-v0.2.0-preview.1.json",
    );
    const outputPath = join(directory, "github-output.txt");
    await writeFile(requestPath, `${JSON.stringify(makeRequest())}\n`);

    await execFileAsync(process.execPath, [
      new URL("./release-request.mjs", import.meta.url).pathname,
      requestPath,
    ], {
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
    });

    const output = await readFile(outputPath, "utf8");
    assert.match(output, /^requested_at=2026-08-05T20:00:00\.000Z$/m);
    assert.doesNotMatch(output, /\r/);
    assert.equal(output.match(/^requested_at=/gm)?.length, 1);
  });
});

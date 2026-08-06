import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

import { collectReleasePayload } from "./collect-release.mjs";

const temporaryDirectories = [];
const sourceSha = "0123456789abcdef0123456789abcdef01234567";
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function request() {
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
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "colony-public-collect-"));
  temporaryDirectories.push(root);
  const inputDir = join(root, "input");
  const outputDir = join(root, "new", "nested", "output");
  await mkdir(inputDir, { recursive: true });
  const archive = "Colony_0.2.0-preview.1_universal.app.tar.gz";
  const dmg = "Colony_0.2.0-preview.1_universal.dmg";
  const archiveContent = "signed app archive";
  const signatureContent = "trusted-signature\n";
  const dmgContent = "signed disk image";
  await writeFile(join(inputDir, archive), archiveContent);
  await writeFile(join(inputDir, `${archive}.sig`), signatureContent);
  await writeFile(join(inputDir, dmg), dmgContent);
  return {
    archive,
    archiveContent,
    dmg,
    dmgContent,
    inputDir,
    outputDir,
    root,
    signatureContent,
  };
}

function collectionOptions(bundle, overrides = {}) {
  return {
    inputDir: bundle.inputDir,
    outputDir: bundle.outputDir,
    request: request(),
    repository: "Epoch-ML/colony-releases",
    pubDate: "2026-08-05T20:00:00.000Z",
    runtimeNodeVersion: "v22.23.2",
    notarized: false,
    notes: "Colony preview",
    ...overrides,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("public collection emits exact immutable assets and a dual-architecture update manifest", async () => {
  const bundle = await fixture();
  const { archive, dmg, outputDir } = bundle;

  const result = await collectReleasePayload(collectionOptions(bundle));

  const url = "https://github.com/Epoch-ML/colony-releases/releases/download/"
    + `colony-desktop-preview-v0.2.0-preview.1/${archive}`;
  assert.deepEqual(result.manifest.platforms, {
    "darwin-aarch64": { signature: "trusted-signature", url },
    "darwin-x86_64": { signature: "trusted-signature", url },
  });
  assert.equal(result.manifest.notes, "Colony preview");
  assert.equal(result.manifest.pub_date, request().requested_at);
  assert.deepEqual(
    result.assets.map((path) => path.split("/").at(-1)).sort(),
    [archive, `${archive}.sig`, dmg, "checksums.txt", "release-metadata.json"].sort(),
  );
  const archiveDigest = sha256(bundle.archiveContent);
  const signatureDigest = sha256(bundle.signatureContent);
  const dmgDigest = sha256(bundle.dmgContent);
  const expectedChecksums = [
    `${archiveDigest}  ${archive}`,
    `${signatureDigest}  ${archive}.sig`,
    `${dmgDigest}  ${dmg}`,
  ].sort().join("\n") + "\n";
  assert.equal(await readFile(join(outputDir, "checksums.txt"), "utf8"), expectedChecksums);
  const metadata = JSON.parse(await readFile(join(outputDir, "release-metadata.json"), "utf8"));
  assert.deepEqual(metadata, {
    schema_version: 1,
    product: "Colony",
    version: "0.2.0-preview.1",
    channel: "preview",
    platform: "darwin-universal",
    source_sha: sourceSha,
    runtime_node_version: "v22.23.2",
    apple_notarized: false,
    artifacts: [
      { name: archive, sha256: archiveDigest },
      { name: `${archive}.sig`, sha256: signatureDigest },
      { name: dmg, sha256: dmgDigest },
    ],
  });
  assert.deepEqual(
    JSON.parse(await readFile(join(outputDir, "latest.json"), "utf8")),
    result.manifest,
  );

  const fallback = await collectReleasePayload(collectionOptions(bundle, {
    notes: 42,
    outputDir: join(bundle.root, "fallback", "nested", "output"),
  }));
  assert.equal(fallback.manifest.notes, "");
});

test("public collection CLI reports exact asset names after a successful collection", async () => {
  const bundle = await fixture();
  const requestPath = join(bundle.root, "request.json");
  await writeFile(requestPath, `${JSON.stringify(request())}\n`);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    new URL("./collect-release.mjs", import.meta.url).pathname,
    requestPath,
    bundle.inputDir,
    bundle.outputDir,
  ], {
    env: {
      ...process.env,
      COLONY_APPLE_NOTARIZED: "false",
      COLONY_RELEASE_DATE: request().requested_at,
      COLONY_RELEASE_NOTES: "Colony preview",
      COLONY_RELEASE_REPOSITORY: "Epoch-ML/colony-releases",
      COLONY_RUNTIME_NODE_VERSION: "v22.23.2",
    },
  });

  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    assets: [
      bundle.archive,
      `${bundle.archive}.sig`,
      bundle.dmg,
      "checksums.txt",
      "release-metadata.json",
    ],
  });
});

test("public collection fails closed for missing signatures and unnotarized stable payloads", async () => {
  const missing = await fixture();
  await rm(join(missing.inputDir, `${missing.archive}.sig`));
  await assert.rejects(
    collectReleasePayload(collectionOptions(missing)),
    /missing updater signature/,
  );

  const stable = await fixture();
  const stableRequest = {
    ...request(),
    channel: "stable",
    version: "0.2.0",
    release_tag: "colony-desktop-v0.2.0",
    source_ref: "refs/tags/colony-desktop-v0.2.0",
  };
  await assert.rejects(
    collectReleasePayload(collectionOptions(stable, { request: stableRequest })),
    /stable releases require verified Apple notarization/,
  );
});

test("public collection validates repository, date, runtime, and required string boundaries", async () => {
  const bundle = await fixture();
  for (const [overrides, message] of [
    [{ repository: "prefix!Epoch-ML/colony-releases" }, /owner\/name syntax/],
    [{ repository: "Epoch-ML/colony-releases!suffix" }, /owner\/name syntax/],
    [{ repository: 42 }, /release repository is required/],
    [{ pubDate: "eventually" }, /canonical ISO-8601 timestamp/],
    [{ pubDate: "2026-08-05" }, /canonical ISO-8601 timestamp/],
    [{ pubDate: "2026-08-05T21:00:00.000Z" }, /immutable request timestamp/],
    [{ runtimeNodeVersion: "22.23.2" }, /v-prefixed stable SemVer/],
    [{ runtimeNodeVersion: "prefix-v22.23.2" }, /v-prefixed stable SemVer/],
    [{ runtimeNodeVersion: "v22.23.2-suffix" }, /v-prefixed stable SemVer/],
  ]) {
    await assert.rejects(
      collectReleasePayload(collectionOptions(bundle, overrides)),
      message,
    );
  }

  const multiDigit = await collectReleasePayload(collectionOptions(bundle, {
    outputDir: join(bundle.root, "multi-digit", "output"),
    repository: "  Epoch-ML/colony-releases  ",
    runtimeNodeVersion: "v123.456.789",
  }));
  assert.equal(
    multiDigit.manifest.platforms["darwin-aarch64"].url,
    "https://github.com/Epoch-ML/colony-releases/releases/download/"
      + "colony-desktop-preview-v0.2.0-preview.1/"
      + "Colony_0.2.0-preview.1_universal.app.tar.gz",
  );
});

test("public collection rejects destructive output locations", async () => {
  const bundle = await fixture();
  for (const outputDir of [bundle.inputDir, bundle.root]) {
    await assert.rejects(
      collectReleasePayload(collectionOptions(bundle, { outputDir })),
      /release output directory is unsafe/,
    );
  }
});

test("public collection rejects empty signatures, extra inputs, and non-file artifacts", async () => {
  const empty = await fixture();
  await writeFile(join(empty.inputDir, `${empty.archive}.sig`), " \n");
  await assert.rejects(
    collectReleasePayload(collectionOptions(empty)),
    /updater signature is empty/,
  );

  const extra = await fixture();
  await writeFile(join(extra.inputDir, "unexpected.txt"), "unexpected");
  await assert.rejects(
    collectReleasePayload(collectionOptions(extra)),
    /release input must contain exactly.*found.*unexpected\.txt/,
  );

  const directory = await fixture();
  await rm(join(directory.inputDir, directory.dmg));
  await mkdir(join(directory.inputDir, directory.dmg));
  await assert.rejects(
    collectReleasePayload(collectionOptions(directory)),
    /release input is not a regular file/,
  );
});

test("public stable collection records verified notarization and removes stale output", async () => {
  const bundle = await fixture();
  const stableRequest = {
    ...request(),
    channel: "stable",
    version: "0.2.0",
    release_tag: "colony-desktop-v0.2.0",
    source_ref: "refs/tags/colony-desktop-v0.2.0",
  };
  const stableArchive = "Colony_0.2.0_universal.app.tar.gz";
  const stableDmg = "Colony_0.2.0_universal.dmg";
  await rm(bundle.inputDir, { recursive: true });
  await mkdir(bundle.inputDir, { recursive: true });
  await writeFile(join(bundle.inputDir, stableArchive), "stable archive");
  await writeFile(join(bundle.inputDir, `${stableArchive}.sig`), "stable-signature\n");
  await writeFile(join(bundle.inputDir, stableDmg), "stable dmg");
  await mkdir(join(bundle.outputDir, "obsolete"), { recursive: true });
  await writeFile(join(bundle.outputDir, "obsolete", "stale.txt"), "stale");

  await collectReleasePayload(collectionOptions(bundle, {
    request: stableRequest,
    notarized: true,
  }));
  const metadata = JSON.parse(await readFile(
    join(bundle.outputDir, "release-metadata.json"),
    "utf8",
  ));
  assert.equal(metadata.apple_notarized, true);
  await assert.rejects(readFile(join(bundle.outputDir, "obsolete", "stale.txt")), /ENOENT/);
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import fc from "fast-check";

import { compareSemVer, updateFeed } from "./update-feed.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function manifest(version, overrides = {}) {
  return {
    version,
    notes: `Colony ${version}`,
    pub_date: "2026-08-05T20:00:00.000Z",
    platforms: {
      "darwin-aarch64": { signature: "signature", url: "https://example.test/app.tar.gz" },
      "darwin-x86_64": { signature: "signature", url: "https://example.test/app.tar.gz" },
    },
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "colony-update-feed-"));
  temporaryDirectories.push(root);
  return {
    candidatePath: join(root, "candidate.json"),
    root,
    siteRoot: join(root, "site"),
  };
}

async function writeCandidate(bundle, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(bundle.candidatePath, bytes);
  return bytes;
}

test("feed policy creates immutable version history and advances only to newer SemVer", async () => {
  const bundle = await fixture();
  const first = await writeCandidate(bundle, manifest("1.0.0-preview.1"));
  assert.deepEqual(
    await updateFeed({ ...bundle, channel: "preview" }),
    { status: "published", version: "1.0.0-preview.1" },
  );
  assert.deepEqual(
    await readFile(join(bundle.siteRoot, "preview", "latest.json")),
    first,
  );
  assert.deepEqual(
    await readFile(join(bundle.siteRoot, "preview", "releases", "1.0.0-preview.1.json")),
    first,
  );

  const second = await writeCandidate(bundle, manifest("1.0.0-preview.2"));
  assert.equal((await updateFeed({ ...bundle, channel: "preview" })).status, "published");
  assert.deepEqual(
    await readFile(join(bundle.siteRoot, "preview", "latest.json")),
    second,
  );
  assert.deepEqual(
    await readFile(join(bundle.siteRoot, "preview", "releases", "1.0.0-preview.1.json")),
    first,
    "advancing latest must not rewrite prior version history",
  );
});

test("feed policy is byte-idempotent and rejects same-version mutation", async () => {
  const bundle = await fixture();
  const original = await writeCandidate(bundle, manifest("2.3.4"));
  await updateFeed({ ...bundle, channel: "stable" });

  // Property: replaying the same immutable manifest is an exact no-op.
  assert.deepEqual(
    await updateFeed({ ...bundle, channel: "stable" }),
    { status: "unchanged", version: "2.3.4" },
  );
  assert.deepEqual(await readFile(join(bundle.siteRoot, "stable", "latest.json")), original);

  await writeCandidate(bundle, manifest("2.3.4", { notes: "mutated notes" }));
  await assert.rejects(
    updateFeed({ ...bundle, channel: "stable" }),
    /history for 2\.3\.4 must remain byte-identical/,
  );
  assert.deepEqual(await readFile(join(bundle.siteRoot, "stable", "latest.json")), original);
});

test("feed policy rejects rollback, equal-precedence aliases, and history collisions", async () => {
  const bundle = await fixture();
  const current = await writeCandidate(bundle, manifest("3.0.0"));
  await updateFeed({ ...bundle, channel: "preview" });

  await writeCandidate(bundle, manifest("2.99.99"));
  await assert.rejects(
    updateFeed({ ...bundle, channel: "preview" }),
    /feed rollback rejected: 2\.99\.99 is older than 3\.0\.0/,
  );
  assert.deepEqual(await readFile(join(bundle.siteRoot, "preview", "latest.json")), current);

  const alias = await fixture();
  await writeCandidate(alias, manifest("1.0.0+build.1"));
  await updateFeed({ ...alias, channel: "preview" });
  await writeCandidate(alias, manifest("1.0.0+build.2"));
  await assert.rejects(
    updateFeed({ ...alias, channel: "preview" }),
    /equal precedence but different identities/,
  );

  await writeFile(
    join(bundle.siteRoot, "preview", "releases", "3.1.0.json"),
    `${JSON.stringify(manifest("3.1.0", { notes: "hostile history" }), null, 2)}\n`,
  );
  await writeCandidate(bundle, manifest("3.1.0"));
  await assert.rejects(
    updateFeed({ ...bundle, channel: "preview" }),
    /history for 3\.1\.0 must remain byte-identical/,
  );
});

test("feed policy rejects invalid channel manifests and symlinked feed state", async () => {
  const stable = await fixture();
  await writeCandidate(stable, manifest("1.0.0-preview.1"));
  await assert.rejects(
    updateFeed({ ...stable, channel: "stable" }),
    /stable feed versions must use MAJOR\.MINOR\.PATCH/,
  );

  const invalidDate = await fixture();
  await writeCandidate(invalidDate, manifest("1.0.0", { pub_date: "tomorrow" }));
  await assert.rejects(
    updateFeed({ ...invalidDate, channel: "preview" }),
    /non-canonical pub_date/,
  );

  const linked = await fixture();
  await symlink(linked.root, linked.siteRoot);
  await writeCandidate(linked, manifest("1.0.0"));
  await assert.rejects(
    updateFeed({ ...linked, channel: "preview" }),
    /feed root must be a real directory/,
  );
});

test("SemVer precedence is antisymmetric and transitive across stable core versions", () => {
  const versionArbitrary = fc.tuple(
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
  ).map((parts) => parts.join("."));

  // Property: comparison reverses sign when operands are swapped.
  fc.assert(fc.property(versionArbitrary, versionArbitrary, (left, right) => {
    assert.equal(Math.sign(compareSemVer(left, right)), -Math.sign(compareSemVer(right, left)));
  }));

  // Property: SemVer precedence is transitive.
  fc.assert(fc.property(
    versionArbitrary,
    versionArbitrary,
    versionArbitrary,
    (first, second, third) => {
      if (compareSemVer(first, second) <= 0 && compareSemVer(second, third) <= 0) {
        assert.ok(compareSemVer(first, third) <= 0);
      }
    },
  ));
});

test("SemVer precedence follows core, prerelease, numeric, lexical, and build rules", () => {
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "2.0.0",
    "10.0.0",
  ];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    assert.equal(compareSemVer(ordered[index], ordered[index + 1]), -1);
    assert.equal(compareSemVer(ordered[index + 1], ordered[index]), 1);
  }
  assert.equal(compareSemVer("1.2.3+build.1", "1.2.3+build.2"), 0);
  assert.equal(compareSemVer("12345678901234567890.0.0", "9999999999999999999.0.0"), 1);

  for (const invalid of [null, "", "01.0.0", "1.02.0", "1.0.03", "1.0.0-01", "1.0"] ) {
    assert.throws(() => compareSemVer(invalid, "1.0.0"), /version must|strict SemVer|leading zeroes/);
  }
});

test("feed policy rejects malformed, absent, oversized, and non-regular candidates", async () => {
  const missing = await fixture();
  await assert.rejects(
    updateFeed({ ...missing, channel: "preview" }),
    /candidate manifest does not exist/,
  );

  const invalidJson = await fixture();
  await writeFile(invalidJson.candidatePath, "{broken\n");
  await assert.rejects(
    updateFeed({ ...invalidJson, channel: "preview" }),
    /must contain valid JSON/,
  );

  for (const value of [null, [], "manifest"]) {
    const invalidObject = await fixture();
    await writeCandidate(invalidObject, value);
    await assert.rejects(
      updateFeed({ ...invalidObject, channel: "preview" }),
      /must contain a JSON object/,
    );
  }

  const oversized = await fixture();
  await writeFile(oversized.candidatePath, `${JSON.stringify(manifest("1.0.0"))}${" ".repeat(128 * 1024)}`);
  await assert.rejects(
    updateFeed({ ...oversized, channel: "preview" }),
    /exceeds 131072 bytes/,
  );

  const directory = await fixture();
  await mkdir(directory.candidatePath);
  await assert.rejects(
    updateFeed({ ...directory, channel: "preview" }),
    /candidate manifest must be a regular file/,
  );

  const linked = await fixture();
  const target = join(linked.root, "target.json");
  await writeFile(target, `${JSON.stringify(manifest("1.0.0"))}\n`);
  await symlink(target, linked.candidatePath);
  await assert.rejects(
    updateFeed({ ...linked, channel: "preview" }),
    /candidate manifest must be a regular file/,
  );
});

test("feed policy validates channel, stable identity, timestamps, and every state directory", async () => {
  for (const channel of ["nightly", "", null]) {
    const bundle = await fixture();
    await writeCandidate(bundle, manifest("1.0.0"));
    await assert.rejects(updateFeed({ ...bundle, channel }), /channel must be preview or stable/);
  }

  for (const version of ["1.0.0-preview.1", "1.0.0+build.1"]) {
    const bundle = await fixture();
    await writeCandidate(bundle, manifest(version));
    await assert.rejects(
      updateFeed({ ...bundle, channel: "stable" }),
      /stable feed versions must use MAJOR\.MINOR\.PATCH/,
    );
  }

  for (const pubDate of [
    null,
    "2026-08-05",
    "2026-08-05T20:00:00Z",
    "2026-02-30T20:00:00.000Z",
  ]) {
    const bundle = await fixture();
    await writeCandidate(bundle, manifest("1.0.0", { pub_date: pubDate }));
    await assert.rejects(
      updateFeed({ ...bundle, channel: "preview" }),
      /non-canonical pub_date/,
    );
  }

  for (const linkedPart of ["preview", "preview/releases"]) {
    const bundle = await fixture();
    await mkdir(bundle.siteRoot, { recursive: true });
    const parent = join(bundle.siteRoot, ...linkedPart.split("/").slice(0, -1));
    await mkdir(parent, { recursive: true });
    await symlink(bundle.root, join(bundle.siteRoot, linkedPart));
    await writeCandidate(bundle, manifest("1.0.0"));
    await assert.rejects(
      updateFeed({ ...bundle, channel: "preview" }),
      /must be a real directory/,
    );
  }
});

test("an identical current manifest backfills missing immutable history", async () => {
  const bundle = await fixture();
  const bytes = await writeCandidate(bundle, manifest("4.5.6"));
  await mkdir(join(bundle.siteRoot, "stable", "releases"), { recursive: true });
  await writeFile(join(bundle.siteRoot, "stable", "latest.json"), bytes);

  assert.deepEqual(
    await updateFeed({ ...bundle, channel: "stable" }),
    { status: "unchanged", version: "4.5.6" },
  );
  assert.deepEqual(
    await readFile(join(bundle.siteRoot, "stable", "releases", "4.5.6.json")),
    bytes,
  );
});

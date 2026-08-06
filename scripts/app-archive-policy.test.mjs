import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { gzipSync } from "node:zlib";

import {
  APP_ARCHIVE_BUDGET,
  inspectAppArchive,
} from "./app-archive-policy.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function writeField(header, offset, length, value) {
  const bytes = Buffer.from(value);
  assert.ok(bytes.length <= length);
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  writeField(header, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

function tarHeader({ name, size = 0, type = "0" }) {
  const header = Buffer.alloc(512);
  writeField(header, 0, 100, name);
  writeOctal(header, 100, 8, type === "5" ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeField(header, 156, 1, type);
  writeField(header, 257, 6, "ustar\0");
  writeField(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function refreshChecksum(header) {
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function member(entry) {
  const body = Buffer.from(entry.body ?? "");
  const header = tarHeader({ ...entry, size: entry.size ?? body.length });
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

function paxRecord(key, value) {
  const payload = `${key}=${value}\n`;
  let length = Buffer.byteLength(payload) + 2;
  while (true) {
    const record = `${length} ${payload}`;
    const actual = Buffer.byteLength(record);
    if (actual === length) return record;
    length = actual;
  }
}

async function archive(entries) {
  const root = await mkdtemp(join(tmpdir(), "colony-app-archive-policy-"));
  temporaryDirectories.push(root);
  const path = join(root, "Colony.app.tar.gz");
  const tar = Buffer.concat([
    ...entries.map(member),
    Buffer.alloc(1024),
  ]);
  await writeFile(path, gzipSync(tar));
  return path;
}

async function rawArchive(tar) {
  const root = await mkdtemp(join(tmpdir(), "colony-app-archive-policy-raw-"));
  temporaryDirectories.push(root);
  const path = join(root, "Colony.app.tar.gz");
  await writeFile(path, gzipSync(tar));
  return path;
}

function validEntries(body = "hello") {
  return [
    { name: "Colony.app/", type: "5" },
    { name: "Colony.app/Contents/MacOS/colony-app", body },
  ];
}

test("application archive policy accepts exact file/count limits and bounded PAX paths", async () => {
  const longPath = `Colony.app/Contents/Resources/${"nested/".repeat(15)}asset.js`;
  const pax = paxRecord("path", longPath);
  const path = await archive([
    { name: "Colony.app/", type: "5" },
    { name: "PaxHeaders/asset", type: "x", body: pax },
    { name: "Colony.app/placeholder", body: "hello" },
  ]);

  assert.deepEqual(
    await inspectAppArchive(path, {
      ...APP_ARCHIVE_BUDGET,
      maxExpandedBytes: 5,
      maxHeaders: 3,
      maxMembers: 2,
    }),
    { expandedBytes: 5, headers: 3, members: 2, regularFiles: 1 },
  );
  assert.deepEqual(APP_ARCHIVE_BUDGET, {
    maxArchiveBytes: 800 * 1024 * 1024,
    maxExpandedBytes: 800 * 1024 * 1024,
    maxHeaders: 70_000,
    maxMembers: 35_000,
    maxPaxBytes: 64 * 1024,
    maxTarBytes: 850 * 1024 * 1024,
  });
});

test("application archive policy rejects symlinks, hardlinks, and device-like members", async () => {
  for (const [type, description] of [
    ["2", "symlink"],
    ["1", "hardlink"],
    ["3", "character device"],
    ["4", "block device"],
    ["6", "FIFO"],
  ]) {
    const path = await archive([
      { name: "Colony.app/", type: "5" },
      { name: `Colony.app/Contents/${description}`, type },
    ]);
    await assert.rejects(
      inspectAppArchive(path),
      new RegExp(`unsupported archive member type ${JSON.stringify(type)}`),
    );
  }
});

test("application archive policy rejects traversal, duplicate paths, and global metadata", async () => {
  const traversal = await archive([
    { name: "Colony.app/", type: "5" },
    { name: "Colony.app/../escape", body: "escape" },
  ]);
  await assert.rejects(inspectAppArchive(traversal), /escapes Colony\.app/);

  const duplicate = await archive([
    ...validEntries(),
    { name: "Colony.app/Contents/MacOS/colony-app", body: "replacement" },
  ]);
  await assert.rejects(inspectAppArchive(duplicate), /repeats member path/);

  const globalPax = paxRecord("path", "Colony.app/Contents/file");
  const global = await archive([
    { name: "GlobalHead", type: "g", body: globalPax },
    ...validEntries(),
  ]);
  await assert.rejects(inspectAppArchive(global), /global PAX metadata is not permitted/);
});

test("application archive policy rejects expanded bytes, members, and metadata over bounds", async () => {
  const expanded = await archive(validEntries("123456"));
  await assert.rejects(
    inspectAppArchive(expanded, { ...APP_ARCHIVE_BUDGET, maxExpandedBytes: 5 }),
    /expanded byte count exceeds 5/,
  );

  const members = await archive(validEntries());
  await assert.rejects(
    inspectAppArchive(members, { ...APP_ARCHIVE_BUDGET, maxMembers: 1 }),
    /member count exceeds 1/,
  );

  const pax = paxRecord("path", "Colony.app/Contents/file");
  const metadata = await archive([
    { name: "Colony.app/", type: "5" },
    { name: "PaxHeader", type: "x", body: pax },
    { name: "Colony.app/file", body: "x" },
  ]);
  await assert.rejects(
    inspectAppArchive(metadata, { ...APP_ARCHIVE_BUDGET, maxPaxBytes: pax.length - 1 }),
    new RegExp(`PAX metadata exceeds ${pax.length - 1}`),
  );
});

test("application archive policy rejects malformed tar framing and numeric fields", async () => {
  const invalidChecksumTar = Buffer.concat([...validEntries().map(member), Buffer.alloc(1024)]);
  invalidChecksumTar[0] ^= 1;
  await assert.rejects(
    inspectAppArchive(await rawArchive(invalidChecksumTar)),
    /invalid checksum/,
  );

  const nonUstar = tarHeader({ name: "Colony.app/", type: "5" });
  nonUstar.fill(0, 257, 263);
  refreshChecksum(nonUstar);
  await assert.rejects(
    inspectAppArchive(await rawArchive(Buffer.concat([nonUstar, Buffer.alloc(1024)]))),
    /not in the ustar\/PAX format/,
  );

  for (const [mutate, expected] of [
    [(header) => { header[124] = 0x80; }, /base-256 encoding/],
    [(header) => { writeField(header, 124, 12, "00000000008\0"); }, /not canonical octal/],
  ]) {
    const header = tarHeader({ name: "Colony.app/file", size: 0 });
    mutate(header);
    refreshChecksum(header);
    await assert.rejects(
      inspectAppArchive(await rawArchive(Buffer.concat([
        member({ name: "Colony.app/", type: "5" }),
        header,
        Buffer.alloc(1024),
      ]))),
      expected,
    );
  }

  const oneEndMarker = Buffer.concat([...validEntries().map(member), Buffer.alloc(512)]);
  await assert.rejects(
    inspectAppArchive(await rawArchive(oneEndMarker)),
    /second tar end marker/,
  );
  const trailingData = Buffer.concat([
    ...validEntries().map(member),
    Buffer.alloc(1024),
    Buffer.from("not-zero"),
  ]);
  await assert.rejects(
    inspectAppArchive(await rawArchive(trailingData)),
    /data after its end markers/,
  );
  await assert.rejects(
    inspectAppArchive(await rawArchive(Buffer.alloc(100))),
    /truncated while reading tar header/,
  );
});

test("application archive policy rejects unsafe paths and structurally incomplete apps", async () => {
  for (const unsafePath of [
    "/Colony.app/file",
    "Colony.app\\file",
    "Other.app/file",
    "Colony.app//file",
    "Colony.app/./file",
    "Colony.app/../file",
  ]) {
    const path = await archive([
      { name: "Colony.app/", type: "5" },
      { name: unsafePath, body: "x" },
    ]);
    await assert.rejects(inspectAppArchive(path), /unsafe archive member path|escapes Colony\.app/);
  }

  const invalidUtf8Header = tarHeader({ name: "Colony.app/file", size: 0 });
  invalidUtf8Header[11] = 0xff;
  refreshChecksum(invalidUtf8Header);
  await assert.rejects(
    inspectAppArchive(await rawArchive(Buffer.concat([
      member({ name: "Colony.app/", type: "5" }),
      invalidUtf8Header,
      Buffer.alloc(1024),
    ]))),
    /not valid UTF-8/,
  );

  for (const entries of [
    [{ name: "Other.app/", type: "5" }, { name: "Other.app/file", body: "x" }],
    [{ name: "Colony.app/", type: "5" }],
  ]) {
    await assert.rejects(
      inspectAppArchive(await archive(entries)),
      /must contain Colony\.app and at least one regular file|escapes Colony\.app/,
    );
  }

  await assert.rejects(
    inspectAppArchive(await archive([
      { name: "Colony.app/", type: "5", body: "x", size: 1 },
      { name: "Colony.app/file", body: "x" },
    ])),
    /directory has a non-zero body/,
  );
});

test("application archive policy rejects malformed and dangling local PAX metadata", async () => {
  const malformedPaxBodies = [
    "no-space",
    "01 path=Colony.app/file\n",
    "99 path=Colony.app/file\n",
    paxRecord("", "value"),
    `${paxRecord("path", "Colony.app/a")}${paxRecord("path", "Colony.app/b")}`,
  ];
  for (const body of malformedPaxBodies) {
    await assert.rejects(
      inspectAppArchive(await archive([
        { name: "Colony.app/", type: "5" },
        { name: "PaxHeader", type: "x", body },
        { name: "Colony.app/file", body: "x" },
      ])),
      /PAX metadata/,
    );
  }

  await assert.rejects(
    inspectAppArchive(await archive([
      { name: "Colony.app/", type: "5" },
      { name: "PaxOne", type: "x", body: paxRecord("path", "Colony.app/a") },
      { name: "PaxTwo", type: "x", body: paxRecord("path", "Colony.app/b") },
      { name: "Colony.app/file", body: "x" },
    ])),
    /consecutive local PAX headers/,
  );
  await assert.rejects(
    inspectAppArchive(await archive([
      ...validEntries(),
      { name: "PaxLast", type: "x", body: paxRecord("path", "Colony.app/unused") },
    ])),
    /unapplied PAX metadata/,
  );
  for (const size of ["01", "-1", "9007199254740992"]) {
    await assert.rejects(
      inspectAppArchive(await archive([
        { name: "Colony.app/", type: "5" },
        { name: "PaxSize", type: "x", body: paxRecord("size", size) },
        { name: "Colony.app/file", body: "x" },
      ])),
      /PAX size/,
    );
  }
});

test("application archive policy enforces compressed and tar-stream budgets and file type", async () => {
  const path = await archive(validEntries("compressible body"));
  const metadata = await lstat(path);
  await assert.rejects(
    inspectAppArchive(path, { ...APP_ARCHIVE_BUDGET, maxArchiveBytes: metadata.size - 1 }),
    /compressed application archive exceeds/,
  );
  await assert.rejects(
    inspectAppArchive(path, { ...APP_ARCHIVE_BUDGET, maxTarBytes: 1024 }),
    /tar stream exceeds 1024 bytes/,
  );

  const root = await mkdtemp(join(tmpdir(), "colony-app-archive-policy-type-"));
  temporaryDirectories.push(root);
  const directory = join(root, "archive-dir");
  await mkdir(directory);
  await assert.rejects(inspectAppArchive(directory), /must be a regular file/);
  const link = join(root, "archive-link.tar.gz");
  await symlink(path, link);
  await assert.rejects(inspectAppArchive(link), /must be a regular file/);
});

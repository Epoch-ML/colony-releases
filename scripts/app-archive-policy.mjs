#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { pathToFileURL } from "node:url";

export const APP_ARCHIVE_BUDGET = Object.freeze({
  maxArchiveBytes: 800 * 1024 * 1024,
  maxExpandedBytes: 800 * 1024 * 1024,
  maxHeaders: 70_000,
  maxMembers: 35_000,
  maxPaxBytes: 64 * 1024,
  maxTarBytes: 850 * 1024 * 1024,
});

const BLOCK_BYTES = 512;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export class AppArchivePolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppArchivePolicyError";
  }
}

class BoundedTarReader {
  constructor(stream, maxBytes) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.maxBytes = maxBytes;
    this.bytesRead = 0;
    this.chunk = Buffer.alloc(0);
    this.offset = 0;
  }

  async _nextChunk() {
    const next = await this.iterator.next();
    if (next.done) return false;
    this.chunk = Buffer.from(next.value);
    this.offset = 0;
    return true;
  }

  _count(length) {
    this.bytesRead += length;
    if (this.bytesRead > this.maxBytes) {
      throw new AppArchivePolicyError(
        `archive tar stream exceeds ${this.maxBytes} bytes`,
      );
    }
  }

  async readExactly(length, description) {
    const output = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      if (this.offset === this.chunk.length && !(await this._nextChunk())) {
        throw new AppArchivePolicyError(`archive is truncated while reading ${description}`);
      }
      const available = this.chunk.length - this.offset;
      const count = Math.min(available, length - written);
      this.chunk.copy(output, written, this.offset, this.offset + count);
      this.offset += count;
      written += count;
      this._count(count);
    }
    return output;
  }

  async skipExactly(length, description) {
    let skipped = 0;
    while (skipped < length) {
      if (this.offset === this.chunk.length && !(await this._nextChunk())) {
        throw new AppArchivePolicyError(`archive is truncated while skipping ${description}`);
      }
      const count = Math.min(this.chunk.length - this.offset, length - skipped);
      this.offset += count;
      skipped += count;
      this._count(count);
    }
  }

  async requireZeroRemainder() {
    while (true) {
      if (this.offset === this.chunk.length && !(await this._nextChunk())) return;
      const remainder = this.chunk.subarray(this.offset);
      this.offset = this.chunk.length;
      this._count(remainder.length);
      if (remainder.some((byte) => byte !== 0)) {
        throw new AppArchivePolicyError("archive contains data after its end markers");
      }
    }
  }
}

function parseOctal(field, description) {
  if ((field[0] & 0x80) !== 0) {
    throw new AppArchivePolicyError(`${description} uses unsupported base-256 encoding`);
  }
  const value = field.toString("ascii").replace(/\0.*$/s, "").trim();
  if (value === "") return 0;
  if (!/^[0-7]+$/.test(value)) {
    throw new AppArchivePolicyError(`${description} is not canonical octal`);
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppArchivePolicyError(`${description} exceeds the safe integer range`);
  }
  return parsed;
}

function decodeField(field, description) {
  const nullIndex = field.indexOf(0);
  const bytes = nullIndex === -1 ? field : field.subarray(0, nullIndex);
  try {
    return utf8.decode(bytes);
  } catch {
    throw new AppArchivePolicyError(`${description} is not valid UTF-8`);
  }
}

function verifyChecksum(header) {
  const expected = parseOctal(header.subarray(148, 156), "tar header checksum");
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  if (actual !== expected) {
    throw new AppArchivePolicyError("archive contains a tar header with an invalid checksum");
  }
}

function headerPath(header) {
  const name = decodeField(header.subarray(0, 100), "tar member name");
  const prefix = decodeField(header.subarray(345, 500), "tar member prefix");
  return prefix === "" ? name : `${prefix}/${name}`;
}

function parsePax(data) {
  const attributes = new Map();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) throw new AppArchivePolicyError("PAX metadata has no record length");
    const lengthText = data.subarray(offset, space).toString("ascii");
    if (!/^[1-9]\d*$/.test(lengthText)) {
      throw new AppArchivePolicyError("PAX metadata has an invalid record length");
    }
    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > data.length || data[end - 1] !== 0x0a) {
      throw new AppArchivePolicyError("PAX metadata record exceeds its declared body");
    }
    const record = data.subarray(space + 1, end - 1);
    const equals = record.indexOf(0x3d);
    if (equals <= 0) throw new AppArchivePolicyError("PAX metadata record has no key");
    let key;
    let value;
    try {
      key = utf8.decode(record.subarray(0, equals));
      value = utf8.decode(record.subarray(equals + 1));
    } catch {
      throw new AppArchivePolicyError("PAX metadata is not valid UTF-8");
    }
    if (attributes.has(key)) {
      throw new AppArchivePolicyError(`PAX metadata repeats ${key}`);
    }
    attributes.set(key, value);
    offset = end;
  }
  return attributes;
}

function parsePaxSize(value) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new AppArchivePolicyError("PAX size is not a canonical non-negative integer");
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size)) {
    throw new AppArchivePolicyError("PAX size exceeds the safe integer range");
  }
  return size;
}

function validatePath(path) {
  if (path.includes("\\") || path.startsWith("/") || path.includes("\0")) {
    throw new AppArchivePolicyError(`unsafe archive member path: ${JSON.stringify(path)}`);
  }
  const normalized = path.replace(/\/+$/, "");
  const parts = normalized.split("/");
  if (
    normalized === ""
    || (normalized !== "Colony.app" && !normalized.startsWith("Colony.app/"))
    || parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new AppArchivePolicyError(`archive member escapes Colony.app: ${JSON.stringify(path)}`);
  }
  return normalized;
}

function paddedSize(size) {
  return Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
}

export async function inspectAppArchive(path, budget = APP_ARCHIVE_BUDGET) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new AppArchivePolicyError("application archive must be a regular file");
  }
  if (metadata.size > budget.maxArchiveBytes) {
    throw new AppArchivePolicyError(
      `compressed application archive exceeds ${budget.maxArchiveBytes} bytes`,
    );
  }

  const gunzip = createReadStream(path).pipe(createGunzip());
  const reader = new BoundedTarReader(gunzip, budget.maxTarBytes);
  const paths = new Set();
  let expandedBytes = 0;
  let headers = 0;
  let members = 0;
  let regularFiles = 0;
  let pendingPax;

  while (true) {
    const header = await reader.readExactly(BLOCK_BYTES, "tar header");
    if (header.every((byte) => byte === 0)) {
      const secondEndBlock = await reader.readExactly(BLOCK_BYTES, "second tar end marker");
      if (secondEndBlock.some((byte) => byte !== 0)) {
        throw new AppArchivePolicyError("archive has only one tar end marker");
      }
      if (pendingPax !== undefined) {
        throw new AppArchivePolicyError("archive ends with unapplied PAX metadata");
      }
      await reader.requireZeroRemainder();
      break;
    }

    headers += 1;
    if (headers > budget.maxHeaders) {
      throw new AppArchivePolicyError(`archive header count exceeds ${budget.maxHeaders}`);
    }
    verifyChecksum(header);
    if (header.subarray(257, 262).toString("ascii") !== "ustar") {
      throw new AppArchivePolicyError("archive member is not in the ustar/PAX format");
    }
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const headerSize = parseOctal(header.subarray(124, 136), "tar member size");

    if (type === "x") {
      if (pendingPax !== undefined) {
        throw new AppArchivePolicyError("archive has consecutive local PAX headers");
      }
      if (headerSize > budget.maxPaxBytes) {
        throw new AppArchivePolicyError(`PAX metadata exceeds ${budget.maxPaxBytes} bytes`);
      }
      const paxBody = await reader.readExactly(headerSize, "PAX metadata");
      await reader.skipExactly(paddedSize(headerSize) - headerSize, "PAX padding");
      pendingPax = parsePax(paxBody);
      continue;
    }
    if (type === "g") {
      throw new AppArchivePolicyError("global PAX metadata is not permitted");
    }
    if (type !== "0" && type !== "5") {
      throw new AppArchivePolicyError(
        `unsupported archive member type ${JSON.stringify(type)}; only files and directories are permitted`,
      );
    }

    members += 1;
    if (members > budget.maxMembers) {
      throw new AppArchivePolicyError(`archive member count exceeds ${budget.maxMembers}`);
    }
    const pathOverride = pendingPax?.get("path");
    const memberPath = validatePath(pathOverride ?? headerPath(header));
    if (paths.has(memberPath)) {
      throw new AppArchivePolicyError(`archive repeats member path: ${memberPath}`);
    }
    paths.add(memberPath);

    const sizeOverride = pendingPax?.get("size");
    const size = sizeOverride === undefined ? headerSize : parsePaxSize(sizeOverride);
    pendingPax = undefined;
    if (type === "5" && size !== 0) {
      throw new AppArchivePolicyError(`archive directory has a non-zero body: ${memberPath}`);
    }
    if (type === "0") {
      regularFiles += 1;
      expandedBytes += size;
      if (expandedBytes > budget.maxExpandedBytes) {
        throw new AppArchivePolicyError(
          `archive expanded byte count exceeds ${budget.maxExpandedBytes}`,
        );
      }
    }
    await reader.skipExactly(paddedSize(size), `body for ${memberPath}`);
  }

  if (members === 0 || regularFiles === 0 || !paths.has("Colony.app")) {
    throw new AppArchivePolicyError("archive must contain Colony.app and at least one regular file");
  }
  return { expandedBytes, headers, members, regularFiles };
}

async function main() {
  if (process.argv.length !== 3) {
    throw new AppArchivePolicyError("usage: app-archive-policy.mjs Colony.app.tar.gz");
  }
  process.stdout.write(`${JSON.stringify(await inspectAppArchive(process.argv[2]))}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`app-archive-policy: ${error.message}`);
    process.exitCode = 1;
  });
}

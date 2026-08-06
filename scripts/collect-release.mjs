#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateReleaseRequest } from "./release-request.mjs";

const REPOSITORY_PATTERN = /^[0-9A-Za-z_.-]+\/[0-9A-Za-z_.-]+$/;
const NODE_VERSION_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function requireString(value, description) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${description} is required`);
  }
  return value.trim();
}

export async function collectReleasePayload(options) {
  const validated = validateReleaseRequest(options.request);
  const repository = requireString(options.repository, "release repository");
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error("release repository must use owner/name syntax");
  }
  const pubDate = requireString(options.pubDate, "publication date");
  if (Number.isNaN(Date.parse(pubDate)) || new Date(pubDate).toISOString() !== pubDate) {
    throw new Error("publication date must be a canonical ISO-8601 timestamp");
  }
  if (pubDate !== validated.requestedAt) {
    throw new Error("publication date must equal the immutable request timestamp");
  }
  const runtimeNodeVersion = requireString(options.runtimeNodeVersion, "runtime Node version");
  if (!NODE_VERSION_PATTERN.test(runtimeNodeVersion)) {
    throw new Error("runtime Node version must be a v-prefixed stable SemVer");
  }
  if (validated.channel === "stable" && options.notarized !== true) {
    throw new Error("stable releases require verified Apple notarization");
  }

  const inputDir = resolve(requireString(options.inputDir, "release input directory"));
  const outputDir = resolve(requireString(options.outputDir, "release output directory"));
  if (inputDir === outputDir || inputDir.startsWith(`${outputDir}/`)) {
    throw new Error("release output directory is unsafe");
  }
  const archiveName = `Colony_${validated.version}_universal.app.tar.gz`;
  const signatureName = `${archiveName}.sig`;
  const dmgName = `Colony_${validated.version}_universal.dmg`;
  const expectedNames = [archiveName, signatureName, dmgName].sort();
  const actualNames = (await readdir(inputDir)).sort();
  if (!actualNames.includes(signatureName)) {
    throw new Error(`missing updater signature for ${archiveName}`);
  }
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `release input must contain exactly ${expectedNames.join(", ")}; found ${actualNames.join(", ")}`,
    );
  }
  for (const name of expectedNames) {
    if (!(await stat(join(inputDir, name))).isFile()) {
      throw new Error(`release input is not a regular file: ${name}`);
    }
  }
  const signature = (await readFile(join(inputDir, signatureName), "utf8")).trim();
  if (signature === "") {
    throw new Error(`updater signature is empty for ${archiveName}`);
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const assets = [];
  const checksums = [];
  const metadataArtifacts = [];
  for (const name of [archiveName, signatureName, dmgName]) {
    const destination = join(outputDir, name);
    await copyFile(join(inputDir, name), destination);
    const digest = await sha256(destination);
    assets.push(destination);
    checksums.push(`${digest}  ${name}`);
    metadataArtifacts.push({ name, sha256: digest });
  }

  const checksumsPath = join(outputDir, "checksums.txt");
  await writeFile(checksumsPath, `${checksums.sort().join("\n")}\n`);
  const metadataPath = join(outputDir, "release-metadata.json");
  await writeFile(metadataPath, `${JSON.stringify({
    schema_version: 1,
    product: "Colony",
    version: validated.version,
    channel: validated.channel,
    platform: "darwin-universal",
    source_sha: validated.sourceSha,
    runtime_node_version: runtimeNodeVersion,
    apple_notarized: options.notarized === true,
    artifacts: metadataArtifacts,
  }, null, 2)}\n`);

  const archiveUrl = `https://github.com/${repository}/releases/download/`
    + `${encodeURIComponent(validated.releaseTag)}/${encodeURIComponent(archiveName)}`;
  const platform = { signature, url: archiveUrl };
  const manifest = {
    version: validated.version,
    notes: typeof options.notes === "string" ? options.notes : "",
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": platform,
      "darwin-x86_64": platform,
    },
  };
  await writeFile(join(outputDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { assets: [...assets, checksumsPath, metadataPath], manifest };
}

async function main() {
  if (process.argv.length !== 5) {
    throw new Error("usage: collect-release.mjs REQUEST.json INPUT_DIR OUTPUT_DIR");
  }
  const request = JSON.parse(await readFile(process.argv[2], "utf8"));
  const result = await collectReleasePayload({
    request,
    inputDir: process.argv[3],
    outputDir: process.argv[4],
    repository: process.env.COLONY_RELEASE_REPOSITORY,
    pubDate: process.env.COLONY_RELEASE_DATE,
    runtimeNodeVersion: process.env.COLONY_RUNTIME_NODE_VERSION,
    notarized: process.env.COLONY_APPLE_NOTARIZED === "true",
    notes: process.env.COLONY_RELEASE_NOTES,
  });
  process.stdout.write(`${JSON.stringify({ assets: result.assets.map((path) => basename(path)) })}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`collect-release: ${error.message}`);
    process.exitCode = 1;
  });
}

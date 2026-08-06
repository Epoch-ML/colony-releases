#!/usr/bin/env node

import {
  lstatSync,
  readlinkSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAC_BUNDLE_BUDGET = Object.freeze({
  maxAppBytes: 800 * 1024 * 1024,
  maxAppFiles: 35_000,
  maxRuntimeBytes: 650 * 1024 * 1024,
  maxRuntimeFiles: 30_000,
});

function assertContainedLink(root, path) {
  const link = readlinkSync(path);
  if (isAbsolute(link)) {
    throw new Error(`application bundle contains an absolute symlink: ${path}`);
  }
  const target = realpathSync(resolve(dirname(path), link));
  const targetRelative = relative(root, target);
  if (targetRelative === ".." || targetRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`application bundle symlink escapes its root: ${path}`);
  }
}

function treeMetrics(root, bundleRoot) {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = treeMetrics(path, bundleRoot);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      if (entry.isSymbolicLink()) assertContainedLink(bundleRoot, path);
      bytes += lstatSync(path).size;
      files += 1;
    }
  }
  return { bytes, files };
}

export function assertMacBundlePolicy(app, limits = MAC_BUNDLE_BUDGET) {
  const bundleRoot = realpathSync(app);
  const metrics = {
    app: treeMetrics(bundleRoot, bundleRoot),
    runtime: treeMetrics(join(bundleRoot, "Contents", "Resources", "runtime"), bundleRoot),
  };
  const checks = [
    ["runtime byte", metrics.runtime.bytes, limits.maxRuntimeBytes],
    ["runtime file", metrics.runtime.files, limits.maxRuntimeFiles],
    ["application byte", metrics.app.bytes, limits.maxAppBytes],
    ["application file", metrics.app.files, limits.maxAppFiles],
  ];
  for (const [description, actual, maximum] of checks) {
    if (actual > maximum) {
      throw new Error(`${description} budget exceeded: ${actual} > ${maximum}`);
    }
  }
  return { ...metrics, limits };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error("usage: node mac-bundle-policy.mjs /path/to/Colony.app");
    process.exit(2);
  }
  try {
    const result = assertMacBundlePolicy(resolve(process.argv[2]));
    console.log(
      `Bundle policy verified: runtime ${result.runtime.bytes} bytes/${result.runtime.files} files; `
      + `application ${result.app.bytes} bytes/${result.app.files} files`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

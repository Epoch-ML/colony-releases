import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  assertMacBundlePolicy,
  MAC_BUNDLE_BUDGET,
} from "./mac-bundle-policy.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function makeApp() {
  const root = await mkdtemp(join(tmpdir(), "colony-public-bundle-"));
  temporaryDirectories.push(root);
  const app = join(root, "Colony.app");
  const runtime = join(app, "Contents", "Resources", "runtime");
  await mkdir(runtime, { recursive: true });
  await writeFile(join(runtime, "node"), "runtime");
  return { app, root, runtime };
}

test("public signing policy rejects runtime size and count regressions", async () => {
  const { app, runtime } = await makeApp();
  await truncate(join(runtime, "node"), 65);
  assert.throws(
    () => assertMacBundlePolicy(app, {
      maxAppBytes: 128,
      maxAppFiles: 4,
      maxRuntimeBytes: 64,
      maxRuntimeFiles: 1,
    }),
    /runtime byte budget exceeded: 65 > 64/,
  );

  await truncate(join(runtime, "node"), 1);
  await writeFile(join(runtime, "extra"), "x");
  assert.throws(
    () => assertMacBundlePolicy(app, {
      maxAppBytes: 128,
      maxAppFiles: 4,
      maxRuntimeBytes: 64,
      maxRuntimeFiles: 1,
    }),
    /runtime file budget exceeded: 2 > 1/,
  );
});

test("public signing policy rejects symlinks that escape the application", async () => {
  const { app, root, runtime } = await makeApp();
  const outside = join(root, "outside");
  await writeFile(outside, "not part of the app");
  await symlink(outside, join(runtime, "escape"));

  assert.throws(
    () => assertMacBundlePolicy(app),
    /application bundle contains an absolute symlink/,
  );

  const relative = await makeApp();
  const outsideRelative = join(relative.root, "outside-relative");
  await writeFile(outsideRelative, "not part of the app");
  await symlink("../../../../outside-relative", join(relative.runtime, "escape"));
  assert.throws(
    () => assertMacBundlePolicy(relative.app),
    /application bundle symlink escapes its root/,
  );

  const parent = await makeApp();
  await symlink("../../../..", join(parent.runtime, "escape"));
  assert.throws(
    () => assertMacBundlePolicy(parent.app),
    /application bundle symlink escapes its root/,
  );
});

test("public signing policy accepts contained relative symlinks", async () => {
  const { app, runtime } = await makeApp();
  await symlink("node", join(runtime, "node-link"));

  const result = assertMacBundlePolicy(app);
  assert.equal(result.runtime.files, 2);
});

test("default public signing budgets are hard bounded", async () => {
  const { app, runtime } = await makeApp();
  await mkdir(join(runtime, "nested"));
  await writeFile(join(runtime, "nested", "model.bin"), "model");
  await writeFile(join(app, "Contents", "Info.plist"), "info");
  const result = assertMacBundlePolicy(app);

  assert.deepEqual(result.runtime, { bytes: 12, files: 2 });
  assert.deepEqual(result.app, { bytes: 16, files: 3 });
  assert.deepEqual(MAC_BUNDLE_BUDGET, {
    maxAppBytes: 800 * 1024 * 1024,
    maxAppFiles: 35_000,
    maxRuntimeBytes: 650 * 1024 * 1024,
    maxRuntimeFiles: 30_000,
  });
});

test("public signing policy enforces application budgets and accepts exact limits", async () => {
  const { app } = await makeApp();
  const exact = {
    maxAppBytes: 7,
    maxAppFiles: 1,
    maxRuntimeBytes: 7,
    maxRuntimeFiles: 1,
  };
  assert.deepEqual(assertMacBundlePolicy(app, exact).app, { bytes: 7, files: 1 });

  assert.throws(
    () => assertMacBundlePolicy(app, { ...exact, maxAppBytes: 6 }),
    /application byte budget exceeded: 7 > 6/,
  );
  assert.throws(
    () => assertMacBundlePolicy(app, { ...exact, maxAppFiles: 0 }),
    /application file budget exceeded: 1 > 0/,
  );
});

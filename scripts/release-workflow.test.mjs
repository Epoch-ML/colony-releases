import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

function job(name, nextName) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = nextName === undefined ? workflow.length : workflow.indexOf(`  ${nextName}:`, start);
  assert.ok(start >= 0 && end > start, `workflow job ${name} must be present and ordered`);
  return workflow.slice(start, end);
}

test("public releases build an exact verified source revision on universal macOS", () => {
  const trigger = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("concurrency:"));
  assert.match(trigger, /workflow_dispatch:/);
  assert.doesNotMatch(trigger, /\n\s+push:/);
  assert.match(workflow, /runs-on:\s*macos-15/);
  assert.equal(workflow.match(/runs-on:\s*ubuntu-24\.04/g)?.length, 4);
  assert.doesNotMatch(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /git init --ref-format=reftable/);
  assert.match(workflow, /api\.github\.com\/meta/);
  assert.match(workflow, /ZERG_SOURCE_DEPLOY_KEY/);
  assert.match(workflow, /universal-apple-darwin/);
  assert.match(workflow, /rev-parse[^\n]+\^\{commit\}/);
  assert.equal(
    workflow.match(/npm audit --omit=dev --audit-level=moderate/g)?.length,
    3,
    "all three shipped JavaScript dependency trees reject moderate advisories",
  );
  assert.doesNotMatch(workflow, /npm audit --omit=dev --audit-level=high/);
  assert.match(
    workflow,
    /npm audit --omit=dev --audit-level=moderate --prefix "\$SOURCE_DIR\/ztc-web-client"/,
  );
  assert.equal(
    workflow.match(/node-version:\s*"22\.23\.2"/g)?.length,
    5,
    "every JavaScript boundary must use the exact Node patch bundled into Colony",
  );
  assert.match(workflow, /COLONY_RUNTIME_NODE_VERSION:\s*v22\.23\.2/);
  assert.match(workflow, /requested_at:\s*\$\{\{ steps\.request\.outputs\.requested_at \}\}/);
  assert.match(
    job("updater_sign", "publish"),
    /COLONY_RELEASE_DATE:\s*\$\{\{ needs\.validate\.outputs\.requested_at \}\}/,
  );
  assert.doesNotMatch(workflow, /release_date="\$\(date -u/);
  assert.deepEqual(
    [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]),
    [
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
      "actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa",
      "actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b",
      "actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e",
      "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
    ],
    "publication must execute only immutable GitHub-owned actions",
  );
  assert.equal(
    workflow.match(/persist-credentials:\s*false/g)?.length,
    5,
    "no checkout may persist a releases-repository token",
  );
  assert.match(
    workflow,
    /Persist the verified update manifest on release-data(?:.|\n)*?FEED_DEPLOY_KEY: \$\{\{ secrets\.COLONY_FEED_DEPLOY_KEY \}\}(?:.|\n)*?GIT_SSH_COMMAND=/,
  );
  assert.match(workflow, /git@github\.com:\$\{GITHUB_REPOSITORY\}\.git/);
  assert.doesNotMatch(workflow, /gh auth setup-git/);
  assert.doesNotMatch(workflow, /dtolnay\/rust-toolchain|oven-sh\/setup-bun/);
  assert.match(workflow, /rustup toolchain install 1\.88\.0/);
  assert.match(workflow, /cargo install cargo-audit --version [0-9]+\.[0-9]+\.[0-9]+ --locked/);
  assert.match(
    workflow,
    /cargo audit --file "\$SOURCE_DIR\/colony\/src-tauri\/Cargo\.lock"/,
  );
  assert.match(workflow, /bun_bin="\$SOURCE_DIR\/colony\/node_modules\/\.bin\/bun"/);
  assert.match(workflow, /"\$bun_bin" --version/);
  assert.doesNotMatch(workflow, /npm install[^\n]+bun@/);
  assert.match(workflow, /61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6/);
  assert.match(workflow, /58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026/);
  assert.match(workflow, /staged_node="\$SOURCE_DIR\/colony\/src-tauri\/resources\/runtime\/node"/);
  assert.match(workflow, /lipo -thin arm64 "\$staged_node"/);
  assert.match(workflow, /lipo -thin x86_64 "\$staged_node"/);
  assert.equal(
    workflow.match(/^\s+lipo "\$app\/Contents\/(?:MacOS\/(?:\$executable|colony-supervisor)|Resources\/runtime\/node)" -verify_arch arm64 x86_64$/gm)?.length,
    6,
    "lipo requires its input path before the -verify_arch operation",
  );
  assert.doesNotMatch(workflow, /^\s+lipo -verify_arch/gm);
  assert.doesNotMatch(workflow, /EVENT_NAME|PUSH_BEFORE|git log --format= --name-status/);
  assert.match(workflow, /git log --diff-filter=A --format=%H --/);
  assert.match(workflow, /git merge-base --is-ancestor "\$request_commit" "\$GITHUB_SHA"/);
  assert.match(workflow, /commit_and_parents/);
  assert.match(workflow, /single-parent commit/);
  assert.match(workflow, /addition_changes/);
  assert.match(workflow, /must add only this request/);
  assert.match(workflow, /request_mode=.*git ls-tree/);
  assert.match(workflow, /request_mode.*100644/);
  assert.match(workflow, /git show "\$request_commit:\$request_path"/);
  assert.match(workflow, /cmp "\$request_path" "\$committed_request"/);
  assert.match(workflow, /\[\[ -L "\$request_path" \]\]/);
  assert.match(workflow, /git ls-remote --exit-code --refs origin \\\n\s+"refs\/tags\/\$RELEASE_TAG"/);
  assert.match(workflow, /release_tag_commit=.*FETCH_HEAD\^\{commit\}/);
  assert.match(workflow, /release_tag_commit(?:.|\n)*?REQUEST_COMMIT/);
  assert.doesNotMatch(workflow, /git log -n 1 --format=%H --/);
});

test("preview and stable signing policies are explicit and stable fails closed", () => {
  assert.match(workflow, /COLONY_TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /COLONY_TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.match(workflow, /APPLE_SIGNING_IDENTITY:\s*"-"/);
  for (const secret of [
    "COLONY_APPLE_CERTIFICATE",
    "COLONY_APPLE_CERTIFICATE_PASSWORD",
    "COLONY_APPLE_SIGNING_IDENTITY",
    "COLONY_APPLE_TEAM_ID",
    "COLONY_APPLE_API_ISSUER",
    "COLONY_APPLE_API_KEY_ID",
    "COLONY_APPLE_API_PRIVATE_KEY",
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
  assert.match(workflow, /COLONY_EXPECT_APPLE_TEAM_ID/);
  assert.match(workflow, /COLONY_REQUIRE_GATEKEEPER/);
  assert.match(workflow, /stapler validate/);
  assert.match(workflow, /updater_key_file="updater\.\$\{COLONY_CHANNEL\}\.pubkey"/);
  assert.match(
    workflow,
    /cmp "\$updater_key_file"(?:.|\n)*?"\$SOURCE_DIR\/colony\/src-tauri\/\$updater_key_file"/,
  );
  assert.match(workflow, /base64 --decode "\$updater_key_file"/);
  assert.doesNotMatch(workflow, /(?:^|\/)updater\.pubkey/);
});

test("preview and stable updater trust roots are distinct valid minisign public keys", () => {
  const preview = readFileSync(new URL("../updater.preview.pubkey", import.meta.url), "utf8").trim();
  const stable = readFileSync(new URL("../updater.stable.pubkey", import.meta.url), "utf8").trim();

  assert.notEqual(preview, stable);
  assert.match(Buffer.from(preview, "base64").toString("utf8"), /minisign public key/);
  assert.match(Buffer.from(stable, "base64").toString("utf8"), /minisign public key/);
});

test("immutable assets are verified over HTTPS before the Pages manifest moves", () => {
  assert.match(workflow, /gh release view/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /curl --fail --show-error --location/);
  assert.match(workflow, /cmp /);
  assert.match(workflow, /actions\/deploy-pages/);
  assert.match(
    workflow,
    /deploy:\n(?:.|\n)*?needs: publish(?:.|\n)*?name: github-pages(?:.|\n)*?actions\/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e/,
    "Pages deployment must use its dedicated protected environment after publication",
  );

  const releaseIndex = workflow.indexOf("gh release create");
  const httpsStepIndex = workflow.indexOf("Re-download every release asset over HTTPS");
  const compareIndex = workflow.indexOf("cmp ", httpsStepIndex);
  const manifestIndex = workflow.indexOf("Persist the verified update manifest on release-data");
  assert.ok(releaseIndex >= 0 && compareIndex > releaseIndex);
  assert.ok(manifestIndex > compareIndex);
});

test("post-release retries verify and resume an exact immutable release", () => {
  assert.doesNotMatch(workflow, /already exists; publish a higher version/);
  assert.match(workflow, /COLONY_REQUEST_COMMIT/);
  assert.match(workflow, /\.target_commitish == \$target/);
  assert.match(workflow, /\.tag_name == \$tag/);
  assert.match(workflow, /\.name == \$title/);
  assert.match(workflow, /\.body == \$body/);
  assert.match(workflow, /\.prerelease == \$prerelease/);
  assert.match(workflow, /rev-parse 'FETCH_HEAD\^\{commit\}'/);
  assert.equal(
    workflow.match(/^          verify_release_tag_target$/gm)?.length,
    2,
    "the concrete release tag target must be checked before assets and after publication",
  );
  assert.match(workflow, /existing_asset_names/);
  assert.match(workflow, /expected_asset_names/);
  assert.match(workflow, /diff -u/);
  assert.match(workflow, /gh release create[^\n]+--draft --verify-tag/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /gh release edit[^\n]+--draft=false/);
  assert.doesNotMatch(workflow, /repos\/\$GITHUB_REPOSITORY\/git\/refs/);
  assert.match(workflow, /"\$RELEASE_DIR\/latest\.json"/);
  assert.match(workflow, /expected exactly six immutable release assets/);

  const releaseCheckIndex = workflow.indexOf("gh release view");
  const draftIndex = workflow.indexOf("--draft");
  const uploadIndex = workflow.indexOf("gh release upload");
  const authenticatedCompareIndex = workflow.indexOf("Compare existing release asset bytes");
  const publishIndex = workflow.indexOf("--draft=false");
  const httpsStepIndex = workflow.indexOf("Re-download every release asset over HTTPS");
  const compareIndex = workflow.indexOf("cmp ", httpsStepIndex);
  const manifestIndex = workflow.indexOf("Persist the verified update manifest on release-data");
  assert.ok(releaseCheckIndex >= 0 && compareIndex > releaseCheckIndex);
  assert.ok(draftIndex >= 0 && uploadIndex > draftIndex);
  assert.ok(authenticatedCompareIndex > uploadIndex);
  assert.ok(publishIndex > authenticatedCompareIndex);
  assert.ok(manifestIndex > compareIndex);
});

test("private release credentials are isolated from source build and test phases", () => {
  const sourceBuild = job("source_build", "apple_sign");
  const appleSign = job("apple_sign", "updater_sign");
  const updaterSign = job("updater_sign", "publish");
  const publish = job("publish", "deploy");

  assert.match(sourceBuild, /permissions:\n\s+contents:\s*read/);
  assert.match(sourceBuild, /environment:\s*colony-source/);
  assert.match(sourceBuild, /secrets\.ZERG_SOURCE_DEPLOY_KEY/);
  assert.doesNotMatch(sourceBuild, /contents:\s*write|TAURI_SIGNING_PRIVATE_KEY|COLONY_APPLE_/);

  assert.match(appleSign, /environment:\n\s+name:\s*colony-apple-\$\{\{ needs\.validate\.outputs\.channel \}\}/);
  assert.match(appleSign, /secrets\.COLONY_APPLE_CERTIFICATE/);
  assert.doesNotMatch(appleSign, /ZERG_SOURCE_DEPLOY_KEY|TAURI_SIGNING_PRIVATE_KEY|source_repository/);

  assert.match(updaterSign, /environment:\n\s+name:\s*colony-updater-\$\{\{ needs\.validate\.outputs\.channel \}\}/);
  assert.match(updaterSign, /secrets\.COLONY_TAURI_SIGNING_PRIVATE_KEY/);
  assert.doesNotMatch(updaterSign, /ZERG_SOURCE_DEPLOY_KEY|secrets\.COLONY_APPLE_|SOURCE_DIR|zerg\//);

  assert.match(publish, /runs-on:\s*ubuntu-24\.04/);
  assert.match(publish, /environment:\s*colony-feed/);
  assert.match(publish, /permissions:\n\s+contents:\s*write/);
  assert.match(publish, /secrets\.COLONY_FEED_DEPLOY_KEY/);
  assert.doesNotMatch(
    publish,
    /ZERG_SOURCE_DEPLOY_KEY|TAURI_SIGNING_PRIVATE_KEY|secrets\.COLONY_APPLE_|source_repository/,
  );
  assert.equal(
    workflow.match(/secrets\.COLONY_FEED_DEPLOY_KEY/g)?.length,
    1,
    "only the publication job's feed step may receive the release-data deploy key",
  );
  for (const credentialFreeJob of [sourceBuild, appleSign, updaterSign]) {
    assert.doesNotMatch(credentialFreeJob, /COLONY_FEED_DEPLOY_KEY|colony-feed/);
  }
  assert.match(
    workflow,
    /cmp "\$updater_key_file"(?:.|\n)*?"\$SOURCE_DIR\/colony\/src-tauri\/\$updater_key_file"/,
  );
  assert.match(workflow, /base64 --decode "\$updater_key_file"/);
});

test("untrusted source output crosses only digest-checked fresh-runner artifacts", () => {
  const sourceBuild = job("source_build", "apple_sign");
  assert.match(job("apple_sign", "updater_sign"), /needs:\s*\[validate, source_build\]/);
  assert.match(job("updater_sign", "publish"), /needs:\s*\[validate, apple_sign\]/);
  assert.match(job("publish", "deploy"), /needs:\s*\[validate, updater_sign\]/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /actions\/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0/);
  assert.match(workflow, /shasum -a 256 -c/);
  assert.equal(
    workflow.match(/node scripts\/app-archive-policy\.mjs "\$(?:archive|transport)"/g)?.length,
    3,
    "both transports and the updater archive must pass member-type and expansion bounds",
  );
  assert.equal(
    workflow.match(/COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --no-acls -h -czf/g)?.length,
    3,
    "transport archives dereference symlinks and omit non-portable Apple metadata",
  );

  const finalAdHocSign = sourceBuild.indexOf('scripts/sign-macos-app.sh" "$app" "-"');
  const sourceAudit = sourceBuild.indexOf('scripts/audit-macos-bundle.sh" "$app"');
  assert.ok(
    finalAdHocSign >= 0 && sourceAudit > finalAdHocSign,
    "Tauri-repacked JIT runtimes must be re-signed with their narrow entitlements before source audit",
  );
});

test("updater signatures use an exact checksum-pinned verifier", () => {
  assert.doesNotMatch(workflow, /brew install minisign/);
  assert.match(workflow, /minisign-0\.12-linux\.tar\.gz/);
  assert.match(workflow, /9a599b48ba6eb7b1e80f12f36b94ceca7c00b7a5173c95c3efc88d9822957e73/);
});

test("the public Apple audit parses only entitlement plist output", () => {
  const audit = readFileSync(new URL("./audit-macos-app.sh", import.meta.url), "utf8");

  assert.match(audit, /codesign -d --entitlements :- "\$path" 2>\/dev\/null/);
  assert.equal(audit.includes('local key_path="${key//./\\\\.}"'), true);
  assert.match(audit, /plutil -extract "\$key_path" raw/);
  assert.doesNotMatch(audit, /codesign -d --entitlements :- "\$path" 2>&1/);
});

test("request branches stay unprivileged and live feeds publish outside protected main", () => {
  const sourceBuild = job("source_build", "apple_sign");
  const appleSign = job("apple_sign", "updater_sign");
  const updaterSign = job("updater_sign", "publish");
  const publish = job("publish", "deploy");
  const deploy = job("deploy", "verify_live");
  const verifyLive = job("verify_live");

  assert.match(job("validate", "source_build"), /GITHUB_REF.*refs\/heads\/main/);
  for (const protectedJob of [sourceBuild, appleSign, updaterSign, publish, deploy, verifyLive]) {
    assert.match(
      protectedJob,
      /if:\s*github\.ref == 'refs\/heads\/main'/,
      "only protected main may reach a release or deployment boundary",
    );
  }
  assert.match(publish, /refs\/heads\/release-data/);
  assert.match(publish, /HEAD:refs\/heads\/release-data/);
  assert.match(publish, /environment:\s*colony-feed/);
  assert.match(publish, /FEED_DEPLOY_KEY:\s*\$\{\{ secrets\.COLONY_FEED_DEPLOY_KEY \}\}/);
  assert.match(publish, /StrictHostKeyChecking=yes/);
  assert.match(publish, /git@github\.com:\$\{GITHUB_REPOSITORY\}\.git/);
  assert.match(
    publish,
    /node scripts\/update-feed\.mjs \\\n\s+"\$COLONY_CHANNEL" "\$RELEASE_DIR\/latest\.json" "\$data_repo\/site"/,
  );
  assert.match(publish, /site\/\$COLONY_CHANNEL\/releases/);
  assert.doesNotMatch(publish, /cp "\$RELEASE_DIR\/latest\.json"/);
  assert.doesNotMatch(publish, /HEAD:main|git add "?site\//);
  assert.match(deploy, /actions\/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e/);
  assert.match(verifyLive, /needs:\s*\[validate, deploy\]/);
  assert.match(verifyLive, /curl --fail --show-error --location/);
  assert.match(verifyLive, /EXPECTED_PAGE_URL:\s*https:\/\/epoch-ml\.github\.io\/colony-releases\//);
  assert.match(verifyLive, /PAGE_URL.*EXPECTED_PAGE_URL/);
  assert.match(verifyLive, /latest\.json\?run=\$CACHE_BUSTER/);
  assert.match(verifyLive, /latest\.json/);
  assert.match(verifyLive, /cmp /);

  const pagesUpload = workflow.indexOf("actions/upload-pages-artifact@");
  const pagesDeploy = workflow.indexOf("actions/deploy-pages@");
  const liveVerification = workflow.indexOf("verify_live:");
  assert.ok(pagesUpload >= 0 && pagesDeploy > pagesUpload && liveVerification > pagesDeploy);
});

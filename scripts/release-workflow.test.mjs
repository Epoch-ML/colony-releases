import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  assert.equal(workflow.match(/runs-on:\s*ubuntu-24\.04/g)?.length, 5);
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
  assert.equal(
    workflow.match(/^\s+npm audit --audit-level=moderate$/gm)?.length,
    1,
    "the public release boundary must reject development-tool advisories too",
  );
  assert.match(
    workflow,
    /npm audit --omit=dev --audit-level=moderate --prefix "\$SOURCE_DIR\/ztc-web-client"/,
  );
  assert.equal(
    workflow.match(/node-version:\s*"22\.23\.2"/g)?.length,
    7,
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
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
    ],
    "publication must execute only immutable GitHub-owned actions",
  );
  assert.equal(
    workflow.match(/persist-credentials:\s*false/g)?.length,
    7,
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

test("Node provenance normalizes signatures without weakening the shipped signing policy", () => {
  const build = job("source_build", "apple_sign");
  assert.match(build, /codesign --verify --verbose=4 "\$staged_node"/);
  assert.match(build, /Signature=adhoc/);
  assert.match(
    build,
    /codesign -d --entitlements "\$provenance\/staged-node-entitlements\.plist" --xml "\$staged_node"/,
  );
  assert.match(build, /JitRuntimeEntitlements\.plist/);
  assert.match(build, /cmp "\$provenance\/expected-node-entitlements\.json" \\\n+\s+"\$provenance\/staged-node-entitlements\.json"/);
  assert.match(
    build,
    /normalize_macho\(\) \{(?:.|\n)*?cp "\$input" "\$output"(?:.|\n)*?codesign --remove-signature "\$output"/,
  );
  assert.equal(
    build.match(/^\s+normalize_macho "[^\n]+$/gm)?.length,
    4,
    "both staged and pinned upstream slices must be normalized on copies",
  );
  assert.match(
    build,
    /cmp "\$provenance\/staged-node-arm64-unsigned" \\\n+\s+"\$provenance\/upstream-node-arm64-unsigned"/,
  );
  assert.match(
    build,
    /cmp "\$provenance\/staged-node-x64-unsigned" \\\n+\s+"\$provenance\/upstream-node-x64-unsigned"/,
  );
  assert.doesNotMatch(
    build,
    /codesign --remove-signature "\$(?:staged_node|arm_node|x64_node)"/,
    "signature normalization must never mutate shipped or pristine upstream inputs",
  );
});

test("the pinned minimal Rust toolchain installs formatter and linter components", () => {
  const sourceBuild = job("source_build", "apple_sign");
  const installStep = sourceBuild.slice(
    sourceBuild.indexOf("      - name: Install pinned build toolchains"),
    sourceBuild.indexOf("      - name: Reject shipped production dependency advisories"),
  );
  const componentInstall =
    "rustup component add --toolchain 1.88.0 rustfmt clippy";

  assert.match(
    installStep,
    /rustup toolchain install 1\.88\.0 --profile minimal --no-self-update\n\s+rustup component add --toolchain 1\.88\.0 rustfmt clippy\n\s+rustup target add --toolchain 1\.88\.0 \\\n\s+aarch64-apple-darwin x86_64-apple-darwin/,
    "the minimal profile must add both required components on the same pinned toolchain",
  );
  assert.equal(workflow.match(/rustup component add/g)?.length, 1);
  for (const cargoValidation of ["cargo test --locked", "cargo clippy --locked"]) {
    assert.ok(
      sourceBuild.indexOf(componentInstall) < sourceBuild.indexOf(cargoValidation),
      `pinned Rust components must be installed before ${cargoValidation}`,
    );
  }
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
  assert.match(workflow, /node scripts\/deploy-pages\.mjs/);
  assert.match(
    workflow,
    /deploy:\n(?:.|\n)*?needs: feed(?:.|\n)*?name: github-pages(?:.|\n)*?node scripts\/deploy-pages\.mjs/,
    "Pages deployment must use its dedicated protected environment after feed promotion",
  );

  const releaseIndex = workflow.indexOf("gh release create");
  const httpsStepIndex = workflow.indexOf("Re-download every release asset over HTTPS");
  const compareIndex = workflow.indexOf("cmp ", httpsStepIndex);
  const manifestIndex = workflow.indexOf("Persist the verified update manifest on release-data");
  assert.ok(releaseIndex >= 0 && compareIndex > releaseIndex);
  assert.ok(manifestIndex > compareIndex);
});

test("Pages uses a deterministic artifact uploaded through an immutable direct action", () => {
  const feed = job("feed", "deploy");

  assert.doesNotMatch(feed, /actions\/upload-pages-artifact/);
  assert.match(
    feed,
    /Build deterministic Pages artifact(?:.|\n)*?tar \\\n\s+--format=ustar \\\n\s+--sort=name \\\n\s+--mtime='UTC 1970-01-01' \\\n\s+--owner=0 \\\n\s+--group=0 \\\n\s+--numeric-owner/,
  );
  assert.match(
    feed,
    /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02(?:.|\n)*?name: github-pages(?:.|\n)*?path: \$\{\{ runner\.temp \}\}\/artifact\.tar(?:.|\n)*?retention-days: 1/,
  );
});

test("Pages deployment leaves a long queue recoverable instead of cancelling it", () => {
  const feed = job("feed", "deploy");
  const deploy = job("deploy", "verify_live");

  assert.match(
    feed,
    /outputs:\n\s+pages_artifact_id: \$\{\{ steps\.pages-artifact\.outputs\.artifact-id \}\}/,
  );
  assert.match(feed, /id: pages-artifact(?:.|\n)*?uses: actions\/upload-artifact@/);
  assert.match(deploy, /timeout-minutes: 35/);
  assert.doesNotMatch(
    deploy,
    /actions\/deploy-pages@/,
    "the upstream action hard-cancels queued deployments at ten minutes",
  );
  assert.match(deploy, /node scripts\/deploy-pages\.mjs/);
  assert.match(deploy, /PAGES_DEPLOY_TIMEOUT_MS: "1800000"/);
  assert.match(
    deploy,
    /PAGES_ARTIFACT_ID: \$\{\{ needs\.feed\.outputs\.pages_artifact_id \}\}/,
  );
});

test("post-release retries verify and resume an exact immutable release", () => {
  const publish = job("publish", "feed");
  assert.doesNotMatch(workflow, /already exists; publish a higher version/);
  assert.match(workflow, /COLONY_REQUEST_COMMIT/);
  assert.doesNotMatch(
    publish,
    /--target "\$COLONY_REQUEST_COMMIT"|\.target_commitish/,
    "the pre-existing verified tag, not a release-create target write, owns release identity",
  );
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

test("immutable release retries promote only canonical verified public bytes", () => {
  const updaterSign = job("updater_sign", "publish");
  const publish = job("publish", "feed");
  const feed = job("feed", "deploy");
  const verifyLive = job("verify_live");

  assert.match(updaterSign, /name: colony-release-payload/);
  assert.match(
    publish,
    /Existing immutable release will be verified from its public bytes/,
    "an immutable retry must not require regenerated binary equality",
  );
  assert.match(
    publish,
    /if \[\[ "\$release_is_draft" != "true" \]\]; then(?:.|\n)*?"\$release_is_immutable" == "true"(?:.|\n)*?diff -u "\$expected_asset_names" "\$existing_asset_names"(?:.|\n)*?Existing immutable release will be verified from its public bytes/,
  );
  assert.match(publish, /\.browser_download_url/);
  assert.match(publish, /\.digest/);
  assert.match(publish, /--proto '=https' --proto-redir '=https' --tlsv1\.2/);
  assert.match(publish, /--max-filesize/);
  assert.match(publish, /shasum -a 256 -c checksums\.txt/);
  assert.match(publish, /minisign[^\n]*\\\n(?:.|\n)*?-Vm "\$archive"/);
  assert.match(
    publish,
    /if \[\[ "\$RELEASE_WAS_DRAFT" == "true" \]\]; then\n\s+cmp "\$asset" "\$CANONICAL_DIR\/\$name"\n\s+fi/,
    "only a newly published draft may be compared with regenerated local bytes",
  );
  assert.match(
    publish,
    /Upload canonical verified release payload(?:.|\n)*?name: colony-verified-release-payload/,
  );
  assert.match(feed, /name: colony-verified-release-payload/);
  assert.match(verifyLive, /name: colony-verified-release-payload/);
  assert.doesNotMatch(feed, /name: colony-release-payload/);
  assert.doesNotMatch(verifyLive, /name: colony-release-payload/);
  assert.equal(
    workflow.match(/name: colony-verified-release-payload/g)?.length,
    3,
    "publish uploads one canonical payload consumed by feed and live verification",
  );
});

test("private release credentials are isolated from source build and test phases", () => {
  const sourceBuild = job("source_build", "apple_sign");
  const appleSign = job("apple_sign", "updater_sign");
  const updaterSign = job("updater_sign", "publish");
  const publish = job("publish", "feed");
  const feed = job("feed", "deploy");

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
  assert.match(publish, /permissions:\n\s+contents:\s*write/);
  assert.doesNotMatch(
    publish,
    /ZERG_SOURCE_DEPLOY_KEY|TAURI_SIGNING_PRIVATE_KEY|secrets\.COLONY_APPLE_|source_repository|COLONY_FEED_DEPLOY_KEY|colony-feed/,
  );

  assert.match(feed, /runs-on:\s*ubuntu-24\.04/);
  assert.match(feed, /environment:\s*colony-feed/);
  assert.match(feed, /permissions:\n\s+contents:\s*read/);
  assert.match(feed, /secrets\.COLONY_FEED_DEPLOY_KEY/);
  assert.doesNotMatch(
    feed,
    /contents:\s*write|GH_TOKEN|gh release|ZERG_SOURCE_DEPLOY_KEY|TAURI_SIGNING_PRIVATE_KEY|secrets\.COLONY_APPLE_|source_repository/,
  );
  assert.equal(
    workflow.match(/secrets\.COLONY_FEED_DEPLOY_KEY/g)?.length,
    1,
    "only the isolated feed job may receive the release-data deploy key",
  );
  for (const credentialFreeJob of [sourceBuild, appleSign, updaterSign, publish]) {
    assert.doesNotMatch(credentialFreeJob, /COLONY_FEED_DEPLOY_KEY|colony-feed/);
  }
  assert.match(
    workflow,
    /cmp "\$updater_key_file"(?:.|\n)*?"\$SOURCE_DIR\/colony\/src-tauri\/\$updater_key_file"/,
  );
  assert.match(workflow, /base64 --decode "\$updater_key_file"/);
});

test("GitHub Release write authority never shares a runner with the feed deploy key", () => {
  const publish = job("publish", "feed");
  const feed = job("feed", "deploy");

  assert.match(publish, /permissions:\n\s+contents:\s*write/);
  assert.doesNotMatch(
    publish,
    /environment:\s*colony-feed|COLONY_FEED_DEPLOY_KEY|refs\/heads\/release-data|update-feed\.mjs/,
    "the release publication runner must not receive feed branch authority",
  );
  assert.match(feed, /needs:\s*\[validate, publish\]/);
  assert.match(feed, /environment:\s*colony-feed/);
  assert.match(feed, /permissions:\n\s+contents:\s*read/);
  assert.match(feed, /COLONY_FEED_DEPLOY_KEY/);
  assert.doesNotMatch(
    feed,
    /contents:\s*write|GH_TOKEN|gh release (?:create|upload|edit)/,
    "the feed runner must not receive GitHub Release write authority",
  );
});

test("GitHub host-key metadata requests use a step-scoped built-in token", () => {
  const sourceBuild = job("source_build", "apple_sign");
  const feed = job("feed", "deploy");
  const sourceCheckout = sourceBuild.slice(
    sourceBuild.indexOf("      - id: source"),
    sourceBuild.indexOf("      - name: Bind source"),
  );
  const feedPromotion = feed.slice(
    feed.indexOf("      - id: feed"),
    feed.length,
  );

  assert.doesNotMatch(sourceBuild.slice(0, sourceBuild.indexOf("    steps:")), /GITHUB_META_TOKEN/);
  assert.doesNotMatch(feed.slice(0, feed.indexOf("    steps:")), /GITHUB_META_TOKEN/);
  for (const metadataStep of [sourceCheckout, feedPromotion]) {
    assert.match(metadataStep, /GITHUB_META_TOKEN:\s*\$\{\{ github\.token \}\}/);
    assert.match(
      metadataStep,
      /--header "Authorization: Bearer \$GITHUB_META_TOKEN"(?:.|\n)*?https:\/\/api\.github\.com\/meta/,
      "GitHub host-key metadata must not consume a shared runner's unauthenticated API quota",
    );
  }
  assert.equal(
    workflow.match(/GITHUB_META_TOKEN:\s*\$\{\{ github\.token \}\}/g)?.length,
    2,
    "only the two SSH host-key verification steps may receive the built-in token",
  );
});

test("SSH host-key verification uses portable bounded scans and ignores banners", () => {
  const sourceBuild = job("source_build", "apple_sign");
  const feed = job("feed", "deploy");
  const sourceCheckout = sourceBuild.slice(
    sourceBuild.indexOf("      - id: source"),
    sourceBuild.indexOf("      - name: Bind source"),
  );
  const feedPromotion = feed.slice(
    feed.indexOf("      - id: feed"),
    feed.length,
  );

  for (const metadataStep of [sourceCheckout, feedPromotion]) {
    assert.match(
      metadataStep,
      /ssh-keyscan -T 10 -t rsa,ecdsa,ed25519 github\.com 2>\/dev\/null/,
      "macOS and Ubuntu must use only their shared ssh-keyscan option surface",
    );
    assert.match(
      metadataStep,
      /while read -r _host algorithm key extra; do(?:.|\n)*?\[\[ -z "\$_host" \|\| "\$\{_host:0:1\}" == "#" \]\](?:.|\n)*?continue/,
      "scanner comments and blank lines must never enter authenticated key comparison",
    );
  }
  assert.equal(
    workflow.match(/ssh-keyscan -T 10 -t rsa,ecdsa,ed25519 github\.com/g)?.length,
    2,
    "both deploy-key paths must suppress ssh-keyscan banners",
  );
  assert.doesNotMatch(workflow, /ssh-keyscan -q/);
});

test("detached monorepo checkout never hydrates unrelated Git LFS payloads", () => {
  const sourceBuild = job("source_build", "apple_sign");
  const sourceCheckout = sourceBuild.slice(
    sourceBuild.indexOf("      - id: source"),
    sourceBuild.indexOf("      - name: Bind source"),
  );

  assert.match(
    sourceCheckout,
    /git -C "\$source_dir" fetch --no-tags --depth=1 origin \\\n\s+"\$COLONY_SOURCE_REF:\$COLONY_SOURCE_REF"/,
    "the validated source tag must remain an explicit no-tags fetch",
  );
  assert.match(
    sourceCheckout,
    /GIT_LFS_SKIP_SMUDGE=1 git -C "\$source_dir" checkout --detach "\$COLONY_SOURCE_SHA"/,
    "detached checkout must not hydrate unrelated monorepo LFS objects",
  );
  assert.equal(workflow.match(/GIT_LFS_SKIP_SMUDGE=1/g)?.length, 1);
});

test("targeted ZTC TypeScript tests resolve the locked loader from the ZTC workspace", () => {
  const sourceBuild = job("source_build", "apple_sign");
  const testStep = sourceBuild.slice(
    sourceBuild.indexOf("      - name: Test ZTC public runtime and Colony"),
    sourceBuild.indexOf("      - name: Generate updater-enabled release config"),
  );

  assert.match(
    testStep,
    /npm --prefix "\$SOURCE_DIR\/ztc" run build\n\s+\(\n\s+cd "\$SOURCE_DIR\/ztc"\n\s+node --import tsx --test \\\n\s+"tests\/unit\/pane_child_ztc_launch\.test\.ts" \\\n\s+"tests\/unit\/plugin_public_surface_static\.test\.ts" \\\n\s+"tests\/unit\/plugin_runtime_registry\.test\.ts"\n\s+\)/,
    "tsx must resolve from the exact locked ZTC dependency tree",
  );
  assert.doesNotMatch(testStep, /node --import tsx --test \\\n\s+"\$SOURCE_DIR\/ztc\//);
  assert.match(
    testStep,
    /npm --prefix "\$SOURCE_DIR\/ztc-web-client" run build:plugin\n\s+\(\n\s+cd "\$SOURCE_DIR\/colony"\n\s+npx tsc --noEmit\n\s+npx tsc -p src\/colony\/ui\/tsconfig\.json --noEmit\n\s+npm test\n\s+npm run test:ui\n\s+\)\n\s+cargo test --locked/,
    "the later Colony and Rust command boundaries must remain unchanged",
  );
});

test("pane-launch tests build the exact locked Rust TUI prerequisite", () => {
  const sourceBuild = job("source_build", "apple_sign");
  const testStep = sourceBuild.slice(
    sourceBuild.indexOf("      - name: Test ZTC public runtime and Colony"),
    sourceBuild.indexOf("      - name: Generate updater-enabled release config"),
  );
  const rustBuild =
    'cargo build --release --locked --manifest-path "$ztc_tui_manifest"';
  const paneTests = 'node --import tsx --test \\';

  assert.match(
    testStep,
    /ztc_tui_lock="locks\/ztc-tui\/\$\{COLONY_SOURCE_SHA\}\.Cargo\.lock"(?:.|\n)*?ztc_tui_manifest="\$SOURCE_DIR\/ztc\/packages\/ztc-tui\/Cargo\.toml"(?:.|\n)*?install -m 0600 "\$ztc_tui_lock" "\$\(dirname "\$ztc_tui_manifest"\)\/Cargo\.lock"/,
    "the exact source SHA must select the trusted ztc-tui dependency lock",
  );
  assert.ok(testStep.includes(rustBuild), "ztc-tui must use a locked release build");
  assert.match(
    testStep,
    /ztc_tui_binary="\$SOURCE_DIR\/ztc\/packages\/ztc-tui\/target\/release\/ztc-tui"(?:.|\n)*?\[\[ -x "\$ztc_tui_binary" \]\]/,
    "the binary path used by ZTC discovery must exist and be executable",
  );
  assert.ok(
    testStep.indexOf(rustBuild) < testStep.indexOf(paneTests),
    "the native renderer must be built before pane-launch tests execute",
  );
  assert.doesNotMatch(testStep, /cargo build --release(?! --locked)/);
});

test("the fixed Colony source has its exact audited ZTC TUI lock", () => {
  const lockUrl = new URL(
    "../locks/ztc-tui/cba256f34d01eeabb637dd3b76f9a9f8d678aff8.Cargo.lock",
    import.meta.url,
  );
  const lockBytes = existsSync(lockUrl)
    ? readFileSync(lockUrl)
    : Buffer.from("missing audited lock alias");
  const digest = createHash("sha256").update(lockBytes).digest("hex");

  assert.equal(
    digest,
    "66ac597a7048542a99371cc74398635ebea5fdda5327aac396122851e06d40e9",
    "source cba256f34 must select the reviewed dependency graph without regenerating it",
  );
});

test("the startup-update source reuses the unchanged audited ZTC TUI lock", () => {
  const lockUrl = new URL(
    "../locks/ztc-tui/3d4c253e1abe85c7db09ef67a0aacbff77736a08.Cargo.lock",
    import.meta.url,
  );
  const lockBytes = existsSync(lockUrl)
    ? readFileSync(lockUrl)
    : Buffer.from("missing startup-update lock alias");
  const digest = createHash("sha256").update(lockBytes).digest("hex");

  assert.equal(
    digest,
    "66ac597a7048542a99371cc74398635ebea5fdda5327aac396122851e06d40e9",
    "source 3d4c253e1 must select the unchanged reviewed dependency graph",
  );
});

test("untrusted source output crosses only digest-checked fresh-runner artifacts", () => {
  const sourceBuild = job("source_build", "apple_sign");
  assert.match(job("apple_sign", "updater_sign"), /needs:\s*\[validate, source_build\]/);
  assert.match(job("updater_sign", "publish"), /needs:\s*\[validate, apple_sign\]/);
  assert.match(job("publish", "feed"), /needs:\s*\[validate, updater_sign\]/);
  assert.match(job("feed", "deploy"), /needs:\s*\[validate, publish\]/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /actions\/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0/);
  assert.match(workflow, /shasum -a 256 -c/);
  assert.match(
    job("feed", "deploy"),
    /Bind the feed candidate to the immutable public release(?:.|\n)*?releases\/download\/\$encoded_tag\/latest\.json(?:.|\n)*?cmp "\$RELEASE_DIR\/latest\.json" "\$published_manifest"/,
  );
  assert.equal(
    workflow.match(/node scripts\/app-archive-policy\.mjs "\$(?:archive|transport)"/g)?.length,
    4,
    "both transports, the updater archive, and canonical public archive must pass bounds",
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
  const publish = job("publish", "feed");
  const feed = job("feed", "deploy");
  const deploy = job("deploy", "verify_live");
  const verifyLive = job("verify_live");

  assert.match(job("validate", "source_build"), /GITHUB_REF.*refs\/heads\/main/);
  for (const protectedJob of [sourceBuild, appleSign, updaterSign, publish, feed, deploy, verifyLive]) {
    assert.match(
      protectedJob,
      /if:\s*github\.ref == 'refs\/heads\/main'/,
      "only protected main may reach a release or deployment boundary",
    );
  }
  assert.match(feed, /refs\/heads\/release-data/);
  assert.match(feed, /HEAD:refs\/heads\/release-data/);
  assert.match(feed, /environment:\s*colony-feed/);
  assert.match(feed, /FEED_DEPLOY_KEY:\s*\$\{\{ secrets\.COLONY_FEED_DEPLOY_KEY \}\}/);
  assert.match(feed, /StrictHostKeyChecking=yes/);
  assert.match(feed, /git@github\.com:\$\{GITHUB_REPOSITORY\}\.git/);
  assert.match(
    feed,
    /node scripts\/update-feed\.mjs \\\n\s+"\$COLONY_CHANNEL" "\$RELEASE_DIR\/latest\.json" "\$data_repo\/site"/,
  );
  assert.match(feed, /site\/\$COLONY_CHANNEL\/releases/);
  assert.doesNotMatch(feed, /cp "\$RELEASE_DIR\/latest\.json"/);
  assert.doesNotMatch(feed, /HEAD:main|git add "?site\//);
  assert.doesNotMatch(publish, /release-data|COLONY_FEED_DEPLOY_KEY|colony-feed/);
  assert.match(deploy, /needs:\s*feed/);
  assert.match(deploy, /node scripts\/deploy-pages\.mjs/);
  assert.doesNotMatch(deploy, /actions\/deploy-pages@/);
  assert.match(verifyLive, /needs:\s*\[validate, deploy\]/);
  assert.match(verifyLive, /curl --fail --show-error --location/);
  assert.match(verifyLive, /EXPECTED_PAGE_URL:\s*https:\/\/epoch-ml\.github\.io\/colony-releases\//);
  assert.match(verifyLive, /PAGE_URL.*EXPECTED_PAGE_URL/);
  assert.match(verifyLive, /latest\.json\?run=\$CACHE_BUSTER/);
  assert.match(verifyLive, /latest\.json/);
  assert.match(verifyLive, /cmp /);

  const pagesUpload = workflow.indexOf("name: Upload deterministic Pages artifact");
  const pagesDeploy = workflow.indexOf("node scripts/deploy-pages.mjs");
  const liveVerification = workflow.indexOf("verify_live:");
  assert.ok(pagesUpload >= 0 && pagesDeploy > pagesUpload && liveVerification > pagesDeploy);
});

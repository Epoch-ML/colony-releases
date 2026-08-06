# Colony releases

This public repository is the distribution boundary for the Colony desktop
application. It contains no application source and no private signing keys.

An immutable tag in `Epoch-ML/zerg` produces a deterministic request artifact;
the source workflow has no credential or write path into this repository. A
human adds that unchanged JSON on a `release-request/<tag>` branch and merges
its pull request into protected `main`. An authorized human creates the matching
protected public tag at the request's unique addition commit and explicitly
dispatches the release workflow from `main`. The workflow validates that tag and
the request's immutable addition
commit, checks out only the stated 40-character source SHA through a read-only
deploy key, and tests, builds, and smoke-tests a universal macOS application on
an unprivileged runner. Fresh runners then Apple-sign the app, updater-sign its
archive, and publish the immutable GitHub Release. The publication runner
downloads every asset over HTTPS and compares the bytes before committing the
channel feed only to `release-data`. GitHub Pages deploys that exact payload,
then a final job byte-compares the live HTTPS `latest.json` with it.

The updater private key is never available to source installs, tests, builds,
or Apple signing. The updater runner checks out only this public repository and
receives only the already Apple-signed app. Apple credentials, the updater key,
and `contents: write` exist on three different fresh runners.

Release builds pin Node `22.23.2` exactly. That same version is embedded as the
private ZTC runtime inside `Colony.app`, smoke-tested after packaging, and
recorded in `release-metadata.json` so the executable provenance is explicit.

Update feeds:

- `https://epoch-ml.github.io/colony-releases/preview/latest.json`
- `https://epoch-ml.github.io/colony-releases/stable/latest.json`

## Repository setup

Before the first release:

1. Protect `main`: require pull requests and review, disallow force pushes and
   deletion, and restrict release environments to that branch. Source automation
   has no repository credential; humans submit release-request branches.
2. Enable **Settings → Releases → Release immutability**. The workflow refuses
   to publish `latest.json` unless the resulting GitHub Release reports
   `immutable: true`.
3. Configure GitHub Pages to deploy through GitHub Actions. The workflow keeps
   generated feeds on the dedicated `release-data` branch rather than `main`.
4. Create these exact environments, all restricted to `main`:

   - `colony-source` (approval-free);
   - `colony-apple-preview` (approval-free, no secrets);
   - `colony-apple-stable` (explicit Idan approval; self-review is temporarily
     allowed until a second authorized reviewer exists);
   - `colony-updater-preview` (approval-free);
   - `colony-updater-stable` (explicit Idan approval; self-review is temporarily
     allowed until a second authorized reviewer exists);
   - `colony-feed` (approval-free).

5. Put only `ZERG_SOURCE_DEPLOY_KEY`, a read-only deploy key for
   `Epoch-ML/zerg`, in `colony-source`.
6. Put only `COLONY_TAURI_SIGNING_PRIVATE_KEY` and
   `COLONY_TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in each `colony-updater-*`
   environment. The two environments must contain different key material: the
   preview key corresponds to `updater.preview.pubkey`, and the stable key to
   `updater.stable.pubkey`.
7. Add the following secrets only to `colony-apple-stable`:

   - `COLONY_APPLE_CERTIFICATE` (base64 Developer ID `.p12`);
   - `COLONY_APPLE_CERTIFICATE_PASSWORD`;
   - `COLONY_APPLE_SIGNING_IDENTITY`;
   - `COLONY_APPLE_TEAM_ID`;
   - `COLONY_APPLE_API_ISSUER`;
   - `COLONY_APPLE_API_KEY_ID`;
   - `COLONY_APPLE_API_PRIVATE_KEY` (complete `.p8` contents).
8. Put only `COLONY_FEED_DEPLOY_KEY`, a write-enabled deploy key for this
   repository, in `colony-feed`. The publication job uses it only to fetch and
   push `release-data`; application builds and signing jobs cannot access it.
9. Protect `colony-desktop-v*` and `colony-desktop-preview-v*` tags: allow
   creation only by the designated human release authority, disallow update and
   deletion, and do not grant Actions or deploy-key bypass. The release workflow
   verifies a pre-existing tag and never creates one.

`colony-apple-preview` intentionally contains no credentials and uses ad-hoc
signing. There are no repository-wide release secrets. The updater private key
is unique to Colony and its channel. The public halves are committed here as
`updater.preview.pubkey` and `updater.stable.pubkey`, with byte-identical source
copies at `colony/src-tauri/updater.preview.pubkey` and
`colony/src-tauri/updater.stable.pubkey`. The workflow selects the key from the
validated request channel, byte-compares that trust root before executing
source, and uses the same release-repository copy for signature verification.

## Release requests

Requests have exactly nine fields and are named after their tag. For example:

```json
{
  "schema_version": 1,
  "product": "Colony",
  "channel": "preview",
  "version": "0.2.0-preview.1",
  "release_tag": "colony-desktop-preview-v0.2.0-preview.1",
  "source_repository": "Epoch-ML/zerg",
  "source_sha": "0123456789abcdef0123456789abcdef01234567",
  "source_ref": "refs/tags/colony-desktop-preview-v0.2.0-preview.1",
  "requested_at": "2026-08-05T20:00:00.000Z"
}
```

Preview versions accept strict SemVer. Stable versions must be numeric
`MAJOR.MINOR.PATCH`. A release tag or asset is never replaced; publish a higher
version instead. Requests reach `main` only through reviewed
`release-request/<tag>` pull requests.

The source workflow uploads the request as
`colony-release-request-<tag>`. Download it, add the JSON unchanged under
`requests/`, and merge the one-file PR. Find the unique addition commit, create
the protected public tag at that exact commit using the authorized human
identity, then manually run **Build and publish Colony desktop** from `main`
with `requests/<tag>.json`. Missing, moved, or workflow-created tags fail closed.

`requested_at` is the canonical UTC timestamp supplied by the immutable release
request; publication never substitutes a runner's wall clock. Each channel feed
advances only to a higher SemVer precedence. Replaying the exact same version is
allowed only when its manifest is byte-identical, while rollback,
equal-precedence aliases, and same-version mutation fail closed. Every accepted
manifest remains available at `<channel>/releases/<version>.json` as immutable
per-version history.

Run the local boundary tests with `npm test` and targeted mutation evidence with
`npm run test:mutation`. Request files must be regular files, may be added only
once, and must remain byte-identical to their addition commit. The workflow creates a draft,
resumes only an exactly matching draft, uploads only missing assets (including
`latest.json` as the immutable feed-recovery copy), compares
every asset byte-for-byte, and publishes only after the set is complete. App
archives are inspected before every extraction or signature step: paths must be
strictly inside `Colony.app`, entries must be regular files or directories, tar
checksums must match, and expanded bytes, members, headers, and PAX metadata are
bounded. A
retry may also resume an exactly matching published immutable release to finish
the `release-data` feed, Pages deployment, and live HTTPS byte verification;
any metadata, tag-target, asset-name, or byte mismatch fails closed.

# Releasing Praxis

The [release workflow](../.github/workflows/release.yml) builds the reviewed source on three native runners, tests installed distributions, and publishes only after every packaging job and the reusable [Check workflow](../.github/workflows/check.yml) succeeds. Check gates release publication on its full Node 22.15.0/24 cross-platform matrix and PostgreSQL tests. The repository is [GShLi/praxis](https://github.com/GShLi/praxis), currently private.

## Release channels

| Trigger                                                            | Signing policy                                                                             | GitHub Release                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Manual dispatch, `signed=false` (default)                          | No production signing credentials; candidate provenance is optional                        | **UNSIGNED** prerelease, never latest/stable; tag `vVERSION-candidate.RUN_NUMBER` |
| Push `vVERSION`, or manual dispatch on that tag with `signed=true` | Required macOS/Windows platform signatures and mandatory GitHub provenance for every asset | Stable for a stable package version; prerelease for a prerelease package version  |

`VERSION` comes from the root `package.json`, currently `0.1.0`. A tag-triggered run must exactly match `v` plus that version. Signed branch dispatches fail before packaging. An unsigned branch dispatch creates, for example, `v0.1.0-candidate.42`, pointing to the tested commit; it does not create or publish `v0.1.0`. For an existing prerelease version, the candidate suffix is appended with a dot. Build metadata is omitted from candidate tags.

Candidate filenames and their internal application version still use the package version; their release title, prerelease flag, manifest policy and acceptance records identify the candidate channel. A successful unsigned candidate does not establish trusted platform signing or authorize a stable release.

For macOS, **UNSIGNED** means no Apple Developer ID signature and no Apple notarization. Candidates use an ad-hoc signature (`identity: '-'`) to seal the complete app bundle and nested code, including native helpers. They must pass strict bundle-integrity verification; a missing or incomplete signature is a packaging defect, not an acceptable consequence of the candidate label. Ad-hoc integrity does not establish publisher identity or Gatekeeper trust.

## Build and acceptance contract

| Runner           | Node architecture | Distribution target            |
| ---------------- | ----------------- | ------------------------------ |
| `macos-15`       | ARM64             | macOS DMG and ZIP              |
| `windows-latest` | x64               | Windows NSIS installer and ZIP |
| `ubuntu-22.04`   | x64               | Linux AppImage and tar.gz      |

Release packaging uses Node 24 and pnpm **11.9.0**, with a frozen lockfile; the reusable Check workflow additionally tests Node 22.15.0. Packaging asserts `process.platform` and `process.arch` against the matrix before compilation. No other distribution CPU/OS combination is claimed as accepted. Windows initializes the MSVC x64 environment. Linux installs build tools, Xvfb/Xauth, D-Bus, libsecret tools, GNOME Keyring, Electron libraries and libfuse2. Electron checks and smoke runs use `xvfb-run -a -- ...`.

Each packaging platform runs `pnpm native:build`, `pnpm check` (structure, type and core/native behavior tests), and `pnpm build`. After metadata validation, the release's `checks` job calls Check from the same source revision. Its core matrix runs Node 22.15.0 and 24 on Ubuntu, macOS and Windows; its separate Ubuntu PostgreSQL job runs `pnpm test:postgres` against a dedicated PostgreSQL 18 service with disposable test data. Packaging may run alongside these checks, but publication requires successful completion of the entire reusable workflow and all packaging jobs. Check retains its independent push and pull-request triggers; those separate runs do not substitute for the release's own `checks` dependency. Both workflows retain `contents: read` as their default token permission; signing and publication privileges remain scoped to the release jobs that need them.

The release commands then run in this order:

```sh
pnpm release:package
pnpm release:desktop -- --dir
pnpm release:smoke
pnpm release:desktop
pnpm release:verify
pnpm release:smoke
pnpm release:manifest
```

1. `release:package` creates `out/release/stage/{cli,server,desktop}` and CLI/server tar.gz archives. These contain the compiled layout and production dependency closure.
2. `release:desktop -- --dir` builds an unsigned desktop directory for an early smoke test, without production credentials. The wrapper recognizes the forwarded `--dir` argument.
3. The first `release:smoke` extracts the CLI/server archives outside the source tree, checks the relocated CLI/Host and server runtime, and launches the packaged desktop. It is an early check, not final installer acceptance.
4. The final `release:desktop` builds the matrix targets. For signed macOS/Windows runs, only this step receives the platform credentials and `PRAXIS_RELEASE_SIGNED=1`.
5. `release:verify` verifies required platform signatures, copies the verified desktop native helpers into the CLI stage, and **rebuilds the archives**. On macOS, strict bundle and native-helper integrity checks apply to both ad-hoc candidates and signed releases; the signed release additionally requires its existing Developer ID/notarization gates. This changes release bytes, so verification must precede the final smoke and manifest.
6. The final `release:smoke` accepts those rebuilt archives and the actual desktop installer: mounts the macOS DMG and copies/launches the app in a temporary location; silently installs Windows NSIS into a temporary directory and uninstalls it; extracts and launches the Linux AppImage. Desktop acceptance exercises renderer, preload and Host using isolated test data, including installation paths containing spaces. Windows acceptance requires a disposable account and no existing registered Praxis installation; the workflow opts in with `PRAXIS_RELEASE_DISPOSABLE_WINDOWS=1` only on Windows smoke steps. Temporary installation resources are cleaned up.
7. `release:manifest` requires successful acceptance with `installerTested: true`, a matching version and unchanged accepted artifact bytes. The early directory-only smoke cannot satisfy this gate.

The automated installer checks do not replace interactive installer UI review, real-model feature acceptance or the remaining platform sandbox acceptance described in the [delivery spec](superpowers/specs/2026-11-02-praxis-sandbox-delivery-design.md). Rebuilding, re-signing or editing an accepted artifact requires repeating verification, final smoke and manifest generation.

macOS installer acceptance must also strictly verify the app copied from the DMG before launching it. A successful renderer/preload/Host startup alone does not prove that the bundle's sealed resources are valid. The strengthened checks are required for the replacement candidate; its actual acceptance is still pending as recorded below.

## Artifacts and provenance

Only final files under `out/release/artifacts/` are uploaded. Each platform produces:

- `praxis-cli-VERSION-PLATFORM.tar.gz` and `praxis-server-VERSION-PLATFORM.tar.gz`.
- The two desktop targets listed above, named by electron-builder with version, OS and architecture.
- `acceptance-PLATFORM.json` and `dependencies-PLATFORM.json`.
- `SHA256SUMS-PLATFORM.txt` and `release-manifest-PLATFORM.json`.

Here `PLATFORM` is `darwin-arm64`, `win32-x64` or `linux-x64`; electron-builder desktop filenames use its own OS labels. The workflow retains per-platform Actions artifacts as `release-candidate-PLATFORM` or `release-signed-PLATFORM` for 14 days.

Publishing downloads all three artifacts from the same run, checks their checksums, and validates manifest version, platform, source commit and signature policy. Signed runs also verify each downloaded file's GitHub attestation against this repository, workflow, source ref and commit. Duplicate names, unexpected directories or missing platform metadata stop publication. No platform files are overwritten when merging.

The publish job preserves every platform file and adds a combined `release-manifest.json` and `SHA256SUMS`. The combined checksums cover all other published files, including the platform manifests and combined manifest. The workflow attests **every final asset**, including the checksum and manifest files themselves, after all byte-changing operations. It first uploads a draft release and makes it visible only after all assets upload successfully. A failed upload leaves a draft, not a partial public release.

SHA-256 checksums detect changed bytes; they are **not signatures**. macOS and Windows use platform code signing. Linux binaries and all CLI/server archives use signed GitHub build provenance bound to their exact file digest. A verified attestation proves the declared build origin, not functional correctness or platform certification. See [GitHub's attestation action](https://github.com/actions/attest-build-provenance/tree/v3) and [verification options](https://cli.github.com/manual/gh_attestation_verify).

For private repositories, attestation availability depends on the GitHub plan. Candidates skip attestation by default for private repositories. Set the repository variable `PRAXIS_CANDIDATE_ATTESTATIONS=1` only when the repository supports it; failures remain non-blocking for unsigned candidates and are reported in the workflow summary/release notes. Public repository candidates attempt attestation automatically. Signed releases always require successful attestations and never silently downgrade when the plan is ineligible. [GitHub documents the plan restrictions here](https://github.com/actions/attest-build-provenance#readme).

## Signing credentials and repository setup

Configure the `release-signing` environment for trusted version tags, with the desired reviewer protection. Use `release-candidate` for unsigned builds and `release-publish` for release publication; their environment rules must permit the reviewed candidate branch and/or version tags as appropriate. Restrict production secrets to the signing environment. Protect version tags against moving after a release starts. Ensure the workflow exists on the default branch before using manual dispatch.

The `GITHUB_TOKEN` needs `contents: write` only in the publish job. Attestation jobs require `id-token: write` and `attestations: write`; repository/organization policy and plan must allow them. No personal access token is needed for the workflow's same-repository artifact uploads and releases.

| Environment secret     | Value and use                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CSC_LINK`             | Base64-encoded exported macOS Developer ID Application `.p12`, including the private key. Passed directly to electron-builder. |
| `CSC_KEY_PASSWORD`     | Non-empty password protecting that `.p12`.                                                                                     |
| `APPLE_API_KEY`        | **Base64-encoded contents** of the App Store Connect API private key `.p8`; not a filesystem path in GitHub Secrets.           |
| `APPLE_API_KEY_ID`     | The Apple API key ID.                                                                                                          |
| `APPLE_API_ISSUER`     | The App Store Connect issuer ID for the key.                                                                                   |
| `WIN_CSC_LINK`         | Base64-encoded Windows code-signing `.pfx`/`.p12`, including its private key, accepted by electron-builder.                    |
| `WIN_CSC_KEY_PASSWORD` | Non-empty password protecting the Windows certificate.                                                                         |

The macOS signing step decodes the `APPLE_API_KEY` secret into an owner-readable temporary `.p8` outside the workspace. It passes that **absolute path** as the process environment variable `APPLE_API_KEY`, following electron-builder's notarization convention, and removes the file on step exit. Certificate secrets stay in step environment variables. Do not echo their values, enable shell tracing, commit signing files or upload the temporary key. These conventions match the installed electron-builder 26.18.0 implementation; consult its [versioned documentation](https://www.electron.build/v26/).

`PRAXIS_RELEASE_SIGNED=1` makes the desktop command require `forceCodeSigning` on macOS/Windows. macOS enables hardened runtime and notarization; verification requires strict `codesign`, Gatekeeper assessment and a valid stapled notarization ticket. Missing credentials, an ad-hoc identity or failed notarization cannot produce a signed release.

Windows enables signing of nested native `.exe` helpers as well as the desktop executable and NSIS installer. With the current `asar: false` and `signExts: ['.exe']` configuration, electron-builder 26.18.0 applies its signing transform while copying nested application files. `release:verify` independently requires a `Valid` Authenticode result for the desktop, installer and each native helper before rebuilding the CLI archive. Providing a certificate variable alone does not establish successful signing. A hardware-only/cloud signing identity needs a separately implemented adapter; do not substitute an unavailable certificate export.

## Run an unsigned candidate

After the reviewed source and workflow are pushed, dispatch from the source branch (replace `main` if needed):

```sh
gh workflow run release.yml --repo GShLi/praxis --ref main -f signed=false
gh run list --repo GShLi/praxis --workflow release.yml
gh run watch RUN_ID --repo GShLi/praxis --exit-status
```

All three package jobs and the complete reusable Check workflow (both Node versions on all three OSes, plus PostgreSQL) must be green. Download either the Actions artifacts or the resulting **UNSIGNED** prerelease. An optional attestation failure is explicitly reported; it is not presented as a signed candidate. The workflow refuses an existing candidate tag rather than attaching unreviewed bytes to it. Use a fresh dispatch for a new run number; inspect any failed draft before removing it manually. Do not push candidate tags as if they were version tags or dispatch a signed run against them.

A macOS candidate with valid ad-hoc bundle integrity can still be blocked because its developer is unidentified and it is not notarized. If you trust that specific candidate and choose to run it, macOS may offer **System Settings → Privacy & Security → Open Anyway** after an attempted launch. This is a per-app exception, not Gatekeeper approval or a repair for broken signatures; see [Apple's guidance](https://support.apple.com/en-gb/102445). Do not disable Gatekeeper globally. Do not use an override to work around candidate.4's known incomplete signature; wait for a corrected, verified candidate.

For a local unsigned run on a supported platform, use Node 24, pnpm 11.9.0 and that platform's compiler/desktop dependencies:

```sh
pnpm install --frozen-lockfile
pnpm native:build
pnpm check
pnpm build
export PRAXIS_RELEASE_SIGNED=0
export CSC_IDENTITY_AUTO_DISCOVERY=false
pnpm release:package
pnpm release:desktop -- --dir
pnpm release:smoke
pnpm release:desktop
pnpm release:verify
pnpm release:smoke
pnpm release:manifest
```

On headless Ubuntu, prefix `pnpm check` and both smoke commands with `xvfb-run -a --`. In PowerShell set `$env:PRAXIS_RELEASE_SIGNED='0'` and `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'` instead of `export`. Keep production signing variables unset for local candidate tests. A local build has no GitHub workflow attestation and does not publish anything.

**Do not run Windows NSIS acceptance in your normal or production Windows account.** Use a disposable Windows VM/account with no registered Praxis installation, then explicitly set `$env:PRAXIS_RELEASE_DISPOSABLE_WINDOWS='1'` for smoke execution. The installer changes per-user installation/registry state even with a temporary destination. The smoke command checks for existing Praxis registrations and refuses to proceed; do not bypass that guard or remove an existing installation merely to run this test. The hosted `windows-latest` release runner provides the disposable CI account.

## Run a signed release

First complete the candidate run, confirm trusted credentials and an attestation-capable plan, and verify environment protection. Create the exact version tag on the reviewed commit and push it; the tag push starts the signed workflow. For an existing version tag, an explicit dispatch is also supported:

```sh
gh workflow run release.yml --repo GShLi/praxis --ref v0.1.0 -f signed=true
```

The workflow rechecks the remote tag's commit immediately before publishing. It does not replace an existing release or reuse an unsigned candidate tag. A failed job, failed signature, failed installer smoke, missing acceptance, missing attestation or any failed reusable Check job (including Node 22.15.0 and PostgreSQL) prevents publication. Investigate a failed draft before retrying; a fresh release must retain a clear source-to-bytes relationship.

After downloading assets into one directory, verify their integrity and, where available, provenance:

```sh
sha256sum --check SHA256SUMS
gh attestation verify ARTIFACT_FILE --repo GShLi/praxis \
  --signer-workflow GShLi/praxis/.github/workflows/release.yml \
  --source-ref refs/tags/v0.1.0 --source-digest REVIEWED_COMMIT_SHA
```

macOS can use `shasum -a 256 --check SHA256SUMS`. Repeat attestation verification for each asset needed; authenticate with repository access for private assets. For candidate attestations, use the actual source branch/tag ref from that run, not the candidate tag created later during publication. A candidate whose notes say attestation was skipped/failed has no claimed provenance guarantee.

## Current acceptance status

**Known bad macOS bundle: v0.1.0-candidate.4.** A user reported the downloaded app as damaged. Strict `codesign` verification of the installed app failed with an incomplete bundle signature, while the downloaded DMG hash matched the published digest. The prior startup smoke missed strict sealed-resource verification. Do not treat this macOS artifact as accepted or try to repair it with a security override. A corrected candidate using complete ad-hoc signing and unconditional strict bundle/helper checks is being prepared; its rebuilt, downloaded and installed artifact acceptance remains **pending** until the implementing agent records actual results.

On 2026-11-04, [Release run 41800812844](https://github.com/GShLi/praxis/actions/runs/41800812844) reported success under the earlier checks and published [UNSIGNED v0.1.0-candidate.4](https://github.com/GShLi/praxis/releases/tag/v0.1.0-candidate.4) in the private repository. The tested source is `3e58e42fdbf23dd85be97df73df762ba3ea44178`. The release is not a draft, is a prerelease, and contains 26 assets: 12 application distributions plus acceptance records, dependency inventories, manifests and checksums. That historical green run does not supersede the subsequently confirmed macOS signing defect.

After publication, all 26 asset digests reported by GitHub were checked against the published checksum inventory. The eight downloaded checksum/manifest/acceptance files were also hashed locally; all three installation records matched the published distribution bytes and exact source commit. This is integrity verification, not a trusted code signature.

| Gate                                 | Actual result                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure, TypeScript and core tests | All six jobs passed: Node 22.15.0 and 24 on macOS, Linux and Windows                                                                                    |
| PostgreSQL                           | Integration gate passed against PostgreSQL 18                                                                                                           |
| macOS ARM64                          | Earlier packaging and startup smoke passed, but the downloaded candidate.4 app failed strict bundle-signature verification; corrected candidate pending |
| Linux x64                            | Build, AppImage/tar.gz packaging, AppImage extraction and installed launch passed on Ubuntu 22.04                                                       |
| Windows x64                          | Build, NSIS/ZIP packaging, silent installation, installed launch and uninstall passed on the hosted Windows runner                                      |
| CLI and server                       | Relocated archive extraction, CLI help/Host handshake and server runtime loading passed on all three platforms                                          |
| Publication                          | Combined checksums and manifests verified; complete asset set uploaded before draft publication                                                         |
| Trusted signing                      | **Not performed:** this is an unsigned candidate; macOS notarization and Windows trusted signing remain unverified                                      |
| GitHub provenance                    | **Skipped:** private-repository candidate attestation was not enabled; checksums are not signatures                                                     |

The separate [Windows native compatibility run](https://github.com/GShLi/praxis/actions/runs/41800803282) passed on both supported Node versions. It compares real temporary-directory identities with `GetFileInformationByHandle`. Release testing fixed an older libuv path-stat ABI defect by using handle-stat, and replaced Git Bash tar with Windows System32 tar for drive-letter archive paths. Backup flush access, native aborted-write cleanup and deterministic Electron installation were also corrected without disabling their safety checks.

The final local `pnpm check` passed structure/type checks and 334 tests, with six platform-dependent skips. Remote Windows acceptance uses a hosted Windows Server runner; it is not a claim of interactive testing on the user's Windows 11 machine. Installer smoke does not replace real-model feature testing or a production server deployment. No Apple Developer ID/notarization credentials or Windows signing certificate were supplied, so the signed release gates remain mandatory and unexecuted.

Configure the signing secrets and an attestation-capable repository plan before publishing a trusted production version. The implementation plan and broader acceptance scope are in the [release plan](superpowers/plans/2026-11-04-release-pipeline.md) and [delivery spec](superpowers/specs/2026-11-02-praxis-sandbox-delivery-design.md).

# Praxis Release Pipeline Implementation Plan

**Goal:** Implement check → build → package → installation acceptance → signing → release for server, CLI and desktop.

**Architecture:** Keep release orchestration in `scripts/release/`, with isolated output under `out/release/`. Stage only allowlisted compiled resources and production dependency closures. GitHub Actions runs native platform builds; unsigned candidate delivery and signed public release are distinct gates.

**Tech Stack:** Existing Node/TypeScript, pnpm, Vite/esbuild; electron-builder for desktop distribution; GitHub Releases and artifact attestations.

**Spec:** `docs/superpowers/specs/2026-11-02-praxis-sandbox-delivery-design.md` sections 7–9.

## Constraints and decisions

- Preserve pending UX changes. Do not include credentials, runtime databases, source maps or source trees in deliverables.
- At the start, the repo had no remote and macOS reported zero valid signing identities. The user authorized creating a GitHub repository; `GShLi/praxis` was created privately. Production signing still needs credentials.
- Use native OS/architecture runners. Initial matrix: macOS ARM64, Windows x64, Linux x64; do not claim other architectures verified.
- No automatic updater or background Agent added. Installer acceptance must launch the actual packaged application and relocated CLI Host.
- Signing requires real trusted platform identities for macOS/Windows; Linux/archive provenance uses GitHub artifact attestations. Never call ad-hoc signing a production signature.

## Tasks

- [x] Resolve existing structure gate findings without weakening thresholds; run structure/type/UI regressions.
- [x] Add production dependency staging, package manifests, archive assembly, checksums and inventory. Test escaping symlinks, transitive dependencies and exclusion of private files.
- [x] Add Electron packaging and isolated packaged-app smoke mode. Verify renderer/preload/Host from installed layout; terminate all resources.
- [x] Add archive installation acceptance and signing verification gates. Fail closed on missing certificates or failed verification.
- [x] Add candidate/signed-release workflow: checks, Postgres integration, platform builds, stage, smoke, sign/package, verify, checksums, attest, release. Publish only when all platform jobs succeed.
- [x] Document exact commands, artifacts, secrets and actual local/remote acceptance evidence; commit scoped changes with local Git identity.

## Execution outcome

[Release run 41800812844](https://github.com/GShLi/praxis/actions/runs/41800812844) passed the six-job Node 22.15.0/24 OS matrix, PostgreSQL and all three native packaging/installation jobs, then published [v0.1.0-candidate.4](https://github.com/GShLi/praxis/releases/tag/v0.1.0-candidate.4) from `3e58e42fdbf23dd85be97df73df762ba3ea44178`. This completes actual unsigned candidate delivery, not trusted signing. Detailed evidence and boundaries are in [releasing.md](../../releasing.md#current-acceptance-status).

Still required for a signed production release: Apple Developer ID and notarization credentials, a Windows code-signing certificate, an attestation-capable repository plan, then a successful signed version-tag workflow. No production signature or notarization success is claimed.

## Review focus

Dependency graphs must not retain links into the developer workspace; unsigned modes must not produce a stable public release; signed bytes must be the bytes checksummed and accepted; package smoke cannot read real user credentials; failures must prevent downstream publish and clean temporary resources.

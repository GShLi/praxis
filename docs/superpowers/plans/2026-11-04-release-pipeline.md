# Praxis Release Pipeline Implementation Plan

**Goal:** Implement check → build → package → installation acceptance → signing → release for server, CLI and desktop.

**Architecture:** Keep release orchestration in `scripts/release/`, with isolated output under `out/release/`. Stage only allowlisted compiled resources and production dependency closures. GitHub Actions runs native platform builds; unsigned candidate delivery and signed public release are distinct gates.

**Tech Stack:** Existing Node/TypeScript, pnpm, Vite/esbuild; electron-builder for desktop distribution; GitHub Releases and artifact attestations.

**Spec:** `docs/superpowers/specs/2026-11-02-praxis-sandbox-delivery-design.md` sections 7–9.

## Constraints and decisions

- Preserve pending UX changes. Do not include credentials, runtime databases, source maps or source trees in deliverables.
- Current repo has no remote and macOS reports zero valid signing identities. Actual public release needs repository and signing credentials; implement and test all independent stages first.
- Use native OS/architecture runners. Initial matrix: macOS ARM64, Windows x64, Linux x64; do not claim other architectures verified.
- No automatic updater or background Agent added. Installer acceptance must launch the actual packaged application and relocated CLI Host.
- Signing requires real trusted platform identities for macOS/Windows; Linux/archive provenance uses GitHub artifact attestations. Never call ad-hoc signing a production signature.

## Tasks

- [ ] Resolve existing structure gate findings without weakening thresholds; run structure/type/UI regressions.
- [ ] Add production dependency staging, package manifests, archive assembly, checksums and inventory. Test escaping symlinks, transitive dependencies and exclusion of private files.
- [ ] Add Electron packaging and isolated packaged-app smoke mode. Verify renderer/preload/Host from installed layout; terminate all resources.
- [ ] Add archive installation acceptance and signing verification gates. Fail closed on missing certificates or failed verification.
- [ ] Add candidate/signed-release workflow: checks, Postgres integration, platform builds, stage, smoke, sign/package, verify, checksums, attest, release. Publish only when all platform jobs succeed.
- [ ] Document exact commands, artifacts, secrets and actual local/remote acceptance evidence; commit scoped changes with local Git identity.

## Review focus

Dependency graphs must not retain links into the developer workspace; unsigned modes must not produce a stable public release; signed bytes must be the bytes checksummed and accepted; package smoke cannot read real user credentials; failures must prevent downstream publish and clean temporary resources.

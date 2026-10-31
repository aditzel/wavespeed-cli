# Release prerequisite on Janus

This prepares the `test` prerequisite of `.github/workflows/release.yml`.
Automatic Actions remain authoritative unless the
[release verification mode](RELEASE-HANDOFF.md) is deliberately enabled.
Nothing here publishes a package, creates a release, enables a provider pipeline,
or gives repository code publication credentials.

The approved command is `bash scripts/buildkite/check.sh release-test`. It runs
exactly the original four stages, in order:

1. `bun install --frozen-lockfile`
2. `bun run build`
3. `bun test`
4. `./dist/index.js --help`

It uses Bun 1.3.14 and the protected image's Node 22 baseline, with the original
360-minute execution allowance. The same supervisor as ordinary CI isolates
HOME, temporary files, caches and environment; rejects API credentials, paid
live tests and active dotenv/config files; preserves failures; and cleans up
process groups on normal exit or cancellation. The release prerequisite has no
artifact-upload contract and does not add the ordinary lane's subcommand checks.

## Inactive admission candidate

`release-test.project.json` is a review input for the Devops image-context
generator, not a manifest that a checkout may load at runtime. Its proposed
pipeline is `wavespeed-cli-release-tests`, bootstrapped by the image-owned
`janus-ci bootstrap` on `janus-linux`. The protected manifest must be reviewed,
baked into the image and commissioned before any provider can use it.

The candidate selects `main` as its sole push branch. Configure the provider for
original-repository `main` pushes; PR and tag routes are excluded. This ordinary
branch policy does not authenticate a manual workflow request or authorize a
publisher. It does not suppress `chore(release):` pushes: the original test
job always runs, and only the later publisher has that suppression condition.
The original workflow also permits manual runs on other branches; their trusted
dispatch/source binding and recovery input remain a separate migration gate.
This candidate therefore does not establish complete event parity.

## Publishing and cutover gates

The existing publisher requires successful tests, full tag history, Node 22,
Bun 1.3.14, npm 11.16.0, GitHub write permission and npm OIDC/provenance. Normal
semantic-release chooses a version, updates package metadata, and invokes
`bun run build` in its prepare phase. A future split must build that exact version
on Janus and verify its source and artifact handoff before a minimal hosted
publisher can use it. An ordinary CI build is not sufficient evidence.
The [versioned build primitive](VERSIONED-BUILD.md) prepares an explicitly supplied
version; trusted version selection and publisher handoff remain integration gates.

The `publish_current_version` recovery path also needs its existing tag check,
npm existence check and GitHub release behavior preserved. Keep these gates,
the successful-test dependency, main-branch restriction and release-commit
suppression intact. Manual routing, the versioned build/handoff, provenance,
serialization and replay behavior need implementation and live validation.

Before cutover, prove provider access, protected image admission, exact immutable
source, main/manual events, failure propagation, retries, cancellation, effective
timeouts and rollback. No real npm or GitHub release is authorized as a test.
Keep the original routes available until those requirements are satisfied.
The optional verification route covers a normal planned main release only;
no-release, release-commit, non-main and tagged recovery tests remain on their
existing route and receive no migration credit from this preparation.

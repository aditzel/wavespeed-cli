# Versioned release build

`bash scripts/buildkite/check.sh release-build 1.3.6` prepares the bundle for an
explicit stable version. It is an inactive build primitive: no workflow calls it
and no protected manifest admits it yet. The version argument is build input,
not evidence of release authorization. Existing release workflows remain active.

The existing supervisor supplies a clean environment, HOME, caches and temporary
directory, rejects API credentials/configuration and cleans process groups on
success, failure or cancellation. The builder copies source into that temporary
directory, excluding Git metadata, dependencies and old build outputs; it rejects
source symlinks. The original checkout and package version remain unchanged.

In the private copy it installs the frozen Bun lockfile, requires Node 22 and
npm 11.16.0, and runs npm's version update with `--no-git-tag-version` and
`--allow-same-version`, matching semantic-release/npm's preparation. It then runs
the existing build command and checks both the bundled CLI `--version` and the
MCP initialization response. The MCP check calls no generation tools or paid API.
New npm lifecycle hooks, npm lockfiles or project npm configuration fail closed
until their release behavior is reviewed. The existing `release-test` workload
remains a separate required prerequisite; this build does not replace it.

Only a successful build creates `out/release/`, containing executable `index.js`,
the prepared `package.json`, and `manifest.json`. The manifest records the version
and SHA-256 of original package metadata, the frozen lockfile, prepared metadata
and bundle. Existing output is never overwritten. `verifyArtifact` rejects wrong
versions, source/lock mismatches, other package edits, corrupt bytes, unexpected
members, symlinks, oversized files and incorrect bundle permissions. These
integrity checks **do not authenticate the producer or complete source tree**.

## Remaining integration requirements

The [release plan and artifact consumer](RELEASE-HANDOFF.md) prepare the engine's
decision binding and byte checks; authenticated provider/workflow integration is
still required before either can authorize publishing.

The trusted planner must preserve semantic-release 25.0.5's configured analyzers,
fallback source-change logic, full history/tags, release notes and version choice.
Its dry run still checks Git push access and plugin conditions; do not give the
Janus workload publishing credentials or mistake a dry run for offline analysis.
The final publisher must revalidate its version decision against authenticated
build identity and bytes, including the original source commit and passing test
job. It must reject stale, replayed, failed or mismatched builds before any
release commit, tag, npm upload or GitHub release write. This manifest alone is
insufficient. Do not execute downloaded bundles in the credentialed publisher.

Normal and manual/recovery events, request/version binding, artifacts and receipt
transport, publisher integration, serialization, retry/cancellation/time budgets,
OIDC provenance and rollback still require implementation and live commissioning.
The recovery path must use the existing tagged package version and retain its npm
and GitHub release existence checks. Nothing here authorizes actual publication,
changes `.releaserc.json`, or removes any current Actions job.

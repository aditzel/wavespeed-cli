# Manual current-version recovery on Janus

The existing `publish_current_version` input remains main-only for publishing.
The selected commit's package version and existing tag are preserved; recovery
does not calculate a semantic-release version, create a tag or push a release
commit. Non-main manual runs continue to test without publishing.

This preparation is disabled unless the versioned release mode is configured
and `JANUS_WAVESPEED_RECOVERY_MODE` is set:

| Recovery mode | Tests and build | Publication |
| --- | --- | --- |
| unset/unsupported | Original workflow | Original recovery |
| verify | Protected Janus recovery pipeline | Read-only hosted verification; legacy publication disabled |
| publish | Protected Janus recovery pipeline | Minimal GitHub-hosted OIDC publisher |

Use the fixed `wavespeed-cli-recovery-build` pipeline. Distinct hosted
`request-recovery-verify` and `request-recovery-publish` jobs bind the requested
mode; a verification build cannot become publishable when a setting changes.
The standalone dispatcher has no caller-controlled version/environment and
never retries an uncertain create response.

The protected helper independently authenticates the source/run/attempt,
package/lock, existing tag object, passing native test/build jobs and their
protected artifacts. It verifies the active callback separately from the
original source; only then does the workflow check out the publisher source.
Fresh verification precedes each mutation. The hosted publisher copies only the
authenticated bundle and preserves source package bytes, npm 11.16.0,
`--provenance --access public`, tag existence and independent npm/GitHub
idempotency checks. It does not install application dependencies or build/test.

Configure only the reviewed `JANUS_WAVESPEED_RECOVERY_POLICY`, private helper
checkout read credential and pipeline-specific Buildkite read/write credentials.
No configuration is installed by this PR. Keep existing hosted routes until
native event/status, retry/cancellation, source/tag races, effective timeouts,
route-aware required checks and rollback have been verified. Review the
Devops `runbooks/wavespeed-recovery.md` activation checklist.

No real package/release/tag publication is part of migration validation.
Main merges still need controlled publication side effects. Existing immutable
branches/tags with older workflows do not acquire these routes automatically.

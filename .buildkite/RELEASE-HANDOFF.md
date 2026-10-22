# Semantic-release planning and artifact consumption

This prepares the release route above the [versioned builder](VERSIONED-BUILD.md).
The workflow has opt-in verification and publication modes; both remain inactive while
`JANUS_WAVESPEED_RELEASE_MODE` is unset. Setting it to `verify` replaces normal
main-branch publication with planning, Janus dispatch and hosted handoff validation.
It does not publish. The separate `publish` mode enables the hosted artifact
publisher after commissioning. Other existing routes and `.releaserc.json` remain authoritative.

## Verification workflow

The hosted `plan-release` job uses full history, Node 22, Bun 1.3.14 and npm 11.16.0.
It retains GitHub write and OIDC permissions because semantic-release's dry run
still verifies the original GitHub/npm authentication. Credentials stay in the
hosted control plane. The immutable plan artifact records the source and run attempt.

For a release decision, `request-janus-release` submits only that artifact/run
identity and source to the fixed `mirai-forge/wavespeed-cli-release-build` pipeline.
The dispatcher inventories existing builds, reuses the newest matching request,
rejects a newer failed attempt, and independently reads the accepted build.
Inventory and response sizes, request counts and elapsed time are bounded.
It never retries an ambiguous create response automatically.

A successful status for that pipeline starts the read-only `verify-release`
verification job. The status URL is only a routing hint. A verifier pinned to
Devops commit `5bc13d18130c510119aa330bc1601b68459a4dc8` independently checks the
active hosted job, original planner, newest native build, prerequisite and artifacts.
`check-handoff.mjs` then validates the exact returned plan and bundle against the
source checkout. It does not invoke semantic-release or a publication plugin.
Request and completion jobs use separate concurrency groups. They do not cancel
a running job, but GitHub's default queue keeps only one pending job per group;
a newer pending job replaces the older one. The newest main source is planned
again, while source checks reject stale plans. This is
latest-source verification, not a guarantee that every queued request executes.
See [GitHub's concurrency behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Before enabling this mode, configure a reviewed `JANUS_WAVESPEED_RELEASE_POLICY`
repository variable, `BUILDKITE_WAVESPEED_RELEASE_WRITE_TOKEN` with only the needed
build read/write access, `BUILDKITE_WAVESPEED_RELEASE_READ_TOKEN` for independent
reads, and `JANUS_HELPERS_READ_TOKEN` for read-only checkout of private Devops.
The protected Janus image must contain the matching reviewed producer policy,
controller and scoped GitHub reader. Missing configuration fails closed.
Do not place any publishing credentials in the Janus job.

No-release decisions, release-commit pushes and manual non-main runs use the
separately prepared versionless test route when configured. Explicit tagged-version
recovery has a separate [current-version recovery route](RECOVERY.md), with a
read-only verification mode and a minimal hosted publisher. Unset recovery mode
preserves the existing tests and publisher, including when release verification
mode is enabled. These routes still need native commissioning and live parity
evidence; do not publish a real package or release as a migration test.
Status callbacks cannot enter the original test/publish route or start a planner.

## Hosted artifact publisher

With mode `publish`, the same planner and dispatcher run. The successful status
routes to `publish-release`, which has GitHub write and OIDC permissions and the
original 360-minute publication budget. It installs the pinned release dependencies
and npm 11.16.0, but does not build the CLI or run its test suite. Those steps are
the authenticated Janus prerequisite and versioned build.

`publish-verified.mjs` independently refreshes provider evidence before starting
the engine, at `verifyConditions`, at `verifyRelease`, and immediately before
artifact preparation. Each read must return the same plan, receipt and active
hosted job identity; the protected helper binds verification/publication to
different job names and modes. Local and remote main must still match the source.
Private temporary files carry the provider reader tokens and are removed when
the entrypoint exits; the Python reader receives no publishing token in its environment.
Pending or changed evidence fails closed; a manual retry authenticates again.

The pinned semantic-release engine receives the original plugins with only its
build step replaced by artifact consumption. The early gate permits exactly one
ordinary release branch, preventing an add-channel path before release validation.
The final result must include the planned version/tag and concrete npm/GitHub
publication results. An engine no-op, skipped publisher or partial result fails.
This result check cannot undo a partial release: inspect registry and tag state
before using the existing tagged-version recovery route.

## Plan the existing release decision

`bun scripts/release/plan-release.mjs SOURCE_SHA OUTPUT` is intended for the minimal
hosted release control plane. It invokes the pinned semantic-release 25.0.5 API
with the existing configuration and `dryRun: true`; it does not reconstruct a
version, remove verification plugins, or supply a replacement analyzer. The engine
skips prepare, tag/publish, success and fail during dry run, while still checking
normal authorization. Do not provide those credentials to a Janus workload.

The helper requires the original repository's main push or normal manual workflow
context, full history, exact local HEAD, and current remote main before and after
planning. It preserves release-commit suppression and rejects recovery publishing,
which needs its existing tagged-version path. It fails on changed release config,
toolchain or source inputs. The existing conventional rules and source-change
fallback remain intact, including the fallback's behavior after commit filtering.

The JSON plan binds repository/source, package/lock/config hashes, engine version,
workflow/run/attempt identity, and the engine's next version, release type, tag,
previous release and commit inventory. A no-release result carries no version and
cannot be consumed by the publisher. Release notes are regenerated by the existing
plugin at publication time; they are not substituted with stale plan text.

GitHub environment values and plan contents are **claims, not authenticated proof**.
The protected admission helper must independently verify the workflow ID/path/pinned
helper, run/attempt/event/source and successful planner job through GitHub's API,
then bind its exact plan artifact ID/digest and selected version into the frozen
Buildkite source, manifest and protected receipt. The existing Hermes request
schema does not carry a version; merely adding an environment variable is insufficient.

## Consume verified bytes before any release push

`publisherOptions` returns the original semantic-release configuration with an
early decision gate and an artifact consumer in place of the exec prepare build.
All analyzers and other plugin settings/order are retained. Its caller must first
authenticate the exact plan digest, producer run/source and artifact-manifest
digest using a fresh protected provider receipt. Passing hashes copied from the
download itself does not satisfy this requirement.

Preflight verifies the plan and artifact against the checkout. `verifyRelease`
rechecks metadata, artifact integrity, and the engine's newly computed decision.
After npm updates the local version, `prepare` requires package metadata to match
the artifact exactly and rechecks its bytes before copying only `dist/index.js`.
Unexpected files or symlinks in `dist` are rejected. The downloaded bundle is never
executed by this consumer. All these gates precede `@semantic-release/git`, which
can push the release commit during prepare, before the core creates its tag.

## Cutover remains gated

The protected producer/receipt adapters, verification workflow and hosted publisher
require live commissioning. The remaining test/manual/recovery migrations,
OIDC/provenance run, queue/execution/cancellation budgets and rollback are still
cutover gates. Successful tests here establish decision, routing and byte checks,
not native provider authentication or replay resistance.
The publisher revalidates the latest successful Buildkite attempts and receipt/run
identity at its release gates; live tests must still establish serialization,
the successful test prerequisite and failure recovery. No actual npm, tag, release commit or GitHub release is authorized
as a migration test.

The default main workflow still publishes automatically. Do not merge the
preparation stack until publication is controlled for the commissioning window.
Removing the verification variable restores the original normal route; that
route can publish, so rollback must be deliberate.

Pinned upstream behavior: [engine](https://github.com/semantic-release/semantic-release/blob/v25.0.5/index.js),
[dry-run phases](https://github.com/semantic-release/semantic-release/blob/v25.0.5/lib/definitions/plugins.js),
and [Git prepare push](https://github.com/semantic-release/git/blob/v10.0.1/lib/prepare.js).

## Remaining Release tests

The standalone `scripts/release/request-tests.mjs` requests the original four
Release test commands from `wavespeed-cli-release-tests` when no versioned
release build takes that obligation. It accepts only main pushes (including
`chore(release):` commits). Requests contain
only repository/workflow/run/attempt/event/commit/ref identity. The fixed
pipeline receives no environment grants, requested version or publishing
authority. Inventory plus an independent post-create read prevents blind
creation retries; an ambiguous POST must be inspected before retrying.

Store the pipeline-scoped `BUILDKITE_WAVESPEED_TEST_WRITE_TOKEN` only in the
`janus-wavespeed-release-tests` GitHub environment. Configure **Selected branches
and tags** with exactly one **branch** rule named `main`, no tag rules, and
administrator bypass disabled. Do not use "Protected branches only": that
setting allows every branch when no branch protection exists. Do not create
repository or organization copies of this credential. The GitHub environment
policy must be verified before the secret is installed; a job condition or a
pinned script alone cannot stop a modified branch workflow from requesting a
repository secret. Historical workflows without this environment receive no
test-write credential. A tag named `main` must also be rejected.

Configure `BUILDKITE_WAVESPEED_TEST_READ_TOKEN` for completion, the existing private-helper
reader, and the independently reviewed `JANUS_WAVESPEED_TEST_POLICY`. The
protected image must approve the exact workflow and standalone dispatcher Git
blobs. Repository-controlled configuration cannot supply those trusted pins.
Keep `JANUS_WAVESPEED_TEST_MODE` unset until native commissioning is ready.

For main pushes, `verify` dispatches alongside the existing test. `janus` skips the old test only
when `JANUS_WAVESPEED_RELEASE_MODE` is also `verify` or `publish`; planned releases
already test inside their versioned pipeline. Manual recovery retains its old
test and publishing dependency until the recovery artifact path is implemented.
Neither flag activates that unfinished recovery migration.

Manual build/test CI will start from Buildkite UI/API under the
[accepted manual CI decision](https://github.com/MiraiForge/devops/blob/docs/manual-ci-buildkite-controls/runbooks/buildkite-manual-ci.md).
The GitHub test dispatcher rejects every `workflow_dispatch`, including main,
branches and tags, before provider access. Until the separate authenticated
Buildkite manual admission is commissioned, manual tests retain the original
test job as a rollback path even when the test mode is `janus`. Separately
gated versioned-release and tagged-recovery publishers keep their own authority;
this change does not enable them or authorize publication.

Before installing the write secret or enabling a mode, verify the environment's
custom branch policy and absence of any repository/organization copy, and prove
that branch and tag workflows cannot enter it even after changing their job
conditions. Recheck these protections when changing environment configuration.
No secret or migration mode should be added as part of a branch-denial probe.
Rollback removes the test mode and environment secret; never restore access by
copying the credential into repository secrets or broadening the branch rules.

The read-only `verify-janus-test` callback handles terminal test statuses. It
checks the fixed provider API, original workflow attempt, newest matching build,
passing retry chain, Janus queue and protected result index, and rechecks after
the last download. Failure, cancellation, a missing result, changed policy or a
newer failed attempt cannot fall back to an older green build. The callback
does not check out or execute the tested repository code.

GitHub runs status workflows from the default branch, so callback source and
tested source are authenticated separately. The result reader can still recognize
historical manual branch/tag and older-main identities; that compatibility does
not re-enable manual dispatch. A status is only a routing hint and a successful
dispatch is not a successful test. Before cutover, verify actual callback
delivery for every event and require the native
`buildkite/wavespeed-cli-release-tests` check. The five-minute hosted adapters
do not replace the 360-minute Janus execution allowance and ten-minute protected
overhead. Queue, cancellation and required-check behavior still need native
evidence. See [GitHub's status-event semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#status).

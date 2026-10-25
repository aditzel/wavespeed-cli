# Ordinary CI operations

The `mirai-forge/wavespeed-cli-ci` Buildkite pipeline runs the reviewed image's
`janus-ci bootstrap` on `janus-linux`. The image admits only the configured
repository, source events and commands; checkout code cannot replace that policy.

| Event | Ordinary CI executor |
| --- | --- |
| Push to `main` or `develop` | Buildkite on Janus |
| Same-repository PR targeting `main` | Buildkite on Janus |
| Fork PR targeting `main` | Hosted GitHub Actions |
| Explicit `workflow_dispatch` | Hosted GitHub Actions recovery |
| Other branches, PR bases or tags | No ordinary automatic CI |

The provider branch filter is `main develop`, with push builds enabled. PR open,
update and reopen events are enabled; fork and tag builds are disabled. PRs ignore
Buildkite's branch filter, so the saved provider conditional must be:

```text
build.pull_request.id == null || build.pull_request.base_branch == "main"
```

Keep skip-existing-commit, skip-intermediate and cancel-intermediate disabled to
preserve the original workflow behavior. The protected graph runs `test` first
and `validate-implementation` only after success. Both use Bun 1.3.14, the reviewed
Node 22 toolchain, a fresh isolated checkout, no credential environment grants,
and no artifact uploads. Each provider job has the original 360-minute whole-job
ceiling, including setup and cleanup.

GitHub receives `buildkite/wavespeed-cli-ci` for branch builds and
`buildkite/wavespeed-cli-ci/pr` for PR builds. The latter must succeed for trusted
PR acceptance; intentionally skipped hosted jobs are not substitute evidence.
The observed `main` branch protection has no required status contexts; preserve
its other protections. If required checks are later introduced, account for both
trusted Buildkite and hosted fork routes rather than requiring a status that
forks cannot receive.

## Acceptance and recovery

Before merging the routing change, verify a real same-repository PR webhook at
the reviewed head, both dependent jobs, the GitHub status, test-failure blocking,
retry, cancellation cleanup and a complete hosted recovery run. Verify the
`main` merge webhook and `develop` push delivery as well. Record exact source SHAs,
job attempts and provider configuration; an operator-created build alone does not
prove webhook routing. Fork event tests and provider fork exclusion do not prove
an external fork run occurred.

Hosted recovery is **Actions → Test and Build → Run workflow**, selecting the
required branch/ref. It runs both original job bodies on hosted Ubuntu 24.04 with
read-only contents access and nonpersistent checkout credentials. It does not
publish or require a Wavespeed API credential; invalid-input checks use only the
existing synthetic `test-key`.

For automatic rollback, restore the `push` trigger for `[main, develop]` and remove
the fork/manual job guards in `.github/workflows/test.yml`, then merge that change
through the normal review path. Preserve the `pull_request` base filter, commands,
dependency, permissions and tool pins. Disable only this Buildkite pipeline's
incoming GitHub webhook processing if duplicate automatic execution must stop.
Reverting this cutover commit restores the exact previous workflow. Retain the
last working image, manifest and Compose pair for runtime rollback.

Buildkite-native manual CI, release testing, semantic-release planning, artifact
handoff and npm publishing have separate commissioning gates. This cutover does
not enable any of those release capabilities or mark the repository migration
complete.

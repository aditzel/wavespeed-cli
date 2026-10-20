import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import semanticRelease from "semantic-release";
import {
  commit,
  makePlan,
  producerIdentity,
  releaseInputs,
  repository,
  requireValue,
} from "./release-plan.mjs";

const remote = "https://github.com/aditzel/wavespeed-cli.git";
const gitRead = (argv, cwd, env) =>
  execFileSync("git", argv, { cwd, env, encoding: "utf8", timeout: 30_000 }).trim();

// A hosted control-plane operation: semantic-release dry-run still requires its
// normal authorization checks. Never run this with publishing credentials on Janus.
export async function planRelease({
  cwd,
  sourceCommit,
  env,
  engine = semanticRelease,
  readGit = gitRead,
}) {
  commit(sourceCommit);
  requireValue(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_REPOSITORY === repository &&
      env.GITHUB_REPOSITORY_ID === "1079467744" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_SHA === sourceCommit &&
      !env.GITHUB_HEAD_REF,
    "Expected the original repository main workflow context",
  );
  const producer = producerIdentity({
    event: env.GITHUB_EVENT_NAME,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
  });
  requireValue(producer.workflowSha === sourceCommit, "Planner workflow differs from source");
  requireValue(typeof env.GITHUB_EVENT_PATH === "string", "Missing workflow event");
  const eventFile = fs.lstatSync(env.GITHUB_EVENT_PATH);
  requireValue(
    eventFile.isFile() && eventFile.size <= 2 * 1024 * 1024,
    "Invalid workflow event file",
  );
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH));
  requireValue(
    event.repository?.full_name === repository && event.repository?.id === 1079467744,
    "Workflow event repository differs",
  );
  if (producer.event === "workflow_dispatch") {
    requireValue(
      event.inputs?.publish_current_version === undefined ||
        event.inputs.publish_current_version === false ||
        event.inputs.publish_current_version === "false",
      "Recovery publishing requires its separate tagged-version plan",
    );
  } else {
    requireValue(
      event.ref === "refs/heads/main" && event.after === sourceCommit && !event.deleted,
      "Push event differs from source",
    );
    requireValue(
      typeof event.head_commit?.message === "string" &&
        !event.head_commit.message.startsWith("chore(release):"),
      "Release commits do not request another publisher",
    );
  }
  const inputs = releaseInputs(cwd, sourceCommit);
  const checkSource = () => {
    requireValue(
      readGit(["rev-parse", "HEAD"], cwd, env) === sourceCommit,
      "Planner checkout differs from source",
    );
    requireValue(
      readGit(["rev-parse", "--is-shallow-repository"], cwd, env) === "false",
      "Release planning requires full history",
    );
    requireValue(
      readGit(["ls-remote", remote, "refs/heads/main"], cwd, env) ===
        `${sourceCommit}\trefs/heads/main`,
      "Source is no longer the current main head",
    );
    const current = releaseInputs(cwd, sourceCommit);
    requireValue(
      JSON.stringify(current.identity) === JSON.stringify(inputs.identity),
      "Release inputs changed during planning",
    );
  };
  for (const [name, version] of [
    ["semantic-release", "25.0.5"],
    ["@semantic-release/npm", "13.1.5"],
  ]) {
    requireValue(
      JSON.parse(fs.readFileSync(path.join(cwd, "node_modules", name, "package.json"))).version ===
        version,
      "Installed release toolchain differs from the reviewed version",
    );
  }
  checkSource();
  // Do not replace analyzers, skip verification plugins or reconstruct a version.
  // The pinned engine skips prepare, tag/publish, success and fail in dry-run mode.
  const result = await engine({ ...inputs.configuration, dryRun: true }, { cwd, env: { ...env } });
  checkSource();
  return makePlan(result, inputs, producer);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 4, "Usage: plan-release.mjs SOURCE_SHA OUTPUT");
    const plan = await planRelease({
      cwd: process.cwd(),
      sourceCommit: process.argv[2],
      env: process.env,
    });
    fs.writeFileSync(process.argv[3], `${JSON.stringify(plan, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Release plan: ${plan.decision.kind}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

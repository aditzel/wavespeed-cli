import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import semanticRelease from "semantic-release";
import { readCompletion } from "./check-handoff.mjs";
import { publisherOptions } from "./publisher-options.mjs";
import { commit, repository, requireValue } from "./release-plan.mjs";

const gitRead = (argv, cwd, env) =>
  execFileSync("git", argv, { cwd, env, encoding: "utf8", timeout: 30_000 }).trim();

export async function publishVerified({ cwd, env, authenticate, engine = semanticRelease, readGit = gitRead }) {
  requireValue(env.JANUS_WAVESPEED_RELEASE_MODE === "publish" && env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_JOB === "publish-release" && env.GITHUB_EVENT_NAME === "status" &&
    env.GITHUB_REPOSITORY === repository && env.GITHUB_REPOSITORY_ID === "1079467744" &&
    env.GITHUB_REF === "refs/heads/main" && env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
    env.GITHUB_WORKFLOW_REF === `${repository}/.github/workflows/release.yml@refs/heads/main` &&
    !env.GITHUB_HEAD_REF, "Expected the commissioned hosted publisher context");
  const source = commit(env.GITHUB_SHA);
  requireValue(source !== "0".repeat(40), "Invalid publisher source");
  for (const [name, version] of [["semantic-release", "25.0.5"], ["@semantic-release/npm", "13.1.5"]]) {
    requireValue(JSON.parse(fs.readFileSync(path.join(cwd, "node_modules", name, "package.json"))).version === version,
      "Installed release toolchain differs from the reviewed version");
  }
  const checkSource = () => {
    requireValue(readGit(["rev-parse", "HEAD"], cwd, env) === source &&
      readGit(["rev-parse", "--is-shallow-repository"], cwd, env) === "false" &&
      readGit(["ls-remote", `https://github.com/${repository}.git`, "refs/heads/main"], cwd, env) ===
        `${source}\trefs/heads/main`, "Publisher source is stale or incomplete");
  };
  checkSource();
  const first = await authenticate();
  const plan = JSON.parse(first.planBytes);
  const phases = [];
  const revalidate = async (phase) => {
    checkSource();
    const fresh = await authenticate();
    requireValue(isDeepStrictEqual(fresh.handoff, first.handoff) && fresh.planBytes.equals(first.planBytes),
      "Provider handoff changed before publication");
    checkSource();
    phases.push(phase);
  };
  const options = publisherOptions({
    cwd, planBytes: first.planBytes, artifactDirectory: first.artifactDirectory,
    expected: first.handoff.receipt, revalidate,
  });
  // Passing these options to the pinned engine preserves the original plugins
  // while replacing only the build with the authenticated Janus bundle.
  const result = await engine({ ...options, dryRun: false, ci: true }, { cwd, env: { ...env } });
  requireValue(isDeepStrictEqual(phases, ["verifyConditions", "verifyRelease", "prepare"]),
    "The release did not complete every fresh handoff gate");
  requireValue(result && result.nextRelease?.version === plan.decision.version &&
    result.nextRelease.type === plan.decision.type && result.nextRelease.gitTag === plan.decision.gitTag &&
    !result.nextRelease.channel && Array.isArray(result.commits) &&
    isDeepStrictEqual(result.commits.map((item) => item.hash), plan.decision.commits) &&
    Array.isArray(result.releases) &&
    result.releases.some((release) => release.pluginName === "@semantic-release/npm" &&
      release.version === plan.decision.version && release.channel === "latest" &&
      release.url === `https://www.npmjs.com/package/wavespeed-cli/v/${plan.decision.version}`) &&
    result.releases.some((release) => release.pluginName === "@semantic-release/github" &&
      release.gitTag === plan.decision.gitTag && Number.isSafeInteger(release.id) && release.id > 0 &&
      release.url === `https://github.com/${repository}/releases/tag/${plan.decision.gitTag}`),
    "The planned npm and GitHub release was not completed");
  return { version: result.nextRelease.version, gitTag: result.nextRelease.gitTag,
    sourceCommit: source, buildNumber: first.handoff.receipt.buildNumber, published: true };
}

export function completionReader({ cwd, env, policy, githubToken, buildkiteToken, state, run = execFileSync }) {
  const helper = path.join(cwd, ".janus-tools/infrastructure/buildkite-publishers/wavespeed-release.py");
  const readerEnv = Object.fromEntries(Object.entries(env).filter(([key]) =>
    ["PATH", "HOME", "TMPDIR", "RUNNER_TEMP", "JANUS_WAVESPEED_RELEASE_MODE"].includes(key) ||
    ["GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_ID", "GITHUB_EVENT_NAME",
      "GITHUB_EVENT_PATH", "GITHUB_REF", "GITHUB_HEAD_REF", "GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "GITHUB_JOB",
      "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_WORKFLOW_REF"].includes(key)));
  return async () => {
    const parent = fs.mkdtempSync(path.join(state, "fresh-"));
    fs.chmodSync(parent, 0o700);
    const output = path.join(parent, "handoff");
    run("python3", ["-I", "-B", helper, "--policy", policy, "--github-token-file", githubToken,
      "--buildkite-token-file", buildkiteToken, "--output", output],
    { cwd, env: readerEnv, timeout: 180_000, maxBuffer: 128 * 1024, stdio: ["ignore", "ignore", "pipe"] });
    return readCompletion(output, env, "publish");
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 6, "Usage: publish-verified.mjs POLICY GITHUB_TOKEN_FILE BUILDKITE_TOKEN_FILE STATE");
    const [policy, githubToken, buildkiteToken, state] = process.argv.slice(2);
    const cwd = process.cwd(), env = process.env;
    const authenticate = completionReader({ cwd, env, policy, githubToken, buildkiteToken, state });
    console.log(JSON.stringify(await publishVerified({ cwd, env, authenticate })));
  } catch {
    console.error("Verified release did not complete. Inspect the current tag and registry state before any recovery.");
    process.exitCode = 1;
  }
}

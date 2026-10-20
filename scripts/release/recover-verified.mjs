import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { releaseVersion, sha256, verifyArtifact } from "./versioned-artifact.mjs";

const repository = "aditzel/wavespeed-cli";
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && value !== "0".repeat(40);
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;

function readFile(filename, limit) {
  const info = fs.lstatSync(filename);
  requireValue(info.isFile() && info.size > 0 && info.size <= limit, "Invalid recovery file");
  return fs.readFileSync(filename);
}

export function readRecovery(directory, env) {
  const mode = env.JANUS_WAVESPEED_RECOVERY_MODE, name = `${mode === "verify" ? "verify" : "publish"}-recovery`;
  requireValue(["verify", "publish"].includes(mode) && env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_REPOSITORY === repository && env.GITHUB_REPOSITORY_ID === "1079467744" &&
    env.GITHUB_EVENT_NAME === "status" && env.GITHUB_REF === "refs/heads/main" && env.GITHUB_JOB === name &&
    sha(env.GITHUB_SHA) && env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
    env.GITHUB_WORKFLOW_REF === `${repository}/.github/workflows/release.yml@refs/heads/main` && !env.GITHUB_HEAD_REF,
  "Expected the commissioned recovery callback");
  const handoff = JSON.parse(readFile(path.join(directory, "handoff.json"), 65536));
  const { request, publisher, receipt } = handoff;
  requireValue(handoff.schemaVersion === 1 && positive(publisher?.jobId) &&
    publisher.jobName === name && publisher.mode === mode && publisher.commit === env.GITHUB_SHA &&
    String(publisher.runId) === env.GITHUB_RUN_ID && String(publisher.runAttempt) === env.GITHUB_RUN_ATTEMPT &&
    request?.mode === mode && request.event === "workflow_dispatch" && request.ref === "refs/heads/main" &&
    request.repositoryId === 1079467744 && request.workflowId === 211956153 &&
    positive(request.runId) && positive(request.runAttempt) && request.runId !== publisher.runId &&
    sha(request.commit) && request.commit === publisher.sourceCommit && receipt?.sourceCommit === request.commit &&
    receipt.repository === repository && digest(receipt.sourcePackageSha256) && digest(receipt.lockSha256) &&
    digest(receipt.artifactManifestSha256) && positive(receipt.buildNumber),
  "Recovery handoff belongs to another source, mode or callback");
  releaseVersion(receipt.version);
  requireValue(receipt.tag?.ref === `refs/tags/v${receipt.version}` && sha(receipt.tag.sha) &&
    ["tag", "commit"].includes(receipt.tag.type), "Recovery tag identity is invalid");
  return { handoff, artifactDirectory: path.join(directory, "artifact") };
}

function execute(command, argv, cwd, env) {
  const result = spawnSync(command, argv, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout: 360 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.signal || !Number.isInteger(result.status)) throw new Error("Recovery command did not complete");
  return { status: result.status, stdout: result.stdout || "" };
}

export async function recoverVerified({ cwd, env, authenticate, run = execute }) {
  const first = await authenticate();
  const { receipt } = first.handoff;
  // Authentication is always independent and fresh. A caller-supplied receipt
  // or an earlier callback output alone is never sufficient.
  const mode = env.JANUS_WAVESPEED_RECOVERY_MODE;
  requireValue(["verify", "publish"].includes(mode) && first.handoff.publisher.mode === mode &&
    first.handoff.request.mode === mode, "Recovery mode changed");
  const sourcePackage = readFile(path.join(cwd, "package.json"), 128 * 1024);
  const lock = readFile(path.join(cwd, "bun.lock"), 2 * 1024 * 1024);
  const pkg = JSON.parse(sourcePackage);
  requireValue(pkg.name === "wavespeed-cli" && releaseVersion(pkg.version) === receipt.version &&
    sha256(sourcePackage) === receipt.sourcePackageSha256 && sha256(lock) === receipt.lockSha256,
  "Recovery must use the existing authenticated package version");
  for (const hook of ["preversion", "version", "postversion", "prepublish", "prepare", "prepublishOnly",
    "prepack", "postpack", "publish", "postpublish"]) {
    requireValue(!Object.hasOwn(pkg.scripts || {}, hook), "Recovery lifecycle hooks require migration review");
  }
  for (const name of [".npmrc", "package-lock.json", "npm-shrinkwrap.json"]) {
    requireValue(!fs.lstatSync(path.join(cwd, name), { throwIfNoEntry: false }), "Unexpected recovery package configuration");
  }
  const command = (name, args) => run(name, args, cwd, env);
  const successful = (name, args) => {
    const result = command(name, args);
    requireValue(result.status === 0, `Recovery ${name} command failed`);
    return result.stdout.trim();
  };
  const checkSource = () => {
    requireValue(successful("git", ["rev-parse", "--verify", "HEAD^{commit}"]) === receipt.sourceCommit &&
      successful("git", ["rev-parse", "--is-shallow-repository"]) === "false" &&
      successful("git", ["rev-parse", "--verify", receipt.tag.ref]) === receipt.tag.sha &&
      successful("git", ["cat-file", "-t", receipt.tag.sha]) === receipt.tag.type &&
      readFile(path.join(cwd, "package.json"), 128 * 1024).equals(sourcePackage) &&
      readFile(path.join(cwd, "bun.lock"), 2 * 1024 * 1024).equals(lock), "Recovery checkout or tag changed");
  };
  const artifact = (value) => {
    requireValue(sha256(readFile(path.join(value.artifactDirectory, "manifest.json"), 8192)) ===
      receipt.artifactManifestSha256, "Recovery artifact manifest changed");
    return verifyArtifact(value.artifactDirectory, { version: receipt.version, sourcePackage, lock });
  };
  checkSource();
  requireValue(successful("npm", ["--version"]) === "11.16.0", "Recovery requires npm 11.16.0");
  const bundle = artifact(first).bundle;
  const fresh = async () => {
    checkSource();
    const current = await authenticate();
    requireValue(isDeepStrictEqual(current.handoff, first.handoff) && artifact(current).bundle.equals(bundle),
      "Recovery authority or bundle changed before publication");
    checkSource();
    return current;
  };
  const versionSpec = `${pkg.name}@${pkg.version}`, tag = `v${pkg.version}`;
  const npmExists = command("npm", ["view", versionSpec, "version"]).status === 0;
  const releaseExists = command("gh", ["release", "view", tag]).status === 0;
  if (mode === "verify") {
    await fresh();
    return { version: pkg.version, sourceCommit: receipt.sourceCommit, buildNumber: receipt.buildNumber,
      npmExists, releaseExists, publicationEnabled: false };
  }
  requireValue(env.GITHUB_JOB === "publish-recovery" && first.handoff.publisher.jobName === "publish-recovery",
    "Only the dedicated hosted recovery publisher may mutate registries");
  const dist = path.join(cwd, "dist");
  requireValue(!fs.lstatSync(dist, { throwIfNoEntry: false }), "Recovery checkout must not contain old build outputs");
  fs.mkdirSync(dist);
  const destination = path.join(dist, "index.js");
  fs.writeFileSync(destination, bundle, { flag: "wx", mode: 0o755 });
  fs.chmodSync(destination, 0o755);
  const beforeMutation = async () => {
    await fresh();
    requireValue(fs.lstatSync(dist).isDirectory() && isDeepStrictEqual(fs.readdirSync(dist), ["index.js"]) &&
      readFile(destination, 16 * 1024 * 1024).equals(bundle) &&
      (fs.lstatSync(destination).mode & 0o777) === 0o755, "Staged recovery bundle changed");
  };
  if (!npmExists) {
    await beforeMutation();
    successful("npm", ["publish", "--provenance", "--access", "public"]);
  }
  // Re-read after npm: partial recovery may need only a GitHub release, and a
  // concurrent existing release retains the original idempotent behavior.
  if (command("gh", ["release", "view", tag]).status !== 0) {
    await beforeMutation();
    successful("gh", ["release", "create", tag, "--verify-tag", "--title", tag, "--generate-notes"]);
  }
  return { version: pkg.version, sourceCommit: receipt.sourceCommit, buildNumber: receipt.buildNumber,
    npmPublished: !npmExists, publicationEnabled: true };
}

export function recoveryReader({ helper, policy, githubToken, buildkiteToken, state, env, run = execFileSync }) {
  const allowed = ["PATH", "HOME", "TMPDIR", "RUNNER_TEMP", "JANUS_WAVESPEED_RECOVERY_MODE",
    "GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_ID", "GITHUB_EVENT_NAME", "GITHUB_EVENT_PATH",
    "GITHUB_REF", "GITHUB_HEAD_REF", "GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "GITHUB_JOB",
    "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_WORKFLOW_REF"];
  const readerEnv = Object.fromEntries(Object.entries(env).filter(([key]) => allowed.includes(key)));
  return async () => {
    const parent = fs.mkdtempSync(path.join(state, "fresh-"));fs.chmodSync(parent, 0o700);
    const output = path.join(parent, "handoff");
    run("python3", ["-I", "-B", helper, "--policy", policy, "--github-token-file", githubToken,
      "--buildkite-token-file", buildkiteToken, "--output", output],
    { cwd: "/", env: readerEnv, timeout: 180_000, maxBuffer: 128 * 1024, stdio: ["ignore", "ignore", "pipe"] });
    return readRecovery(output, env);
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 7, "Usage: recover-verified.mjs HELPER POLICY GITHUB_TOKEN_FILE BUILDKITE_TOKEN_FILE STATE");
    const [helper, policy, githubToken, buildkiteToken, state] = process.argv.slice(2);
    const env = process.env;
    const authenticate = recoveryReader({ helper, policy, githubToken, buildkiteToken, state, env });
    console.log(JSON.stringify(await recoverVerified({ cwd: process.cwd(), env, authenticate })));
  } catch {
    console.error("Recovery did not complete. Inspect the existing tag, npm version and GitHub release before retrying.");
    process.exitCode = 1;
  }
}

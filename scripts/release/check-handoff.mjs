import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { publisherOptions } from "./publisher-options.mjs";
import { requireValue, repository } from "./release-plan.mjs";

// Verification mode never invokes semantic-release or any plugin lifecycle.
export function checkHandoff(cwd, directory, env) {
  const read = (name, limit) => {
    const target = path.join(directory, name), info = fs.lstatSync(target);
    requireValue(info.isFile() && info.size > 0 && info.size <= limit, "Invalid handoff file");
    return fs.readFileSync(target);
  };
  const handoff = JSON.parse(read("handoff.json", 65536));
  const planBytes = read("release-plan.json", 1024 * 1024);
  requireValue(env.JANUS_WAVESPEED_RELEASE_MODE === "verify" && env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_EVENT_NAME === "status" && env.GITHUB_JOB === "publish-release" &&
    env.GITHUB_REPOSITORY === repository && env.GITHUB_REPOSITORY_ID === "1079467744" &&
    env.GITHUB_REF === "refs/heads/main" &&
    env.GITHUB_WORKFLOW_REF === `${repository}/.github/workflows/release.yml@refs/heads/main` &&
    env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA && !env.GITHUB_HEAD_REF,
    "Unexpected handoff verification context");
  requireValue(handoff.schemaVersion === 1 && Number.isSafeInteger(handoff.publisher?.jobId) &&
    handoff.publisher.jobId > 0 && String(handoff.publisher.runId) === env.GITHUB_RUN_ID &&
    String(handoff.publisher.runAttempt) === env.GITHUB_RUN_ATTEMPT &&
    handoff.publisher.commit === env.GITHUB_SHA && handoff.receipt?.sourceCommit === env.GITHUB_SHA &&
    handoff.receipt.repository === repository, "Handoff belongs to another publisher or source");
  publisherOptions({ cwd, planBytes, artifactDirectory: path.join(directory, "artifact"), expected: handoff.receipt });
  return { sourceCommit: handoff.receipt.sourceCommit, version: handoff.receipt.version,
    buildNumber: handoff.receipt.buildNumber, planSha256: handoff.receipt.planSha256,
    artifactManifestSha256: handoff.receipt.artifactManifestSha256, publicationEnabled: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 3, "Usage: check-handoff.mjs DIRECTORY");
    console.log(JSON.stringify(checkHandoff(process.cwd(), process.argv[2], process.env)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

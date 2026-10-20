import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { releaseVersion, sha256 } from "./versioned-artifact.mjs";

export const repository = "aditzel/wavespeed-cli";
export const configurationSha256 =
  "1c616905741b4477fba43990759b4fe50d05237b8fa3334b71f427e2f8f38597";
export const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};
export function commit(value) {
  requireValue(
    typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && value.length === 40,
    "Invalid source commit",
  );
  return value;
}

export function releaseInputs(cwd, sourceCommit) {
  const read = (name, limit) => {
    const filename = path.join(cwd, name),
      stat = fs.lstatSync(filename);
    requireValue(
      stat.isFile() && stat.size > 0 && stat.size <= limit,
      "Invalid release input file",
    );
    return fs.readFileSync(filename);
  };
  const sourcePackage = read("package.json", 128 * 1024);
  const lock = read("bun.lock", 2 * 1024 * 1024);
  const configuration = read(".releaserc.json", 64 * 1024);
  requireValue(
    sha256(configuration) === configurationSha256,
    "Release configuration changed; migration review required",
  );
  const pkg = JSON.parse(sourcePackage);
  requireValue(
    !Object.hasOwn(pkg, "release") && !Object.hasOwn(pkg, "cosmiconfig"),
    "Unexpected alternate release configuration",
  );
  for (const name of [
    ".releaserc",
    "package.yaml",
    ...["json", "yaml", "yml", "js", "ts", "cjs", "mjs"].map(
      (extension) => `.config/config.${extension}`,
    ),
  ]) {
    requireValue(
      !fs.lstatSync(path.join(cwd, name), { throwIfNoEntry: false }),
      "Unexpected alternate release configuration",
    );
  }
  requireValue(
    pkg.name === "wavespeed-cli" &&
      pkg.devDependencies?.["semantic-release"] === "25.0.5" &&
      pkg.devDependencies?.["@semantic-release/npm"] === "13.1.5",
    "Unexpected release package or toolchain",
  );
  return {
    sourcePackage,
    lock,
    configuration: JSON.parse(configuration),
    identity: {
      repository,
      sourceCommit: commit(sourceCommit),
      configurationSha256,
      sourcePackageSha256: sha256(sourcePackage),
      lockSha256: sha256(lock),
      semanticReleaseVersion: "25.0.5",
    },
  };
}

function decision(result, sourceCommit) {
  if (result === false) return { kind: "no-release" };
  requireValue(result && typeof result === "object", "Invalid semantic-release result");
  const next = result.nextRelease;
  requireValue(
    next &&
      next.gitHead === sourceCommit &&
      ["major", "minor", "patch"].includes(next.type) &&
      !next.channel,
    "Release decision does not match source or main channel",
  );
  const version = releaseVersion(next.version);
  requireValue(next.gitTag === `v${version}`, "Unexpected release tag");
  requireValue(
    Array.isArray(result.commits) && result.commits.length <= 10000,
    "Invalid release commit inventory",
  );
  const commits = result.commits.map((item) => commit(item.hash));
  requireValue(new Set(commits).size === commits.length, "Duplicate release commits");
  let lastRelease = null;
  if (result.lastRelease && Object.keys(result.lastRelease).length) {
    const previous = result.lastRelease;
    const previousVersion = releaseVersion(previous.version);
    requireValue(previous.gitTag === `v${previousVersion}`, "Unexpected previous release tag");
    lastRelease = {
      version: previousVersion,
      gitTag: previous.gitTag,
      gitHead: commit(previous.gitHead),
    };
  }
  return { kind: "release", version, type: next.type, gitTag: next.gitTag, lastRelease, commits };
}

export function producerIdentity(value) {
  requireValue(
    value &&
      Object.keys(value).sort().join(",") === "event,runAttempt,runId,workflowRef,workflowSha",
    "Invalid planner run identity",
  );
  for (const key of ["runId", "runAttempt"])
    requireValue(
      typeof value[key] === "string" &&
        /^[1-9][0-9]{0,15}$/.test(value[key]) &&
        value[key].trim() === value[key],
      "Invalid planner run identifier",
    );
  requireValue(
    ["push", "workflow_dispatch"].includes(value.event) &&
      value.workflowRef === `${repository}/.github/workflows/release.yml@refs/heads/main`,
    "Unexpected planner workflow or event",
  );
  commit(value.workflowSha);
  return { ...value };
}

export function makePlan(result, inputs, producer) {
  producer = producerIdentity(producer);
  requireValue(
    producer.workflowSha === inputs.identity.sourceCommit,
    "Planner workflow differs from source",
  );
  return {
    schemaVersion: 1,
    ...inputs.identity,
    producer,
    decision: decision(result, inputs.identity.sourceCommit),
  };
}

export function verifyPlan(value, inputs) {
  requireValue(value && value.schemaVersion === 1 && value.decision, "Invalid release plan");
  let result = false;
  if (value.decision.kind !== "no-release") {
    const item = value.decision;
    requireValue(Array.isArray(item.commits), "Invalid planned commits");
    result = {
      nextRelease: {
        type: item.type,
        version: item.version,
        gitTag: item.gitTag,
        gitHead: inputs.identity.sourceCommit,
        channel: null,
      },
      lastRelease: item.lastRelease || {},
      commits: item.commits.map((hash) => ({ hash })),
    };
  }
  const expected = makePlan(result, inputs, value.producer);
  requireValue(
    isDeepStrictEqual(value, expected),
    "Release plan differs from source or decision schema",
  );
  return expected;
}

export function verifyDecision(plan, context) {
  const current = decision(context, plan.sourceCommit);
  requireValue(
    isDeepStrictEqual(current, plan.decision),
    "Release decision changed since the Janus build was planned",
  );
}

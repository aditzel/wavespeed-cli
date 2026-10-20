import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { releaseInputs, requireValue, verifyDecision, verifyPlan } from "./release-plan.mjs";
import { sha256, verifyArtifact } from "./versioned-artifact.mjs";

// The caller must obtain these expected digests/source/run from a protected,
// freshly verified provider receipt. Self-reported artifact hashes are not proof.
export function publisherOptions({ cwd, planBytes, artifactDirectory, expected, revalidate }) {
  requireValue(
    expected &&
      /^[a-f0-9]{64}$/.test(expected.planSha256) &&
      /^[a-f0-9]{64}$/.test(expected.artifactManifestSha256),
    "Authenticated handoff digests are required",
  );
  requireValue(sha256(planBytes) === expected.planSha256, "Release plan digest mismatch");
  const inputs = releaseInputs(cwd, expected.sourceCommit);
  const plan = verifyPlan(JSON.parse(planBytes), inputs);
  requireValue(
    isDeepStrictEqual(plan.producer, expected.producer),
    "Planner run differs from the authenticated handoff",
  );
  requireValue(plan.decision.kind === "release", "A no-release plan cannot publish");
  const artifact = () => {
    const verified = verifyArtifact(artifactDirectory, {
      version: plan.decision.version,
      sourcePackage: inputs.sourcePackage,
      lock: inputs.lock,
    });
    requireValue(
      sha256(fs.readFileSync(path.join(artifactDirectory, "manifest.json"))) ===
        expected.artifactManifestSha256,
      "Artifact manifest differs from the authenticated handoff",
    );
    return verified;
  };
  artifact(); // Reject corrupt or mismatched handoffs before invoking the engine.
  let approved = false;
  const verify = {
    verifyConditions(_config, context) {
      if (!revalidate) return;
      // With exactly one ordinary branch there is no higher release channel:
      // the engine cannot take its addChannel mutation path before verifyRelease.
      requireValue(context.options?.dryRun === false && context.branch?.name === "main" &&
        context.branch.type === "release" && !context.branch.channel &&
        context.branches?.length === 1 && context.branches[0].name === "main",
      "Unexpected live release configuration");
      return revalidate("verifyConditions");
    },
    verifyRelease(_config, context) {
      approved = false;
      const finish = () => {
        requireValue(
          context.cwd === cwd && context.branch?.name === "main",
          "Unexpected publisher checkout or branch",
        );
        const current = releaseInputs(cwd, expected.sourceCommit);
        requireValue(
          isDeepStrictEqual(current.identity, inputs.identity),
          "Publisher inputs changed after preflight",
        );
        verifyDecision(plan, context);
        artifact();
        approved = true;
      };
      return revalidate ? Promise.resolve(revalidate("verifyRelease")).then(finish) : finish();
    },
  };
  const consume = {
    prepare(_config, context) {
      requireValue(
        approved && context.cwd === cwd,
        "Release decision must be verified before artifact preparation",
      );
      approved = false;
      const finish = () => {
        verifyDecision(plan, context);
        const verified = artifact();
        requireValue(
          isDeepStrictEqual(
            JSON.parse(fs.readFileSync(path.join(cwd, "package.json"))),
            JSON.parse(verified.preparedPackage),
          ),
          "npm preparation differs from the versioned artifact",
        );
        const output = path.join(cwd, "dist");
        const stat = fs.lstatSync(output, { throwIfNoEntry: false });
        if (stat) {
          requireValue(stat.isDirectory(), "Publisher dist must be a real directory");
          const names = fs.readdirSync(output);
          requireValue(
            names.length === 0 ||
              (names.length === 1 &&
                names[0] === "index.js" &&
                fs.lstatSync(path.join(output, "index.js")).isFile()),
            "Unexpected existing publisher output",
          );
        } else fs.mkdirSync(output);
        const staging = fs.mkdtempSync(path.join(cwd, ".janus-bundle-"));
        try {
          const temporary = path.join(staging, "index.js");
          fs.writeFileSync(temporary, verified.bundle);
          fs.chmodSync(temporary, 0o755);
          fs.renameSync(temporary, path.join(output, "index.js"));
        } finally {
          fs.rmSync(staging, { recursive: true, force: true });
        }
      };
      return revalidate ? Promise.resolve(revalidate("prepare")).then(finish) : finish();
    },
  };
  // Preserve all existing analyzers and publish/success/fail behavior. Only the
  // exec prepare build is replaced, before @semantic-release/git can push.
  const plugins = [verify];
  for (const entry of inputs.configuration.plugins) {
    if (Array.isArray(entry) && entry[0] === "@semantic-release/exec") {
      const { prepareCmd, ...remaining } = entry[1];
      requireValue(prepareCmd === "bun run build", "Unexpected prepare command");
      plugins.push([entry[0], remaining], consume);
    } else plugins.push(entry);
  }
  return { ...inputs.configuration, plugins };
}

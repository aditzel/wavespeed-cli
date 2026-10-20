import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dir, "../..");
const workflow: any = Bun.YAML.parse(fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"));
const jobs = workflow.jobs;

// Evaluate the actual expressions in this workflow for controlled boolean/string
// fixtures. actionlint separately checks GitHub's syntax/context availability.
function routes({ mode = "", event = "push", ref = "refs/heads/main", recovery = false,
  message = "feat: change", decision = "", planResult = "skipped", testResult = "success", repo = "aditzel/wavespeed-cli",
  status = "success", context = "buildkite/wavespeed-cli-release-build", stale = false, canceled = false } = {}) {
  const github = { repository: repo, event_name: event, ref, sha: "a".repeat(40),
    event: { head_commit: { message }, state: status, context, sha: (stale ? "b" : "a").repeat(40) } };
  const needs: any = { "plan-release": { result: planResult, outputs: { decision } }, test: { result: testResult } };
  const run = (name: string) => {
    const expression = jobs[name].if.replace(/^\s*\$\{\{|\}\}\s*$/g, "").replaceAll("needs.plan-release", 'needs["plan-release"]');
    const dependency = jobs[name].needs;
    if (dependency && !expression.includes("cancelled(") && needs[dependency].result !== "success") return false;
    return !!new Function("github", "vars", "inputs", "needs", "startsWith", "cancelled", "contains", "fromJSON",
      `return (${expression});`)(github, { JANUS_WAVESPEED_RELEASE_MODE: mode },
      { publish_current_version: recovery }, needs, (value: string, prefix: string) => value.startsWith(prefix), () => canceled, (items: string[], item: string) => items.includes(item), JSON.parse);
  };
  return Object.fromEntries(["plan-release", "request-janus-release", "verify-release", "publish-release", "test", "release"]
    .map((name) => [name, run(name)]));
}

describe("release workflow routing", () => {
  it("preserves legacy main publishing and non-main tests while verification is off", () => {
    expect(routes()).toEqual({ "plan-release": false, "request-janus-release": false,
      "verify-release": false, "publish-release": false, test: true, release: true });
    expect(routes({ event: "workflow_dispatch", ref: "refs/heads/topic" }).release).toBe(false);
    expect(routes({ event: "workflow_dispatch", ref: "refs/heads/topic" }).test).toBe(true);
    expect(routes({ message: "chore(release): 1.4.0" }).release).toBe(false);
    expect(routes({ message: "chore(release): 1.4.0" }).test).toBe(true);
  });

  it("routes a planned normal release to Janus verification without legacy publication", () => {
    expect(routes({ mode: "verify", decision: "release", planResult: "success" })).toEqual({
      "plan-release": true, "request-janus-release": true, "verify-release": false, "publish-release": false, test: false, release: false,
    });
    expect(routes({ mode: "verify", event: "workflow_dispatch", decision: "release", planResult: "success" })
      ["request-janus-release"]).toBe(true);
  });

  it("retains no-release, release-commit and non-main tests plus tagged recovery behavior", () => {
    expect(routes({ mode: "verify", decision: "no-release", planResult: "success" }).test).toBe(true);
    expect(routes({ mode: "verify", decision: "no-release", planResult: "success" }).release).toBe(false);
    expect(routes({ mode: "verify", message: "chore(release): 1.4.0" }).test).toBe(true);
    expect(routes({ mode: "verify", event: "workflow_dispatch", ref: "refs/heads/topic" }).test).toBe(true);
    expect(routes({ mode: "verify", event: "workflow_dispatch", recovery: true })).toEqual({
      "plan-release": false, "request-janus-release": false, "verify-release": false, "publish-release": false, test: true, release: true,
    });
  });

  it("completion statuses cannot enter legacy publishing or start another planner", () => {
    expect(routes({ mode: "verify", event: "status" })).toEqual({
      "plan-release": false, "request-janus-release": false, "verify-release": true, "publish-release": false, test: false, release: false,
    });
    for (const change of [{ mode: "" }, { stale: true }, { context: "other" }, { status: "failure" },
      { repo: "outsider/fork" }]) {
      expect(routes({ mode: "verify", event: "status", ...change })["verify-release"]).toBe(false);
    }
    expect(routes({ canceled: true }).test).toBe(false);
    expect(routes({ canceled: true }).release).toBe(false);
    for (const testResult of ["failure", "cancelled", "skipped"]) expect(routes({ testResult }).release).toBe(false);
    expect(routes({ mode: "verify", decision: "release", planResult: "failure" })["request-janus-release"]).toBe(false);
  });

  it("keeps the verification job read-only and pins private helper source and workflow actions", () => {
    expect(jobs["verify-release"].permissions).toEqual({ contents: "read", actions: "read" });
    expect(jobs["verify-release"].concurrency).toEqual({ group: "wavespeed-release-publish", "cancel-in-progress": false });
    const helper = jobs["verify-release"].steps.find((step: any) => step.name === "Checkout reviewed verifier");
    expect(helper.with.repository).toBe("MiraiForge/devops");
    expect(helper.with.ref).toBe("5bc13d18130c510119aa330bc1601b68459a4dc8");
    for (const job of Object.values(jobs) as any[]) for (const step of job.steps) {
      if (step.uses) expect(step.uses).toMatch(/^[\w/-]+@[a-f0-9]{40}$/);
      if (step.uses?.startsWith("actions/checkout@")) expect(step.with["persist-credentials"]).toBe(false);
    }
    const run = jobs["verify-release"].steps.map((step: any) => step.run || "").join("\n");
    expect(run).not.toMatch(/npm publish|bun run release|semanticRelease\(/);
    expect(jobs["plan-release"].steps.find((step: any) => step.name === "Upload release plan").with.overwrite).toBe(false);
    expect(jobs.test["runs-on"]).toEqual(["self-hosted", "Linux", "X64"]);
    expect(jobs.release["runs-on"]).toEqual(["self-hosted", "Linux", "X64"]);
  });

  it("uses only the hosted publisher for successful status callbacks in publish mode", () => {
    expect(routes({ mode: "publish", event: "status" })).toEqual({
      "plan-release": false, "request-janus-release": false, "verify-release": false,
      "publish-release": true, test: false, release: false,
    });
    const planned = routes({ mode: "publish", decision: "release", planResult: "success" });
    expect(planned["request-janus-release"]).toBe(true);
    expect(planned.release).toBe(false);
    for (const change of [{ stale: true }, { status: "failure" }, { context: "other" }, { repo: "outsider/fork" }])
      expect(routes({ mode: "publish", event: "status", ...change })["publish-release"]).toBe(false);
    expect(jobs["publish-release"]["runs-on"]).toBe("ubuntu-24.04");
    expect(jobs["publish-release"]["timeout-minutes"]).toBe(360);
    expect(jobs["publish-release"].permissions).toEqual({ contents: "write", actions: "read", "id-token": "write" });
    expect(jobs["publish-release"].concurrency).toEqual(jobs["verify-release"].concurrency);
    expect(jobs["publish-release"].steps[0].with["fetch-depth"]).toBe(0);
    const commands = jobs["publish-release"].steps.map((step: any) => step.run || "").join("\n");
    expect(commands).toContain("publish-verified.mjs");
    expect(commands).not.toMatch(/bun run build|bun test|bun run release/);
  });

  it("executes each CLI entry point under Node instead of silently doing nothing", () => {
    for (const name of ["plan-release", "request-janus", "check-handoff", "publish-verified"]) {
      const result = spawnSync("node", [`scripts/release/${name}.mjs`], {
        cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 15_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  });
});

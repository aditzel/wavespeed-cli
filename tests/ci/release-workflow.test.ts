import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dir, "../..");
const workflow: any = Bun.YAML.parse(fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"));
const jobs = workflow.jobs;

// Evaluate the actual expressions in this workflow for controlled boolean/string
// fixtures. actionlint separately checks GitHub's syntax/context availability.
function routes({ mode = "", testMode = "", recoveryMode = "", all = false, event = "push", ref = "refs/heads/main", recovery = false,
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
      `return (${expression});`)(github, { JANUS_WAVESPEED_RELEASE_MODE: mode, JANUS_WAVESPEED_TEST_MODE: testMode, JANUS_WAVESPEED_RECOVERY_MODE: recoveryMode },
      { publish_current_version: recovery }, needs, (value: string, prefix: string) => value.startsWith(prefix), () => canceled, (items: string[], item: string) => items.includes(item), JSON.parse);
  };
  return Object.fromEntries(["plan-release", "request-janus-release", "verify-release", "publish-release", "request-janus-test", "verify-janus-test", "test", "release"]
    .concat(all ? ["request-recovery-verify", "request-recovery-publish", "verify-recovery", "publish-recovery"] : [])
    .map((name) => [name, run(name)]));
}

describe("release workflow routing", () => {
  it("preserves legacy main publishing and non-main tests while verification is off", () => {
    expect(routes()).toEqual({ "plan-release": false, "request-janus-release": false,
      "verify-release": false, "publish-release": false, "request-janus-test": false, "verify-janus-test": false, test: true, release: true });
    expect(routes({ event: "workflow_dispatch", ref: "refs/heads/topic" }).release).toBe(false);
    expect(routes({ event: "workflow_dispatch", ref: "refs/heads/topic" }).test).toBe(true);
    expect(routes({ message: "chore(release): 1.4.0" }).release).toBe(false);
    expect(routes({ message: "chore(release): 1.4.0" }).test).toBe(true);
  });

  it("routes a planned normal release to Janus verification without legacy publication", () => {
    expect(routes({ mode: "verify", decision: "release", planResult: "success" })).toEqual({
      "plan-release": true, "request-janus-release": true, "verify-release": false, "publish-release": false, "request-janus-test": false, "verify-janus-test": false, test: false, release: false,
    });
    expect(routes({ mode: "verify", event: "workflow_dispatch", decision: "release", planResult: "success" })
      ["request-janus-release"]).toBe(true);
  });

  it("does not let a release decision alone select the credential-bearing dispatcher", () => {
    for (const mode of ["verify", "publish"]) {
      const planned = { mode, decision: "release", planResult: "success" };
      for (const event of ["push", "workflow_dispatch"])
        expect(routes({ ...planned, event })["request-janus-release"]).toBe(true);
      for (const change of [{ ref: "refs/heads/topic" }, { ref: "refs/tags/main" },
        { ref: "refs/tags/v1.3.5" }, { event: "status" }, { repo: "outsider/fork" },
        { mode: "" }, { mode: "unsupported" }, { message: "chore(release): 1.4.0" },
        { event: "workflow_dispatch", recovery: true }, { planResult: "failure" },
        { planResult: "cancelled" }, { planResult: "skipped" }])
        expect(routes({ ...planned, ...change })["request-janus-release"]).toBe(false);
    }
  });

  it("binds every Buildkite writer consumer to its dedicated environment", () => {
    const expected: Record<string, [string, string]> = {
      "request-janus-release": ["janus-wavespeed-release-build", "BUILDKITE_WAVESPEED_RELEASE_WRITE_TOKEN"],
      "request-janus-test": ["janus-wavespeed-release-tests", "BUILDKITE_WAVESPEED_TEST_WRITE_TOKEN"],
      "request-recovery-verify": ["janus-wavespeed-recovery-build", "BUILDKITE_WAVESPEED_RECOVERY_WRITE_TOKEN"],
      "request-recovery-publish": ["janus-wavespeed-recovery-build", "BUILDKITE_WAVESPEED_RECOVERY_WRITE_TOKEN"],
    };
    const writers = Object.entries(jobs).filter(([, job]) => /secrets\.BUILDKITE_\w+_WRITE_TOKEN/.test(JSON.stringify(job)));
    expect(writers.map(([name]) => name).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, value] of writers) {
      const job = value as any;
      const [environment, secret] = expected[name]!;
      expect(job.environment).toBe(environment);
      expect(job.permissions).toEqual({ contents: "read" });
      expect([...JSON.stringify(job).matchAll(/secrets\.(BUILDKITE_\w+_WRITE_TOKEN)/g)]
        .map((match) => match[1])).toEqual([secret]);
    }
    expect(JSON.stringify(workflow.env || {})).not.toContain("WRITE_TOKEN");
  });

  it("retains no-release, release-commit and non-main tests plus tagged recovery behavior", () => {
    expect(routes({ mode: "verify", decision: "no-release", planResult: "success" }).test).toBe(true);
    expect(routes({ mode: "verify", decision: "no-release", planResult: "success" }).release).toBe(false);
    expect(routes({ mode: "verify", message: "chore(release): 1.4.0" }).test).toBe(true);
    expect(routes({ mode: "verify", event: "workflow_dispatch", ref: "refs/heads/topic" }).test).toBe(true);
    expect(routes({ mode: "verify", event: "workflow_dispatch", recovery: true })).toEqual({
      "plan-release": false, "request-janus-release": false, "verify-release": false, "publish-release": false, "request-janus-test": false, "verify-janus-test": false, test: true, release: true,
    });
  });

  it("completion statuses cannot enter legacy publishing or start another planner", () => {
    expect(routes({ mode: "verify", event: "status" })).toEqual({
      "plan-release": false, "request-janus-release": false, "verify-release": true, "publish-release": false, "request-janus-test": false, "verify-janus-test": false, test: false, release: false,
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
    expect(jobs.release["runs-on"]).toBe("ubuntu-24.04");
  });

  it("uses only the hosted publisher for successful status callbacks in publish mode", () => {
    expect(routes({ mode: "publish", event: "status" })).toEqual({
      "plan-release": false, "request-janus-release": false, "verify-release": false,
      "publish-release": true, "request-janus-test": false, "verify-janus-test": false, test: false, release: false,
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

  it("routes remaining test events to Janus only after both modes are configured", () => {
    for (const change of [{ decision: "no-release", planResult: "success" }, { message: "chore(release): 1.4.0" },
      { planResult: "failure" }]) {
      const cutover = routes({ mode: "verify", testMode: "janus", ...change });
      expect(cutover["request-janus-test"]).toBe(true);
      expect(cutover.test).toBe(false);
      expect(cutover.release).toBe(false);
      expect(routes({ mode: "verify", testMode: "verify", ...change }).test).toBe(true);
    }
    expect(routes({ testMode: "janus" }).test).toBe(true);
    expect(routes({ mode: "verify", testMode: "janus", decision: "release", planResult: "success" })["request-janus-test"]).toBe(false);
    for (const change of [{ canceled: true }, { event: "status" }, { repo: "outsider/fork" },
      { ref: "refs/heads/topic" }, { ref: "refs/tags/main" }])
      expect(routes({ mode: "verify", testMode: "janus", ...change })["request-janus-test"]).toBe(false);
    const recovery = routes({ mode: "publish", testMode: "janus", event: "workflow_dispatch", recovery: true });
    expect(recovery.test).toBe(true);
    expect(recovery.release).toBe(true);
    expect(recovery["request-janus-test"]).toBe(false);
  });

  it("keeps manual test fallback without entering the credential-bearing dispatcher", () => {
    for (const mode of ["", "verify", "publish"]) for (const testMode of ["", "verify", "janus"])
      for (const ref of ["refs/heads/main", "refs/heads/topic", "refs/tags/v1.3.5", "refs/tags/main"]) {
        const manual = routes({ mode, testMode, event: "workflow_dispatch", ref });
        expect(manual["request-janus-test"]).toBe(false);
        expect(manual.test).toBe(true);
      }
    expect(jobs["request-janus-test"].environment).toBe("janus-wavespeed-release-tests");
  });

  it("verifies terminal test statuses independently of the callback commit without publishing", () => {
    for (const status of ["success", "failure", "error"]) {
      const result = routes({ mode: "publish", testMode: "janus", event: "status", stale: true,
        context: "buildkite/wavespeed-cli-release-tests", status });
      expect(result["verify-janus-test"]).toBe(true);
      expect(result["publish-release"]).toBe(false);
      expect(result["request-janus-test"]).toBe(false);
      expect(result.test).toBe(false);
      expect(result.release).toBe(false);
    }
    const callback = jobs["verify-janus-test"];
    expect(callback.permissions).toEqual({ contents: "read", actions: "read" });
    expect(callback["runs-on"]).toBe("ubuntu-24.04");
    expect(callback["timeout-minutes"]).toBe(5);
    expect(callback.steps).toHaveLength(2);
    expect(callback.steps[0].with.repository).toBe("MiraiForge/devops");
    expect(callback.steps[0].with.ref).toBe("3ec5499e8ffe5743e64f8dbed7597ce0034044bd");
    const commands = callback.steps.map((step: any) => step.run || "").join("\n");
    expect(commands).toContain("wavespeed-tests.py");
    expect(commands).not.toMatch(/bun install|bun test|npm publish|bun run release/);
    expect(jobs["request-janus-test"].concurrency.group).toContain("github.run_id");
    expect(jobs["request-janus-test"].permissions).toEqual({ contents: "read" });
  });

  it("routes recovery modes to Janus while preventing legacy or verify-mode publication", () => {
    for (const recoveryMode of ["verify", "publish"]) {
      const result = routes({ mode: "verify", testMode: "janus", recoveryMode, all: true,
        event: "workflow_dispatch", recovery: true });
      expect(result[`request-recovery-${recoveryMode}`]).toBe(true);
      expect(result[`request-recovery-${recoveryMode === "verify" ? "publish" : "verify"}`]).toBe(false);
      expect(result.test).toBe(false);
      expect(result.release).toBe(false);
      expect(result["request-janus-test"]).toBe(false);
      expect(result["publish-recovery"]).toBe(false);
      for (const change of [{ ref: "refs/tags/v1.3.5" }, { ref: "refs/tags/main" }, { ref: "refs/heads/topic" },
        { recovery: false }, { event: "push" }, { repo: "outsider/fork" }, { mode: "" }]) {
        expect(routes({ mode: "verify", recoveryMode, all: true, event: "workflow_dispatch", recovery: true,
          ...change })[`request-recovery-${recoveryMode}`]).toBe(false);
      }
    }
    const off = routes({ recoveryMode: "publish", all: true, event: "workflow_dispatch", recovery: true });
    expect(off.test).toBe(true);
    expect(off.release).toBe(true);
  });

  it("separates read-only verification from hosted recovery publication and authenticates before checkout", () => {
    for (const mode of ["verify", "publish"]) {
      const result = routes({ mode: "verify", recoveryMode: mode, all: true, event: "status", stale: true,
        context: "buildkite/wavespeed-cli-recovery-build" });
      expect(result[`${mode}-recovery`]).toBe(true);
      expect(result.test).toBe(false);
      expect(result.release).toBe(false);
      expect(result["plan-release"]).toBe(false);
      const job = jobs[`${mode}-recovery`];
      expect(job.permissions).toEqual(mode === "verify" ? { contents: "read", actions: "read" } :
        { contents: "write", actions: "read", "id-token": "write" });
      expect(job["runs-on"]).toBe("ubuntu-24.04");
      if (mode === "publish") {
        expect(job.concurrency).toEqual(jobs["publish-release"].concurrency);
      } else {
        expect(job.concurrency).toEqual({ group: "wavespeed-recovery-verify", "cancel-in-progress": false });
        for (const publisher of ["publish-release", "publish-recovery"])
          expect(job.concurrency.group).not.toBe(jobs[publisher].concurrency.group);
      }
      expect(job.steps[0].with.repository).toBe("MiraiForge/devops");
      expect(job.steps[0].with.ref).toBe("f0a8a66149da26af43918f8d88f4cad3e352a91c");
      expect(job.steps[1].id).toBe("recovery");
      expect(job.steps[2].with.ref).toBe("${{ steps.recovery.outputs.source }}");
      expect(job.steps[2].with["fetch-depth"]).toBe(0);
      const commands = job.steps.map((step: any) => step.run || "").join("\n");
      expect(commands).not.toMatch(/bun install|bun run build|bun test|bun run release/);
      expect(commands).toContain("recover-verified.mjs");
    }
  });

  it("executes each CLI entry point under Node instead of silently doing nothing", () => {
    for (const name of ["plan-release", "request-janus", "request-tests", "request-recovery", "recover-verified", "check-handoff", "publish-verified"]) {
      const result = spawnSync("node", [`scripts/release/${name}.mjs`], {
        cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 15_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  });
});

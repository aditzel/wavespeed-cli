import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(resolve(import.meta.dir, "../../.github/workflows/test.yml"), "utf8"),
);
const jobs = workflow.jobs;

// Exercise the actual guards; actionlint checks GitHub expression syntax.
function hosted(event: string, fork = false, base = "main", result = "success") {
  const trigger = workflow.on[event];
  if (!(event in workflow.on)) return [];
  if (event === "pull_request" && !trigger.branches.includes(base)) return [];
  const github = {
    repository: "aditzel/wavespeed-cli",
    event_name: event,
    event:
      event === "pull_request"
        ? {
            pull_request: {
              head: {
                repo: { full_name: fork ? "contributor/wavespeed-cli" : "aditzel/wavespeed-cli" },
              },
            },
          }
        : {},
  };
  return Object.entries(jobs)
    .filter(([, value]) => {
      const job = value as { if: string; needs?: string };
      if (job.needs && result !== "success") return false;
      return new Function("github", `return (${job.if});`)(github);
    })
    .map(([name]) => name);
}

describe("ordinary CI ownership", () => {
  it("leaves trusted pushes and same-repository PRs to Buildkite", () => {
    expect(hosted("push")).toEqual([]);
    expect(hosted("pull_request")).toEqual([]);
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "workflow_dispatch"]);
    expect(workflow.on.pull_request.branches).toEqual(["main"]);
    for (const event of ["release", "status", "pull_request_target", "repository_dispatch"])
      expect(hosted(event)).toEqual([]);
  });

  it("retains both hosted lanes for fork PRs to main and explicit recovery", () => {
    expect(hosted("pull_request", true)).toEqual(["test", "validate-implementation"]);
    expect(hosted("workflow_dispatch")).toEqual(["test", "validate-implementation"]);
    expect(hosted("pull_request", true, "develop")).toEqual([]);
    expect(hosted("pull_request", false, "develop")).toEqual([]);
  });

  it("keeps validation dependent on successful tests", () => {
    expect(jobs["validate-implementation"].needs).toBe("test");
    for (const result of ["failure", "cancelled", "skipped"])
      expect(hosted("workflow_dispatch", false, "main", result)).toEqual(["test"]);
    expect(jobs["validate-implementation"].if).not.toMatch(/always\(|failure\(|cancelled\(/);
  });

  it("keeps hosted recovery read-only with pinned tools and original checks", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(jobs) as any[]) {
      expect(job["runs-on"]).toBe("ubuntu-24.04");
      expect(job["timeout-minutes"] ?? 360).toBe(360);
      expect(job.permissions).toBeUndefined();
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
        if (step.uses?.startsWith("actions/checkout@"))
          expect(step.with["persist-credentials"]).toBe(false);
        if (step.uses?.startsWith("oven-sh/setup-bun@"))
          expect(step.with["bun-version"]).toBe("1.3.14");
      }
      const commands = job.steps.map((step: any) => step.run || "").join("\n");
      expect(commands).toContain("bun install --frozen-lockfile");
      expect(commands).toContain("bun run build");
    }
    const test = jobs.test.steps.map((step: any) => step.run || "").join("\n");
    expect(test).toContain("bun test");
    expect(test).toContain("./dist/index.js --help");
    for (const command of ["generate", "edit", "generate-sequential", "edit-sequential"])
      expect(test).toContain(`./dist/index.js ${command} --help`);
    const validation = jobs["validate-implementation"].steps
      .map((step: any) => step.run || "")
      .join("\n");
    for (const check of [
      "sync.*mode",
      "file paths",
      "Prompt is required",
      "Images are required",
      "Size must be WIDTH",
    ])
      expect(validation).toContain(check);
  });
});

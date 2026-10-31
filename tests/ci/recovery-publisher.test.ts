import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRecovery, recoverVerified, recoveryReader } from "../../scripts/release/recover-verified.mjs";
import { artifactManifest, sha256 } from "../../scripts/release/versioned-artifact.mjs";

const source = "a".repeat(40), control = "b".repeat(40), tagObject = "c".repeat(40);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture(mode = "publish") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-publisher-"));roots.push(root);
  const cwd = path.join(root, "source");fs.mkdirSync(cwd);
  const directory = path.join(root, "handoff"), artifactDirectory = path.join(directory, "artifact");
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const sourcePackage = Buffer.from(JSON.stringify({
    name: "wavespeed-cli", version: "1.3.5", files: ["dist", "README.md", "skills"], scripts: { build: "bun build" },
  }));
  const lock = Buffer.from('{"lockfileVersion":1}\n'), bundle = Buffer.from("#!/usr/bin/env bun\nthrow new Error('never execute bundle');\n");
  fs.writeFileSync(path.join(cwd, "package.json"), sourcePackage);fs.writeFileSync(path.join(cwd, "bun.lock"), lock);
  fs.writeFileSync(path.join(artifactDirectory, "package.json"), sourcePackage);
  fs.writeFileSync(path.join(artifactDirectory, "index.js"), bundle, { mode: 0o755 });
  fs.chmodSync(path.join(artifactDirectory, "index.js"), 0o755);
  const manifest = Buffer.from(JSON.stringify(artifactManifest({
    version: "1.3.5", sourcePackage, lock, preparedPackage: sourcePackage, bundle,
  })));
  fs.writeFileSync(path.join(artifactDirectory, "manifest.json"), manifest);
  const env: any = {
    JANUS_WAVESPEED_RECOVERY_MODE: mode, GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "aditzel/wavespeed-cli",
    GITHUB_REPOSITORY_ID: "1079467744", GITHUB_EVENT_NAME: "status", GITHUB_REF: "refs/heads/main",
    GITHUB_JOB: `${mode}-recovery`, GITHUB_SHA: control, GITHUB_WORKFLOW_SHA: control,
    GITHUB_WORKFLOW_REF: "aditzel/wavespeed-cli/.github/workflows/release.yml@refs/heads/main",
    GITHUB_RUN_ID: "101", GITHUB_RUN_ATTEMPT: "2",
  };
  const handoff: any = {
    schemaVersion: 1,
    request: { schemaVersion: 1, repositoryId: 1079467744, workflowId: 211956153, event: "workflow_dispatch",
      ref: "refs/heads/main", commit: source, runId: 100, runAttempt: 1, mode },
    publisher: { jobId: 201, jobName: `${mode}-recovery`, mode, runId: 101, runAttempt: 2, commit: control, sourceCommit: source },
    receipt: { repository: "aditzel/wavespeed-cli", sourceCommit: source, version: "1.3.5",
      sourcePackageSha256: sha256(sourcePackage), lockSha256: sha256(lock), artifactManifestSha256: sha256(manifest),
      tag: { ref: "refs/tags/v1.3.5", sha: tagObject, type: "tag" }, buildNumber: 5 },
  };
  const save = () => fs.writeFileSync(path.join(directory, "handoff.json"), JSON.stringify(handoff));
  save();
  const calls: any[] = [];
  let npmExists = false, releaseExists = false, auths = 0;
  const authenticate = async () => { auths++;return readRecovery(directory, env); };
  const run = (command: string, args: string[], _cwd: string, _env: any) => {
    calls.push([command, ...args]);
    if (command === "git") {
      const value = args[0] === "cat-file" ? "tag" : args.includes("HEAD^{commit}") ? source :
        args.includes("--is-shallow-repository") ? "false" : tagObject;
      return { status: 0, stdout: value + "\n" };
    }
    if (command === "npm" && args[0] === "--version") return { status: 0, stdout: "11.16.0\n" };
    if (command === "npm" && args[0] === "view") return { status: npmExists ? 0 : 1, stdout: "" };
    if (command === "gh" && args[1] === "view") return { status: releaseExists ? 0 : 1, stdout: "" };
    if (command === "npm" && args[0] === "publish") { npmExists = true;return { status: 0, stdout: "" }; }
    if (command === "gh" && args[1] === "create") { releaseExists = true;return { status: 0, stdout: "" }; }
    throw new Error(`Unexpected command: ${command} ${args}`);
  };
  return { root, cwd, env, directory, artifactDirectory, handoff, save, bundle, sourcePackage, lock, calls, run, authenticate,
    auths: () => auths, existing: (npm: boolean, release: boolean) => { npmExists = npm;releaseExists = release; } };
}

const mutations = (calls: any[]) => calls.filter((x) => x[1] === "publish" || x[2] === "create");

describe("minimal hosted recovery publisher", () => {
  it("publishes the existing version from authenticated bytes without executing build/test/versioning", async () => {
    const f = fixture();
    const result = await recoverVerified(f);
    expect(mutations(f.calls)).toEqual([
      ["npm", "publish", "--provenance", "--access", "public"],
      ["gh", "release", "create", "v1.3.5", "--verify-tag", "--title", "v1.3.5", "--generate-notes"],
    ]);
    expect(f.auths()).toBe(3);
    expect(result.version).toBe("1.3.5");
    expect(fs.readFileSync(path.join(f.cwd, "package.json"))).toEqual(f.sourcePackage);
    expect(fs.readFileSync(path.join(f.cwd, "dist/index.js"))).toEqual(f.bundle);
    expect(f.calls.flat().join(" ")).not.toMatch(/bun|semantic-release|git push|npm version/);
  });

  it("verification mode is read-only even when neither registry has the version", async () => {
    const f = fixture("verify");
    const result = await recoverVerified(f);
    expect(result.publicationEnabled).toBe(false);
    expect(mutations(f.calls)).toEqual([]);
    expect(f.auths()).toBe(2);
    expect(fs.existsSync(path.join(f.cwd, "dist"))).toBe(false);
  });

  it("preserves npm-only, GitHub-only and already-complete partial recovery", async () => {
    for (const [npm, release] of [[true, false], [false, true], [true, true]]) {
      const f = fixture();f.existing(npm, release);
      await recoverVerified(f);
      expect(mutations(f.calls).filter((x) => x[0] === "npm")).toHaveLength(npm ? 0 : 1);
      expect(mutations(f.calls).filter((x) => x[0] === "gh")).toHaveLength(release ? 0 : 1);
    }
  });

  it("cannot promote a verify handoff or another source/callback into publication", () => {
    const f = fixture("verify");
    for (const change of [{ JANUS_WAVESPEED_RECOVERY_MODE: "publish", GITHUB_JOB: "publish-recovery" },
      { GITHUB_RUN_ID: "999" }, { GITHUB_SHA: source }, { GITHUB_JOB: "release" }]) {
      expect(() => readRecovery(f.directory, { ...f.env, ...change })).toThrow();
    }
    for (const change of [{ sourceCommit: control }, { version: "1.4.0" }, { tag: { ref: "refs/tags/v1.3.5", sha: "0".repeat(40), type: "tag" } }]) {
      const original = structuredClone(f.handoff.receipt);
      Object.assign(f.handoff.receipt, change);f.save();
      expect(() => readRecovery(f.directory, f.env)).toThrow();
      f.handoff.receipt = original;
    }
  });

  it("requires package bytes, existing tag object, complete checkout and pinned npm before publication", async () => {
    for (const scenario of ["source", "shallow", "tag", "npm", "package"]) {
      const f = fixture();
      if (scenario === "package") fs.appendFileSync(path.join(f.cwd, "package.json"), " ");
      const run = (command: string, args: string[], cwd: string, env: any) => {
        if (scenario === "source" && args.includes("HEAD^{commit}") ||
          scenario === "shallow" && args.includes("--is-shallow-repository") ||
          scenario === "tag" && args.includes("refs/tags/v1.3.5") ||
          scenario === "npm" && command === "npm" && args[0] === "--version") return { status: 0, stdout: "wrong" };
        return f.run(command, args, cwd, env);
      };
      await expect(recoverVerified({ ...f, run })).rejects.toThrow();
      expect(mutations(f.calls)).toEqual([]);
    }
  });

  it("rejects a corrupted or substituted artifact before executing publisher commands", async () => {
    const f = fixture();fs.appendFileSync(path.join(f.artifactDirectory, "index.js"), "corrupt");
    await expect(recoverVerified(f)).rejects.toThrow();
    expect(mutations(f.calls)).toEqual([]);
  });

  it("reauthenticates immediately before each mutation and stops on rerun or tag movement", async () => {
    for (const failAt of [2, 3]) {
      const f = fixture();let count = 0;
      const authenticate = async () => {
        count++;
        if (count === failAt) throw new Error("run rerun or tag moved");
        return f.authenticate();
      };
      await expect(recoverVerified({ ...f, authenticate })).rejects.toThrow("tag moved");
      expect(mutations(f.calls)).toHaveLength(failAt === 2 ? 0 : 1);
    }
  });

  it("rejects changed authority even when the replacement artifact is internally consistent", async () => {
    const f = fixture();let count = 0;
    const authenticate = async () => {
      const value = await f.authenticate();
      if (++count === 2) value.handoff.receipt.buildNumber++;
      return value;
    };
    await expect(recoverVerified({ ...f, authenticate })).rejects.toThrow("authority");
    expect(mutations(f.calls)).toEqual([]);
  });

  it("does not create a GitHub release after a failed npm publish", async () => {
    const f = fixture();
    const run = (command: string, args: string[], cwd: string, env: any) =>
      command === "npm" && args[0] === "publish" ? { status: 1, stdout: "" } : f.run(command, args, cwd, env);
    await expect(recoverVerified({ ...f, run })).rejects.toThrow("failed");
    expect(f.calls.some((x) => x[2] === "create")).toBe(false);
  });

  it("keeps publication credentials out of every independent reader process", async () => {
    const f = fixture();const calls: any[] = [];
    const reader = recoveryReader({ helper: "/reviewed/wavespeed-recovery.py", policy: "/private/policy",
      githubToken: "/private/github", buildkiteToken: "/private/buildkite", state: f.root,
      env: { ...f.env, GITHUB_TOKEN: "must-not-inherit", GH_TOKEN: "must-not-inherit", NPM_TOKEN: "must-not-inherit" },
      run(command: string, args: string[], options: any) {
        calls.push({ command, args, options });
        const output = args[args.indexOf("--output") + 1];
        fs.cpSync(f.directory, output, { recursive: true });
      } });
    expect((await reader()).handoff.receipt.version).toBe("1.3.5");
    expect(calls[0].args.slice(0, 2)).toEqual(["-I", "-B"]);
    expect(calls[0].options.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(calls[0].options.env).not.toHaveProperty("GH_TOKEN");
    expect(calls[0].options.env).not.toHaveProperty("NPM_TOKEN");
    expect(calls[0].options.timeout).toBe(180_000);
  });
});

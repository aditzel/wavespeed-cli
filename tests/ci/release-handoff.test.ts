import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  makePlan,
  releaseInputs,
  verifyDecision,
  verifyPlan,
} from "../../scripts/release/release-plan.mjs";
import { planRelease } from "../../scripts/release/plan-release.mjs";
import { publisherOptions } from "../../scripts/release/publisher-options.mjs";
import { checkHandoff, readCompletion } from "../../scripts/release/check-handoff.mjs";
import { publishVerified, completionReader } from "../../scripts/release/publish-verified.mjs";
import { artifactManifest, sha256 } from "../../scripts/release/versioned-artifact.mjs";
import plugins from "../../node_modules/semantic-release/lib/plugins/index.js";
import getNextVersion from "../../node_modules/semantic-release/lib/get-next-version.js";

const sourceCommit = "a".repeat(40),
  priorCommit = "b".repeat(40);
const repo = path.resolve(import.meta.dir, "../..");
const producer = {
  event: "push",
  runId: "12345",
  runAttempt: "2",
  workflowRef: "aditzel/wavespeed-cli/.github/workflows/release.yml@refs/heads/main",
  workflowSha: sourceCommit,
};
const result = () => ({
  nextRelease: {
    type: "minor",
    version: "1.4.0",
    gitTag: "v1.4.0",
    gitHead: sourceCommit,
    channel: null,
    notes: "Fresh release notes",
  },
  lastRelease: { version: "1.3.5", gitTag: "v1.3.5", gitHead: priorCommit },
  commits: [{ hash: sourceCommit, message: "feat: new command" }],
});

describe("semantic-release plan and artifact handoff", () => {
  let cwd: string,
    artifactDirectory: string,
    env: Record<string, string>,
    readGit: (argv: string[]) => string;
  let inputs: ReturnType<typeof releaseInputs>, plan: any, planBytes: Buffer, expected: any;
  const bundle = Buffer.from(
    "throw new Error('A publisher must never execute a downloaded bundle');\n",
  );
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wavespeed-handoff-test-"));
    for (const name of ["package.json", "bun.lock", ".releaserc.json"])
      fs.copyFileSync(path.join(repo, name), path.join(cwd, name));
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(cwd, "node_modules"));
    artifactDirectory = path.join(cwd, "artifact");
    fs.mkdirSync(artifactDirectory);
    inputs = releaseInputs(cwd, sourceCommit);
    plan = makePlan(result(), inputs, producer);
    planBytes = Buffer.from(JSON.stringify(plan));
    const preparedPackage = Buffer.from(
      JSON.stringify({ ...JSON.parse(inputs.sourcePackage), version: "1.4.0" }),
    );
    fs.writeFileSync(path.join(artifactDirectory, "index.js"), bundle);
    fs.chmodSync(path.join(artifactDirectory, "index.js"), 0o755);
    fs.writeFileSync(path.join(artifactDirectory, "package.json"), preparedPackage);
    const manifest = artifactManifest({
      version: "1.4.0",
      sourcePackage: inputs.sourcePackage,
      lock: inputs.lock,
      preparedPackage,
      bundle,
    });
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    fs.writeFileSync(path.join(artifactDirectory, "manifest.json"), manifestBytes);
    expected = {
      sourceCommit,
      producer,
      planSha256: sha256(planBytes),
      artifactManifestSha256: sha256(manifestBytes),
    };
    env = {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "aditzel/wavespeed-cli",
      GITHUB_REPOSITORY_ID: "1079467744",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: sourceCommit,
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ID: "12345",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_WORKFLOW_REF: producer.workflowRef,
      GITHUB_WORKFLOW_SHA: sourceCommit,
      GITHUB_EVENT_PATH: path.join(cwd, "event.json"),
    };
    fs.writeFileSync(
      env.GITHUB_EVENT_PATH,
      JSON.stringify({
        repository: { full_name: "aditzel/wavespeed-cli", id: 1079467744 },
        ref: "refs/heads/main",
        after: sourceCommit,
        head_commit: { message: "feat: new command" },
      }),
    );
    readGit = (argv) =>
      argv[0] === "ls-remote"
        ? `${sourceCommit}\trefs/heads/main`
        : argv[1] === "--is-shallow-repository"
          ? "false"
          : sourceCommit;
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const options = () => publisherOptions({ cwd, planBytes, artifactDirectory, expected });
  const context = () => ({ ...result(), cwd, branch: { name: "main" } });
  const gates = () => {
    const value = options();
    return {
      value,
      verify: value.plugins.find((item: any) => item.verifyRelease).verifyRelease,
      consume: value.plugins.find((item: any) => item.prepare).prepare,
    };
  };
  const bump = () =>
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      fs.readFileSync(path.join(artifactDirectory, "package.json")),
    );

  it("verifies the completion receipt in its active callback without running publication plugins", () => {
    const receipt = { ...expected, repository: "aditzel/wavespeed-cli", version: "1.4.0", buildNumber: 7 };
    const directory = path.join(cwd, "completion");
    fs.mkdirSync(directory);
    fs.cpSync(artifactDirectory, path.join(directory, "artifact"), { recursive: true });
    fs.writeFileSync(path.join(directory, "release-plan.json"), planBytes);
    const handoff = { schemaVersion: 1, receipt,
      publisher: { jobId: 12, runId: 456, runAttempt: 2, commit: sourceCommit, jobName: "verify-release", mode: "verify" } };
    fs.writeFileSync(path.join(directory, "handoff.json"), JSON.stringify(handoff));
    const callbackEnv = { ...env, JANUS_WAVESPEED_RELEASE_MODE: "verify", GITHUB_EVENT_NAME: "status",
      GITHUB_JOB: "verify-release", GITHUB_RUN_ID: "456" };
    expect(checkHandoff(cwd, directory, callbackEnv).publicationEnabled).toBe(false);
    expect(fs.existsSync(path.join(cwd, "dist"))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, "package.json")).equals(inputs.sourcePackage)).toBe(true);
    expect(() => checkHandoff(cwd, directory, { ...callbackEnv, GITHUB_RUN_ATTEMPT: "3" })).toThrow("another publisher");
    expect(() => checkHandoff(cwd, directory, { ...callbackEnv, JANUS_WAVESPEED_RELEASE_MODE: "" })).toThrow("context");
    fs.appendFileSync(path.join(directory, "artifact/index.js"), "changed");
    expect(() => checkHandoff(cwd, directory, callbackEnv)).toThrow();
  });

  it("uses the exact engine decision and original plugin configuration in forced dry-run", async () => {
    let calls = 0;
    const planned = await planRelease({
      cwd,
      sourceCommit,
      env,
      readGit,
      engine: async (configuration: any, runtime: any) => {
        calls++;
        expect(configuration).toEqual({ ...inputs.configuration, dryRun: true });
        expect(runtime.cwd).toBe(cwd);
        expect(runtime.env).toEqual(env);
        return result();
      },
    });
    expect(calls).toBe(1);
    expect(planned).toEqual(plan);
    expect(fs.readFileSync(path.join(cwd, "package.json")).equals(inputs.sourcePackage)).toBe(true);
  });

  function publicationFixture() {
    const callbackEnv = { ...env, JANUS_WAVESPEED_RELEASE_MODE: "publish", GITHUB_EVENT_NAME: "status",
      GITHUB_JOB: "publish-release", GITHUB_RUN_ID: "456" };
    const handoff = { schemaVersion: 1,
      receipt: { ...expected, repository: "aditzel/wavespeed-cli", version: "1.4.0", buildNumber: 7 },
      publisher: { jobId: 12, runId: 456, runAttempt: 2, commit: sourceCommit, jobName: "publish-release", mode: "publish" } };
    const directory = path.join(cwd, "completion");
    const write = (target: string) => {
      fs.mkdirSync(target);
      fs.cpSync(artifactDirectory, path.join(target, "artifact"), { recursive: true });
      fs.writeFileSync(path.join(target, "release-plan.json"), planBytes);
      fs.writeFileSync(path.join(target, "handoff.json"), JSON.stringify(handoff));
    };
    write(directory);
    const authenticate = async () => readCompletion(directory, callbackEnv, "publish");
    const engine = async (value: any, execution: any) => {
      expect(execution.cwd).toBe(cwd);
      expect(value.dryRun).toBe(false);
      expect(value.ci).toBe(true);
      const ctx = { ...context(), options: value, branch: { name: "main", type: "release" },
        branches: [{ name: "main", type: "release" }] };
      await value.plugins[0].verifyConditions({}, ctx);
      await value.plugins[0].verifyRelease({}, ctx);
      bump(); // Only local fixture metadata; no npm/git/GitHub publish plugin runs.
      await value.plugins.find((item: any) => item.prepare).prepare({}, ctx);
      return { ...result(), releases: [
        { ...result().nextRelease, pluginName: "@semantic-release/npm", channel: "latest",
          url: "https://www.npmjs.com/package/wavespeed-cli/v/1.4.0" },
        { ...result().nextRelease, pluginName: "@semantic-release/github", id: 123,
          url: "https://github.com/aditzel/wavespeed-cli/releases/tag/v1.4.0" },
      ] };
    };
    return { env: callbackEnv, handoff, directory, write, authenticate, engine };
  }

  it("passes the artifact adapter to the publisher engine and reauthenticates at every mutation gate", async () => {
    const fixture = publicationFixture();
    let reads = 0;
    const published = await publishVerified({ cwd, ...fixture, readGit,
      authenticate: async () => { reads++;return fixture.authenticate(); } });
    expect(reads).toBe(4);
    expect(published).toEqual({ sourceCommit, version: "1.4.0", gitTag: "v1.4.0", buildNumber: 7, published: true });
    expect(fs.readFileSync(path.join(cwd, "dist/index.js")).equals(bundle)).toBe(true);
  });

  it("cannot enter the publisher from verification mode or a stale checkout", async () => {
    const fixture = publicationFixture();
    let reads = 0;
    const authenticate = async () => { reads++;return fixture.authenticate(); };
    await expect(publishVerified({ cwd, ...fixture, env: { ...fixture.env, JANUS_WAVESPEED_RELEASE_MODE: "verify" },
      readGit, authenticate })).rejects.toThrow("publisher context");
    await expect(publishVerified({ cwd, ...fixture, readGit: () => "stale", authenticate })).rejects.toThrow("stale or incomplete");
    expect(reads).toBe(0);
  });

  for (const changeAt of [2, 3, 4]) {
    it(`rejects a replaced handoff at authentication ${changeAt} before copying the bundle`, async () => {
      const fixture = publicationFixture();
      let reads = 0;
      await expect(publishVerified({ cwd, ...fixture, readGit, authenticate: async () => {
        const fresh = await fixture.authenticate();
        if (++reads === changeAt) fresh.handoff.receipt.buildNumber++;
        return fresh;
      } })).rejects.toThrow("handoff changed");
      expect(fs.existsSync(path.join(cwd, "dist/index.js"))).toBe(false);
    });
  }

  it("rechecks local artifact bytes after awaiting provider authentication", async () => {
    const fixture = publicationFixture();
    let reads = 0;
    await expect(publishVerified({ cwd, ...fixture, readGit, authenticate: async () => {
      const fresh = await fixture.authenticate();
      if (++reads === 4) fs.appendFileSync(path.join(fixture.directory, "artifact/index.js"), "tampered");
      return fresh;
    } })).rejects.toThrow();
    expect(fs.existsSync(path.join(cwd, "dist/index.js"))).toBe(false);
  });

  it("does not report a no-op or incomplete plugin result as a completed release", async () => {
    const fixture = publicationFixture();
    await expect(publishVerified({ cwd, ...fixture, readGit, engine: async () => false })).rejects.toThrow("every fresh handoff gate");
    await expect(publishVerified({ cwd, ...fixture, readGit, engine: async (...args: any[]) => {
      const value = await fixture.engine(args[0], args[1]);
      value.releases = [{ pluginName: "@semantic-release/npm" }];
      return value;
    } })).rejects.toThrow("npm and GitHub");
  });

  it("rejects a skipped publisher even when the engine includes its plugin name", async () => {
    const fixture = publicationFixture();
    await expect(publishVerified({ cwd, ...fixture, readGit, engine: async (...args: any[]) => {
      const value = await fixture.engine(args[0], args[1]);
      // The pinned dispatcher still attaches pluginName when publish returns false.
      value.releases = [{ pluginName: "@semantic-release/npm" }, { pluginName: "@semantic-release/github" }] as any;
      return value;
    } })).rejects.toThrow("npm and GitHub");
  });

  it("rejects channel addition and accidental engine dry-run before any mutation", async () => {
    for (const change of [{ options: { dryRun: true } }, { branches: [{ name: "main" }, { name: "next" }] },
      { branch: { name: "main", type: "maintenance" } }]) {
      const value = publisherOptions({ cwd, planBytes, artifactDirectory, expected, revalidate: async () => {} });
      expect(() => value.plugins[0].verifyConditions({}, {
        ...context(), options: { dryRun: false }, branch: { name: "main", type: "release" },
        branches: [{ name: "main" }], ...change,
      })).toThrow("live release configuration");
    }
  });

  it("runs each protected refresh with bounded arguments and no publishing tokens in its environment", async () => {
    const fixture = publicationFixture();
    const calls: any[] = [];
    const reader = completionReader({ cwd, env: { ...fixture.env, GITHUB_TOKEN: "private-test-placeholder",
      GH_TOKEN: "private-test-placeholder", BUILDKITE_READER_TOKEN: "private-test-placeholder" },
      policy: "/private/policy", githubToken: "/private/github", buildkiteToken: "/private/buildkite", state: cwd,
      run: (command: string, args: string[], options: any) => {
        calls.push({ command, args, options });
        fixture.write(args.at(-1)!);
      } });
    await reader();await reader();
    expect(calls).toHaveLength(2);
    expect(calls[0].args.at(-1)).not.toBe(calls[1].args.at(-1));
    for (const call of calls) {
      expect(call.command).toBe("python3");
      expect(call.args.slice(0, 3)).toEqual(["-I", "-B", path.join(cwd, ".janus-tools/infrastructure/buildkite-publishers/wavespeed-release.py")]);
      expect(call.options.timeout).toBe(180_000);
      expect(call.options.env.GITHUB_TOKEN).toBeUndefined();
      expect(call.options.env.GH_TOKEN).toBeUndefined();
      expect(call.options.env.BUILDKITE_READER_TOKEN).toBeUndefined();
    }
  });
  it("represents no-release without inventing a version", async () => {
    const planned = await planRelease({
      cwd,
      sourceCommit,
      env,
      readGit,
      engine: async () => false,
    });
    expect(planned.decision).toEqual({ kind: "no-release" });
    expect(verifyPlan(planned, inputs)).toEqual(planned);
    planBytes = Buffer.from(JSON.stringify(planned));
    expected.planSha256 = sha256(planBytes);
    expect(options).toThrow("no-release");
  });
  it("accepts the engine's first-release result", () => {
    const first = result();
    first.lastRelease = {} as any;
    first.nextRelease.version = "1.0.0";
    first.nextRelease.gitTag = "v1.0.0";
    expect(makePlan(first, inputs, producer).decision.lastRelease).toBeNull();
  });
  for (const change of [
    { GITHUB_REPOSITORY: "outsider/wavespeed-cli" },
    { GITHUB_REPOSITORY_ID: "123" },
    { GITHUB_REF: "refs/heads/topic" },
    { GITHUB_SHA: priorCommit },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_HEAD_REF: "topic" },
    { GITHUB_RUN_ATTEMPT: "0" },
    { GITHUB_RUN_ID: "123\n" },
    { GITHUB_WORKFLOW_SHA: priorCommit },
  ]) {
    it(`rejects invalid planner ${Object.keys(change)[0]} before engine invocation`, async () => {
      let called = false;
      await expect(
        planRelease({
          cwd,
          sourceCommit,
          env: { ...env, ...change },
          readGit,
          engine: async () => {
            called = true;
            return result();
          },
        }),
      ).rejects.toThrow();
      expect(called).toBe(false);
    });
  }
  it("rejects shallow checkout and wrong HEAD before engine invocation", async () => {
    for (const bad of ["true", priorCommit])
      await expect(
        planRelease({
          cwd,
          sourceCommit,
          env,
          readGit: () => bad,
          engine: async () => {
            throw new Error("must not run");
          },
        }),
      ).rejects.toThrow("checkout differs");
    await expect(
      planRelease({
        cwd,
        sourceCommit,
        env,
        readGit: (args: string[]) =>
          args[1] === "--is-shallow-repository" ? "true" : readGit(args),
        engine: async () => result(),
      }),
    ).rejects.toThrow("full history");
  });
  it("rejects main advancing during the engine run", async () => {
    let advanced = false;
    await expect(
      planRelease({
        cwd,
        sourceCommit,
        env,
        readGit: (args: string[]) =>
          advanced && args[0] === "ls-remote" ? `${priorCommit}\trefs/heads/main` : readGit(args),
        engine: async () => {
          advanced = true;
          return result();
        },
      }),
    ).rejects.toThrow("current main head");
  });
  it("rejects metadata changes during planning", async () => {
    await expect(
      planRelease({
        cwd,
        sourceCommit,
        env,
        readGit,
        engine: async () => {
          fs.appendFileSync(path.join(cwd, "bun.lock"), "changed");
          return result();
        },
      }),
    ).rejects.toThrow("inputs changed");
  });
  it("preserves the release-commit suppression", async () => {
    const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    event.head_commit.message = "chore(release): 1.4.0";
    fs.writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify(event));
    await expect(
      planRelease({ cwd, sourceCommit, env, readGit, engine: async () => result() }),
    ).rejects.toThrow("Release commits");
  });
  it("accepts normal manual planning and rejects recovery publishing", async () => {
    env.GITHUB_EVENT_NAME = "workflow_dispatch";
    const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    event.inputs = { publish_current_version: "false" };
    fs.writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify(event));
    expect(
      (await planRelease({ cwd, sourceCommit, env, readGit, engine: async () => result() }))
        .producer.event,
    ).toBe("workflow_dispatch");
    event.inputs.publish_current_version = "true";
    fs.writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify(event));
    await expect(
      planRelease({ cwd, sourceCommit, env, readGit, engine: async () => result() }),
    ).rejects.toThrow("Recovery publishing");
  });
  for (const change of [
    (r: any) => {
      r.nextRelease.version = "1.5.0";
      r.nextRelease.gitTag = "v1.5.0";
    },
    (r: any) => {
      r.nextRelease.type = "patch";
    },
    (r: any) => {
      r.nextRelease.gitHead = priorCommit;
    },
    (r: any) => {
      r.lastRelease.gitHead = "c".repeat(40);
    },
    (r: any) => {
      r.commits.push({ hash: "c".repeat(40) });
    },
  ]) {
    it("rejects a stale semantic-release decision before preparation", () => {
      const current = context();
      change(current);
      const { verify, consume } = gates();
      expect(() => verify({}, current)).toThrow();
      expect(() => consume({}, current)).toThrow("must be verified");
      expect(fs.existsSync(path.join(cwd, "dist"))).toBe(false);
    });
  }
  for (const field of ["planSha256", "artifactManifestSha256"]) {
    it(`rejects wrong trusted ${field}`, () => {
      expected[field] = "f".repeat(64);
      expect(options).toThrow();
    });
  }
  it("rejects a different authenticated planner run", () => {
    expected.producer = { ...producer, runAttempt: "3" };
    expect(options).toThrow("Planner run differs");
  });
  it("rejects extra plan fields even when its digest is self-consistent", () => {
    plan.extra = true;
    planBytes = Buffer.from(JSON.stringify(plan));
    expected.planSha256 = sha256(planBytes);
    expect(options).toThrow("schema");
  });
  it("rejects drift in release configuration", () => {
    fs.appendFileSync(path.join(cwd, ".releaserc.json"), " ");
    expect(options).toThrow("configuration changed");
  });
  it("rejects configuration shadowing", () => {
    fs.writeFileSync(path.join(cwd, ".releaserc"), "plugins: []");
    expect(options).toThrow("alternate release configuration");
  });
  it("preserves original plugin order, analyzers and publication settings", () => {
    const { value } = gates();
    const original = inputs.configuration.plugins;
    const remaining = value.plugins.filter(
      (entry: any) => typeof entry === "string" || Array.isArray(entry),
    );
    expect(remaining).toEqual(
      original.map((entry: any) =>
        Array.isArray(entry) && entry[0] === "@semantic-release/exec"
          ? [entry[0], { analyzeCommitsCmd: entry[1].analyzeCommitsCmd }]
          : entry,
      ),
    );
    const consume = value.plugins.findIndex((entry: any) => entry.prepare);
    expect(value.plugins[consume - 1][0]).toBe("@semantic-release/exec");
    expect(value.plugins.slice(consume + 1)).toEqual(original.slice(-2));
    expect(value.branches).toEqual(["main"]);
  });
  it("copies exact bytes after npm preparation without executing the bundle", () => {
    const { verify, consume } = gates();
    verify({}, context());
    bump();
    consume({}, context());
    expect(fs.readFileSync(path.join(cwd, "dist/index.js")).equals(bundle)).toBe(true);
    expect(fs.statSync(path.join(cwd, "dist/index.js")).mode & 0o777).toBe(0o755);
    expect(() => consume({}, context())).toThrow("must be verified");
  });
  it("rejects package drift after npm preparation", () => {
    const { verify, consume } = gates();
    verify({}, context());
    bump();
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    pkg.scripts.postinstall = "untrusted";
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify(pkg));
    expect(() => consume({}, context())).toThrow("npm preparation differs");
  });
  it("rechecks artifact bytes immediately before consumption", () => {
    const { verify, consume } = gates();
    verify({}, context());
    bump();
    fs.appendFileSync(path.join(artifactDirectory, "index.js"), "tampered");
    expect(() => consume({}, context())).toThrow();
    expect(fs.existsSync(path.join(cwd, "dist"))).toBe(false);
  });
  it("rejects extra stale dist files and symlinked output", () => {
    const { verify, consume } = gates();
    verify({}, context());
    bump();
    fs.mkdirSync(path.join(cwd, "dist"));
    fs.writeFileSync(path.join(cwd, "dist/extra.js"), "old");
    expect(() => consume({}, context())).toThrow("Unexpected existing");
    fs.rmSync(path.join(cwd, "dist"), { recursive: true });
    fs.symlinkSync(artifactDirectory, path.join(cwd, "dist"));
    const fresh = gates;
    // Restore pre-prepare metadata to obtain a fresh decision gate.
    fs.writeFileSync(path.join(cwd, "package.json"), inputs.sourcePackage);
    const again = fresh();
    again.verify({}, context());
    bump();
    expect(() => again.consume({}, context())).toThrow("real directory");
  });
  it("allows fresh release notes while preserving the version/source decision", () => {
    const current = context();
    current.nextRelease.notes = "Notes regenerated on the publication date";
    expect(() => verifyDecision(plan, current)).not.toThrow();
  });

  for (const [message, changed, expectedType, expectedVersion] of [
    ["feat: new command", "README.md", "minor", "1.4.0"],
    ["fix: correct behavior", "README.md", "patch", "1.3.6"],
    ["build: update tooling", "README.md", "patch", "1.3.6"],
    ["refactor: internal work", "README.md", "patch", "1.3.6"],
    [
      "feat: incompatible change\n\nBREAKING CHANGE: removed old command",
      "README.md",
      "major",
      "2.0.0",
    ],
    ["docs: describe changes", "src/index.ts", "patch", "1.3.6"],
    ["docs: describe changes", "README.md", undefined, undefined],
    ["fix: correct behavior [skip release]", "README.md", undefined, undefined],
    ["fix: correct behavior [skip release]", "src/index.ts", "patch", "1.3.6"],
  ] as const) {
    it(`preserves actual analyzer/fallback decision for ${message.split("\n")[0]} and ${changed}`, async () => {
      fs.mkdirSync(path.join(cwd, "scripts/release"), { recursive: true });
      fs.copyFileSync(
        path.join(repo, "scripts/release/fallback-analyze.mjs"),
        path.join(cwd, "scripts/release/fallback-analyze.mjs"),
      );
      const shim = path.join(cwd, "bin");
      fs.mkdirSync(shim);
      fs.writeFileSync(
        path.join(shim, "git"),
        `#!/bin/sh\ncase "$1" in\ndescribe) printf 'v1.3.5\\n';;\ndiff) printf '%s\\n' '${changed}';;\n*) exit 71;;\nesac\n`,
        { mode: 0o755 },
      );
      const logger: any = {
        log() {},
        warn() {},
        success() {},
        error() {},
        scope() {
          return logger;
        },
      };
      const runtime: any = {
        ...context(),
        commits: [{ hash: sourceCommit, message }],
        options: { ...inputs.configuration, dryRun: true },
        env: { PATH: `${shim}:${process.env.PATH}` },
        logger,
        stdout: process.stdout,
        stderr: process.stderr,
      };
      const pipeline = await plugins(runtime, {});
      const type = await pipeline.analyzeCommits(runtime);
      expect(type).toBe(expectedType);
      if (type) {
        const version = getNextVersion({
          ...runtime,
          branch: { type: "release" },
          nextRelease: { type, channel: null },
        });
        expect(version).toBe(expectedVersion);
        const planned = makePlan(
          {
            ...runtime,
            nextRelease: { ...runtime.nextRelease, type, version, gitTag: `v${version}` },
          },
          inputs,
          producer,
        );
        expect(planned.decision.version).toBe(expectedVersion);
      }
    });
  }

  for (const mode of ["dry-run", "unwired", "refresh", "reject-refresh"] as const) {
    it(`runs through the pinned engine plugin dispatcher with ${mode}`, async () => {
      const dryRun = mode === "dry-run";
      const events: string[] = [];
      const revalidate = mode === "refresh" || mode === "reject-refresh" ? async (phase: string) => {
        await Promise.resolve();
        events.push(`refresh:${phase}`);
        if (mode === "reject-refresh" && phase === "prepare") throw new Error("Provider attempt superseded");
      } : undefined;
      const value = publisherOptions({ cwd, planBytes, artifactDirectory, expected, revalidate });
      const shim = path.join(cwd, "bin");
      fs.mkdirSync(shim);
      fs.writeFileSync(path.join(shim, "git"), `#!/bin/sh\nprintf '%s\\n' '${sourceCommit}'\n`, {
        mode: 0o755,
      });
      const savedPath = process.env.PATH;
      // Test-only Git read adapter: the dispatcher asks for HEAD after prepare.
      // No fixture or real repository refs are created or changed.
      process.env.PATH = `${shim}:${savedPath}`;
      const logger: any = {
        log() {},
        warn() {},
        success() {},
        error() {},
        scope() {
          return logger;
        },
      };
      try {
        const adapted = value.plugins.map((entry: any) => {
          if (entry.verifyRelease || entry.prepare) return entry;
          const name = Array.isArray(entry) ? entry[0] : entry;
          if (name === "@semantic-release/npm")
            return {
              prepare() {
                events.push("npm-version");
                bump();
              },
              publish() {
                events.push("npm-publish");
              },
            };
          if (name === "@semantic-release/git")
            return {
              prepare() {
                events.push("git-push");
                expect(fs.readFileSync(path.join(cwd, "dist/index.js")).equals(bundle)).toBe(true);
              },
            };
          if (name === "@semantic-release/changelog")
            return {
              prepare() {
                events.push("changelog");
              },
            };
          return { verifyConditions() {} };
        });
        const runtime: any = {
          ...context(),
          branch: { name: "main", type: "release" },
          branches: [{ name: "main", type: "release" }],
          options: { plugins: adapted, dryRun },
          env: {},
          logger,
          stdout: process.stdout,
          stderr: process.stderr,
        };
        const pipeline = await plugins(runtime, {});
        await pipeline.verifyConditions(runtime);
        await pipeline.verifyRelease(runtime);
        if (mode === "reject-refresh") {
          await expect(pipeline.prepare(runtime)).rejects.toThrow("Provider attempt superseded");
          expect(events).toEqual(["refresh:verifyConditions", "refresh:verifyRelease", "changelog",
            "npm-version", "refresh:prepare"]);
          expect(fs.existsSync(path.join(cwd, "dist/index.js"))).toBe(false);
          return;
        }
        await pipeline.prepare(runtime);
        await pipeline.publish(runtime);
        expect(events).toEqual(
          dryRun ? [] : mode === "refresh"
            ? ["refresh:verifyConditions", "refresh:verifyRelease", "changelog", "npm-version",
              "refresh:prepare", "git-push", "npm-publish"]
            : ["changelog", "npm-version", "git-push", "npm-publish"],
        );
        expect(fs.existsSync(path.join(cwd, "dist/index.js"))).toBe(!dryRun);
      } finally {
        process.env.PATH = savedPath;
      }
    });
  }
});

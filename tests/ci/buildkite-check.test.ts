import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Call = { command: string; cwd: string; env: Record<string, string> };
type Settings = {
  version?: string;
  fail?: string;
  hang?: boolean;
  orphan?: boolean;
  invalidSuccess?: boolean;
  invalidMessage?: string;
};
const modes = ["test", "validate-implementation", "release-test", "release-build"] as const;
const releaseBuildCommand = "bun scripts/release/build-versioned.mjs 9.8.7";
const modeArgs = (mode: string) => mode === "release-build" ? [mode, "9.8.7"] : [mode];
const helps = ["generate", "edit", "generate-sequential", "edit-sequential"];
const releaseTestCommands = [
  "bun install --frozen-lockfile",
  "bun run build",
  "bun test",
  "cli --help",
];
const testCommands = [
  ...releaseTestCommands,
  ...helps.map((name) => `cli ${name} --help`),
];
const validationCommands = [
  "bun install --frozen-lockfile",
  "bun run build",
  ...helps.map((name) => `cli ${name} --help`),
  "cli edit --help",
  "cli edit-sequential --help",
  "cli edit",
  "cli edit -p test",
  "cli edit -p test -i https://example.com/test.jpg -s invalid",
];

describe("protected Buildkite checks", () => {
  let directory: string;
  let checkout: string;
  let trace: string;
  let pids: string;
  let settings: string;
  const children = new Set<ReturnType<typeof spawn>>();

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "wavespeed-wrapper-test-"));
    checkout = path.join(directory, "checkout");
    trace = path.join(directory, "trace.jsonl");
    pids = path.join(directory, "pids.jsonl");
    settings = path.join(directory, "settings.json");
    for (const name of [
      "checkout/scripts/buildkite",
      "checkout/dist",
      "bin",
      "tmp",
      "original-home",
    ])
      fs.mkdirSync(path.join(directory, name), { recursive: true });
    fs.writeFileSync(path.join(directory, "original-home/keep"), "untouched");
    fs.copyFileSync(
      process.env.WAVESPEED_WRAPPER_UNDER_TEST ||
        path.join(import.meta.dir, "../../scripts/buildkite/check.sh"),
      path.join(checkout, "scripts/buildkite/check.sh"),
    );
    const python = Bun.which("python3");
    if (!python) throw new Error("Python 3 is required for wrapper fixtures");
    fs.symlinkSync(python, path.join(directory, "bin/python3"));
    fs.writeFileSync(settings, "{}");
    const descendant = `process.on("SIGTERM", () => {}); process.on("SIGINT", () => {}); require("node:fs").appendFileSync(${JSON.stringify(pids)}, process.pid + "\\n"); setInterval(() => {}, 1000);`;
    const child = `process.on("SIGTERM", () => {}); process.on("SIGINT", () => {}); require("node:fs").appendFileSync(${JSON.stringify(pids)}, process.pid + "\\n"); Bun.spawn([process.execPath, "-e", ${JSON.stringify(descendant)}], {stdout:"inherit",stderr:"inherit"}); setInterval(() => {}, 1000);`;
    const executable = (kind: string) => `#!${process.execPath}
const fs = require("node:fs"), args = process.argv.slice(2), settings = JSON.parse(fs.readFileSync(${JSON.stringify(settings)}, "utf8"));
if (${JSON.stringify(kind)} === "bun" && args[0] === "--version") { console.log(settings.version || "1.3.14"); process.exit(0); }
const command = ${JSON.stringify(kind)} + " " + args.join(" ");
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({command,cwd:process.cwd(),env:process.env}) + "\\n");
if ((command === "bun install --frozen-lockfile" || command === ${JSON.stringify(releaseBuildCommand)}) && (settings.hang || settings.orphan)) {
  process.on("SIGTERM", () => {}); process.on("SIGINT", () => {});
  Bun.spawn([process.execPath, "-e", ${JSON.stringify(child)}], {stdout:"inherit",stderr:"inherit"});
  while (!fs.existsSync(${JSON.stringify(pids)}) || fs.readFileSync(${JSON.stringify(pids)}, "utf8").trim().split("\\n").length < 2) await Bun.sleep(10);
  if (settings.orphan) process.exit(71);
  setInterval(() => {}, 1000);
} else {
  if (command === settings.fail) process.exit(71);
  if (${JSON.stringify(kind)} === "cli" && !args.includes("--help")) {
    console.error(settings.invalidMessage || (args.length === 1 ? "Prompt is required" : args.length === 3 ? "Images are required" : "Size must be WIDTH"));
    process.exit(settings.invalidSuccess ? 0 : 1);
  }
  if (${JSON.stringify(kind)} === "cli") console.log("sync mode; file paths");
}
`;
    fs.writeFileSync(path.join(directory, "bin/bun"), executable("bun"), { mode: 0o755 });
    fs.writeFileSync(path.join(checkout, "dist/index.js"), executable("cli"), { mode: 0o755 });
  });

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      if (process.platform === "linux")
        return !/^State:\s+Z/m.test(fs.readFileSync(`/proc/${pid}/status`, "utf8"));
      return true;
    } catch {
      return false;
    }
  };
  const waitUntil = async (predicate: () => boolean, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("Fixture readiness/cleanup deadline exceeded");
      await Bun.sleep(20);
    }
  };
  const descendantPids = () =>
    fs.existsSync(pids) ? fs.readFileSync(pids, "utf8").trim().split("\n").map(Number) : [];
  afterEach(() => {
    for (const child of children) {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
    for (const pid of descendantPids()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    children.clear();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const start = (args: string[], values: Settings = {}, extra: Record<string, string> = {}) => {
    fs.writeFileSync(settings, JSON.stringify(values));
    const child = spawn("/bin/bash", [path.join(checkout, "scripts/buildkite/check.sh"), ...args], {
      cwd: directory,
      detached: true,
      env: {
        PATH: `${path.join(directory, "bin")}:/usr/bin:/bin`,
        HOME: path.join(directory, "original-home"),
        TMPDIR: path.join(directory, "tmp"),
        INHERITED_SECRET: "must-not-leak",
        NODE_OPTIONS: "--conditions=fixture",
        ...extra,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    let output = "";
    child.stdout?.on("data", (data) => {
      output += data.toString();
    });
    child.stderr?.on("data", (data) => {
      output += data.toString();
    });
    const done = new Promise<{ code: number | null; signal: string | null; output: string }>(
      (resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code, signal) => {
          children.delete(child);
          resolve({ code, signal, output });
        });
      },
    );
    return { child, done };
  };
  const calls = (): Call[] =>
    fs.existsSync(trace)
      ? fs
          .readFileSync(trace, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  const assertClean = () => {
    expect(fs.readdirSync(path.join(directory, "tmp"))).toEqual([]);
    expect(fs.readFileSync(path.join(directory, "original-home/keep"), "utf8")).toBe("untouched");
    for (const call of calls()) {
      expect(call.env.HOME).not.toBe(path.join(directory, "original-home"));
      expect(fs.existsSync(call.env.HOME)).toBe(false);
    }
  };

  for (const mode of modes) {
    it(`${mode} preserves commands and isolates configuration and credentials`, async () => {
      const result = await start(modeArgs(mode)).done;
      expect(result.code).toBe(0);
      expect(calls().map((call) => call.command)).toEqual(
        mode === "test"
          ? testCommands
          : mode === "release-build"
            ? [releaseBuildCommand]
          : mode === "release-test"
            ? releaseTestCommands
            : validationCommands,
      );
      for (const call of calls()) {
        expect(call.cwd).toBe(fs.realpathSync(checkout));
        expect(call.env.CI).toBe("true");
        expect(call.env.INHERITED_SECRET).toBeUndefined();
        expect(call.env.NODE_OPTIONS).toBeUndefined();
        const invalid = call.command.startsWith("cli edit") && !call.command.includes("--help");
        expect(call.env.WAVESPEED_API_KEY).toBe(invalid ? "test-key" : undefined);
      }
      assertClean();
    });
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      it(`${mode} handles ${signal}, stops signal-ignoring descendants and removes temporary state`, async () => {
        const running = start(modeArgs(mode), { hang: true });
        await waitUntil(() => descendantPids().length === 2);
        const descendants = descendantPids();
        if (!running.child.pid) throw new Error("Wrapper did not start");
        process.kill(running.child.pid, signal);
        const result = await Promise.race([
          running.done,
          Bun.sleep(5000).then(() => {
            throw new Error("Cancellation exceeded deadline");
          }),
        ]);
        expect(result.signal).toBeNull();
        expect(result.code).toBe(signal === "SIGTERM" ? 143 : 130);
        await waitUntil(() => descendants.every((pid) => !alive(pid)));
        expect(calls().map((call) => call.command)).toEqual([mode === "release-build" ? releaseBuildCommand : testCommands[0]]);
        assertClean();
      }, 10_000);
    }
    it(`${mode} retains ordinary failure and removes leftover descendants`, async () => {
      const result = await start(modeArgs(mode), { orphan: true }).done;
      expect(result.code).toBe(71);
      await waitUntil(() => descendantPids().every((pid) => !alive(pid)));
      expect(calls().map((call) => call.command)).toEqual([mode === "release-build" ? releaseBuildCommand : testCommands[0]]);
      assertClean();
    }, 10_000);
  }
  for (const command of testCommands) {
    it(`retains failure at ${command} and prevents later stages`, async () => {
      expect((await start(["test"], { fail: command }).done).code).toBe(71);
      expect(calls().map((call) => call.command)).toEqual(
        testCommands.slice(0, testCommands.indexOf(command) + 1),
      );
      assertClean();
    });
  }
  for (const command of releaseTestCommands) {
    it(`release-test retains failure at ${command} and prevents later stages`, async () => {
      expect((await start(["release-test"], { fail: command }).done).code).toBe(71);
      expect(calls().map((call) => call.command)).toEqual(
        releaseTestCommands.slice(0, releaseTestCommands.indexOf(command) + 1),
      );
      assertClean();
    });
  }
  for (const extra of [{ WAVESPEED_LIVE_E2E: "1" }, { WAVESPEED_API_KEY: "real-inherited-key" }]) {
    it(`rejects inherited ${Object.keys(extra)[0]} before a stage`, async () => {
      expect((await start(["test"], {}, extra).done).code).toBe(1);
      expect(calls()).toEqual([]);
      assertClean();
    });
  }
  for (const name of [
    ".env",
    ".env.local",
    ".env.test",
    ".env.test.local",
    ".env.development",
    ".env.development.local",
    ".env.production",
    ".env.production.local",
    ".wavespeedrc.json",
  ]) {
    it(`rejects ${name} before Bun can load configuration`, async () => {
      fs.writeFileSync(path.join(checkout, name), "WAVESPEED_API_KEY=fixture-only");
      expect((await start(["test"]).done).code).toBe(1);
      expect(calls()).toEqual([]);
      assertClean();
    });
  }
  it("rejects a dangling dotenv symlink without traversing it", async () => {
    fs.symlinkSync(path.join(directory, "absent-secret"), path.join(checkout, ".env"));
    expect((await start(["test"]).done).code).toBe(1);
    expect(calls()).toEqual([]);
  });
  it("rejects a wrong Bun version", async () => {
    expect((await start(["test"], { version: "1.3.13" }).done).code).toBe(1);
    expect(calls()).toEqual([]);
    assertClean();
  });
  for (const args of [[], ["publish"], ["test", "extra"], ["release-build"],
    ["release-build", "1.2.3", "extra"], ...["v1.2.3", "01.2.3", "1.2.3-beta.1", "1.2.3+meta", "-1.2.3", "1.2.3;id", "1.2.3\n", "999999999.1.1"].map((version) => ["release-build", version])]) {
    it(`rejects unsupported argv ${JSON.stringify(args)}`, async () => {
      expect((await start(args).done).code).toBe(2);
      expect(calls()).toEqual([]);
    });
  }
  for (const invalid of [
    { invalidSuccess: true },
    { invalidMessage: "unexpected network response" },
  ]) {
    it(`rejects an invalid-input regression ${JSON.stringify(invalid)}`, async () => {
      expect((await start(["validate-implementation"], invalid).done).code).toBe(1);
      expect(calls().length).toBe(9);
      assertClean();
    });
  }
});

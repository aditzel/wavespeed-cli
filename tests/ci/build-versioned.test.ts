import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("versioned build failure boundaries", () => {
  let root: string;
  let checkout: string;
  let tmp: string;
  const pkg = {
    name: "wavespeed-cli",
    version: "1.3.5",
    scripts: { build: "bun build src/index.ts --outdir dist" },
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "wavespeed-builder-test-"));
    checkout = path.join(root, "checkout");
    tmp = path.join(root, "tmp");
    for (const directory of ["checkout/scripts/release", "bin", "tmp"])
      fs.mkdirSync(path.join(root, directory), { recursive: true });
    for (const file of ["build-versioned.mjs", "versioned-artifact.mjs"]) {
      fs.copyFileSync(
        path.join(import.meta.dir, "../../scripts/release", file),
        path.join(checkout, "scripts/release", file),
      );
    }
    fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify(pkg));
    fs.writeFileSync(path.join(checkout, "bun.lock"), "frozen fixture lock");
    fs.writeFileSync(path.join(root, "bin/node"), "#!/bin/sh\necho v22.23.3\n", { mode: 0o755 });
    // Never install packages in these fixtures: prove an installation failure
    // leaves source metadata unchanged and produces no usable artifact.
    fs.writeFileSync(path.join(root, "bin/bun"), "#!/bin/sh\nexit 71\n", { mode: 0o755 });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  async function reject(message: string, args = ["9.8.7"]) {
    const child = Bun.spawn([process.execPath, "scripts/release/build-versioned.mjs", ...args], {
      cwd: checkout,
      env: { PATH: `${root}/bin:/usr/bin:/bin`, TMPDIR: tmp },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(1);
    expect(stdout + stderr).toContain(message);
    expect(fs.readdirSync(tmp)).toEqual([]);
    expect(fs.readFileSync(path.join(checkout, "bun.lock"), "utf8")).toBe("frozen fixture lock");
    return stdout + stderr;
  }
  it("cleans failed installation and leaves the source version unchanged", async () => {
    await reject("command failed (71)");
    expect(fs.readFileSync(path.join(checkout, "package.json"), "utf8")).toBe(JSON.stringify(pkg));
    expect(fs.readdirSync(path.join(checkout, "out"))).toEqual([]);
  });
  it("produces an executable artifact even with umask 077", async () => {
    fs.writeFileSync(
      path.join(root, "bin/node"),
      `#!${process.execPath}
const fs = require("node:fs"), args = process.argv.slice(2);
if (args[0] === "--version") console.log("v22.23.3");
else if (args[1] === "--version") console.log("11.16.0");
else if (args[1] === "version") {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.version = args[2]; fs.writeFileSync("package.json", JSON.stringify(pkg));
} else process.exit(71);
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(root, "bin/bun"),
      `#!${process.execPath}
const fs = require("node:fs"), args = process.argv.slice(2);
if (args[0] === "run" && args[1] === "build") {
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  fs.mkdirSync("dist");
  fs.writeFileSync("dist/index.js", ${JSON.stringify(`#!${process.execPath}\nconsole.log(`)} + JSON.stringify(version) + ");\\n");
  fs.chmodSync("dist/index.js", 0o755);
} else if (args[0] !== "install" && args[0] !== "scripts/release/check-mcp-version.mjs") process.exit(71);
`,
      { mode: 0o755 },
    );
    const child = Bun.spawn(
      [
        "/bin/sh",
        "-c",
        'umask 077; exec "$@"',
        "fixture",
        process.execPath,
        "scripts/release/build-versioned.mjs",
        "9.8.7",
      ],
      {
        cwd: checkout,
        env: { PATH: `${root}/bin:/usr/bin:/bin`, TMPDIR: tmp },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, error: stderr.trim() }).toEqual({ code: 0, error: "" });
    expect(stdout).toContain("Versioned build ready");
    expect(fs.statSync(path.join(checkout, "out/release/index.js")).mode & 0o777).toBe(0o755);
    expect(fs.readdirSync(tmp)).toEqual([]);
    expect(fs.readFileSync(path.join(checkout, "package.json"), "utf8")).toBe(JSON.stringify(pkg));
  });
  for (const name of [".npmrc", "package-lock.json", "npm-shrinkwrap.json"]) {
    it(`rejects unreviewed ${name} before installation`, async () => {
      fs.writeFileSync(path.join(checkout, name), "fixture");
      const output = await reject(`requires no ${name}`);
      expect(output).not.toContain("bun install");
    });
  }
  it("rejects lifecycle hooks without executing them", async () => {
    fs.writeFileSync(
      path.join(checkout, "package.json"),
      JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, version: "exit 0" } }),
    );
    expect(await reject("Unsupported release lifecycle hook")).not.toContain("bun install");
  });
  it("rejects source symlinks and cleans the partial copy", async () => {
    fs.symlinkSync(path.join(root, "absent"), path.join(checkout, "secret"));
    expect(await reject("only regular files")).not.toContain("bun install");
    expect(fs.readdirSync(path.join(checkout, "out"))).toEqual([]);
  });
  it("preserves existing output and refuses to overwrite it", async () => {
    fs.mkdirSync(path.join(checkout, "out/release"), { recursive: true });
    fs.writeFileSync(path.join(checkout, "out/release/keep"), "keep");
    await reject("Release output already exists");
    expect(fs.readFileSync(path.join(checkout, "out/release/keep"), "utf8")).toBe("keep");
  });
  it("rejects a symlinked output directory", async () => {
    fs.symlinkSync(tmp, path.join(checkout, "out"));
    await reject("Output root must be a real directory");
  });
  for (const args of [[], ["1.2.3", "extra"], ["1.2.3\n"]]) {
    it(`rejects invalid input ${JSON.stringify(args)} without creating output`, async () => {
      await reject("Expected", args);
      expect(fs.existsSync(path.join(checkout, "out"))).toBe(false);
    });
  }
});

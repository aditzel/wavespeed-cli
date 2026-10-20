import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { artifactManifest, releaseVersion, verifyArtifact } from "./versioned-artifact.mjs";

// Run only through scripts/buildkite/check.sh: its sanitized environment and
// process-group supervisor cover installation, build, MCP checks and cleanup.
async function main() {
  if (process.argv.length !== 3) throw new Error("Expected exactly one version");
  const version = releaseVersion(process.argv[2]);
  const source = path.resolve(import.meta.dir, "../..");
  if (process.cwd() !== source) throw new Error("Run from the repository root");
  for (const name of [".npmrc", "package-lock.json", "npm-shrinkwrap.json"]) {
    if (
      fs.existsSync(path.join(source, name)) ||
      fs.lstatSync(path.join(source, name), { throwIfNoEntry: false })
    ) {
      throw new Error(`Release build requires no ${name}`);
    }
  }
  const sourcePackage = fs.readFileSync(path.join(source, "package.json"));
  const lock = fs.readFileSync(path.join(source, "bun.lock"));
  const pkg = JSON.parse(sourcePackage.toString("utf8"));
  // Adding release lifecycle hooks requires explicit migration review; do not
  // silently skip hooks or run publisher hooks on the build worker.
  for (const hook of [
    "preversion",
    "version",
    "postversion",
    "prepublish",
    "prepare",
    "prepublishOnly",
    "prepack",
    "postpack",
    "publish",
    "postpublish",
  ]) {
    if (Object.hasOwn(pkg.scripts || {}, hook))
      throw new Error(`Unsupported release lifecycle hook: ${hook}`);
  }
  const outputRoot = path.join(source, "out");
  if (!fs.existsSync(outputRoot)) fs.mkdirSync(outputRoot);
  if (!fs.lstatSync(outputRoot).isDirectory())
    throw new Error("Output root must be a real directory");
  const output = path.join(outputRoot, "release");
  if (fs.lstatSync(output, { throwIfNoEntry: false }))
    throw new Error("Release output already exists");
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "wavespeed-versioned-"));
  let staging;
  try {
    const work = path.join(state, "checkout");
    function copy(from, to, root = false) {
      const stat = fs.lstatSync(from);
      if (stat.isDirectory()) {
        fs.mkdirSync(to);
        for (const name of fs.readdirSync(from)) {
          if (root && [".git", "node_modules", "dist", "out"].includes(name)) continue;
          copy(path.join(from, name), path.join(to, name));
        }
      } else if (stat.isFile()) {
        fs.copyFileSync(from, to);
        fs.chmodSync(to, stat.mode & 0o777);
      } else {
        throw new Error("Release source must contain only regular files and directories");
      }
    }
    copy(source, work, true);
    async function run(argv, capture = false) {
      console.log(`release-build: ${argv.join(" ")}`);
      const child = Bun.spawn(argv, {
        cwd: work,
        env: process.env,
        stdin: "ignore",
        stdout: capture ? "pipe" : "inherit",
        stderr: "inherit",
      });
      const text = capture ? await new Response(child.stdout).text() : "";
      const code = await child.exited;
      if (code !== 0) throw new Error(`Release build command failed (${code}): ${argv[0]}`);
      return text.trim();
    }
    if (!/^v22\./.test(await run(["node", "--version"], true)))
      throw new Error("Node 22 is required");
    await run(["bun", "install", "--frozen-lockfile"]);
    const npm = ["node", "node_modules/npm/bin/npm-cli.js"];
    if ((await run([...npm, "--version"], true)) !== "11.16.0")
      throw new Error("npm 11.16.0 is required");
    await run([...npm, "version", version, "--no-git-tag-version", "--allow-same-version"]);
    await run(["bun", "run", "build"]);
    if ((await run(["./dist/index.js", "--version"], true)) !== version)
      throw new Error("CLI version mismatch");
    await run(["bun", "scripts/release/check-mcp-version.mjs", version]);
    const preparedPackage = fs.readFileSync(path.join(work, "package.json"));
    const bundleFile = path.join(work, "dist/index.js");
    if (!fs.lstatSync(bundleFile).isFile()) throw new Error("Build must produce a regular bundle");
    if (!fs.readFileSync(path.join(work, "bun.lock")).equals(lock))
      throw new Error("Release build changed the frozen lockfile");
    const bundle = fs.readFileSync(bundleFile);
    const manifest = artifactManifest({ version, sourcePackage, lock, preparedPackage, bundle });
    staging = fs.mkdtempSync(path.join(outputRoot, ".release-"));
    fs.writeFileSync(path.join(staging, "index.js"), bundle, { mode: 0o755 });
    fs.chmodSync(path.join(staging, "index.js"), 0o755);
    fs.writeFileSync(path.join(staging, "package.json"), preparedPackage);
    fs.writeFileSync(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    verifyArtifact(staging, { version, sourcePackage, lock });
    fs.renameSync(staging, output);
    staging = undefined;
    console.log(`Versioned build ready: ${output}`);
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

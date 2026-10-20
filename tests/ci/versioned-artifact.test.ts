import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  artifactManifest,
  releaseVersion,
  verifyArtifact,
} from "../../scripts/release/versioned-artifact.mjs";

describe("versioned release artifact", () => {
  let root: string;
  let directory: string;
  const pkg = { name: "wavespeed-cli", version: "1.3.5", bin: { wavespeed: "dist/index.js" } };
  const sourcePackage = Buffer.from(JSON.stringify(pkg));
  const lock = Buffer.from("frozen dependency inputs");
  const version = "9.8.7";
  const preparedPackage = Buffer.from(JSON.stringify({ ...pkg, version }));
  const bundle = Buffer.from("#!/usr/bin/env bun\nconsole.log('9.8.7');\n");
  const expected = { version, sourcePackage, lock };
  const write = (name: string, bytes: string | Buffer) =>
    fs.writeFileSync(path.join(directory, name), bytes);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "wavespeed-artifact-test-"));
    directory = path.join(root, "artifact");
    fs.mkdirSync(directory);
    write("index.js", bundle);
    fs.chmodSync(path.join(directory, "index.js"), 0o755);
    write("package.json", preparedPackage);
    write(
      "manifest.json",
      JSON.stringify(artifactManifest({ ...expected, preparedPackage, bundle })),
    );
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("returns exact versioned bytes without modifying source metadata", () => {
    const result = verifyArtifact(directory, expected);
    expect(result.bundle.equals(bundle)).toBe(true);
    expect(result.preparedPackage.equals(preparedPackage)).toBe(true);
    expect(JSON.parse(sourcePackage.toString()).version).toBe("1.3.5");
  });
  for (const version of ["0.0.0", "1.3.5", "99999999.1.0"]) {
    it(`accepts canonical stable version ${version}`, () =>
      expect(releaseVersion(version)).toBe(version));
  }
  for (const version of [
    undefined,
    123,
    "",
    "v1.2.3",
    "01.2.3",
    "1.2",
    "1.2.3-beta",
    "1.2.3+metadata",
    "1.2.3\n",
    "1.2.3;id",
    "999999999.1.0",
  ]) {
    it(`rejects invalid version ${JSON.stringify(version)}`, () =>
      expect(() => releaseVersion(version)).toThrow());
  }
  for (const name of ["index.js", "package.json", "manifest.json"]) {
    it(`rejects corruption of ${name}`, () => {
      fs.appendFileSync(path.join(directory, name), "corruption");
      expect(() => verifyArtifact(directory, expected)).toThrow();
    });
    it(`rejects missing ${name}`, () => {
      fs.unlinkSync(path.join(directory, name));
      expect(() => verifyArtifact(directory, expected)).toThrow();
    });
    it(`rejects symlinked ${name}`, () => {
      const outside = path.join(root, "outside");
      fs.renameSync(path.join(directory, name), outside);
      fs.symlinkSync(outside, path.join(directory, name));
      expect(() => verifyArtifact(directory, expected)).toThrow();
    });
  }
  it("rejects a symlinked artifact directory", () => {
    const link = path.join(root, "link");
    fs.symlinkSync(directory, link);
    expect(() => verifyArtifact(link, expected)).toThrow();
  });
  for (const difference of [
    { version: "9.8.8" },
    { sourcePackage: Buffer.from(JSON.stringify({ ...pkg, description: "changed source" })) },
    { lock: Buffer.from("changed lock") },
  ]) {
    it(`rejects changed expected ${Object.keys(difference)[0]}`, () =>
      expect(() => verifyArtifact(directory, { ...expected, ...difference })).toThrow());
  }
  it("rejects a forged package change even with self-consistent digests", () => {
    const altered = Buffer.from(
      JSON.stringify({ ...pkg, version, scripts: { postinstall: "untrusted" } }),
    );
    expect(() => artifactManifest({ ...expected, preparedPackage: altered, bundle })).toThrow();
  });
  it("rejects another package identity", () => {
    expect(() =>
      artifactManifest({
        ...expected,
        sourcePackage: Buffer.from(JSON.stringify({ ...pkg, name: "other" })),
        preparedPackage,
        bundle,
      }),
    ).toThrow();
  });
  it("rejects empty bundles", () =>
    expect(() =>
      artifactManifest({ ...expected, preparedPackage, bundle: Buffer.alloc(0) }),
    ).toThrow());
  it("rejects unexpected members", () => {
    write("extra", "not allowed");
    expect(() => verifyArtifact(directory, expected)).toThrow();
  });
  it("rejects extra manifest claims", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    write("manifest.json", JSON.stringify({ ...manifest, authenticated: true }));
    expect(() => verifyArtifact(directory, expected)).toThrow();
  });
  it("rejects wrong executable permissions", () => {
    fs.chmodSync(path.join(directory, "index.js"), 0o644);
    expect(() => verifyArtifact(directory, expected)).toThrow();
  });
  it("rejects oversized metadata", () => {
    write("manifest.json", " ".repeat(8193));
    expect(() => verifyArtifact(directory, expected)).toThrow();
  });
});

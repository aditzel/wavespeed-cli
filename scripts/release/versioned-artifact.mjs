import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export function releaseVersion(value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !/^(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})$/.test(value)
  ) {
    throw new Error("Expected a canonical stable release version");
  }
  return value;
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function artifactManifest({ version, sourcePackage, lock, preparedPackage, bundle }) {
  releaseVersion(version);
  const original = JSON.parse(sourcePackage.toString("utf8"));
  const prepared = JSON.parse(preparedPackage.toString("utf8"));
  if (original.name !== "wavespeed-cli" || !isDeepStrictEqual(prepared, { ...original, version })) {
    throw new Error("Prepared package must change only the Wavespeed version");
  }
  if (!bundle.length) throw new Error("Release bundle is empty");
  return {
    schemaVersion: 1,
    version,
    sourcePackageSha256: sha256(sourcePackage),
    lockSha256: sha256(lock),
    preparedPackageSha256: sha256(preparedPackage),
    bundleSha256: sha256(bundle),
  };
}

// Integrity validation only. A protected provider receipt must authenticate these
// bytes and the complete source commit before any publisher may consume them.
export function verifyArtifact(directory, { version, sourcePackage, lock }) {
  if (
    !fs.lstatSync(directory).isDirectory() ||
    !isDeepStrictEqual(fs.readdirSync(directory).sort(), [
      "index.js",
      "manifest.json",
      "package.json",
    ])
  ) {
    throw new Error("Unexpected release artifact layout");
  }
  const read = (name, limit) => {
    const filename = path.join(directory, name);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size === 0 || stat.size > limit) {
      throw new Error(`Invalid release artifact file: ${name}`);
    }
    return fs.readFileSync(filename);
  };
  const preparedPackage = read("package.json", 128 * 1024);
  const bundle = read("index.js", 16 * 1024 * 1024);
  const actual = JSON.parse(read("manifest.json", 8192).toString("utf8"));
  const expected = artifactManifest({ version, sourcePackage, lock, preparedPackage, bundle });
  if (!isDeepStrictEqual(actual, expected)) throw new Error("Release artifact identity mismatch");
  if ((fs.statSync(path.join(directory, "index.js")).mode & 0o777) !== 0o755) {
    throw new Error("Release bundle must be executable with mode 0755");
  }
  return { manifest: expected, preparedPackage, bundle };
}

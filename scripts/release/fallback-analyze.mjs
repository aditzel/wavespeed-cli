#!/usr/bin/env bun

import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function getChangedFiles(lastTag) {
  const args = lastTag
    ? ["diff", "--name-only", `${lastTag}..HEAD`]
    : ["show", "--pretty=format:", "--name-only", "HEAD"];

  const output = git(args);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveBaseTag() {
  const explicitTag = process.argv[2];
  if (explicitTag) {
    return explicitTag;
  }

  try {
    return git(["describe", "--tags", "--abbrev=0", "--match", "v*"]);
  } catch {
    return "";
  }
}

function hasReleasableSourceChange(changedFiles) {
  return changedFiles.some((path) => {
    return (
      path === "package.json" ||
      path === "bun.lock" ||
      path === "tsconfig.json" ||
      path.startsWith("src/")
    );
  });
}

const baseTag = resolveBaseTag();
const changedFiles = getChangedFiles(baseTag);

// semantic-release already handles conventional feat/fix/perf/refactor/build commits.
// This fallback emits a patch only when source files changed since the last tag.
if (hasReleasableSourceChange(changedFiles)) {
  process.stdout.write("patch");
}

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { producerIdentity, repository, requireValue } from "./release-plan.mjs";

export const pipeline = "wavespeed-cli-release-build";
export const endpoint = `https://api.buildkite.com/v2/organizations/mirai-forge/pipelines/${pipeline}/builds`;
export const buildUrl = `https://buildkite.com/mirai-forge/${pipeline}/builds/`;
export const requestKey = "janus-wavespeed-request-v1";
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && value !== "0".repeat(40);
const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const keys = ["schemaVersion", "repositoryId", "workflowId", "runId", "runAttempt", "event", "commit", "ref", "artifactId"].sort();

export function requestSchema(value) {
  requireValue(value && typeof value === "object" && Object.keys(value).sort().join() === keys.join(),
    "Unexpected Janus request fields");
  requireValue(value.schemaVersion === 1 && value.repositoryId === 1079467744 && value.workflowId === 211956153 &&
    ["runId", "runAttempt", "artifactId"].every((key) => positive(value[key])) && value.runAttempt <= 999999 &&
    ["push", "workflow_dispatch"].includes(value.event) && value.ref === "refs/heads/main" && sha(value.commit),
    "Invalid Janus request identity");
  return value;
}

export function requestFromContext(env, event) {
  requireValue(env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === repository &&
    env.GITHUB_REPOSITORY_ID === "1079467744" && env.GITHUB_REF === "refs/heads/main" &&
    env.GITHUB_JOB === "request-janus-release" && !env.GITHUB_HEAD_REF &&
    env.JANUS_WAVESPEED_RELEASE_MODE === "verify", "Unexpected Janus dispatch context");
  const producer = producerIdentity({
    event: env.GITHUB_EVENT_NAME, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    workflowRef: env.GITHUB_WORKFLOW_REF, workflowSha: env.GITHUB_WORKFLOW_SHA,
  });
  requireValue(producer.workflowSha === env.GITHUB_SHA && sha(env.GITHUB_SHA), "Dispatch source changed");
  requireValue(event?.repository?.id === 1079467744 && event.repository.full_name === repository,
    "Dispatch event repository changed");
  if (producer.event === "push") {
    requireValue(event.ref === "refs/heads/main" && event.after === env.GITHUB_SHA && !event.deleted &&
      typeof event.head_commit?.message === "string" && !event.head_commit.message.startsWith("chore(release):"),
      "Push does not request a release plan");
  } else {
    requireValue([undefined, false, "false"].includes(event.inputs?.publish_current_version),
      "Recovery uses its separate release route");
  }
  requireValue(typeof env.PLAN_ARTIFACT_ID === "string" && /^[1-9][0-9]{0,15}$/.test(env.PLAN_ARTIFACT_ID),
    "Missing plan artifact ID");
  return requestSchema({
    schemaVersion: 1, repositoryId: 1079467744, workflowId: 211956153,
    runId: Number(producer.runId), runAttempt: Number(producer.runAttempt), event: producer.event,
    commit: env.GITHUB_SHA, ref: "refs/heads/main", artifactId: Number(env.PLAN_ARTIFACT_ID),
  });
}

// All requests stay at the fixed pipeline. No redirects, retries, arbitrary
// headers, environment grants or version input are accepted.
export function transport(token, fetcher = fetch, clock = () => performance.now()) {
  requireValue(typeof token === "string" && /^[A-Za-z0-9_.-]{16,4096}$/.test(token), "Missing scoped Buildkite credential");
  const deadline = clock() + 60_000;
  let requests = 0;
  return async (suffix, body) => {
    requireValue(/^(?:\?commit=[a-f0-9]{40}&per_page=100&page=[1-5]|\/[1-9][0-9]{0,15})?$/.test(suffix) &&
      (!body || suffix === "") && ++requests <= 8 && clock() < deadline, "Dispatch request exceeds its bounds");
    const response = await fetcher(endpoint + suffix, {
      method: body ? "POST" : "GET", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
        "Accept-Encoding": "identity", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(15_000, deadline - clock())))),
    });
    requireValue(response.url === endpoint + suffix && response.status === (body ? 201 : 200),
      "Buildkite did not confirm the requested operation");
    requireValue(!response.headers.get("content-encoding") || response.headers.get("content-encoding") === "identity",
      "Buildkite response encoding changed");
    const limit = 4 * 1024 * 1024, length = response.headers.get("content-length");
    requireValue(!length || /^\d+$/.test(length) && Number(length) <= limit, "Buildkite response is oversized");
    requireValue(response.body, "Buildkite response is empty");
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        requireValue(clock() < deadline, "Buildkite response exceeded its deadline");
        if (done) break;
        size += value.byteLength;
        requireValue(size <= limit, "Buildkite response is oversized");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    requireValue(!length || Number(length) === size, "Buildkite response is incomplete");
    return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      next: /rel="?next"?/.test(response.headers.get("link") || "") };
  };
}

function buildIdentity(build, wanted) {
  requireValue(build && positive(build.number) && uuid(build.id) && build.source === "api" &&
    build.commit === wanted.commit && build.branch === "main" &&
    build.pipeline?.slug === pipeline && build.pipeline.repository === `https://github.com/${repository}.git` &&
    build.url === `${endpoint}/${build.number}` && build.web_url === `${buildUrl}${build.number}`,
    "Build identity differs from the fixed pipeline and source");
  requireValue(typeof build.meta_data?.[requestKey] === "string", "Build has no authenticated-plan request");
  const request = requestSchema(JSON.parse(build.meta_data[requestKey]));
  requireValue(request.commit === wanted.commit, "Build request commit changed");
  return request;
}

export async function dispatchRelease(wanted, api) {
  requestSchema(wanted);
  let candidates = [], complete = false;
  const ids = new Set(), numbers = new Set();
  for (let page = 1; page <= 5; page++) {
    const { value: rows, next } = await api(`?commit=${wanted.commit}&per_page=100&page=${page}`);
    requireValue(Array.isArray(rows) && rows.length <= 100, "Invalid Buildkite inventory");
    for (const build of rows) {
      const request = buildIdentity(build, wanted);
      requireValue(!ids.has(build.id) && !numbers.has(build.number), "Build inventory changed during pagination");
      ids.add(build.id); numbers.add(build.number);
      if (isDeepStrictEqual(request, wanted)) candidates.push(build);
      else requireValue(request.runId !== wanted.runId || request.runAttempt !== wanted.runAttempt,
        "Plan artifact changed within the current attempt");
    }
    if (rows.length < 100) {
      requireValue(!next, "Incomplete Buildkite inventory page");
      complete = true;
      break;
    }
  }
  requireValue(complete, "Buildkite inventory exceeds the dispatch bound");
  let selected, reused = candidates.length > 0;
  if (reused) selected = candidates.reduce((a, b) => a.number > b.number ? a : b);
  else {
    // Never retry an ambiguous POST. A subsequent invocation first inventories
    // existing builds, while a new workflow attempt receives a distinct request.
    const response = await api("", {
      commit: wanted.commit, branch: "main",
      message: `Verify Wavespeed release plan ${wanted.runId} attempt ${wanted.runAttempt}`,
      meta_data: { [requestKey]: JSON.stringify(wanted) },
    });
    selected = response.value;
  }
  requireValue(isDeepStrictEqual(buildIdentity(selected, wanted), wanted), "Buildkite accepted a different request");
  requireValue(["scheduled", "running", "passed", "blocked", "waiting", "creating"].includes(selected.state),
    "The current request has a failed or canceled build");
  const fresh = (await api(`/${selected.number}`)).value;
  requireValue(fresh.id === selected.id && fresh.number === selected.number &&
    isDeepStrictEqual(buildIdentity(fresh, wanted), wanted) &&
    ["scheduled", "running", "passed", "blocked", "waiting", "creating"].includes(fresh.state),
    "Build changed after dispatch");
  return { buildId: fresh.id, buildNumber: fresh.number, url: fresh.web_url, reused };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 2, "This dispatcher accepts no command-line inputs");
    const stat = fs.lstatSync(process.env.GITHUB_EVENT_PATH);
    requireValue(stat.isFile() && stat.size > 0 && stat.size <= 2 * 1024 * 1024, "Invalid workflow event");
    const request = requestFromContext(process.env, JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH)));
    const result = await dispatchRelease(request, transport(process.env.BUILDKITE_RELEASE_WRITE_TOKEN));
    console.log(JSON.stringify(result));
  } catch {
    console.error("Janus dispatch could not be confirmed. No automatic retry was attempted; inspect the current build before retrying.");
    process.exitCode = 1;
  }
}

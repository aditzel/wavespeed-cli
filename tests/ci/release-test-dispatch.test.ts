import { describe, expect, it } from "bun:test";
import { dispatchTests, requestFromContext, requestSchema, transport, endpoint, buildUrl, pipeline, requestKey } from "../../scripts/release/request-tests.mjs";

const commit = "a".repeat(40);
const env = {
  GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "aditzel/wavespeed-cli", GITHUB_REPOSITORY_ID: "1079467744",
  GITHUB_REF: "refs/heads/main", GITHUB_JOB: "request-janus-test", GITHUB_EVENT_NAME: "push",
  GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", GITHUB_SHA: commit, GITHUB_WORKFLOW_SHA: commit,
  GITHUB_WORKFLOW_REF: "aditzel/wavespeed-cli/.github/workflows/release.yml@refs/heads/main",
  JANUS_WAVESPEED_TEST_MODE: "verify",
};
const event = {
  repository: { id: 1079467744, full_name: "aditzel/wavespeed-cli" }, ref: "refs/heads/main",
  after: commit, head_commit: { message: "feat: command" },
};
const wanted = requestFromContext(env, event);
const build = (number = 1, request = wanted, state = "scheduled") => ({
  id: `${number.toString(16).padStart(8, "0")}-1111-1111-1111-111111111111`,
  number, commit, branch: request.ref.split("/").slice(2).join("/"), source: "api", state,
  pipeline: { slug: pipeline, repository: "https://github.com/aditzel/wavespeed-cli.git" },
  url: `${endpoint}/${number}`, web_url: `${buildUrl}${number}`,
  meta_data: { [requestKey]: JSON.stringify(request) },
});

describe("bounded standalone Janus test dispatch", () => {
  it("creates one build with only the source and closed request, then reads it independently", async () => {
    const calls: any[] = [];
    const result = await dispatchTests(wanted, async (suffix: string, body?: any) => {
      calls.push({ suffix, body });
      return { value: suffix.startsWith("?") ? [] : build(), next: false };
    });
    expect(calls.map((x) => x.suffix)).toEqual([`?commit=${commit}&per_page=100&page=1`, "", "/1"]);
    expect(calls[1].body).toEqual({
      commit, branch: "main", message: "Run Wavespeed Release tests for 123 attempt 2",
      meta_data: { [requestKey]: JSON.stringify(wanted) },
    });
    expect(result).toEqual({ buildId: build().id, buildNumber: 1, url: buildUrl + "1", reused: false });
  });

  it("reuses the newest matching request without another POST", async () => {
    const calls: string[] = [];
    const result = await dispatchTests(wanted, async (suffix: string, body?: any) => {
      expect(body).toBeUndefined();calls.push(suffix);
      return { value: suffix.startsWith("?") ? [build(2), build(1)] : build(2), next: false };
    });
    expect(result.reused).toBe(true);
    expect(result.buildNumber).toBe(2);
    expect(calls.at(-1)).toBe("/2");
  });

  for (const state of ["failed", "canceled", "canceling", "skipped", "not_run"]) {
    it(`does not fall back from the newest ${state} build to older success`, async () => {
      let writes = 0;
      await expect(dispatchTests(wanted, async (_path: string, body?: any) => {
        if (body) writes++;
        return { value: [build(2, wanted, state), build(1, wanted, "passed")], next: false };
      })).rejects.toThrow("failed or canceled");
      expect(writes).toBe(0);
    });
  }

  it("ignores a different earlier workflow attempt at the same source", async () => {
    let posts = 0;
    const result = await dispatchTests(wanted, async (suffix: string, body?: any) => {
      if (body) posts++;
      return { value: suffix.startsWith("?") ? [build(1, { ...wanted, runAttempt: 1 })] : build(2), next: false };
    });
    expect(posts).toBe(1);
    expect(result.buildNumber).toBe(2);
  });

  it("refuses missing metadata, artifact substitution and duplicate inventories before POST", async () => {
    for (const rows of [
      [{ ...build(), meta_data: {} }],
      [build(1, { ...wanted, artifactId: 999 })],
      [build(), build()],
      [{ ...build(), pipeline: { slug: "other", repository: "https://github.com/aditzel/wavespeed-cli.git" } }],
    ]) {
      let writes = 0;
      await expect(dispatchTests(wanted, async (_path: string, body?: any) => {
        if (body) writes++;
        return { value: rows, next: false };
      })).rejects.toThrow();
      expect(writes).toBe(0);
    }
  });

  it("rejects an incomplete or overflowing inventory without creating a build", async () => {
    for (const scenario of ["short-with-next", "overflow"]) {
      let reads = 0;
      await expect(dispatchTests(wanted, async (_path: string, body?: any) => {
        expect(body).toBeUndefined();reads++;
        return { value: scenario === "short-with-next" ? [] :
          Array.from({ length: 100 }, (_, n) => build(reads * 100 + n, { ...wanted, runId: 999 })),
        next: true };
      })).rejects.toThrow();
      expect(reads).toBe(scenario === "short-with-next" ? 1 : 5);
    }
  }, 20_000);

  it("never retries an ambiguous create response", async () => {
    let writes = 0;
    await expect(dispatchTests(wanted, async (_path: string, body?: any) => {
      if (body) { writes++;throw new Error("response lost"); }
      return { value: [], next: false };
    })).rejects.toThrow("response lost");
    expect(writes).toBe(1);
  });

  it("requires the independent post-create read to match source and request", async () => {
    await expect(dispatchTests(wanted, async (suffix: string) => ({
      value: suffix.startsWith("?") ? [] : suffix === "" ? build() : { ...build(), commit: "b".repeat(40) },
      next: false,
    }))).rejects.toThrow();
  });

  it("accepts release commits and manual branches/tags including recovery without publication inputs", () => {
    for (const ref of ["refs/heads/main", "refs/heads/feature/topic", "refs/tags/v1.3.5"]) {
      const manual = { ...env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: ref,
        GITHUB_WORKFLOW_REF: `aditzel/wavespeed-cli/.github/workflows/release.yml@${ref}` };
      expect(requestFromContext(manual, { repository: event.repository, inputs: { publish_current_version: "true" } }).ref).toBe(ref);
    }
    expect(requestFromContext(env, { ...event, head_commit: { message: "chore(release): 1.4.0" } })).toEqual(wanted);
    for (const change of [{ GITHUB_EVENT_NAME: "status" }, { GITHUB_REPOSITORY_ID: "9" },
      { GITHUB_WORKFLOW_SHA: "b".repeat(40) }, { GITHUB_JOB: "test" }, { GITHUB_RUN_ATTEMPT: "1000000" },
      { GITHUB_RUN_ID: "123\n" }, { JANUS_WAVESPEED_TEST_MODE: "" }])
      expect(() => requestFromContext({ ...env, ...change }, event)).toThrow();
    for (const extra of [{ version: "9.9.9" }, { artifactId: 999 }, { environment: {} }, { runAttempt: true }])
      expect(() => requestSchema({ ...wanted, ...extra })).toThrow();
    for (const ref of ["main", "refs/heads/-bad", "refs/heads/a.lock", "refs/heads/a..b", "refs/tags/a\nb"])
      expect(() => requestSchema({ ...wanted, event: "workflow_dispatch", ref })).toThrow();
  });

  it("dispatches a manual tag and ignores separate requests at the same commit", async () => {
    const request = { ...wanted, event: "workflow_dispatch", ref: "refs/tags/v1.3.5" };
    const other = { ...wanted, runId: 99, event: "workflow_dispatch", ref: "refs/heads/other" };
    let created: any;
    const result = await dispatchTests(request, async (suffix: string, body?: any) => {
      if (body) created = body;
      return { value: suffix.startsWith("?") ? [build(1, other)] : build(2, request), next: false };
    });
    expect(result.buildNumber).toBe(2);
    expect(created.branch).toBe("v1.3.5");
    expect(JSON.parse(created.meta_data[requestKey])).toEqual(request);
    expect(created).not.toHaveProperty("env");
  });

  it("uses only a fixed origin, rejects redirects and bounds responses", async () => {
    const requests: any[] = [];
    const api = transport("x".repeat(32), async (url: string, options: any) => {
      requests.push({ url, options });
      const response = new Response(JSON.stringify(build()), { status: options.method === "POST" ? 201 : 200 });
      Object.defineProperty(response, "url", { value: url });
      return response;
    });
    await api("/1");
    expect(requests[0].url).toBe(endpoint + "/1");
    expect(requests[0].options.redirect).toBe("error");
    expect(requests[0].options.headers["Accept-Encoding"]).toBe("identity");
    expect(requests[0].options.signal).toBeInstanceOf(AbortSignal);
    for (const suffix of ["/1?url=https://evil.invalid", "https://evil.invalid", "/1/../pipelines", "/1#fragment"])
      await expect(api(suffix)).rejects.toThrow("bounds");
    const oversized = transport("x".repeat(32), async (url: string) => {
      const response = new Response("", { headers: { "content-length": String(4 * 1024 * 1024 + 1) } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    });
    await expect(oversized("/1")).rejects.toThrow("oversized");
    const encoded = transport("x".repeat(32), async (url: string) => {
      const response = new Response("{}", { headers: { "content-encoding": "gzip" } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    });
    await expect(encoded("/1")).rejects.toThrow("encoding changed");
    const redirected = transport("x".repeat(32), async () => {
      const response = new Response("{}");
      Object.defineProperty(response, "url", { value: "https://evil.invalid" });
      return response;
    });
    await expect(redirected("/1")).rejects.toThrow("did not confirm");
  });

  it("enforces the overall deadline and request cap", async () => {
    let now = 0, calls = 0;
    const api = transport("x".repeat(32), async (url: string) => {
      calls++;
      const response = new Response("{}");
      Object.defineProperty(response, "url", { value: url });
      return response;
    }, () => now);
    for (let n = 0; n < 8; n++) await api("/1");
    await expect(api("/1")).rejects.toThrow("bounds");
    expect(calls).toBe(8);
    const expired = transport("x".repeat(32), async () => { throw new Error("must not fetch"); }, () => now);
    now = 60_001;
    await expect(expired("/1")).rejects.toThrow("bounds");
  });
});

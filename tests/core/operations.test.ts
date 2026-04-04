import { afterEach, describe, expect, it } from "bun:test";
import type { ResolvedModel } from "../../src/config/types.ts";
import {
  editImage,
  editSequential,
  generateImage,
  generateSequential,
} from "../../src/core/operations.ts";

const originalFetch = globalThis.fetch;

const aliasedModel: ResolvedModel = {
  id: "custom-alias",
  provider: "wavespeed",
  apiBaseUrl: "https://api.test.local",
  apiKeyEnv: "WAVESPEED_API_KEY",
  apiKey: "test-api-key",
  modelName: "vendor/custom-model",
  type: "image",
  requestDefaults: {},
  isFromConfig: true,
  submitMode: "base",
};

const aiRemoverAliasModel: ResolvedModel = {
  id: "background-remover",
  provider: "wavespeed",
  apiBaseUrl: "https://api.test.local",
  apiKeyEnv: "WAVESPEED_API_KEY",
  apiKey: "test-api-key",
  modelName: "wavespeed-ai/image-background-remover",
  apiModelType: "ai-remover",
  type: "image",
  requestDefaults: {},
  isFromConfig: true,
  submitMode: "base",
};

const aiRemoverEraserModel: ResolvedModel = {
  ...aiRemoverAliasModel,
  id: "image-eraser",
  modelName: "wavespeed-ai/image-eraser",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Core operations", () => {
  const cases = [
    {
      name: "generateImage",
      run: () =>
        generateImage({
          prompt: "test prompt",
          size: "1024*1024",
          syncMode: false,
          model: aliasedModel,
        }),
      expectedPath: "/api/v3/vendor/custom-model",
      expectedModel: "vendor/custom-model",
    },
    {
      name: "editImage",
      run: () =>
        editImage({
          prompt: "test prompt",
          images: ["https://example.com/source.png"],
          size: "1024*1024",
          syncMode: false,
          model: aliasedModel,
        }),
      expectedPath: "/api/v3/vendor/custom-model/edit",
      expectedModel: "vendor/custom-model/edit",
    },
    {
      name: "generateSequential",
      run: () =>
        generateSequential({
          prompt: "test prompt",
          maxImages: 3,
          size: "1024*1024",
          syncMode: false,
          model: aliasedModel,
        }),
      expectedPath: "/api/v3/vendor/custom-model/sequential",
      expectedModel: "vendor/custom-model/sequential",
    },
    {
      name: "editSequential",
      run: () =>
        editSequential({
          prompt: "test prompt",
          images: ["https://example.com/source.png"],
          maxImages: 3,
          size: "1024*1024",
          syncMode: false,
          model: aliasedModel,
        }),
      expectedPath: "/api/v3/vendor/custom-model/edit-sequential",
      expectedModel: "vendor/custom-model/edit-sequential",
    },
  ] as const;

  for (const testCase of cases) {
    it(`submits ${testCase.name} using the canonical route and body model`, async () => {
      const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

      globalThis.fetch = async (url: string | URL, options?: RequestInit) => {
        const method = options?.method || "GET";
        const urlStr = url.toString();
        const body =
          method === "POST"
            ? (JSON.parse((options?.body as string | undefined) || "{}") as Record<string, unknown>)
            : undefined;

        requests.push({ method, url: urlStr, body });

        if (method === "POST") {
          return new Response(
            JSON.stringify({
              data: {
                id: "task-123",
                status: "created",
                outputs: [],
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response(
          JSON.stringify({
            data: {
              id: "task-123",
              status: "completed",
              outputs: [],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      };

      const result = await testCase.run();
      expect(result.success).toBe(true);

      const postRequest = requests.find((request) => request.method === "POST");
      expect(postRequest?.url).toBe(`https://api.test.local${testCase.expectedPath}`);
      expect(postRequest?.body?.model).toBe(testCase.expectedModel);
    });
  }

  it("submits ai-remover edits with a singular image payload on the base route", async () => {
    const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

    globalThis.fetch = async (url: string | URL, options?: RequestInit) => {
      const method = options?.method || "GET";
      const urlStr = url.toString();
      const body =
        method === "POST"
          ? (JSON.parse((options?.body as string | undefined) || "{}") as Record<string, unknown>)
          : undefined;

      requests.push({ method, url: urlStr, body });

      if (method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              id: "task-123",
              status: "created",
              outputs: [],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          data: {
            id: "task-123",
            status: "completed",
            outputs: [],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const result = await editImage({
      prompt: "remove background",
      images: ["https://example.com/source.png"],
      size: "1024*1024",
      syncMode: false,
      model: aiRemoverAliasModel,
    });

    expect(result.success).toBe(true);

    const postRequest = requests.find((request) => request.method === "POST");
    expect(postRequest?.url).toBe(
      "https://api.test.local/api/v3/wavespeed-ai/image-background-remover",
    );
    expect(postRequest?.body).toEqual({
      image: "https://example.com/source.png",
      enable_base64_output: false,
      enable_sync_mode: false,
      model: "wavespeed-ai/image-background-remover",
    });
  });

  it("preserves prompt forwarding for prompt-driven ai-remover models", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = async (_url: string | URL, options?: RequestInit) => {
      const method = options?.method || "GET";
      if (method === "POST") {
        capturedBody = JSON.parse((options?.body as string | undefined) || "{}");
        return new Response(
          JSON.stringify({
            data: {
              id: "task-123",
              status: "created",
              outputs: [],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          data: {
            id: "task-123",
            status: "completed",
            outputs: [],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const result = await editImage({
      prompt: "remove the logo",
      images: ["https://example.com/source.png"],
      syncMode: false,
      model: aiRemoverEraserModel,
    });

    expect(result.success).toBe(true);
    expect(capturedBody?.prompt).toBe("remove the logo");
  });

  it("fails fast when an ai-remover edit receives multiple images", async () => {
    const result = await editImage({
      prompt: "remove background",
      images: ["https://example.com/source.png", "https://example.com/second.png"],
      syncMode: false,
      model: aiRemoverAliasModel,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("exactly 1 input image");
  });
});

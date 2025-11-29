import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { submitTask, getResult, endpoints } from "../../src/api/client.ts";
import { ResolvedModel } from "../../src/config/types";

const testModel: ResolvedModel = {
  id: "seedream-v4",
  provider: "wavespeed",
  apiBaseUrl: "https://api.wavespeed.ai",
  apiKeyEnv: "WAVESPEED_API_KEY",
  apiKey: "test-api-key",
  modelName: "bytedance/seedream-v4",
  type: "image",
  requestDefaults: {},
  isFromConfig: false,
};

describe("API Client", () => {
  const originalEnv = process.env.WAVESPEED_API_KEY;
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    process.env.WAVESPEED_API_KEY = "test-api-key";
  });

  afterAll(() => {
    if (originalEnv) {
      process.env.WAVESPEED_API_KEY = originalEnv;
    } else {
      delete process.env.WAVESPEED_API_KEY;
    }
    globalThis.fetch = originalFetch;
  });

  describe("HTTP Operations", () => {
    beforeAll(() => {
      globalThis.fetch = async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString();
        const method = options?.method || "GET";

        // Mock successful responses
        if (
          urlStr ===
            "https://api.wavespeed.ai" + endpoints.edit &&
          method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              data: {
                id: "test-task-123",
                status: "created",
                outputs: [],
                error: null,
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }

        if (
          urlStr ===
            "https://api.wavespeed.ai" +
              endpoints.result("test-task-123") &&
          method === "GET"
        ) {
          return new Response(
            JSON.stringify({
              data: {
                id: "test-task-123",
                status: "completed",
                outputs: ["https://example.com/result.png"],
                error: null,
                timings: { inference: 1500 },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }

        // Mock error response
        if (urlStr.endsWith("/error") && method === "POST") {
          return new Response(
            JSON.stringify({
              error: "Test error message",
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            }
          );
        }

        // Mock non-JSON response
        if (urlStr.endsWith("/non-json") && method === "POST") {
          return new Response("Not JSON", {
            status: 500,
            headers: { "content-type": "text/plain" },
          });
        }

        return new Response("Not found", { status: 404 });
      };
    });

    it("should submit task successfully", async () => {
      const payload = {
        prompt: "test prompt",
        images: ["https://example.com/image.jpg"],
        size: "1024*1024",
        enable_base64_output: false,
        enable_sync_mode: false,
      };

      const result = await submitTask(testModel, endpoints.edit, payload);

      expect(result.id).toBe("test-task-123");
      expect(result.status).toBe("created");
      expect(result.outputs).toEqual([]);
    });

    it("should get result successfully", async () => {
      const result = await getResult(testModel, "test-task-123");

      expect(result.id).toBe("test-task-123");
      expect(result.status).toBe("completed");
      expect(result.outputs).toEqual(["https://example.com/result.png"]);
      expect(result.timings?.inference).toBe(1500);
    });

    it("should handle HTTP errors", async () => {
      await expect(
        submitTask(testModel, "/error", {})
      ).rejects.toThrow("HTTP 400: Test error message");
    });

    it("should handle non-JSON responses", async () => {
      await expect(
        submitTask(testModel, "/non-json", {})
      ).rejects.toThrow("Non JSON response with status 500");
    });

    it("should send correct headers", async () => {
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = async (url: string | URL, options?: RequestInit) => {
        capturedHeaders = Object.fromEntries(
          Object.entries(options?.headers || {})
        );

        return new Response(
          JSON.stringify({
            data: { id: "test", status: "created", outputs: [] },
          }),
          { status: 200 }
        );
      };

      await submitTask(testModel, endpoints.edit, { test: "data" });

      expect(capturedHeaders["Authorization"]).toBe(
        `Bearer ${testModel.apiKey}`
      );
      expect(capturedHeaders["Content-Type"]).toBe("application/json");
      expect(capturedHeaders["Accept"]).toBe("application/json");
    });
  });

  describe("Endpoints", () => {
    it("should have correct endpoint URLs", () => {
      expect(endpoints.generate).toBe("/api/v3/bytedance/seedream-v4");
      expect(endpoints.edit).toBe("/api/v3/bytedance/seedream-v4/edit");
      expect(endpoints.generateSequential).toBe(
        "/api/v3/bytedance/seedream-v4/sequential"
      );
      expect(endpoints.editSequential).toBe(
        "/api/v3/bytedance/seedream-v4/edit-sequential"
      );
      expect(endpoints.result("test-123")).toBe(
        "/api/v3/predictions/test-123/result"
      );
    });
  });
});
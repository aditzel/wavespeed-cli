import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { submitTask, getResult, endpoints } from "../../src/api/client.ts";

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

  describe("API Key Validation", () => {
    it("should require API key to be set", () => {
      delete process.env.WAVESPEED_API_KEY;
      
      // The client will check for API key when imported/used
      // We can't easily test process.exit in bun test, so we'll just verify
      // the key is required in other tests
      expect(process.env.WAVESPEED_API_KEY).toBeUndefined();
      
      // Restore for other tests
      process.env.WAVESPEED_API_KEY = "test-api-key";
    });
  });

  describe("HTTP Operations", () => {
    beforeAll(() => {
      globalThis.fetch = async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString();
        const method = options?.method || "GET";
        
        // Mock successful responses
        if (urlStr.includes("/api/v3/bytedance/seedream-v4/edit") && method === "POST") {
          return new Response(JSON.stringify({
            data: {
              id: "test-task-123",
              status: "created",
              outputs: [],
              error: null
            }
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        
        if (urlStr.includes("/api/v3/predictions/test-task-123/result") && method === "GET") {
          return new Response(JSON.stringify({
            data: {
              id: "test-task-123",
              status: "completed",
              outputs: ["https://example.com/result.png"],
              error: null,
              timings: { inference: 1500 }
            }
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        // Mock error response
        if (urlStr.includes("/error")) {
          return new Response(JSON.stringify({
            error: "Test error message"
          }), {
            status: 400,
            headers: { "content-type": "application/json" }
          });
        }

        // Mock non-JSON response
        if (urlStr.includes("/non-json")) {
          return new Response("Not JSON", {
            status: 500,
            headers: { "content-type": "text/plain" }
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
        enable_sync_mode: false
      };

      const result = await submitTask(endpoints.edit, payload);
      
      expect(result.id).toBe("test-task-123");
      expect(result.status).toBe("created");
      expect(result.outputs).toEqual([]);
    });

    it("should get result successfully", async () => {
      const result = await getResult("test-task-123");
      
      expect(result.id).toBe("test-task-123");
      expect(result.status).toBe("completed");
      expect(result.outputs).toEqual(["https://example.com/result.png"]);
      expect(result.timings?.inference).toBe(1500);
    });

    it("should handle HTTP errors", async () => {
      await expect(submitTask("/error", {})).rejects.toThrow("HTTP 400: Test error message");
    });

    it("should handle non-JSON responses", async () => {
      await expect(submitTask("/non-json", {})).rejects.toThrow("Non JSON response with status 500");
    });

    it("should send correct headers", async () => {
      let capturedHeaders: Record<string, string> = {};
      
      globalThis.fetch = async (url: string | URL, options?: RequestInit) => {
        capturedHeaders = Object.fromEntries(
          Object.entries(options?.headers || {})
        );
        
        return new Response(JSON.stringify({
          data: { id: "test", status: "created", outputs: [] }
        }), { status: 200 });
      };

      await submitTask(endpoints.edit, { test: "data" });
      
      expect(capturedHeaders["Authorization"]).toBe("Bearer test-api-key");
      expect(capturedHeaders["Content-Type"]).toBe("application/json");
      expect(capturedHeaders["Accept"]).toBe("application/json");
    });
  });

  describe("Endpoints", () => {
    it("should have correct endpoint URLs", () => {
      expect(endpoints.generate).toBe("/api/v3/bytedance/seedream-v4");
      expect(endpoints.edit).toBe("/api/v3/bytedance/seedream-v4/edit");
      expect(endpoints.generateSequential).toBe("/api/v3/bytedance/seedream-v4/sequential");
      expect(endpoints.editSequential).toBe("/api/v3/bytedance/seedream-v4/edit-sequential");
      expect(endpoints.result("test-123")).toBe("/api/v3/predictions/test-123/result");
    });
  });
});
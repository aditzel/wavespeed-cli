import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "bun";

describe("CLI Integration Tests", () => {
  const cliEntryPath = path.join(import.meta.dir, "../../src/index.ts");

  let tempDir: string;
  let server: ReturnType<typeof createServer>;
  let serverUrl = "";
  let requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

  const startServer = async () => {
    requests = [];
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : undefined;

      requests.push({
        method: req.method || "GET",
        url: req.url || "/",
        body,
      });

      res.setHeader("content-type", "application/json");

      if (req.method === "POST" && req.url?.startsWith("/api/v3/")) {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            data: {
              id: "task-123",
              status: "created",
              outputs: [],
              error: null,
            },
          }),
        );
        return;
      }

      if (req.method === "GET" && req.url === "/api/v3/predictions/task-123/result") {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            data: {
              id: "task-123",
              status: "completed",
              outputs: [],
              error: null,
            },
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to determine test server address");
    }

    serverUrl = `http://127.0.0.1:${address.port}`;
  };

  const writeConfig = (content: Record<string, unknown>) => {
    fs.writeFileSync(path.join(tempDir, ".wavespeedrc.json"), JSON.stringify(content, null, 2));
  };

  const runCLI = async (
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const process = spawn(["bun", "run", cliEntryPath, ...args], {
      cwd: tempDir,
      env: { ...Bun.env, WAVESPEED_API_KEY: "test-cli-key" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    await process.exited;

    return {
      stdout,
      stderr,
      exitCode: process.exitCode || 0,
    };
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wavespeed-cli-test-"));
    await startServer();
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Help Commands", () => {
    it("should show main help", async () => {
      const result = await runCLI(["--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Wavespeed AI CLI - Generate and Edit Images");
      expect(result.stdout).toContain("generate");
      expect(result.stdout).toContain("edit");
      expect(result.stdout).toContain("generate-sequential");
      expect(result.stdout).toContain("edit-sequential");
    });

    it("should show edit command help", async () => {
      const result = await runCLI(["edit", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Image editing");
      expect(result.stdout).toContain("--prompt");
      expect(result.stdout).toContain("--images");
      expect(result.stdout).toContain("--size");
      expect(result.stdout).toContain("--sync");
      expect(result.stdout).toContain("--base64");
      expect(result.stdout).toContain("--model");
      expect(result.stdout).toContain("URLs or file paths");
      expect(result.stdout).toContain("Request base64 outputs");
    });

    it("should show generate command help", async () => {
      const result = await runCLI(["generate", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Text-to-image generation");
      expect(result.stdout).toContain("--prompt");
      expect(result.stdout).toContain("--size");
      expect(result.stdout).toContain("--sync");
      expect(result.stdout).toContain("--model");
      expect(result.stdout).toContain("Enable synchronous mode");
    });
  });

  describe("Basic Validation", () => {
    it("should reject missing prompt for edit", async () => {
      const result = await runCLI(["edit", "-i", "https://example.com/test.jpg"]);

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Prompt is required");
    });

    it("should reject missing images for edit", async () => {
      const result = await runCLI(["edit", "-p", "test prompt"]);

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Images are required");
    });

    it("should reject invalid size format", async () => {
      const result = await runCLI([
        "edit",
        "-p",
        "test",
        "-i",
        "https://example.com/test.jpg",
        "-s",
        "invalid",
      ]);

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Size must be WIDTH*HEIGHT");
    });
  });

  describe("Model Routing", () => {
    it("should use CLI --model over defaults and submit matching route and body model", async () => {
      writeConfig({
        models: {
          defaultModel: {
            provider: "wavespeed",
            apiKeyEnv: "WAVESPEED_API_KEY",
            apiBaseUrl: serverUrl,
            modelName: "vendor/default-model",
          },
          cliModel: {
            provider: "wavespeed",
            apiKeyEnv: "WAVESPEED_API_KEY",
            apiBaseUrl: serverUrl,
            modelName: "vendor/cli-model",
          },
        },
        defaults: {
          globalModel: "defaultModel",
        },
      });

      const result = await runCLI([
        "generate",
        "--prompt",
        "test prompt",
        "--sync",
        "--model",
        "cliModel",
      ]);

      expect(result.exitCode).toBe(0);

      const postRequest = requests.find((request) => request.method === "POST");
      expect(postRequest?.url).toBe("/api/v3/vendor/cli-model");
      expect(postRequest?.body?.model).toBe("vendor/cli-model");
      expect(postRequest?.url).not.toBe("/api/v3/vendor/default-model");
      expect(result.stderr).not.toContain("default-model");
    });
  });
});

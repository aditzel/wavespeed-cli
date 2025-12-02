import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const apiKey = process.env.WAVESPEED_API_KEY;
const shouldRun = !!apiKey;

// Skip all tests if no API key
describe.skipIf(!shouldRun)("MCP E2E", () => {
  let mcpProcess: ChildProcess;
  const outputDir = path.join(process.cwd(), "tests", "e2e", "output_" + Date.now());

  beforeAll(async () => {
    // Ensure output dir exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Start MCP server
    const scriptPath = path.join(process.cwd(), "src/index.ts");
    mcpProcess = spawn("bun", ["run", scriptPath, "mcp"], {
      env: process.env,
      stdio: ["pipe", "pipe", "inherit"],
    });

    // Wait a bit for server to be ready (though stdio doesn't really announce readiness in a machine readable way instantly)
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(() => {
    if (mcpProcess) {
      mcpProcess.kill();
    }
    // Cleanup output dir
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  // Helper to send request
  const sendRequest = (request: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Request timed out"));
        cleanup();
      }, 120000); // 2 minute timeout for generation

      const onData = (chunk: Buffer) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              resolve(response);
              cleanup();
            }
          } catch (e) {
            // ignore
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        mcpProcess.stdout?.off("data", onData);
      };

      mcpProcess.stdout?.on("data", onData);
      mcpProcess.stdin?.write(JSON.stringify(request) + "\n");
    });
  };

  it("should list models and contain valid prices", async () => {
    const req = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "list_models",
        arguments: {},
      },
    };

    const res = await sendRequest(req);
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();

    const content = JSON.parse(res.result.content[0].text);
    expect(content.recommended).toBeDefined();
    expect(Array.isArray(content.recommended)).toBe(true);
    expect(content.recommended.length).toBeGreaterThan(0);

    // Check that at least one model has a price
    // (Note: some might be undefined if not in cache or API doesn't return them, but usually they do)
    const hasPrice = content.recommended.some((m: any) => m.price !== undefined);
    // We expect at least some prices to be populated given our recent changes
    // However, if cache is empty and API fails, it falls back to registry which might not have prices yet?
    // But this is E2E with API key, so it should fetch from API.
    expect(hasPrice).toBe(true);
  });

  it("should generate an image using the cheapest text-to-image model", async () => {
    // 1. Get models again to find cheapest
    const listReq = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "list_models",
        arguments: {},
      },
    };
    const listRes = await sendRequest(listReq);
    const listContent = JSON.parse(listRes.result.content[0].text);
    const recommended = listContent.recommended || [];

    const t2iModels = recommended.filter((m: any) => m.type === "text-to-image");
    expect(t2iModels.length).toBeGreaterThan(0);

    const cheapest = t2iModels.sort((a: any, b: any) => {
      const pA = a.price ?? Infinity;
      const pB = b.price ?? Infinity;
      return pA - pB;
    })[0];

    expect(cheapest).toBeDefined();
    console.log(`[TEST] Using model: ${cheapest.id} (Price: ${cheapest.price})`);

    // 2. Generate
    const genReq = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "generate",
        arguments: {
          prompt: "A simple geometric cube, minimal, white background",
          model: cheapest.id,
          size: "1024*1024",
          output: "paths",
          outputDir: outputDir,
        },
      },
    };

    const genRes = await sendRequest(genReq);
    expect(genRes.error).toBeUndefined();

    const genContent = JSON.parse(genRes.result.content[0].text);
    expect(genContent.status).toBe("completed");
    expect(genContent.images).toBeDefined();
    expect(genContent.images.length).toBe(1);

    const imagePath = genContent.images[0].path;
    expect(imagePath).toBeDefined();
    
    // Check file existence
    const exists = fs.existsSync(imagePath);
    expect(exists).toBe(true);
  }, 120000); // increase timeout for this test
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatForMCP } from "../../src/core/output-formatter.ts";
import type { OperationResult } from "../../src/core/types.ts";

const PNG_BASE64 = Buffer.from(
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00,
    0xff, 0xff, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]),
).toString("base64");

describe("Output formatter", () => {
  let tempDir = "";

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "wavespeed-output-formatter-"));
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves MCP image indexes when one path save fails", async () => {
    const result: OperationResult = {
      success: true,
      taskId: "task-with-gap",
      status: "completed",
      outputs: [PNG_BASE64, "not-an-image", PNG_BASE64],
    };

    const formatted = await formatForMCP(result, "paths", tempDir);

    expect(formatted.images).toHaveLength(3);
    expect(formatted.images[0].index).toBe(0);
    expect(formatted.images[0].path).toBeDefined();
    expect(formatted.images[1].index).toBe(1);
    expect(formatted.images[1].path).toBeUndefined();
    expect(formatted.images[2].index).toBe(2);
    expect(formatted.images[2].path).toBeDefined();
  });
});

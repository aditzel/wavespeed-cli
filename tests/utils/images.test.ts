import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import {
  convertFileToBase64,
  fileExists,
  isUrl,
  saveBase64Image,
  saveImagesFromOutputs,
} from "../../src/utils/images.ts";

describe("Image Utils", () => {
  const testDir = path.join(import.meta.dir, "../temp");
  const testImagePath = path.join(testDir, "test.png");
  const outputDir = path.join(testDir, "output");

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    // Create a minimal PNG for testing
    const pngData = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
      0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x01, 0x01,
      0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    await writeFile(testImagePath, pngData);
  });

  afterAll(async () => {
    try {
      await rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("isUrl", () => {
    it("should correctly identify URLs", () => {
      expect(isUrl("https://example.com")).toBe(true);
      expect(isUrl("http://example.com")).toBe(true);
      expect(isUrl("https://example.com/image.jpg")).toBe(true);
      expect(isUrl("http://localhost:3000/api")).toBe(true);
    });

    it("should correctly identify non-URLs", () => {
      expect(isUrl("example.com")).toBe(false);
      expect(isUrl("file.jpg")).toBe(false);
      expect(isUrl("/path/to/file.png")).toBe(false);
      expect(isUrl("./relative/path.gif")).toBe(false);
      expect(isUrl("")).toBe(false);
    });
  });

  describe("fileExists", () => {
    it("should return true for existing files", async () => {
      expect(await fileExists(testImagePath)).toBe(true);
    });

    it("should return false for non-existing files", async () => {
      expect(await fileExists("nonexistent.jpg")).toBe(false);
      expect(await fileExists(path.join(testDir, "missing.png"))).toBe(false);
    });
  });

  describe("convertFileToBase64", () => {
    it("should convert file to base64", async () => {
      const base64 = await convertFileToBase64(testImagePath);
      expect(typeof base64).toBe("string");
      expect(base64.length).toBeGreaterThan(0);

      // Verify it's valid base64 by attempting to decode
      const decoded = Buffer.from(base64, "base64");
      expect(decoded.length).toBeGreaterThan(0);

      // First 8 bytes should be PNG signature
      expect(decoded.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    });
  });

  describe("saveBase64Image", () => {
    it("should save base64 string to file", async () => {
      const base64 = await convertFileToBase64(testImagePath);
      const outputPath = path.join(outputDir, "saved.png");

      await saveBase64Image(base64, outputPath);

      const exists = await fileExists(outputPath);
      expect(exists).toBe(true);

      const savedContent = await readFile(outputPath);
      const originalContent = await readFile(testImagePath);
      expect(savedContent).toEqual(originalContent);
    });

    it("should handle data URI format", async () => {
      const base64 = await convertFileToBase64(testImagePath);
      const dataUri = `data:image/png;base64,${base64}`;
      const outputPath = path.join(outputDir, "saved-datauri.png");

      await saveBase64Image(dataUri, outputPath);

      const exists = await fileExists(outputPath);
      expect(exists).toBe(true);

      const savedContent = await readFile(outputPath);
      const originalContent = await readFile(testImagePath);
      expect(savedContent).toEqual(originalContent);
    });
  });

  describe("saveImagesFromOutputs", () => {
    let server: Server;
    let serverUrl = "";

    beforeAll(async () => {
      server = createServer(async (req, res) => {
        if (req.url?.includes("valid") || req.url?.includes("image")) {
          const pngData = await readFile(testImagePath);
          res.writeHead(200, { "content-type": "image/png" });
          res.end(pngData);
          return;
        }

        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      });

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to determine test server address");
      }
      serverUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it("should save images from URLs", async () => {
      const outputs = [`${serverUrl}/image1.png`, `${serverUrl}/image2.png`];
      const taskId = "test-task-123";

      const result = await saveImagesFromOutputs(outputs, outputDir, taskId, {
        allowPrivateNetwork: true,
      });

      expect(result.savedPaths).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(result.savedPaths[0]).toContain("test-task-123_1.png");
      expect(result.savedPaths[1]).toContain("test-task-123_2.png");

      // Verify files exist
      for (const savedPath of result.savedPaths) {
        expect(await fileExists(savedPath)).toBe(true);
      }
    });

    it("should save images from base64", async () => {
      const base64 = await convertFileToBase64(testImagePath);
      const outputs = [base64, `data:image/png;base64,${base64}`];
      const taskId = "test-base64-456";

      const result = await saveImagesFromOutputs(outputs, outputDir, taskId);

      expect(result.savedPaths).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(result.savedPaths[0]).toContain("test-base64-456_1.png");
      expect(result.savedPaths[1]).toContain("test-base64-456_2.png");
    });

    it("should handle mixed success and failure", async () => {
      const base64 = await convertFileToBase64(testImagePath);
      const outputs = [`${serverUrl}/valid.png`, `${serverUrl}/missing.png`, base64];
      const taskId = "test-mixed-789";

      const result = await saveImagesFromOutputs(outputs, outputDir, taskId, {
        allowPrivateNetwork: true,
      });

      expect(result.savedPaths).toHaveLength(2); // URL + base64 success
      expect(result.savedByIndex[0]).toBeDefined();
      expect(result.savedByIndex[1]).toBeUndefined();
      expect(result.savedByIndex[2]).toBeDefined();
      expect(result.failed).toHaveLength(1); // Invalid URL failure
      expect(result.failed[0].index).toBe(1);
    });

    it("should sanitize task ids before building output paths", async () => {
      const base64 = await convertFileToBase64(testImagePath);
      const result = await saveImagesFromOutputs([base64], outputDir, "../evil/task");

      expect(result.savedPaths).toHaveLength(1);
      expect(path.dirname(result.savedPaths[0])).toBe(path.resolve(outputDir));
      expect(path.basename(result.savedPaths[0])).not.toContain("..");
    });

    it("should reject output directories outside a configured root", async () => {
      const base64 = await convertFileToBase64(testImagePath);
      await expect(
        saveImagesFromOutputs([base64], "../outside", "task", { outputRoot: outputDir }),
      ).rejects.toThrow("Output directory must stay within configured output root");
    });

    it("should reject private network download URLs", async () => {
      const result = await saveImagesFromOutputs(
        ["http://127.0.0.1/private.png"],
        outputDir,
        "private-url",
      );

      expect(result.savedPaths).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain("localhost/private network");
    });

    it("should reject IPv4-mapped IPv6 private download URLs", async () => {
      const result = await saveImagesFromOutputs(
        ["http://[::ffff:127.0.0.1]/private.png"],
        outputDir,
        "private-ipv6-url",
      );

      expect(result.savedPaths).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain("localhost/private network");
    });
  });
});

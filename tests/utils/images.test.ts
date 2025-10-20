import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { 
  isUrl, 
  fileExists, 
  convertFileToBase64, 
  saveBase64Image, 
  saveImagesFromOutputs 
} from "../../src/utils/images.ts";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";

describe("Image Utils", () => {
  const testDir = path.join(import.meta.dir, "../temp");
  const testImagePath = path.join(testDir, "test.png");
  const outputDir = path.join(testDir, "output");

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    
    // Create a minimal PNG for testing
    const pngData = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE,
      0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54,
      0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF,
      0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
      0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
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
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
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
    // Mock fetch for URL testing
    const originalFetch = globalThis.fetch;
    
    beforeAll(() => {
      globalThis.fetch = async (url: string | URL) => {
        if (url.toString().includes("example.com")) {
          const pngData = await readFile(testImagePath);
          return new Response(pngData, { 
            status: 200, 
            headers: { "content-type": "image/png" } 
          });
        }
        return new Response("Not found", { status: 404 });
      };
    });

    afterAll(() => {
      globalThis.fetch = originalFetch;
    });

    it("should save images from URLs", async () => {
      const outputs = ["https://example.com/image1.png", "https://example.com/image2.png"];
      const taskId = "test-task-123";
      
      const result = await saveImagesFromOutputs(outputs, outputDir, taskId);
      
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
      const outputs = [
        "https://example.com/valid.png",
        "https://invalid-domain.test/fail.png",
        base64
      ];
      const taskId = "test-mixed-789";
      
      const result = await saveImagesFromOutputs(outputs, outputDir, taskId);
      
      expect(result.savedPaths).toHaveLength(2); // URL + base64 success
      expect(result.failed).toHaveLength(1); // Invalid URL failure
      expect(result.failed[0].index).toBe(1);
    });
  });
});
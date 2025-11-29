import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensurePrompt,
  parseImagesList,
  parseMaxImages,
  parseSize,
} from "../../src/utils/validation.ts";

describe("Validation Utils", () => {
  const testDir = path.join(import.meta.dir, "../fixtures");
  const testImagePath = path.join(testDir, "test-validation.png");

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
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
      await rm(testImagePath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("ensurePrompt", () => {
    it("should return trimmed prompt for valid input", () => {
      expect(ensurePrompt("  test prompt  ")).toBe("test prompt");
      expect(ensurePrompt("valid prompt")).toBe("valid prompt");
    });

    it("should throw error for empty or invalid prompts", () => {
      expect(() => ensurePrompt("")).toThrow("Prompt is required");
      expect(() => ensurePrompt("   ")).toThrow("Prompt is required");
      expect(() => ensurePrompt(null)).toThrow("Prompt is required");
      expect(() => ensurePrompt(undefined)).toThrow("Prompt is required");
    });
  });

  describe("parseSize", () => {
    it("should parse valid size formats", () => {
      expect(parseSize("1024*1024")).toBe("1024*1024");
      expect(parseSize("2048x2048")).toBe("2048*2048");
      expect(parseSize("1920X1080")).toBe("1920*1080");
      expect(parseSize("4096*4096")).toBe("4096*4096");
    });

    it("should use default size when no input provided", () => {
      expect(parseSize()).toBe("2048*2048");
      expect(parseSize("")).toBe("2048*2048");
      expect(parseSize(null)).toBe("2048*2048");
      expect(parseSize(undefined)).toBe("2048*2048");
    });

    it("should reject invalid size formats", () => {
      expect(() => parseSize("invalid")).toThrow("Size must be WIDTH*HEIGHT");
      expect(() => parseSize("1024")).toThrow("Size must be WIDTH*HEIGHT");
      expect(() => parseSize("1024*")).toThrow("Size must be WIDTH*HEIGHT");
      expect(() => parseSize("*1024")).toThrow("Size must be WIDTH*HEIGHT");
    });

    it("should reject sizes outside valid range", () => {
      expect(() => parseSize("512*1024")).toThrow(
        "Each size dimension must be between 1024 and 4096",
      );
      expect(() => parseSize("1024*512")).toThrow(
        "Each size dimension must be between 1024 and 4096",
      );
      expect(() => parseSize("5000*2048")).toThrow(
        "Each size dimension must be between 1024 and 4096",
      );
      expect(() => parseSize("2048*5000")).toThrow(
        "Each size dimension must be between 1024 and 4096",
      );
    });
  });

  describe("parseImagesList", () => {
    it("should handle valid URLs", async () => {
      const urls = "https://example.com/image1.jpg,https://example.com/image2.png";
      const result = await parseImagesList(urls, true, 10);
      expect(result).toEqual(["https://example.com/image1.jpg", "https://example.com/image2.png"]);
    });

    it("should handle local file paths", async () => {
      const result = await parseImagesList(testImagePath, true, 10);
      expect(result).toHaveLength(1);
      expect(result[0]).toStartWith("data:image/jpeg;base64,");
    });

    it("should handle mixed URLs and files", async () => {
      const mixed = `https://example.com/image.jpg,${testImagePath}`;
      const result = await parseImagesList(mixed, true, 10);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe("https://example.com/image.jpg");
      expect(result[1]).toStartWith("data:image/jpeg;base64,");
    });

    it("should return empty array when not required and no input", async () => {
      const result = await parseImagesList("", false, 10);
      expect(result).toEqual([]);
    });

    it("should throw when required but no input provided", async () => {
      await expect(parseImagesList("", true, 10)).rejects.toThrow("Images are required");
    });

    it("should throw when file doesn't exist", async () => {
      await expect(parseImagesList("nonexistent.jpg", true, 10)).rejects.toThrow(
        "Image file not found",
      );
    });

    it("should throw when invalid URL provided", async () => {
      await expect(parseImagesList("not-a-url-or-file", true, 10)).rejects.toThrow(
        "Image file not found",
      );
    });

    it("should enforce max image limit", async () => {
      const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/image${i}.jpg`).join(
        ",",
      );
      await expect(parseImagesList(urls, true, 10)).rejects.toThrow(
        "At most 10 images are allowed",
      );
    });
  });

  describe("parseMaxImages", () => {
    it("should parse valid max image values", () => {
      expect(parseMaxImages(1)).toBe(1);
      expect(parseMaxImages(5)).toBe(5);
      expect(parseMaxImages(15)).toBe(15);
      expect(parseMaxImages("10")).toBe(10);
    });

    it("should use default value when no input", () => {
      expect(parseMaxImages()).toBe(1);
      expect(parseMaxImages(null)).toBe(1);
      expect(parseMaxImages(undefined)).toBe(1);
    });

    it("should reject invalid ranges", () => {
      expect(() => parseMaxImages(0)).toThrow("max-images must be an integer between 1 and 15");
      expect(() => parseMaxImages(16)).toThrow("max-images must be an integer between 1 and 15");
      expect(() => parseMaxImages(-1)).toThrow("max-images must be an integer between 1 and 15");
      expect(() => parseMaxImages("invalid")).toThrow(
        "max-images must be an integer between 1 and 15",
      );
      expect(() => parseMaxImages(3.14)).toThrow("max-images must be an integer between 1 and 15");
    });
  });
});

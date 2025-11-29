import { describe, it, expect } from "bun:test";
import { spawn } from "bun";
import path from "node:path";

describe("CLI Integration Tests", () => {
  const cliPath = path.join(import.meta.dir, "../../dist/index.js");

  const runCLI = async (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const process = spawn([cliPath, ...args], {
      env: { ...Bun.env, WAVESPEED_API_KEY: "test-cli-key" },
      stdout: "pipe",
      stderr: "pipe"
    });

    const [stdout, stderr] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text()
    ]);
    
    await process.exited;

    return {
      stdout,
      stderr,
      exitCode: process.exitCode || 0
    };
  };

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
      expect(result.stdout).toContain("Enable synchronous mode");
    });
  });

  describe("Basic Validation", () => {
    it("should reject missing prompt for edit", async () => {
      const result = await runCLI(["edit", "-i", "https://example.com/test.jpg"]);
      
      expect(result.exitCode).toBe(1);
      // Error message could be in either stdout or stderr
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
      const result = await runCLI(["edit", "-p", "test", "-i", "https://example.com/test.jpg", "-s", "invalid"]);
      
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Size must be WIDTH*HEIGHT");
    });
  });
});
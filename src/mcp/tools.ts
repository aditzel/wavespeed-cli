import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "../config/load";
import { ConfigError, resolveModel } from "../config/models";
import {
  createMCPError,
  editImage,
  editSequential,
  formatForMCP,
  generateImage,
  generateSequential,
  type OutputMode,
} from "../core";
import { ensurePrompt, parseImagesList, parseMaxImages, parseSize } from "../utils/validation";

// Shared schemas
const outputModeSchema = z.enum(["urls", "paths", "base64"]).default("urls");
const sizeSchema = z.string().default("2048*2048");
const modelSchema = z.string().optional();
const outputDirSchema = z.string().default("./output");

/**
 * Register all MCP tools
 */
export function registerTools(server: McpServer): void {
  registerGenerateTool(server);
  registerEditTool(server);
  registerGenerateSequentialTool(server);
  registerEditSequentialTool(server);
}

/**
 * Generate tool - text to image
 */
function registerGenerateTool(server: McpServer): void {
  server.registerTool(
    "generate",
    {
      title: "Generate Image",
      description: "Generate images from text prompts using Wavespeed AI",
      inputSchema: {
        prompt: z.string().describe("Text description of image to generate"),
        size: sizeSchema.describe("Image size WxH (1024-4096, default: 2048*2048)"),
        model: modelSchema.describe("Model ID (optional, uses config default)"),
        output: outputModeSchema.describe("Output format: urls, paths (save files), or base64"),
        outputDir: outputDirSchema.describe("Directory to save images (for paths mode)"),
      },
    },
    async ({ prompt, size, model, output, outputDir }) => {
      try {
        const validatedPrompt = ensurePrompt(prompt);
        const validatedSize = parseSize(size);
        const outputMode = output as OutputMode;

        const { config } = loadConfig();
        const resolvedModel = resolveModel("generate", model, config);

        const result = await generateImage({
          prompt: validatedPrompt,
          size: validatedSize,
          base64Output: outputMode === "base64",
          syncMode: true,
          model: resolvedModel,
        });

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  createMCPError(
                    "task_failed",
                    result.error || "Generation failed",
                    "Check prompt and try again",
                  ),
                ),
              },
            ],
            isError: true,
          };
        }

        const formatted = await formatForMCP(result, outputMode, outputDir);
        return {
          content: [{ type: "text", text: JSON.stringify(formatted) }],
        };
      } catch (err) {
        const error = err as Error | ConfigError;
        if (error instanceof ConfigError) {
          return {
            content: [
              { type: "text", text: JSON.stringify(createMCPError("config_error", error.message)) },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(createMCPError("error", error.message)) }],
          isError: true,
        };
      }
    },
  );
}

/**
 * Edit tool - image to image
 */
function registerEditTool(server: McpServer): void {
  server.registerTool(
    "edit",
    {
      title: "Edit Image",
      description: "Edit images using text prompts with Wavespeed AI",
      inputSchema: {
        prompt: z.string().describe("Text description of desired edits"),
        images: z.array(z.string()).max(10).describe("Image URLs or base64 data (max 10)"),
        size: sizeSchema.describe("Output image size WxH (default: 2048*2048)"),
        model: modelSchema.describe("Model ID (optional)"),
        output: outputModeSchema.describe("Output format: urls, paths, or base64"),
        outputDir: outputDirSchema.describe("Directory to save images"),
      },
    },
    async ({ prompt, images, size, model, output, outputDir }) => {
      try {
        const validatedPrompt = ensurePrompt(prompt);
        const validatedImages = await parseImagesList(images.join(","), true, 10);
        const validatedSize = parseSize(size);
        const outputMode = output as OutputMode;

        const { config } = loadConfig();
        const resolvedModel = resolveModel("edit", model, config);

        const result = await editImage({
          prompt: validatedPrompt,
          images: validatedImages,
          size: validatedSize,
          base64Output: outputMode === "base64",
          syncMode: true,
          model: resolvedModel,
        });

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(createMCPError("task_failed", result.error || "Edit failed")),
              },
            ],
            isError: true,
          };
        }

        const formatted = await formatForMCP(result, outputMode, outputDir);
        return {
          content: [{ type: "text", text: JSON.stringify(formatted) }],
        };
      } catch (err) {
        const error = err as Error | ConfigError;
        if (error instanceof ConfigError) {
          return {
            content: [
              { type: "text", text: JSON.stringify(createMCPError("config_error", error.message)) },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(createMCPError("error", error.message)) }],
          isError: true,
        };
      }
    },
  );
}

/**
 * Generate sequential tool - multiple consistent images
 */
function registerGenerateSequentialTool(server: McpServer): void {
  server.registerTool(
    "generate_sequential",
    {
      title: "Generate Sequential",
      description: "Generate multiple consistent images from text prompts",
      inputSchema: {
        prompt: z.string().describe("Text description of images to generate"),
        count: z.number().int().min(1).max(15).default(1).describe("Number of images (1-15)"),
        size: sizeSchema.describe("Image size WxH (default: 2048*2048)"),
        model: modelSchema.describe("Model ID (optional)"),
        output: outputModeSchema.describe("Output format: urls, paths, or base64"),
        outputDir: outputDirSchema.describe("Directory to save images"),
      },
    },
    async ({ prompt, count, size, model, output, outputDir }) => {
      try {
        const validatedPrompt = ensurePrompt(prompt);
        const validatedCount = parseMaxImages(count?.toString());
        const validatedSize = parseSize(size);
        const outputMode = output as OutputMode;

        const { config } = loadConfig();
        const resolvedModel = resolveModel("generate-sequential", model, config);

        const result = await generateSequential({
          prompt: validatedPrompt,
          maxImages: validatedCount,
          size: validatedSize,
          base64Output: outputMode === "base64",
          syncMode: true,
          model: resolvedModel,
        });

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  createMCPError("task_failed", result.error || "Generation failed"),
                ),
              },
            ],
            isError: true,
          };
        }

        const formatted = await formatForMCP(result, outputMode, outputDir);
        return {
          content: [{ type: "text", text: JSON.stringify(formatted) }],
        };
      } catch (err) {
        const error = err as Error | ConfigError;
        if (error instanceof ConfigError) {
          return {
            content: [
              { type: "text", text: JSON.stringify(createMCPError("config_error", error.message)) },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(createMCPError("error", error.message)) }],
          isError: true,
        };
      }
    },
  );
}

/**
 * Edit sequential tool - edit multiple images with consistency
 */
function registerEditSequentialTool(server: McpServer): void {
  server.registerTool(
    "edit_sequential",
    {
      title: "Edit Sequential",
      description: "Edit multiple images sequentially with consistency",
      inputSchema: {
        prompt: z.string().describe("Text description of desired edits"),
        images: z.array(z.string()).max(10).optional().describe("Optional input images (max 10)"),
        count: z
          .number()
          .int()
          .min(1)
          .max(15)
          .default(1)
          .describe("Number of output images (1-15)"),
        size: sizeSchema.describe("Output image size WxH (default: 2048*2048)"),
        model: modelSchema.describe("Model ID (optional)"),
        output: outputModeSchema.describe("Output format: urls, paths, or base64"),
        outputDir: outputDirSchema.describe("Directory to save images"),
      },
    },
    async ({ prompt, images, count, size, model, output, outputDir }) => {
      try {
        const validatedPrompt = ensurePrompt(prompt);
        const validatedImages = images?.length
          ? await parseImagesList(images.join(","), false, 10)
          : undefined;
        const validatedCount = parseMaxImages(count?.toString());
        const validatedSize = parseSize(size);
        const outputMode = output as OutputMode;

        const { config } = loadConfig();
        const resolvedModel = resolveModel("edit-sequential", model, config);

        const result = await editSequential({
          prompt: validatedPrompt,
          images: validatedImages,
          maxImages: validatedCount,
          size: validatedSize,
          base64Output: outputMode === "base64",
          syncMode: true,
          model: resolvedModel,
        });

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(createMCPError("task_failed", result.error || "Edit failed")),
              },
            ],
            isError: true,
          };
        }

        const formatted = await formatForMCP(result, outputMode, outputDir);
        return {
          content: [{ type: "text", text: JSON.stringify(formatted) }],
        };
      } catch (err) {
        const error = err as Error | ConfigError;
        if (error instanceof ConfigError) {
          return {
            content: [
              { type: "text", text: JSON.stringify(createMCPError("config_error", error.message)) },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(createMCPError("error", error.message)) }],
          isError: true,
        };
      }
    },
  );
}

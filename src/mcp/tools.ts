import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ModelCache } from "../cache";
import { loadConfig } from "../config/load";
import { ConfigError, resolveModel } from "../config/models";
import { getAllRegistryModels, type RegistryModel } from "../config/registry";
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
  registerListModelsTool(server);
  registerGenerateTool(server);
  registerEditTool(server);
  registerGenerateSequentialTool(server);
  registerEditSequentialTool(server);
}

/**
 * List models tool - discover available models with smart defaults and filtering
 *
 * Default response (no filters): Returns summary stats + recommended models (~600 tokens)
 * With filters: Returns matching models up to limit
 */
function registerListModelsTool(server: McpServer): void {
  server.registerTool(
    "list_models",
    {
      title: "List Models",
      description:
        "List available Wavespeed AI models with their capabilities. Call this to discover valid model IDs before using generate/edit tools.",
      inputSchema: {
        type: z
          .string()
          .optional()
          .describe("Filter by model type (e.g., 'text-to-image', 'text-to-video')"),
        search: z
          .string()
          .optional()
          .describe("Search models by name or ID (e.g., 'flux', 'seedream')"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Maximum models to return (default: 20)"),
        refresh: z.boolean().default(false).describe("Force refresh from API"),
      },
    },
    async ({ type, search, limit, refresh }) => {
      const apiKey = process.env.WAVESPEED_API_KEY;

      // If no API key, fall back to registry
      if (!apiKey) {
        return formatRegistryFallback();
      }

      const cache = ModelCache.getInstance();

      try {
        // Load models (from cache or API)
        await cache.getModels(apiKey, { forceRefresh: refresh });

        // No filters = return smart summary
        if (!type && !search) {
          const summary = cache.getSummary();
          const recommended = await cache.getRecommendedModelsAsync();

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  summary: {
                    totalModels: summary.totalModels,
                    types: summary.types,
                    typeCount: summary.typeCount,
                    typeCounts: summary.typeCounts,
                  },
                  recommended: recommended.map((r) => ({
                    id: r.id,
                    type: r.type,
                    desc: r.desc,
                  })),
                  usage:
                    "Use 'type' or 'search' params to filter. Use model 'id' in generate/edit tools.",
                  source: "api_cached",
                }),
              },
            ],
          };
        }

        // With filters = return filtered list
        const filtered = cache.filterModels({ type, search, limit });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                models: filtered.map((m) => ({
                  id: m.model_id,
                  name: m.name,
                  type: m.type,
                })),
                meta: {
                  total: type
                    ? cache.getTypeCounts()[type] || 0
                    : search
                      ? cache.searchModels(search).length
                      : cache.getModelCount(),
                  returned: filtered.length,
                  filter: { ...(type && { type }), ...(search && { search }) },
                },
                source: "api_cached",
              }),
            },
          ],
        };
      } catch {
        // API/cache failed, fall back to registry
        return formatRegistryFallback();
      }
    },
  );
}

/**
 * Format registry fallback response
 */
function formatRegistryFallback() {
  const registryModels: RegistryModel[] = getAllRegistryModels();
  const models = registryModels.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    capabilities: m.capabilities,
    recommended: m.isRecommended || false,
  }));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          models,
          source: "registry",
          note: "API unavailable. Use model 'id' in generate/edit tools.",
        }),
      },
    ],
  };
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

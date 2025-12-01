import { saveImagesFromOutputs } from "../utils/images";
import type { ImageOutput, MCPError, MCPToolResponse, OperationResult, OutputMode } from "./types";

/**
 * Format operation result for CLI output (console logging + file saving)
 */
export async function formatForCLI(
  result: OperationResult,
  outputDir: string,
  base64Mode: boolean,
): Promise<{ savedPaths: string[]; failed: Array<{ index: number; reason: string }> }> {
  // Print task info
  console.log("Task ID:", result.taskId);
  console.log("Status:", result.status);

  if (result.timingMs != null) {
    console.log("Inference time ms:", result.timingMs);
  }

  if (result.hasNsfw?.some(Boolean)) {
    console.warn("Warning: NSFW content flagged in one or more outputs");
  }

  if (!result.success) {
    console.error("Error:", result.error);
    return { savedPaths: [], failed: [] };
  }

  // Print outputs
  if (result.outputs.length) {
    if (base64Mode) {
      console.log("Outputs base64:");
    } else {
      console.log("Outputs urls:");
    }
    result.outputs.forEach((o, idx) => {
      console.log(`${idx + 1}. ${o}`);
    });

    // Save images
    const { savedPaths, failed } = await saveImagesFromOutputs(
      result.outputs,
      outputDir,
      result.taskId,
    );

    console.log("\nSaved files:");
    savedPaths.forEach((p) => {
      console.log(`  ${p}`);
    });

    if (failed.length) {
      console.warn(`\nFailed to save ${failed.length} image(s):`);
      failed.forEach((f) => {
        console.warn(`  #${f.index + 1}: ${f.reason}`);
      });
    }

    return { savedPaths, failed };
  }

  console.warn("No images were returned by the API.");
  return { savedPaths: [], failed: [] };
}

/**
 * Format operation result for MCP response (structured JSON)
 * Token-efficient: only includes relevant fields based on output mode
 */
export async function formatForMCP(
  result: OperationResult,
  outputMode: OutputMode,
  outputDir: string,
): Promise<MCPToolResponse> {
  // Handle errors
  if (!result.success) {
    return {
      id: result.taskId || "unknown",
      status: "failed",
      images: [],
      error: result.error,
    };
  }

  const images: ImageOutput[] = [];

  // Format based on output mode
  switch (outputMode) {
    case "urls": {
      // Most token-efficient: just URLs
      for (let i = 0; i < result.outputs.length; i++) {
        images.push({
          index: i,
          url: result.outputs[i],
        });
      }
      break;
    }

    case "paths": {
      // URLs + saved file paths
      const { savedPaths } = await saveImagesFromOutputs(result.outputs, outputDir, result.taskId);

      for (let i = 0; i < result.outputs.length; i++) {
        images.push({
          index: i,
          url: result.outputs[i],
          path: savedPaths[i] || undefined,
        });
      }
      break;
    }

    case "base64": {
      // Base64 data (outputs are already base64 when base64Output=true)
      for (let i = 0; i < result.outputs.length; i++) {
        images.push({
          index: i,
          data: result.outputs[i],
        });
      }
      break;
    }
  }

  const response: MCPToolResponse = {
    id: result.taskId,
    status: "completed",
    images,
  };

  // Only include timing if available
  if (result.timingMs != null) {
    response.timing_ms = result.timingMs;
  }

  return response;
}

/**
 * Create a compact MCP error response
 */
export function createMCPError(code: string, message: string, fix?: string): MCPError {
  const error: MCPError = { error: code, message };
  if (fix) {
    error.fix = fix;
  }
  return error;
}

/**
 * Common error codes and their compact representations
 */
export const MCPErrorCodes = {
  NO_API_KEY: (envVar: string) =>
    createMCPError("no_api_key", `${envVar} not set`, "Set environment variable"),

  INVALID_SIZE: () =>
    createMCPError("invalid_size", "Size must be 1024-4096", "Use format: 2048*2048"),

  INVALID_PROMPT: () =>
    createMCPError("missing_prompt", "Prompt is required", "Provide prompt text"),

  INVALID_IMAGES: () =>
    createMCPError("invalid_images", "Images array required", "Provide image URLs or base64"),

  UNKNOWN_MODEL: (modelId: string) =>
    createMCPError("unknown_model", `Model '${modelId}' not found`, "Check available models"),

  TASK_FAILED: (reason?: string) =>
    createMCPError(
      "task_failed",
      reason || "Image generation failed",
      "Check prompt and try again",
    ),

  TIMEOUT: (taskId: string) =>
    createMCPError("timeout", `Task ${taskId} timed out`, "Try again or use smaller size"),
} as const;

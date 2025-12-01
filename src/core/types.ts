import type { ResolvedModel } from "../config/types";

/** Output mode for image generation results */
export type OutputMode = "urls" | "paths" | "base64";

/** Command types supported by the CLI/MCP */
export type CommandType = "generate" | "edit" | "generate-sequential" | "edit-sequential";

/** Result of any image generation operation */
export interface OperationResult {
  success: boolean;
  taskId: string;
  status: "completed" | "failed";
  outputs: string[];
  timingMs?: number;
  hasNsfw?: boolean[];
  error?: string;
}

/** Base parameters for all operations */
export interface BaseOperationParams {
  prompt: string;
  size?: string;
  base64Output?: boolean;
  syncMode?: boolean;
}

/** Parameters for generate operation */
export interface GenerateParams extends BaseOperationParams {
  model: ResolvedModel;
}

/** Parameters for edit operation */
export interface EditParams extends BaseOperationParams {
  model: ResolvedModel;
  images: string[];
}

/** Parameters for generate-sequential operation */
export interface GenerateSequentialParams extends BaseOperationParams {
  model: ResolvedModel;
  maxImages?: number;
}

/** Parameters for edit-sequential operation */
export interface EditSequentialParams extends BaseOperationParams {
  model: ResolvedModel;
  images?: string[];
  maxImages?: number;
}

/** Image output with index for structured responses */
export interface ImageOutput {
  index: number;
  url?: string;
  path?: string;
  data?: string;
}

/** Formatted MCP response */
export interface MCPToolResponse {
  id: string;
  status: "completed" | "failed";
  images: ImageOutput[];
  timing_ms?: number;
  error?: string;
}

/** Compact error format for MCP */
export interface MCPError {
  error: string;
  message: string;
  fix?: string;
}

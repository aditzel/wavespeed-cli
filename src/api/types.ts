export type JobStatus = "created" | "processing" | "completed" | "succeeded" | "failed";

export interface Timings {
  inference?: number;
}

export interface TaskData {
  id: string;
  status: JobStatus;
  outputs?: string[];
  error?: string | null;
  has_nsfw_contents?: boolean[];
  timings?: Timings;
}

export interface ApiEnvelope {
  data: TaskData;
}

export interface GenerateRequest {
  prompt: string;
  size?: string;
  enable_base64_output?: boolean;
  enable_sync_mode?: boolean;
}

export interface EditRequest extends GenerateRequest {
  images: string[];
  enable_sync_mode?: boolean;
}

export interface SequentialGenerateRequest extends GenerateRequest {
  max_images?: number;
}

export interface SequentialEditRequest extends SequentialGenerateRequest {
  images?: string[];
}

export interface ModelSchema {
  model_id: string;
  name: string;
  base_price: number;
  description: string;
  type: string;
  api_schema?: unknown;
}

export interface ModelsListResponse {
  code: number;
  message: string;
  data: ModelSchema[];
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function encodeRequestId(id: string): string {
  if (!id || !REQUEST_ID_PATTERN.test(id)) {
    throw new Error("Invalid prediction request id");
  }
  return encodeURIComponent(id);
}

export const BASE_URL = "https://api.wavespeed.ai";
export const endpoints = {
  result: (id: string) => `/api/v3/predictions/${encodeRequestId(id)}/result`,
  models: "/api/v3/models",
};

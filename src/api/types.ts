export type JobStatus = "created" | "processing" | "completed" | "failed";

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
  api_schema?: any;
}

export interface ModelsListResponse {
  code: number;
  message: string;
  data: ModelSchema[];
}

export const BASE_URL = "https://api.wavespeed.ai";
export const endpoints = {
  generate: "/api/v3/bytedance/seedream-v4",
  edit: "/api/v3/bytedance/seedream-v4/edit",
  generateSequential: "/api/v3/bytedance/seedream-v4/sequential",
  editSequential: "/api/v3/bytedance/seedream-v4/edit-sequential",
  result: (id: string) => `/api/v3/predictions/${id}/result`,
  models: "/api/v3/models",
};

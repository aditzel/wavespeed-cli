import { endpoints, submitTask } from "../api/client";
import { pollUntilDone } from "../utils/polling";
import type {
  EditParams,
  EditSequentialParams,
  GenerateParams,
  GenerateSequentialParams,
  OperationResult,
} from "./types";

/**
 * Core generate operation - text to image
 */
export async function generateImage(params: GenerateParams): Promise<OperationResult> {
  const { prompt, size = "2048*2048", base64Output = false, syncMode = true, model } = params;

  const payload: Record<string, unknown> = {
    prompt,
    size,
    enable_base64_output: base64Output,
    enable_sync_mode: syncMode,
    model: model.modelName ?? model.id,
  };

  try {
    const created = await submitTask(model, endpoints.generate, payload);
    const final = await pollUntilDone(created.id);

    if (final.status === "failed") {
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Task failed",
      };
    }

    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    return {
      success: false,
      taskId: "",
      status: "failed",
      outputs: [],
      error: (err as Error).message,
    };
  }
}

/**
 * Core edit operation - image to image
 */
export async function editImage(params: EditParams): Promise<OperationResult> {
  const {
    prompt,
    images,
    size = "2048*2048",
    base64Output = false,
    syncMode = true,
    model,
  } = params;

  const payload: Record<string, unknown> = {
    prompt,
    images,
    size,
    enable_base64_output: base64Output,
    enable_sync_mode: syncMode,
    model: model.modelName ?? model.id,
  };

  try {
    const created = await submitTask(model, endpoints.edit, payload);
    const final = await pollUntilDone(created.id);

    if (final.status === "failed") {
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Task failed",
      };
    }

    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    return {
      success: false,
      taskId: "",
      status: "failed",
      outputs: [],
      error: (err as Error).message,
    };
  }
}

/**
 * Core generate-sequential operation - multiple consistent images
 */
export async function generateSequential(
  params: GenerateSequentialParams,
): Promise<OperationResult> {
  const {
    prompt,
    maxImages = 1,
    size = "2048*2048",
    base64Output = false,
    syncMode = true,
    model,
  } = params;

  const payload: Record<string, unknown> = {
    prompt,
    max_images: maxImages,
    size,
    enable_base64_output: base64Output,
    enable_sync_mode: syncMode,
    model: model.modelName ?? model.id,
  };

  try {
    const created = await submitTask(model, endpoints.generateSequential, payload);
    const final = await pollUntilDone(created.id);

    if (final.status === "failed") {
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Task failed",
      };
    }

    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    return {
      success: false,
      taskId: "",
      status: "failed",
      outputs: [],
      error: (err as Error).message,
    };
  }
}

/**
 * Core edit-sequential operation - edit multiple images with consistency
 */
export async function editSequential(params: EditSequentialParams): Promise<OperationResult> {
  const {
    prompt,
    images,
    maxImages = 1,
    size = "2048*2048",
    base64Output = false,
    syncMode = true,
    model,
  } = params;

  const payload: Record<string, unknown> = {
    prompt,
    max_images: maxImages,
    size,
    enable_base64_output: base64Output,
    enable_sync_mode: syncMode,
    model: model.modelName ?? model.id,
  };

  if (images && images.length > 0) {
    payload.images = images;
  }

  try {
    const created = await submitTask(model, endpoints.editSequential, payload);
    const final = await pollUntilDone(created.id);

    if (final.status === "failed") {
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Task failed",
      };
    }

    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    return {
      success: false,
      taskId: "",
      status: "failed",
      outputs: [],
      error: (err as Error).message,
    };
  }
}

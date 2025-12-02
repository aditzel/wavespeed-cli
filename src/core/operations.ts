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
    console.error(`[DEBUG] generateImage: Submitting task with model=${model.id}, size=${size}, syncMode=${syncMode}`);
    const created = await submitTask(model, endpoints.generate, payload);
    console.error(`[DEBUG] generateImage: Task submitted, id=${created.id}, status=${created.status}`);
    const final = await pollUntilDone(model, created.id);

    if (final.status === "failed") {
      console.error(`[DEBUG] generateImage: Task ${final.id} failed: ${final.error || "Unknown error"}`);
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Task failed",
      };
    }

    console.error(`[DEBUG] generateImage: Task ${final.id} completed successfully, outputs=${final.outputs?.length || 0}`);
    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    console.error(`[DEBUG] generateImage: Exception caught: ${(err as Error).message}`);
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
    console.error(`[DEBUG] editImage: Submitting task with model=${model.id}, size=${size}, images=${images.length}, syncMode=${syncMode}`);
    const created = await submitTask(model, endpoints.edit, payload);
    console.error(`[DEBUG] editImage: Task submitted, id=${created.id}, status=${created.status}`);
    const final = await pollUntilDone(model, created.id);

    if (final.status === "failed") {
      console.error(`[DEBUG] editImage: Task ${final.id} failed: ${final.error || "Unknown error"}`);
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Edit failed",
      };
    }

    console.error(`[DEBUG] editImage: Task ${final.id} completed successfully, outputs=${final.outputs?.length || 0}`);
    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    console.error(`[DEBUG] editImage: Exception caught: ${(err as Error).message}`);
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
    console.error(`[DEBUG] generateSequential: Submitting task with model=${model.id}, maxImages=${maxImages}, size=${size}, syncMode=${syncMode}`);
    const created = await submitTask(model, endpoints.generateSequential, payload);
    console.error(`[DEBUG] generateSequential: Task submitted, id=${created.id}, status=${created.status}`);
    const final = await pollUntilDone(model, created.id);

    if (final.status === "failed") {
      console.error(`[DEBUG] generateSequential: Task ${final.id} failed: ${final.error || "Unknown error"}`);
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Generation failed",
      };
    }

    console.error(`[DEBUG] generateSequential: Task ${final.id} completed successfully, outputs=${final.outputs?.length || 0}`);
    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    console.error(`[DEBUG] generateSequential: Exception caught: ${(err as Error).message}`);
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
    console.error(`[DEBUG] editSequential: Submitting task with model=${model.id}, maxImages=${maxImages}, size=${size}, images=${images?.length || 0}, syncMode=${syncMode}`);
    const created = await submitTask(model, endpoints.editSequential, payload);
    console.error(`[DEBUG] editSequential: Task submitted, id=${created.id}, status=${created.status}`);
    const final = await pollUntilDone(model, created.id);

    if (final.status === "failed") {
      console.error(`[DEBUG] editSequential: Task ${final.id} failed: ${final.error || "Unknown error"}`);
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Edit failed",
      };
    }

    console.error(`[DEBUG] editSequential: Task ${final.id} completed successfully, outputs=${final.outputs?.length || 0}`);
    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    console.error(`[DEBUG] editSequential: Exception caught: ${(err as Error).message}`);
    return {
      success: false,
      taskId: "",
      status: "failed",
      outputs: [],
      error: (err as Error).message,
    };
  }
}

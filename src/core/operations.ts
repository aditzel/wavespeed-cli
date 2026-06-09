import { submitTask } from "../api/client";
import { debugLog } from "../utils/logging.ts";
import { buildEditPayload } from "../utils/model-routing.ts";
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
  };

  try {
    debugLog(
      `[DEBUG] generateImage: Submitting task with model=${model.id}, size=${size}, syncMode=${syncMode}`,
    );
    const created = await submitTask(model, "generate", payload);
    debugLog(`[DEBUG] generateImage: Task submitted, id=${created.id}, status=${created.status}`);
    const final = await pollUntilDone(model, created.id);

    if (final.status === "failed") {
      debugLog(`[DEBUG] generateImage: Task ${final.id} failed: ${final.error || "Unknown error"}`);
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Task failed",
      };
    }

    debugLog(
      `[DEBUG] generateImage: Task ${final.id} completed successfully, outputs=${final.outputs?.length || 0}`,
    );
    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    debugLog(`[DEBUG] generateImage: Exception caught: ${(err as Error).message}`);
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
  const { images, model } = params;

  try {
    const payload = buildEditPayload(params);
    debugLog(
      `[DEBUG] editImage: Submitting task with model=${model.id}, images=${images.length}, aiRemover=${"image" in payload}, payloadKeys=${Object.keys(payload).join(",")}`,
    );
    const created = await submitTask(model, "edit", payload);
    debugLog(`[DEBUG] editImage: Task submitted, id=${created.id}, status=${created.status}`);
    const final = await pollUntilDone(model, created.id);

    if (final.status === "failed") {
      debugLog(`[DEBUG] editImage: Task ${final.id} failed: ${final.error || "Unknown error"}`);
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Edit failed",
      };
    }

    debugLog(
      `[DEBUG] editImage: Task ${final.id} completed successfully, outputs=${final.outputs?.length || 0}`,
    );
    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    debugLog(`[DEBUG] editImage: Exception caught: ${(err as Error).message}`);
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
  };

  try {
    debugLog(
      `[DEBUG] generateSequential: Submitting task with model=${model.id}, maxImages=${maxImages}, size=${size}, syncMode=${syncMode}`,
    );
    const created = await submitTask(model, "generate-sequential", payload);
    debugLog(
      `[DEBUG] generateSequential: Task submitted, id=${created.id}, status=${created.status}`,
    );
    const final = await pollUntilDone(model, created.id);

    if (final.status === "failed") {
      debugLog(
        `[DEBUG] generateSequential: Task ${final.id} failed: ${final.error || "Unknown error"}`,
      );
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Generation failed",
      };
    }

    debugLog(
      `[DEBUG] generateSequential: Task ${final.id} completed successfully, outputs=${final.outputs?.length || 0}`,
    );
    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    debugLog(`[DEBUG] generateSequential: Exception caught: ${(err as Error).message}`);
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
  };

  if (images && images.length > 0) {
    payload.images = images;
  }

  try {
    debugLog(
      `[DEBUG] editSequential: Submitting task with model=${model.id}, maxImages=${maxImages}, size=${size}, images=${images?.length || 0}, syncMode=${syncMode}`,
    );
    const created = await submitTask(model, "edit-sequential", payload);
    debugLog(`[DEBUG] editSequential: Task submitted, id=${created.id}, status=${created.status}`);
    const final = await pollUntilDone(model, created.id);

    if (final.status === "failed") {
      debugLog(
        `[DEBUG] editSequential: Task ${final.id} failed: ${final.error || "Unknown error"}`,
      );
      return {
        success: false,
        taskId: final.id,
        status: "failed",
        outputs: [],
        error: final.error || "Edit failed",
      };
    }

    debugLog(
      `[DEBUG] editSequential: Task ${final.id} completed successfully, outputs=${final.outputs?.length || 0}`,
    );
    return {
      success: true,
      taskId: final.id,
      status: "completed",
      outputs: final.outputs || [],
      timingMs: final.timings?.inference,
      hasNsfw: final.has_nsfw_contents,
    };
  } catch (err) {
    debugLog(`[DEBUG] editSequential: Exception caught: ${(err as Error).message}`);
    return {
      success: false,
      taskId: "",
      status: "failed",
      outputs: [],
      error: (err as Error).message,
    };
  }
}

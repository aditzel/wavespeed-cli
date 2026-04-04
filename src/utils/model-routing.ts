import type { ResolvedModel } from "../config/types.ts";
import type { EditParams } from "../core/types.ts";

const AI_REMOVER_MODEL_HINTS = [
  "remove-background",
  "background-remover",
  "image-eraser",
  "image-text-remover",
  "image-watermark-remover",
] as const;

function getModelRef(model: ResolvedModel): string {
  return model.modelName ?? model.id;
}

export function inferApiModelType(modelRef?: string): string | undefined {
  if (!modelRef) {
    return undefined;
  }

  const lower = modelRef.toLowerCase();
  return AI_REMOVER_MODEL_HINTS.some((hint) => lower.includes(hint)) ? "ai-remover" : undefined;
}

export function isAiRemoverModel(model: ResolvedModel): boolean {
  return (
    model.apiModelType === "ai-remover" || inferApiModelType(getModelRef(model)) === "ai-remover"
  );
}

function supportsPromptDrivenAiRemoval(model: ResolvedModel): boolean {
  return getModelRef(model).toLowerCase().includes("image-eraser");
}

export function buildEditPayload(params: EditParams): Record<string, unknown> {
  const {
    prompt,
    images,
    size = "2048*2048",
    base64Output = false,
    syncMode = true,
    model,
  } = params;

  if (!isAiRemoverModel(model)) {
    return {
      prompt,
      images,
      size,
      enable_base64_output: base64Output,
      enable_sync_mode: syncMode,
    };
  }

  if (images.length !== 1) {
    throw new Error(`Model '${model.id}' accepts exactly 1 input image`);
  }

  const payload: Record<string, unknown> = {
    image: images[0],
    enable_base64_output: base64Output,
    enable_sync_mode: syncMode,
  };

  if (supportsPromptDrivenAiRemoval(model) && prompt.trim()) {
    payload.prompt = prompt;
  }

  return payload;
}

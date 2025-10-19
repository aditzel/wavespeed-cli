import { Command } from "commander";
import { submitTask, endpoints } from "../api/client.ts";
import { pollUntilDone } from "../utils/polling.ts";
import { ensurePrompt, parseSize, parseImagesList, parseMaxImages } from "../utils/validation.ts";
import { TaskData } from "../api/types.ts";

function printResult(d: TaskData, base64: boolean) {
  console.log("Task ID:", d.id);
  console.log("Status:", d.status);
  if (d.timings?.inference != null) {
    console.log("Inference time ms:", d.timings.inference);
  }
  if (d.has_nsfw_contents && d.has_nsfw_contents.some(Boolean)) {
    console.warn("Warning: NSFW content flagged in one or more outputs");
  }
  if (d.outputs?.length) {
    if (base64) {
      console.log("Outputs base64:");
    } else {
      console.log("Outputs urls:");
    }
    d.outputs.forEach((o, idx) => console.log(`${idx + 1}. ${o}`));
  }
}

export function registerEditSequential(program: Command) {
  program
    .command("edit-sequential")
    .description("Sequential image editing with consistency")
    .option("-p, --prompt [value]", "Prompt text")
    .option("-i, --images [value]", "Comma separated image URLs, max 10")
    .option("-m, --max-images [value]", "Max images, default 1")
    .option("-s, --size [value]", "Image size WIDTH*HEIGHT, default 2048*2048")
    .option("--base64", "Return base64 outputs instead of URLs")
    .option("--no-wait", "Return immediately without polling")
    .action(async (opts) => {
      try {
        const prompt = ensurePrompt(opts.prompt);
        const images = parseImagesList(opts.images, false, 10);
        const max_images = parseMaxImages(opts.maxImages);
        const size = parseSize(opts.size);
        const base64 = Boolean(opts.base64);

        const payload: any = { prompt, max_images, size, enable_base64_output: base64 };
        if (images.length) payload.images = images;

        const created = await submitTask(endpoints.editSequential, payload);

        if (opts.wait === false) {
          console.log("Task created");
          console.log("Task ID:", created.id);
          console.log("Result URL:");
          console.log(`https://api.wavespeed.ai/api/v3/predictions/${created.id}/result`);
          console.log("Use your WAVESPEED_API_KEY for Authorization header to check status.");
          return;
        }

        const final = await pollUntilDone(created.id);
        if (final.status === "failed") {
          throw new Error(final.error || "Task failed");
        }
        printResult(final, base64);
      } catch (err: any) {
        console.error("edit-sequential error:", err?.message ?? err);
        process.exit(1);
      }
    });
}

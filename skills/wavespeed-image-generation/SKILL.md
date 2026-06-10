---
name: wavespeed-image-generation
description: Generate and edit AI images with wavespeed-cli, preferring its MCP server and falling back to CLI commands when MCP is unavailable or the agent prefers shell execution. Use when a user asks to create images, edit existing images, generate image sequences or storyboards, choose Wavespeed models, configure Wavespeed API access, save outputs, or connect image generation to an agentic coding workflow.
license: MIT
compatibility: Requires a Wavespeed API key in WAVESPEED_API_KEY and either a configured wavespeed MCP server or the wavespeed CLI running on Bun.
---

# Wavespeed Image Generation

Use `wavespeed-cli` to generate and edit images. Prefer MCP tools because they return structured, token-efficient results and can save files for the user. Use CLI commands when MCP is not configured, when the user asks for terminal commands, or when shell execution is more convenient.

## Safety and cost rules

- Never print, persist, or commit API keys. Use `WAVESPEED_API_KEY`.
- Ask before running large batches, high-resolution generations, or repeated retries that may incur cost.
- Save outputs to an explicit directory when the user expects files.
- Prefer URL or file-path outputs over base64 unless the user specifically needs inline image data.
- If the user asks for disallowed, unsafe, or rights-infringing content, refuse or redirect to a safe alternative.

## MCP-first workflow

1. Check whether a Wavespeed MCP server/toolset is available.
2. Call the model listing tool before selecting a non-default model. Prefer a model whose type matches the task (`text-to-image`, `image-to-image`, sequential/storyboard-capable, or a specific requested model family).
3. Use MCP image tools with structured arguments:
   - `list_models`: discover valid model ids and current model types/prices.
   - `generate`: text-to-image.
   - `edit`: image-to-image with URLs, local files converted by the tool, or base64 data.
   - `generate_sequential`: multiple consistent images from a prompt.
   - `edit_sequential`: sequential outputs with optional reference images.
4. Choose output mode:
   - `paths` when the user wants downloaded files.
   - `urls` when the user only needs links or a compact response.
   - `base64` only for systems that require inline image bytes.
5. Return the task id, model used if known, output paths/URLs, and any warnings.

Typical MCP arguments:

```json
{
  "prompt": "a cinematic robot gardener in a greenhouse",
  "size": "2048*2048",
  "model": "optional-model-id",
  "output": "paths",
  "outputDir": "./output"
}
```

## CLI fallback

If MCP is unavailable, use the `wavespeed` command:

```bash
export WAVESPEED_API_KEY="..." # user-provided; do not echo it back
wavespeed models
wavespeed generate --prompt "a cinematic robot gardener in a greenhouse" --output-dir ./output
wavespeed edit --prompt "make it watercolor" --images ./input.png --output-dir ./output
wavespeed generate-sequential --prompt "spaceship launch storyboard in 4 panels" --max-images 4 --output-dir ./output
wavespeed edit-sequential --prompt "turn this into a comic strip" --images ./input.png --max-images 4 --output-dir ./output
```

Use `wavespeed models --json` when parsing model metadata programmatically.

## Model selection guidance

- Do not assume one default model is best for every task. Wavespeed has many current models; discover available models at runtime.
- For one-off image generation, default model resolution is acceptable if the user has no preference.
- For explicit model requests, pass the requested model id via MCP `model` or CLI `--model`.
- Raw Wavespeed model ids such as `provider/model/text-to-image` or `provider/model/edit` can be passed directly.
- If a plain model alias is unknown, list models and ask the user to choose.

## Troubleshooting

- Missing API key: ask the user to set `WAVESPEED_API_KEY`; do not ask them to paste secrets into a committed file.
- Unknown model: run `list_models` or `wavespeed models` and retry with a valid id.
- Invalid size: use `WIDTH*HEIGHT` or `WIDTHxHEIGHT`; each dimension must be 1024-4096.
- No saved files: retry with output mode `paths` or CLI `--output-dir` and report any download errors.
- API/task failure: report the task id and API error, then suggest a smaller size, safer prompt, or different model.

# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Essential Development Commands

```bash
# Install dependencies
bun install

# Run in development mode with hot reload
bun run dev

# Build for production
bun run build

# Link CLI globally (makes 'wavespeed' command available system-wide)
bun link
```

## High-Level Architecture

This is a TypeScript CLI for the Wavespeed AI Bytedance Seedream V4 API, built with Bun.

### Command Structure
The CLI exposes 4 commands via Commander.js:
- `generate`: Text-to-image generation
- `edit`: Image-to-image editing
- `generate-sequential`: Generate consistent image sequences
- `edit-sequential`: Edit images while maintaining consistency

### API Client Layer (`src/api/`)
- Authenticates with `WAVESPEED_API_KEY` environment variable
- Sends HTTP requests to `https://api.wavespeed.ai`
- Creates tasks and returns task IDs immediately
- Results retrieved by polling `/api/v3/predictions/{id}/result`

### Polling Mechanism (`src/utils/polling.ts`)
- **Default interval**: 2.5 seconds
- **Timeout**: 10 minutes
- **Network retries**: 3 attempts with exponential backoff
- Continues until task status is `completed` or `failed`

### Validation Layer (`src/utils/validation.ts`)
- **Prompt**: Required, non-empty string
- **Size**: Must be between 1024×1024 and 4096×4096
  - Accepts both `*` and `x` separators (e.g., `2048*2048` or `2048x2048`)
- **Images**: Max 10 image URLs for edit commands
- **max-images**: Integer between 1 and 15 for sequential commands

## Key Technical Notes

### Runtime Requirements
- Built for **Bun runtime** (not Node.js)
- Entry point uses Bun shebang: `#!/usr/bin/env bun`
- Requires `WAVESPEED_API_KEY` environment variable

### Image Download Behavior
- **Auto-download**: Images are automatically downloaded when tasks complete
- **Output directory**: Default `./output/` (configurable via `--output-dir` flag)
- **File naming**: `{taskId}_1.png`, `{taskId}_2.png`, etc.
- **Base64 support**: When using `--base64`, images are decoded and saved as PNG files

### CLI Flags
- `--output-dir <dir>`: Directory to save downloaded images (default: `./output/`)
- `--base64`: Requests base64-encoded outputs from API (auto-decoded and saved)

### API Behavior
- All operations create a task asynchronously
- CLI always polls until completion (or failure)
- Images are automatically downloaded upon successful completion

## Code Structure

```
src/
  index.ts              # Entry point, registers all commands
  commands/             # Command implementations
    generate.ts
    edit.ts
    generate-sequential.ts
    edit-sequential.ts
  api/                  # API client and type definitions
    client.ts          # HTTP client with auth
    types.ts           # Request/response types and endpoints
  utils/                # Shared utilities
    polling.ts         # Async task polling logic
    validation.ts      # Input validation functions
    images.ts          # Image download and save utilities
```

## API Documentation

Official Wavespeed API docs:
- [Bytedance Seedream V4 (Generate)](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4)
- [Bytedance Seedream V4 Edit](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4-edit)
- [Bytedance Seedream V4 Sequential](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4-sequential)
- [Bytedance Seedream V4 Edit Sequential](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4-edit-sequential)

## Image Size Guidelines

The API supports resolutions from 1024×1024 to 4096×4096.

**Recommended resolutions by aspect ratio:**
- **1:1** — 2048×2048, 3072×3072, 4096×4096
- **16:9** — 2048×1152, 3072×1728, 4096×2304
- **4:3** — 2048×1536, 3072×2304, 4096×3072
- **9:16** — 1152×2048, 1728×3072, 2304×4096
- **3:4** — 1536×2048, 2304×3072, 3072×4096

## Environment Setup

### Fish Shell
```fish
set -Ux WAVESPEED_API_KEY "your_api_key_here"
source ~/.config/fish/config.fish
```

### Bash/Zsh
```bash
export WAVESPEED_API_KEY="your_api_key_here"
source ~/.bashrc  # or source ~/.zshrc
```

## Error Handling

Exit codes:
- `0`: Success
- `1`: Command error (validation, API error, task failed)
- `2`: Missing API key

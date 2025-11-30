# wavespeed-cli

[![Test and Build](https://github.com/aditzel/wavespeed-cli/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/aditzel/wavespeed-cli/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-Runtime-f9f1e1.svg)](https://bun.sh)

A powerful command-line interface for [Wavespeed AI](https://wavespeed.ai)'s image generation and editing APIs. Generate stunning images from text prompts, edit existing images, and create consistent image sequences—all from your terminal.

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Multi-model Support](#multi-model-selection)
- [Error Handling](#error-handling-and-exit-codes)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Quick Start

Get up and running in under 2 minutes:

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Clone and build
git clone https://github.com/aditzel/wavespeed-cli.git
cd wavespeed-cli
bun install && bun run build && bun link

# Set your API key
export WAVESPEED_API_KEY="your_api_key_here"

# Generate your first image
wavespeed generate --prompt "a photorealistic cat sitting on a windowsill"
```

## Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Text-to-Image Generation** | Create images from text prompts using state-of-the-art AI models |
| **Image Editing** | Modify existing images with natural language prompts |
| **Sequential Generation** | Generate consistent image sequences for animations or storyboards |
| **Sequential Editing** | Edit multiple images while maintaining visual consistency |

### Developer Experience

- **Auto-Download**: Images are automatically downloaded when generation completes
- **Base64 Support**: Seamlessly decode and save base64-encoded image outputs
- **Multi-Model Support**: Switch between different AI providers and models via configuration
- **Flexible Configuration**: JSON/YAML config files with environment variable interpolation
- **Comprehensive Validation**: Clear error messages with actionable guidance

## Installation

### Prerequisites

Before installing wavespeed-cli, ensure you have:

- **[Bun](https://bun.sh)** (v1.0 or later) - A fast JavaScript runtime
  - macOS: `brew install oven-sh/bun/bun`
  - Linux/WSL: `curl -fsSL https://bun.sh/install | bash`
- **Wavespeed API Key** - Get one at [wavespeed.ai](https://wavespeed.ai)

### Build and Install

```bash
# Clone the repository
git clone https://github.com/aditzel/wavespeed-cli.git
cd wavespeed-cli

# Install dependencies
bun install

# Build the CLI
bun run build

# Link the CLI globally (makes the 'wavespeed' command available)
bun link
```

### Set Up Your API Key

The CLI requires a Wavespeed API key. Set it as an environment variable:

**Bash/Zsh:**
```bash
export WAVESPEED_API_KEY="your_api_key_here"
# Add to ~/.bashrc or ~/.zshrc for persistence
```

**Fish:**
```fish
set -Ux WAVESPEED_API_KEY "your_api_key_here"
```

## Configuration

### Default Configuration

By default, the CLI uses the built-in Wavespeed Seedream V4 configuration with `WAVESPEED_API_KEY` from your environment. No config file is required for basic usage.

If no config file is present, all commands:
- Use `https://api.wavespeed.ai`
- Use `WAVESPEED_API_KEY`
- Target the Bytedance Seedream V4 endpoints

### Config file discovery (multi-model support)

To use multiple models/providers or override defaults, create a config file. On each run, the CLI looks for the first existing file (no merging):

Project-level (current directory):

1. `.wavespeedrc`
2. `.wavespeedrc.json`
3. `.wavespeedrc.yaml`
4. `.wavespeedrc.yml`
5. `wavespeed.config.json`
6. `wavespeed.config.yaml`
7. `wavespeed.config.yml`

If none found, fall back to home directory:

8. `$HOME/.wavespeedrc`
9. `$HOME/.wavespeedrc.json`
10. `$HOME/.wavespeedrc.yaml`
11. `$HOME/.wavespeedrc.yml`

The first match wins. Supported formats:
- JSON
- YAML
- `.wavespeedrc` without extension: tries JSON, then YAML.

### Config schema (overview)

Minimal JSON example:

```json
{
  "models": {
    "seedream-v4": {
      "provider": "wavespeed",
      "apiBaseUrl": "https://api.wavespeed.ai",
      "apiKeyEnv": "WAVESPEED_API_KEY",
      "modelName": "bytedance/seedream-v4"
    },
    "my-alt-model": {
      "provider": "openai-compatible",
      "apiBaseUrl": "https://api.my-gateway.example",
      "apiKeyEnv": "MY_GATEWAY_API_KEY",
      "modelName": "bytedance/seedream-v4"
    }
  },
  "defaults": {
    "globalModel": "seedream-v4",
    "commands": {
      "generate": "seedream-v4",
      "edit": "seedream-v4",
      "generate-sequential": "seedream-v4",
      "edit-sequential": "seedream-v4"
    }
  }
}
```

Key points:

- `models`:
  - Keys are model ids used with `--model <id>`.
  - Each model:
    - `provider`: `"wavespeed" | "openai" | "openai-compatible" | "custom"`.
    - `apiBaseUrl`:
      - Optional for `wavespeed` (defaults to `https://api.wavespeed.ai`).
      - Required for non-`wavespeed` providers.
    - `apiKeyEnv`:
      - Environment variable name holding the API key.
      - Defaults to `WAVESPEED_API_KEY` for `wavespeed` if omitted.
    - `modelName`:
      - Remote model identifier (e.g. `"bytedance/seedream-v4"`).
    - `type`, `requestDefaults`:
      - Optional and currently not required by core commands.
- `defaults`:
  - `globalModel`:
    - Default model id when no command-level default applies.
  - `commands`:
    - Per-command defaults (model ids) for:
      - `generate`, `edit`, `generate-sequential`, `edit-sequential`.

Unknown fields are ignored by the loader to remain forward-compatible.

### Environment variable interpolation

In the config, any string exactly matching one of:

- `${ENV:NAME}`
- `${NAME}`

is resolved as:

- `process.env.NAME` if defined.
- If not defined:
  - Left as an empty string; resolution/validation logic will fail later if that field is required for the chosen model.

Example:

```json
{
  "models": {
    "gateway": {
      "provider": "openai-compatible",
      "apiBaseUrl": "${GATEWAY_BASE_URL}",
      "apiKeyEnv": "GATEWAY_API_KEY"
    }
  }
}
```

If `GATEWAY_BASE_URL` or `GATEWAY_API_KEY` are missing at runtime when this model is selected, the CLI exits with a configuration/secret error as described below.

## Usage

### Basic Commands

#### Generate (Text-to-Image)

```bash
wavespeed generate --prompt "a photorealistic cat sitting on a windowsill"

# Specify custom size
wavespeed generate --prompt "mountain landscape" --size 1024*1024

# Custom output directory
wavespeed generate --prompt "sunset over ocean" --output-dir ./my-images/

# Request base64 output (auto-decoded and saved)
wavespeed generate --prompt "abstract art" --base64
```

#### Edit (Image-to-Image)

```bash
wavespeed edit \
  --prompt "make it cyberpunk style" \
  --images "https://example.com/image1.jpg,https://example.com/image2.jpg"

# With custom size and output directory
wavespeed edit \
  --prompt "add autumn colors" \
  --images "https://example.com/photo.jpg" \
  --size 2048*2048 \
  --output-dir ./edited/
```

#### Generate Sequential

Generate a sequence of images with consistency:

```bash
wavespeed generate-sequential \
  --prompt "spaceship launch sequence in 3 frames" \
  --max-images 3

# Larger images
wavespeed generate-sequential \
  --prompt "sunrise timelapse" \
  --max-images 5 \
  --size 3072*2048
```

#### Edit Sequential

Edit images while maintaining visual consistency:

```bash
wavespeed edit-sequential \
  --prompt "comic strip style transformation" \
  --images "https://example.com/base.jpg" \
  --max-images 4

# Without reference images
wavespeed edit-sequential \
  --prompt "character turnaround sheet" \
  --max-images 8
```

### Common Options

- `-p, --prompt <text>`: Text prompt (required)
- `-s, --size <WIDTHxHEIGHT>`: Image dimensions (default: 2048*2048)
  - Minimum: 1024x1024
  - Maximum: 4096x4096
  - Accepts `*` or `x` as separator
- `-o, --output-dir <dir>`: Directory to save images (default: `./output/`)
- `--base64`: Request base64-encoded images (auto-decoded and saved as PNG)

For edit commands:

- `-i, --images <urls>`: Comma-separated image URLs (max 10)

For sequential commands:

- `-m, --max-images <number>`: Number of images to generate (1-15, default: 1)

### Output Behavior

- Images auto-downloaded on completion.
- Files named like `{taskId}_1.png`, `{taskId}_2.png`, etc.
- Default output dir: `./output/`, configurable with `--output-dir`.
- Base64 outputs auto-decoded and saved.

## Multi-model selection

Model selection for each command follows:

1. CLI flag `--model <id>`:
   - Must match a model defined in `models`.
   - If unknown: configuration error (exit code 3).
2. Command-level default:
   - `defaults.commands[commandName]` if present.
3. Global default:
   - `defaults.globalModel` if present.
4. Built-in fallback:
   - Wavespeed Seedream V4 using `WAVESPEED_API_KEY`.
   - If `WAVESPEED_API_KEY` is missing here: exit code 2.

This behavior is implemented centrally and used by all commands.

Examples:

```bash
# Use default / configured resolution
wavespeed generate --prompt "A cat in space"

# Use a specific configured model for one run
wavespeed generate --model my-alt-model --prompt "A dragon in neon lights"

# Global model override via config only
wavespeed edit --prompt "style it" --images "https://example.com/img.png"
```

## Listing configured models

The CLI provides global flags:

```bash
wavespeed --list-models
wavespeed --list-models-json
```

Behavior:

- When either flag is present:
  - The CLI lists models and exits with code 0.
  - If used alongside a subcommand, the listing still runs and the command is not executed.

Text output example:

```text
Config source: /path/to/.wavespeedrc.json
seedream-v4 * [cmd=generate,edit] provider=wavespeed baseUrl=https://api.wavespeed.ai modelName=bytedance/seedream-v4 keyEnv=WAVESPEED_API_KEY
my-alt-model [cmd=generate] provider=openai-compatible baseUrl=https://api.my-gateway.example modelName=bytedance/seedream-v4 keyEnv=MY_GATEWAY_API_KEY
```

- `*` marks the global default model.
- `[cmd=...]` lists commands for which this model is the default.

JSON output example:

```bash
wavespeed --list-models-json
```

```json
{
  "source": "/path/to/.wavespeedrc.json",
  "models": [
    {
      "id": "seedream-v4",
      "provider": "wavespeed",
      "apiBaseUrl": "https://api.wavespeed.ai",
      "modelName": "bytedance/seedream-v4",
      "apiKeyEnv": "WAVESPEED_API_KEY",
      "isDefaultGlobal": true,
      "defaultForCommands": ["generate", "edit"]
    }
  ]
}
```

If no config file is present:
- Listing shows a single built-in Seedream V4 model as the global default.

## Error Handling and Exit Codes

The CLI validates inputs and configuration and returns:

- `0`: Success
- `1`: Command usage/validation/runtime/API error (e.g., invalid args, task failure)
- `2`: Missing required secrets (e.g., required API key env var not set for selected model)
- `3`: Configuration/model errors:
  - Invalid JSON/YAML in config
  - Unknown model id referenced in `defaults` or `--model`
  - Missing required `apiBaseUrl`/`apiKeyEnv` for chosen model

Typical messages include guidance such as:

- Unknown model:
  - "Unknown model 'X'. Use --list-models to see available models."
- Invalid config defaults:
  - "defaults.globalModel 'X' does not exist in models"
- Missing secrets:
  - "Environment variable 'NAME' is not set for model 'id'."

## Development

```bash
# Run in development mode with hot reload
bun run dev

# Build for production
bun run build

# Lint the code
bun run lint

# Format the code
bun run format
```

### Testing

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test:watch

# Run tests with coverage
bun test:coverage
```

Test coverage includes:

- Input validation (prompts, sizes, image URLs/files)
- Local file upload and base64 conversion
- API client behavior and error handling
- CLI integration and parsing
- Image download and saving utilities
- Config loading and model resolution
- Multi-model selection and listing flags

## Troubleshooting

### Common Issues

**"WAVESPEED_API_KEY is not set"**
```bash
# Verify your API key is set
echo $WAVESPEED_API_KEY

# Set it if missing
export WAVESPEED_API_KEY="your_api_key_here"
```

**"Command not found: wavespeed"**
```bash
# Rebuild and relink the CLI
bun run build && bun link

# Or run directly with Bun
bun run src/index.ts generate --prompt "test"
```

**"Unknown model 'X'"**
- Check your config file with `wavespeed --list-models`
- Ensure the model ID matches exactly (case-sensitive)

**"Invalid size format"**
- Use format: `WIDTHxHEIGHT` or `WIDTH*HEIGHT`
- Minimum: 1024x1024, Maximum: 4096x4096

**Network/API errors**
- Verify your internet connection
- Check if your API key is valid at [wavespeed.ai](https://wavespeed.ai)
- Ensure the API service is available

## API Documentation

For detailed API specifications, see:

- [Bytedance Seedream V4 (Generate)](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4)
- [Bytedance Seedream V4 Edit](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4-edit)
- [Bytedance Seedream V4 Sequential](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4-sequential)
- [Bytedance Seedream V4 Edit Sequential](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4-edit-sequential)

## Pricing

From the API documentation:

- Standard generation: $0.027 per image
- Sequential generation: $0.027 × `max_images`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **API Issues**: See [Wavespeed API documentation](https://wavespeed.ai/docs)
- **CLI Issues**: [Open an issue on GitHub](https://github.com/aditzel/wavespeed-cli/issues)
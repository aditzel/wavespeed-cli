# wavespeed-cli

A TypeScript CLI for the Wavespeed AI Bytedance Seedream V4 API, built with Bun.

## Features

- **Text-to-Image Generation**: Create images from text prompts
- **Image Editing**: Modify existing images with prompts
- **Sequential Generation**: Generate consistent image sequences
- **Sequential Editing**: Edit images while maintaining consistency
- **Auto-Download**: Images are automatically downloaded when generation completes
- **Base64 Support**: Decode and save base64-encoded image outputs

## API Documentation

- [Bytedance Seedream V4 (Generate)](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4)
- [Bytedance Seedream V4 Edit](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4-edit)
- [Bytedance Seedream V4 Sequential](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4-sequential)
- [Bytedance Seedream V4 Edit Sequential](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4-edit-sequential)

## Installation

### Prerequisites

- [Bun](https://bun.sh) installed (`brew install oven-sh/bun/bun` on macOS)
- A Wavespeed API key

### Build and Install

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/wavespeed-cli.git
cd wavespeed-cli

# Install dependencies
bun install

# Build the CLI
bun run build

# Link the CLI globally (makes the 'wavespeed' command available)
bun link
```

## Configuration

### Environment Variable

The CLI requires the `WAVESPEED_API_KEY` environment variable.

For Fish shell users:

```fish
# Check if the variable exists
echo $WAVESPEED_API_KEY

# If not set, add it globally
set -Ux WAVESPEED_API_KEY "your_api_key_here"

# Reload your configuration
source ~/.config/fish/config.fish
```

For Bash/Zsh users:

```bash
# Add to ~/.bashrc or ~/.zshrc
export WAVESPEED_API_KEY="your_api_key_here"

# Reload
source ~/.bashrc  # or source ~/.zshrc
```

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
  - Format accepts both `*` and `x` as separators
- `-o, --output-dir <dir>`: Directory to save downloaded images (default: `./output/`)
- `--base64`: Request base64-encoded images from API (auto-decoded and saved as PNG)

For edit commands:
- `-i, --images <urls>`: Comma-separated image URLs (max 10)

For sequential commands:
- `-m, --max-images <number>`: Number of images to generate (1-15, default: 1)

### Output Behavior

- **Auto-download**: Images are automatically downloaded when generation completes
- **File naming**: Saved as `{taskId}_1.png`, `{taskId}_2.png`, etc.
- **Output directory**: Default is `./output/`, configurable with `--output-dir`
- **Base64 handling**: Base64 outputs are automatically decoded and saved as PNG files

## Image Size Guidelines

The API supports resolutions from 1024x1024 to 4096x4096.

**Recommended resolutions** (by aspect ratio):
- **1:1** - 2048×2048, 3072×3072, 4096×4096
- **16:9** - 2048×1152, 3072×1728, 4096×2304
- **4:3** - 2048×1536, 3072×2304, 4096×3072  
- **9:16** - 1152×2048, 1728×3072, 2304×4096
- **3:4** - 1536×2048, 2304×3072, 3072×4096

## Error Handling

The CLI validates inputs and provides clear error messages:

- **Missing prompt**: `Prompt is required`
- **Invalid size**: `Size must be WIDTH*HEIGHT, for example 2048*2048`
- **Size out of range**: `Each size dimension must be between 1024 and 4096`
- **Too many images**: `At most 10 images are allowed`
- **Invalid image URL**: `Invalid image URL: <url>`
- **Invalid max-images**: `max-images must be an integer between 1 and 15`
- **Missing API key**: Instructions for setting `WAVESPEED_API_KEY`
- **API errors**: HTTP status and error message from the API
- **Task failures**: Displays the error from the failed task

Exit codes:
- `0`: Success
- `1`: Command error (validation, API error, task failed)
- `2`: Missing API key

## Development

```bash
# Run in development mode with hot reload
bun run dev

# Build for production
bun run build

# The build automatically makes dist/index.js executable
```

### Testing

The CLI includes a comprehensive test suite to ensure correctness and reliability.

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test:watch

# Run tests with coverage (if implemented)  
bun test:coverage
```

**Test Coverage:**
- ✅ Input validation (prompts, sizes, image URLs/files)
- ✅ Local file upload and base64 conversion
- ✅ API client functionality and error handling
- ✅ CLI integration and command-line parsing
- ✅ Image download and saving utilities

**Key Features Tested:**
- **Sync Mode Support**: `--sync` option available in all commands
- **File Upload**: Local image files auto-converted to base64 data URIs  
- **Mixed Input**: Handles both URLs and local files in same command
- **Validation**: Comprehensive input validation and error messages
- **API Compliance**: Matches Wavespeed API specification exactly

See [TESTING.md](TESTING.md) for detailed testing documentation.

### Implementation Verification

The current implementation correctly addresses the API requirements:

✅ **Missing `enable_sync_mode` parameter** - Added to all commands  
✅ **Local file upload support** - Auto-detection and base64 conversion  
✅ **API parameter compliance** - All documented parameters supported  
✅ **Input validation** - Proper error handling and constraints  
✅ **Image handling** - Both URLs and local files supported

## Pricing

From the API documentation:
- **Standard generation**: $0.027 per image
- **Sequential generation**: $0.027 × `max_images`

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

For API-related issues, refer to the [Wavespeed API Documentation](https://wavespeed.ai/docs).

For CLI issues, please open an issue on GitHub.

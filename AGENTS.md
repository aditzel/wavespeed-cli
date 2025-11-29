# Build & Test

- Build: `bun run build` (outputs to `dist/index.js`)
- Dev: `bun run dev` (runs `src/index.ts` with hot reload)
- Test: `bun test`
- Test Coverage: `bun test --coverage`

# Architecture Overview

- **CLI Entry**: `src/index.ts` uses `commander` to define CLI structure.
- **Commands**: Implemented in `src/commands/` (e.g., `generate.ts`, `edit.ts`).
- **API Layer**: `src/api/client.ts` handles HTTP requests to Wavespeed/compatible APIs.
- **Config**: `src/config/load.ts` loads multi-format config (JSON/YAML) from project or home dir.

# Security

- **API Keys**: Never commit API keys. Use `WAVESPEED_API_KEY` env var or configure `apiKeyEnv` in `.wavespeedrc`.
- **Env Vars**: Config files support `${ENV_VAR}` interpolation.

# Conventions & Patterns

- **Runtime**: Bun (for build, test, and execution).
- **Language**: TypeScript (ESM).
- **File Structure**:
  - `src/api`: API client logic.
  - `src/commands`: Individual command implementations.
  - `src/config`: Configuration loading and validation.
  - `src/utils`: Shared helpers.
- **Config Priority**: Project config > Home config > Defaults.

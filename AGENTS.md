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

# Commits & Pull Requests

- **Conventional Commits**: Write commit subjects and PR titles as [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor:`, ...). semantic-release (`.releaserc.json`) derives versions and the changelog from these types on `main`.
- **Agent attribution**: When a coding agent contributes to a commit, end the commit message with a `Co-authored-by:` trailer identifying that agent, for example `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`.
- This applies to new commits only; existing history is not rewritten.

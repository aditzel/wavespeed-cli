import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import type { ConfigLoadResult, ModelConfig, WavespeedConfig } from "./types";

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 3,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

const PROJECT_CONFIG_CANDIDATES = [
  ".wavespeedrc",
  ".wavespeedrc.json",
  ".wavespeedrc.yaml",
  ".wavespeedrc.yml",
  "wavespeed.config.json",
  "wavespeed.config.yaml",
  "wavespeed.config.yml",
];

const HOME_CONFIG_CANDIDATES = [
  ".wavespeedrc",
  ".wavespeedrc.json",
  ".wavespeedrc.yaml",
  ".wavespeedrc.yml",
];

type AnyRecord = Record<string, unknown>;

export function loadConfig(): ConfigLoadResult {
  const cwd = process.cwd();
  const homeDir = os.homedir();

  const projectPath = findFirstExisting(cwd, PROJECT_CONFIG_CANDIDATES);
  let configPath: string | undefined = projectPath;

  if (!configPath) {
    const homePath = findFirstExisting(homeDir, HOME_CONFIG_CANDIDATES);
    if (homePath) {
      configPath = homePath;
    }
  }

  if (!configPath) {
    return { config: undefined, path: undefined };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const ext = path.extname(configPath);

  let parsed: unknown;

  try {
    if (!ext) {
      parsed = tryParseNoExtConfig(raw, configPath);
    } else if (ext === ".json" || ext === ".rc") {
      parsed = tryParseJson(raw, configPath);
    } else if (ext === ".yaml" || ext === ".yml") {
      parsed = tryParseYaml(raw, configPath);
    } else {
      parsed = tryParseJson(raw, configPath);
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      throw err;
    }
    throw new ConfigError(
      `Failed to parse config file '${configPath}': ${(err as Error).message}`,
      3,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ConfigError(`Invalid config structure in '${configPath}': expected an object`, 3);
  }

  const interpolated = interpolateEnv(parsed, configPath);
  const normalized = normalizeConfig(interpolated, configPath);
  validateConfig(normalized, configPath);

  return { config: normalized, path: configPath };
}

function findFirstExisting(baseDir: string, candidates: string[]): string | undefined {
  for (const name of candidates) {
    const p = path.join(baseDir, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }
  return undefined;
}

function tryParseJson(raw: string, filePath: string): AnyRecord {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `Invalid JSON in config file '${filePath}': ${(err as Error).message}`,
      3,
    );
  }
}

function tryParseYaml(raw: string, filePath: string): AnyRecord {
  try {
    return YAML.parse(raw) ?? {};
  } catch (err) {
    throw new ConfigError(
      `Invalid YAML in config file '${filePath}': ${(err as Error).message}`,
      3,
    );
  }
}

function tryParseNoExtConfig(raw: string, filePath: string): AnyRecord {
  // Try JSON first
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }

  // Then YAML
  try {
    return YAML.parse(raw) ?? {};
  } catch (err) {
    throw new ConfigError(
      `Invalid config file '${filePath}': not valid JSON or YAML (${(err as Error).message})`,
      3,
    );
  }
}

function interpolateEnv(value: unknown, contextPath: string): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = /^\$\{([^}]+)\}$/.exec(trimmed);
    if (!match) {
      return value;
    }

    const token = match[1];

    let varName: string;
    if (token.startsWith("ENV:")) {
      varName = token.slice(4);
    } else {
      varName = token;
    }

    if (!varName) {
      throw new ConfigError(
        `Invalid environment variable reference '\${${token}}' in '${contextPath}'`,
        3,
      );
    }

    const envVal = process.env[varName];
    if (envVal === undefined) {
      // For interpolation we do a generic validation step later when fields are required.
      // Here, leave as empty string to allow detection/validation.
      return "";
    }

    return envVal;
  }

  if (Array.isArray(value)) {
    return value.map((v) => interpolateEnv(v, contextPath));
  }

  if (value && typeof value === "object") {
    const out: AnyRecord = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateEnv(v, contextPath);
    }
    return out;
  }

  return value;
}

function normalizeConfig(input: AnyRecord, filePath: string): WavespeedConfig {
  const config: WavespeedConfig = {
    version: typeof input.version === "string" ? input.version : input.version,
    models: {},
    defaults: input.defaults,
    env: input.env,
  };

  const models = input.models;
  if (models && typeof models === "object") {
    for (const [key, rawModel] of Object.entries(models as Record<string, unknown>)) {
      if (!rawModel || typeof rawModel !== "object") {
        continue;
      }

      const model = { ...(rawModel as ModelConfig) };

      if (!model.id) {
        model.id = key;
      }

      config.models[key] = model;
    }
  } else if (models !== undefined) {
    throw new ConfigError(`Invalid 'models' section in '${filePath}': expected an object`, 3);
  }

  return config;
}

function validateConfig(config: WavespeedConfig, filePath: string): void {
  if (!config.models) {
    config.models = {};
  }

  const modelIds = new Set(Object.keys(config.models));

  // Validate defaults.globalModel
  const globalModel = config.defaults?.globalModel;
  if (globalModel && !modelIds.has(globalModel)) {
    throw new ConfigError(
      `Invalid config '${filePath}': defaults.globalModel '${globalModel}' does not exist in models`,
      3,
    );
  }

  // Validate defaults.commands entries
  const cmdDefaults = config.defaults?.commands;
  if (cmdDefaults && typeof cmdDefaults === "object") {
    for (const [cmd, modelId] of Object.entries(cmdDefaults)) {
      if (modelId && !modelIds.has(modelId)) {
        throw new ConfigError(
          `Invalid config '${filePath}': defaults.commands.${cmd} refers to unknown model '${modelId}'`,
          3,
        );
      }
    }
  }
}

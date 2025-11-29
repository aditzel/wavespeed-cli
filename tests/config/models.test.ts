import { beforeEach, describe, expect, it } from "bun:test";
import { ConfigError, listModels, resolveModel } from "../../src/config/models.ts";
import type { ResolvedModelSummary, WavespeedConfig } from "../../src/config/types.ts";

function makeConfig(partial: Partial<WavespeedConfig>): WavespeedConfig {
  const baseModels = partial.models || {};
  const baseDefaults = partial.defaults || {};

  return {
    version: "1",
    env: {},
    ...partial,
    models: {
      ...baseModels,
    },
    defaults: {
      ...baseDefaults,
    },
  };
}

describe("config/models.resolveModel", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("uses built-in fallback when no config and WAVESPEED_API_KEY set", () => {
    process.env.WAVESPEED_API_KEY = "test-key";

    const model = resolveModel("generate", undefined, undefined);

    expect(model.id).toBe("seedream-v4");
    expect(model.provider).toBe("wavespeed");
    expect(model.apiBaseUrl).toBe("https://api.wavespeed.ai");
    expect(model.apiKeyEnv).toBe("WAVESPEED_API_KEY");
    expect(model.apiKey).toBe("test-key");
    expect(model.isFromConfig).toBe(false);
  });

  it("throws ConfigError(exitCode=2) when built-in fallback missing WAVESPEED_API_KEY", () => {
    delete process.env.WAVESPEED_API_KEY;

    try {
      resolveModel("generate", undefined, undefined);
      throw new Error("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.exitCode).toBe(2);
    }
  });

  it("CLI --model overrides defaults", () => {
    process.env.CLI_KEY = "cli-key";
    process.env.DEFAULT_KEY = "default-key";

    const config = makeConfig({
      models: {
        defaultModel: {
          provider: "wavespeed",
          apiKeyEnv: "DEFAULT_KEY",
        },
        cliModel: {
          provider: "wavespeed",
          apiKeyEnv: "CLI_KEY",
        },
      },
      defaults: {
        globalModel: "defaultModel",
      },
    });

    const resolved = resolveModel("generate", "cliModel", config);

    expect(resolved.id).toBe("cliModel");
    expect(resolved.apiKeyEnv).toBe("CLI_KEY");
    expect(resolved.apiKey).toBe("cli-key");
  });

  it("command-level default overrides global default", () => {
    process.env.GLOBAL_KEY = "global-key";
    process.env.CMD_KEY = "cmd-key";

    const config = makeConfig({
      models: {
        globalModel: {
          provider: "wavespeed",
          apiKeyEnv: "GLOBAL_KEY",
        },
        cmdModel: {
          provider: "wavespeed",
          apiKeyEnv: "CMD_KEY",
        },
      },
      defaults: {
        globalModel: "globalModel",
        commands: {
          generate: "cmdModel",
        },
      },
    });

    const resolved = resolveModel("generate", undefined, config);

    expect(resolved.id).toBe("cmdModel");
    expect(resolved.apiKeyEnv).toBe("CMD_KEY");
    expect(resolved.apiKey).toBe("cmd-key");
  });

  it("global default used when no command-level default", () => {
    process.env.GLOBAL_KEY = "global-key";

    const config = makeConfig({
      models: {
        globalModel: {
          provider: "wavespeed",
          apiKeyEnv: "GLOBAL_KEY",
        },
      },
      defaults: {
        globalModel: "globalModel",
      },
    });

    const resolved = resolveModel("edit", undefined, config);

    expect(resolved.id).toBe("globalModel");
    expect(resolved.apiKeyEnv).toBe("GLOBAL_KEY");
    expect(resolved.apiKey).toBe("global-key");
  });

  it("throws on unknown CLI model", () => {
    const config = makeConfig({
      models: {
        m1: { provider: "wavespeed", apiKeyEnv: "M1_KEY" },
      },
    });

    process.env.M1_KEY = "m1";

    try {
      resolveModel("generate", "does-not-exist", config);
      throw new Error("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.exitCode).toBe(3);
      expect(ce.message).toContain("Unknown model");
    }
  });

  it("throws when command default refers to missing model", () => {
    const config = makeConfig({
      models: {
        m1: { provider: "wavespeed", apiKeyEnv: "M1_KEY" },
      },
      defaults: {
        commands: {
          generate: "missing",
        },
      },
    });

    process.env.M1_KEY = "m1";

    try {
      resolveModel("generate", undefined, config);
      throw new Error("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.exitCode).toBe(3);
    }
  });

  it("throws when global default refers to missing model", () => {
    const config = makeConfig({
      models: {
        m1: { provider: "wavespeed", apiKeyEnv: "M1_KEY" },
      },
      defaults: {
        globalModel: "missing",
      },
    });

    process.env.M1_KEY = "m1";

    try {
      resolveModel("generate", undefined, config);
      throw new Error("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.exitCode).toBe(3);
    }
  });

  it("throws exitCode=2 when apiKey for chosen model is missing", () => {
    const config = makeConfig({
      models: {
        m1: {
          provider: "wavespeed",
          apiKeyEnv: "M1_KEY",
        },
      },
      defaults: {
        globalModel: "m1",
      },
    });

    delete process.env.M1_KEY;

    try {
      resolveModel("generate", undefined, config);
      throw new Error("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.exitCode).toBe(2);
    }
  });

  it("requires apiKeyEnv for non-wavespeed providers", () => {
    const config = makeConfig({
      models: {
        custom: {
          provider: "custom",
          apiBaseUrl: "https://example.com",
        },
      },
      defaults: {
        globalModel: "custom",
      },
    });

    try {
      resolveModel("generate", undefined, config);
      throw new Error("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.exitCode).toBe(3);
    }
  });

  it("requires apiBaseUrl for non-wavespeed providers", () => {
    const config = makeConfig({
      models: {
        custom: {
          provider: "custom",
          apiKeyEnv: "C_KEY",
        },
      },
      defaults: {
        globalModel: "custom",
      },
    });

    process.env.C_KEY = "secret";

    try {
      resolveModel("generate", undefined, config);
      throw new Error("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.exitCode).toBe(3);
    }
  });
});

describe("config/models.listModels", () => {
  it("returns built-in model summary when no config", () => {
    const { models, source } = listModels(undefined, undefined);
    expect(source).toBeUndefined();
    expect(models.length).toBe(1);
    const m = models[0] as ResolvedModelSummary;
    expect(m.id).toBe("seedream-v4");
    expect(m.provider).toBe("wavespeed");
    expect(m.apiBaseUrl).toBe("https://api.wavespeed.ai");
    expect(m.modelName).toBe("bytedance/seedream-v4");
    expect(m.apiKeyEnv).toBe("WAVESPEED_API_KEY");
    expect(m.isDefaultGlobal).toBe(true);
    expect(m.defaultForCommands).toEqual([
      "generate",
      "edit",
      "generate-sequential",
      "edit-sequential",
    ]);
  });

  it("returns summaries for configured models with defaults metadata", () => {
    const config = makeConfig({
      models: {
        a: {
          provider: "wavespeed",
        },
        b: {
          provider: "wavespeed",
          apiBaseUrl: "https://alt",
          apiKeyEnv: "B_KEY",
        },
      },
      defaults: {
        globalModel: "a",
        commands: {
          generate: "b",
        },
      },
    });

    const { models, source } = listModels(config, "/tmp/config.json");
    expect(source).toBe("/tmp/config.json");
    expect(models.length).toBe(2);

    const a = models.find((m) => m.id === "a");
    const b = models.find((m) => m.id === "b");

    expect(a).toBeDefined();
    expect(b).toBeDefined();

    if (a && b) {
      expect(a.isDefaultGlobal).toBe(true);
      expect(a.defaultForCommands).toEqual([]);
      expect(a.apiBaseUrl).toBe("https://api.wavespeed.ai");

      expect(b.isDefaultGlobal).toBe(false);
      expect(b.defaultForCommands).toContain("generate");
      expect(b.apiBaseUrl).toBe("https://alt");
    }
  });
});

import { describe, it, expect, beforeEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { loadConfig, ConfigError } from "../../src/config/load.ts";
import { WavespeedConfig } from "../../src/config/types.ts";

const ORIGINAL_CWD = process.cwd();
const TMP_ROOT = path.join(os.tmpdir(), "wavespeed-load-tests");

function writeFile(relPath: string, content: string) {
  const full = path.join(process.cwd(), relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function cleanupDir(dir: string) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) {
      cleanupDir(full);
      fs.rmdirSync(full);
    } else {
      fs.unlinkSync(full);
    }
  }
}

describe("config/load", () => {
  beforeEach(() => {
    // Reset temp root for each test by recreating directory
    if (fs.existsSync(TMP_ROOT)) {
      cleanupDir(TMP_ROOT);
    } else {
      fs.mkdirSync(TMP_ROOT, { recursive: true });
    }
    process.chdir(TMP_ROOT);
    // Clear relevant env between tests
    delete process.env.TEST_API_KEY;
  });

  it("returns undefined config when no config file exists", () => {
    const { config, path: configPath } = loadConfig();
    expect(config).toBeUndefined();
    expect(configPath).toBeUndefined();
  });

  it("loads valid JSON config", () => {
    writeFile(
      ".wavespeedrc.json",
      JSON.stringify({
        models: {
          m1: {
            provider: "wavespeed",
          },
        },
        defaults: {
          globalModel: "m1",
        },
      })
    );

    const { config, path: configPath } = loadConfig();
    expect(configPath).toContain(".wavespeedrc.json");
    expect(config).toBeDefined();
    const cfg = config as WavespeedConfig;
    expect(Object.keys(cfg.models)).toContain("m1");
    expect(cfg.models.m1.id).toBe("m1");
    expect(cfg.defaults?.globalModel).toBe("m1");
  });

  it("loads valid YAML config", () => {
    writeFile(
      "wavespeed.config.yaml",
      [
        "models:",
        "  m2:",
        "    provider: wavespeed",
        "defaults:",
        "  globalModel: m2",
        "",
      ].join("\n")
    );

    const { config, path: configPath } = loadConfig();
    expect(configPath).toContain("wavespeed.config.yaml");
    expect(config).toBeDefined();
    const cfg = config as WavespeedConfig;
    expect(Object.keys(cfg.models)).toContain("m2");
    expect(cfg.models.m2.id).toBe("m2");
    expect(cfg.defaults?.globalModel).toBe("m2");
  });

  it("tries JSON then YAML for .wavespeedrc without extension", () => {
    // Invalid JSON but valid YAML
    writeFile(
      ".wavespeedrc",
      [
        "models:",
        "  m3:",
        "    provider: wavespeed",
        "defaults:",
        "  globalModel: m3",
        "",
      ].join("\n")
    );

    const { config, path: configPath } = loadConfig();
    expect(configPath).toContain(".wavespeedrc");
    expect(config).toBeDefined();
    const cfg = config as WavespeedConfig;
    expect(Object.keys(cfg.models)).toContain("m3");
    expect(cfg.defaults?.globalModel).toBe("m3");
  });

  it("throws ConfigError on invalid JSON", () => {
    writeFile(".wavespeedrc.json", "{ invalid json");
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws ConfigError on invalid YAML", () => {
    writeFile("wavespeed.config.yaml", "::: not yaml :::");
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("validates defaults.globalModel references existing model", () => {
    writeFile(
      ".wavespeedrc.json",
      JSON.stringify({
        models: {
          m1: {
            provider: "wavespeed",
          },
        },
        defaults: {
          globalModel: "missing",
        },
      })
    );

    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("validates defaults.commands references existing models", () => {
    writeFile(
      ".wavespeedrc.json",
      JSON.stringify({
        models: {
          m1: {
            provider: "wavespeed",
          },
        },
        defaults: {
          commands: {
            generate: "missing",
          },
        },
      })
    );

    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("supports ${ENV:VAR} and ${VAR} interpolation", () => {
    process.env.TEST_API_KEY = "secret";
    writeFile(
      ".wavespeedrc.json",
      JSON.stringify({
        models: {
          m1: {
            provider: "wavespeed",
            apiKeyEnv: "${ENV:TEST_API_KEY}",
          },
          m2: {
            provider: "wavespeed",
            apiBaseUrl: "${TEST_BASE_URL}",
          },
        },
        defaults: {
          globalModel: "m1",
        },
      })
    );

    const { config } = loadConfig();
    expect(config).toBeDefined();
    const cfg = config as WavespeedConfig;
    // m1.apiKeyEnv should be interpolated to actual env value
    expect(cfg.models.m1.apiKeyEnv).toBe("secret");
    // m2.apiBaseUrl uses missing env and becomes empty string; validation of usage is in resolveModel
    expect(cfg.models.m2.apiBaseUrl).toBe("");
  });

  it("prefers project config over home config", () => {
    // Simulate a home config, then a project config; loader should prefer project.
    const homeDir = os.homedir();
    const homeCfgPath = path.join(homeDir, ".wavespeedrc.json");
    const originalHomeExists = fs.existsSync(homeCfgPath);
    let backup: string | undefined;

    try {
      if (originalHomeExists) {
        backup = fs.readFileSync(homeCfgPath, "utf8");
      }
      fs.writeFileSync(
        homeCfgPath,
        JSON.stringify({
          models: { homeModel: { provider: "wavespeed" } },
          defaults: { globalModel: "homeModel" },
        }),
        "utf8"
      );

      writeFile(
        ".wavespeedrc.json",
        JSON.stringify({
          models: { projectModel: { provider: "wavespeed" } },
          defaults: { globalModel: "projectModel" },
        })
      );

      const { config } = loadConfig();
      const cfg = config as WavespeedConfig;
      expect(Object.keys(cfg.models)).toContain("projectModel");
      expect(cfg.defaults?.globalModel).toBe("projectModel");
    } finally {
      // restore home config
      if (backup !== undefined) {
        fs.writeFileSync(homeCfgPath, backup, "utf8");
      } else if (fs.existsSync(homeCfgPath)) {
        fs.unlinkSync(homeCfgPath);
      }
      process.chdir(ORIGINAL_CWD);
      if (fs.existsSync(TMP_ROOT)) {
        cleanupDir(TMP_ROOT);
        fs.rmdirSync(TMP_ROOT);
      }
    }
  });
});
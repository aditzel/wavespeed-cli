/**
 * Model cache with in-memory and file persistence
 *
 * Singleton pattern - one cache instance for the MCP server process.
 * Implements a two-tier caching strategy:
 * 1. In-memory cache (5 min TTL) for fast repeated access
 * 2. File cache (24 hr TTL) for cold-start optimization
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getModels } from "../api/client";
import type { ModelSchema } from "../api/types";
import {
  CACHE_VERSION,
  type CachedModel,
  type CacheStats,
  DEFAULT_FILE_TTL_MS,
  DEFAULT_MEMORY_TTL_MS,
  type ModelCacheData,
  type ModelFilterOptions,
  type ModelSummary,
  type RecommendedModel,
} from "./types";

/**
 * Fallback list of recommended models (used when scraping fails)
 */
const FALLBACK_RECOMMENDED: RecommendedModel[] = [
  { id: "bytedance/seedream-v4/edit", type: "image-to-image", desc: "Best image editing" },
  { id: "google/nano-banana-pro/edit", type: "image-to-image", desc: "Google's 4K image editing" },
  {
    id: "alibaba/wan-2.5/image-to-video",
    type: "image-to-video",
    desc: "Image to video with audio",
  },
  { id: "bytedance/seedream-v4", type: "text-to-image", desc: "Best overall image quality" },
  { id: "alibaba/wan-2.5/text-to-video", type: "text-to-video", desc: "Text to video with audio" },
  { id: "wavespeed-ai/flux-dev", type: "text-to-image", desc: "Fast high-quality images" },
];

/**
 * Infer model type from model ID
 * Uses naming conventions to guess the type
 */
function inferModelType(modelId: string): string {
  const lower = modelId.toLowerCase();

  // Check for explicit type markers in the path
  if (lower.includes("/image-to-video") || lower.includes("/i2v")) return "image-to-video";
  if (lower.includes("/text-to-video") || lower.includes("/t2v")) return "text-to-video";
  if (lower.includes("/video-to-video") || lower.includes("/v2v")) return "video-to-video";
  if (lower.includes("/image-to-image") || lower.includes("/edit")) return "image-to-image";
  if (lower.includes("/text-to-image")) return "text-to-image";
  if (lower.includes("upscaler") || lower.includes("face-swap") || lower.includes("background"))
    return "image-tools";
  if (lower.includes("speech") || lower.includes("audio") || lower.includes("voice"))
    return "text-to-audio";
  if (lower.includes("video-extend") || lower.includes("animate")) return "video-to-video";
  if (lower.includes("infinitetalk") || lower.includes("lipsync")) return "image-to-video";

  // Default based on common model families
  if (lower.includes("seedream") || lower.includes("flux") || lower.includes("qwen-image"))
    return "text-to-image";
  if (lower.includes("seedance") || lower.includes("wan") || lower.includes("hailuo"))
    return "image-to-video";

  return "text-to-image"; // safe default
}

/**
 * Scrape popular models from wavespeed.ai/models page
 *
 * The page lists models in popularity order. We extract the first 15 unique
 * model paths from /models/provider/model-id links.
 */
async function scrapePopularModels(): Promise<RecommendedModel[]> {
  try {
    const response = await fetch("https://wavespeed.ai/models");
    if (!response.ok) {
      return FALLBACK_RECOMMENDED;
    }

    const html = await response.text();
    const models: RecommendedModel[] = [];
    const seenIds = new Set<string>();

    // Extract model paths: href="/models/provider/model-id"
    // The page shows models in popularity order
    const linkPattern = /href="\/models\/([a-z0-9-]+\/[a-z0-9./-]+)"/gi;

    for (
      let match = linkPattern.exec(html);
      match !== null && models.length < 15;
      match = linkPattern.exec(html)
    ) {
      const modelId = match[1];

      // Skip duplicates and collection links
      if (seenIds.has(modelId) || modelId.includes("collection")) {
        continue;
      }
      seenIds.add(modelId);

      // Infer type from model path
      const type = inferModelType(modelId);

      // Generate a short description based on model name
      const parts = modelId.split("/");
      const provider = parts[0];
      const modelName = parts.slice(1).join("/");
      const desc = `${provider}'s ${modelName.replace(/[-/]/g, " ")}`;

      models.push({
        id: modelId,
        type,
        desc: desc.slice(0, 60),
      });
    }

    return models.length > 0 ? models : FALLBACK_RECOMMENDED;
  } catch {
    return FALLBACK_RECOMMENDED;
  }
}

export class ModelCache {
  private static instance: ModelCache | null = null;

  // In-memory cache
  private data: ModelCacheData | null = null;
  private memoryLoadedAt: number = 0;

  // Popular models cache (scraped from wavespeed.ai/models)
  private popularModels: RecommendedModel[] | null = null;
  private popularModelsFetchedAt: number = 0;
  private readonly popularModelsTtlMs = 24 * 60 * 60 * 1000; // 24 hours

  // Configuration
  private readonly memoryTtlMs: number;
  private readonly fileTtlMs: number;
  private readonly cacheDir: string;
  private readonly cacheFile: string;

  // Stats
  private stats: CacheStats = {
    hitCount: 0,
    missCount: 0,
    lastFetchMs: 0,
    cacheAgeMs: 0,
    source: "none",
  };

  private constructor(options?: { memoryTtlMs?: number; fileTtlMs?: number }) {
    this.memoryTtlMs = options?.memoryTtlMs ?? DEFAULT_MEMORY_TTL_MS;
    this.fileTtlMs = options?.fileTtlMs ?? DEFAULT_FILE_TTL_MS;
    this.cacheDir = this.resolveCacheDir();
    this.cacheFile = path.join(this.cacheDir, "models-cache.json");
  }

  /**
   * Get the singleton instance
   */
  static getInstance(options?: { memoryTtlMs?: number; fileTtlMs?: number }): ModelCache {
    if (!ModelCache.instance) {
      ModelCache.instance = new ModelCache(options);
    }
    return ModelCache.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    ModelCache.instance = null;
  }

  /**
   * Resolve cache directory location
   */
  private resolveCacheDir(): string {
    if (process.env.WAVESPEED_CACHE_DIR) {
      return process.env.WAVESPEED_CACHE_DIR;
    }
    return path.join(os.homedir(), ".wavespeed", "cache");
  }

  /**
   * Check if in-memory cache is stale
   */
  private isMemoryStale(): boolean {
    if (!this.data || !this.memoryLoadedAt) return true;
    return Date.now() - this.memoryLoadedAt > this.memoryTtlMs;
  }

  /**
   * Check if file cache is stale
   */
  private isFileStale(data: ModelCacheData): boolean {
    return Date.now() - data.fetchedAt > data.ttlMs;
  }

  /**
   * Load cache from file
   */
  private async loadFromFile(): Promise<ModelCacheData | null> {
    try {
      if (!fs.existsSync(this.cacheFile)) return null;
      const content = await fs.promises.readFile(this.cacheFile, "utf8");
      const data = JSON.parse(content) as ModelCacheData;

      // Validate version for future migrations
      if (data.version !== CACHE_VERSION) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Save cache to file
   */
  private async saveToFile(data: ModelCacheData): Promise<void> {
    try {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
      await fs.promises.writeFile(this.cacheFile, JSON.stringify(data), "utf8");
    } catch {
      // Silently fail - file cache is optional
    }
  }

  /**
   * Transform API response to cached format
   */
  private transformAndIndex(rawModels: ModelSchema[]): ModelCacheData {
    const models: CachedModel[] = rawModels.map((m) => ({
      model_id: m.model_id,
      name: m.name,
      type: m.type,
      base_price: m.base_price,
      description: m.description?.slice(0, 150), // Truncate descriptions
    }));

    // Build type index
    const typeIndex: Record<string, string[]> = {};
    for (const model of models) {
      if (!typeIndex[model.type]) {
        typeIndex[model.type] = [];
      }
      typeIndex[model.type].push(model.model_id);
    }

    return {
      version: CACHE_VERSION,
      fetchedAt: Date.now(),
      ttlMs: this.fileTtlMs,
      modelCount: models.length,
      typeIndex,
      models,
    };
  }

  /**
   * Refresh cache from API
   */
  async refresh(apiKey: string): Promise<void> {
    try {
      const rawModels = (await getModels(apiKey)) as ModelSchema[];
      this.data = this.transformAndIndex(rawModels);
      this.memoryLoadedAt = Date.now();
      this.stats.lastFetchMs = Date.now();
      this.stats.source = "api";
      await this.saveToFile(this.data);
    } catch (error) {
      // If refresh fails but we have stale data, keep it
      if (this.data) {
        return;
      }
      throw error;
    }
  }

  /**
   * Get all models (with caching)
   */
  async getModels(apiKey: string, options?: { forceRefresh?: boolean }): Promise<CachedModel[]> {
    // Force refresh if requested
    if (options?.forceRefresh) {
      await this.refresh(apiKey);
      this.stats.missCount++;
      return this.data?.models ?? [];
    }

    // Try in-memory cache first
    if (this.data && !this.isMemoryStale()) {
      this.stats.hitCount++;
      this.stats.source = "memory";
      this.stats.cacheAgeMs = Date.now() - this.data.fetchedAt;
      return this.data.models;
    }

    // Try file cache
    if (!this.data) {
      const fileData = await this.loadFromFile();
      if (fileData && !this.isFileStale(fileData)) {
        this.data = fileData;
        this.memoryLoadedAt = Date.now();
        this.stats.hitCount++;
        this.stats.source = "file";
        this.stats.cacheAgeMs = Date.now() - fileData.fetchedAt;
        return this.data.models;
      }
      // File cache exists but is stale - still use it while we fetch
      if (fileData) {
        this.data = fileData;
        this.memoryLoadedAt = Date.now();
      }
    }

    // Fetch from API
    this.stats.missCount++;
    await this.refresh(apiKey);
    return this.data?.models ?? [];
  }

  /**
   * Invalidate cache (clear memory and file)
   */
  invalidate(): void {
    this.data = null;
    this.memoryLoadedAt = 0;
    try {
      if (fs.existsSync(this.cacheFile)) {
        fs.unlinkSync(this.cacheFile);
      }
    } catch {
      // Silently fail
    }
  }

  /**
   * Get models filtered by type
   */
  getModelsByType(type: string): CachedModel[] {
    if (!this.data) return [];
    const modelIds = this.data.typeIndex[type] || [];
    const idSet = new Set(modelIds);
    return this.data.models.filter((m) => idSet.has(m.model_id));
  }

  /**
   * Search models by name or ID (case-insensitive)
   */
  searchModels(query: string): CachedModel[] {
    if (!this.data) return [];
    const lowerQuery = query.toLowerCase();
    return this.data.models.filter(
      (m) =>
        m.model_id.toLowerCase().includes(lowerQuery) ||
        m.name.toLowerCase().includes(lowerQuery) ||
        m.description?.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Filter models with multiple criteria
   */
  filterModels(options: ModelFilterOptions): CachedModel[] {
    if (!this.data) return [];

    let results = this.data.models;

    if (options.type) {
      const modelIds = this.data.typeIndex[options.type] || [];
      const idSet = new Set(modelIds);
      results = results.filter((m) => idSet.has(m.model_id));
    }

    if (options.search) {
      const lowerQuery = options.search.toLowerCase();
      results = results.filter(
        (m) =>
          m.model_id.toLowerCase().includes(lowerQuery) ||
          m.name.toLowerCase().includes(lowerQuery) ||
          m.description?.toLowerCase().includes(lowerQuery),
      );
    }

    if (options.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get available types
   */
  getTypes(): string[] {
    if (!this.data) return [];
    return Object.keys(this.data.typeIndex).sort();
  }

  /**
   * Get type counts
   */
  getTypeCounts(): Record<string, number> {
    if (!this.data) return {};
    const counts: Record<string, number> = {};
    for (const [type, ids] of Object.entries(this.data.typeIndex)) {
      counts[type] = ids.length;
    }
    return counts;
  }

  /**
   * Get model count
   */
  getModelCount(): number {
    return this.data?.modelCount ?? 0;
  }

  /**
   * Get summary for default response
   */
  getSummary(): ModelSummary {
    const types = this.getTypes();
    return {
      totalModels: this.getModelCount(),
      types,
      typeCount: types.length,
      typeCounts: this.getTypeCounts(),
    };
  }

  /**
   * Check if popular models cache is stale
   */
  private isPopularModelsStale(): boolean {
    if (!this.popularModels || !this.popularModelsFetchedAt) return true;
    return Date.now() - this.popularModelsFetchedAt > this.popularModelsTtlMs;
  }

  /**
   * Refresh popular models from wavespeed.ai/models
   */
  async refreshPopularModels(): Promise<void> {
    this.popularModels = await scrapePopularModels();
    this.popularModelsFetchedAt = Date.now();
  }

  /**
   * Get recommended models (scraped from wavespeed.ai/models, filtered to those that exist)
   */
  getRecommendedModels(): RecommendedModel[] {
    // Use scraped popular models if available, otherwise fallback
    const recommended = this.popularModels ?? FALLBACK_RECOMMENDED;

    if (!this.data) return recommended;

    // Filter to only models that exist in the API response
    const existingMap = new Map(this.data.models.map((m) => [m.model_id, m]));
    const filtered = recommended
      .filter((r) => existingMap.has(r.id))
      .map((r) => ({
        ...r,
        price: existingMap.get(r.id)?.base_price,
      }));

    // If filtering removed too many, supplement with fallback
    if (filtered.length < 3) {
      const fallbackFiltered = FALLBACK_RECOMMENDED.filter(
        (r) => existingMap.has(r.id) && !filtered.some((f) => f.id === r.id),
      ).map((r) => ({
        ...r,
        price: existingMap.get(r.id)?.base_price,
      }));
      return [...filtered, ...fallbackFiltered].slice(0, 10);
    }

    return filtered.slice(0, 10);
  }

  /**
   * Get recommended models asynchronously (refreshes popular models if stale)
   */
  async getRecommendedModelsAsync(): Promise<RecommendedModel[]> {
    if (this.isPopularModelsStale()) {
      await this.refreshPopularModels();
    }
    return this.getRecommendedModels();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      cacheAgeMs: this.data ? Date.now() - this.data.fetchedAt : 0,
    };
  }

  /**
   * Check if cache has data (for graceful degradation)
   */
  hasData(): boolean {
    return this.data !== null;
  }
}

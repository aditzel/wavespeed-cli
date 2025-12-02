/**
 * Cache types for model data storage and retrieval
 */

/**
 * Minimal model schema for caching (excludes api_schema to save space)
 */
export interface CachedModel {
  model_id: string;
  name: string;
  type: string;
  base_price: number;
  description?: string;
}

/**
 * Persisted cache data structure
 */
export interface ModelCacheData {
  /** Schema version for migrations */
  version: number;
  /** Unix timestamp (ms) when data was fetched */
  fetchedAt: number;
  /** TTL in milliseconds */
  ttlMs: number;
  /** Quick count without parsing all models */
  modelCount: number;
  /** Type -> model_ids index for fast filtering */
  typeIndex: Record<string, string[]>;
  /** Full model list */
  models: CachedModel[];
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  hitCount: number;
  missCount: number;
  lastFetchMs: number;
  cacheAgeMs: number;
  source: "memory" | "file" | "api" | "none";
}

/**
 * Filter options for model queries
 */
export interface ModelFilterOptions {
  type?: string;
  search?: string;
  limit?: number;
}

/**
 * Summary response for default (no-filter) queries
 */
export interface ModelSummary {
  totalModels: number;
  types: string[];
  typeCount: number;
  typeCounts: Record<string, number>;
}

/**
 * Recommended model for default response
 */
export interface RecommendedModel {
  id: string;
  type: string;
  desc: string;
}

/** Current cache schema version */
export const CACHE_VERSION = 1;

/** Default memory TTL: 5 minutes */
export const DEFAULT_MEMORY_TTL_MS = 5 * 60 * 1000;

/** Default file TTL: 24 hours */
export const DEFAULT_FILE_TTL_MS = 24 * 60 * 60 * 1000;

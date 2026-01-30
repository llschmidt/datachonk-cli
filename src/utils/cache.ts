import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import chalk from "chalk";

/**
 * Caching Layer for DataChonk CLI
 * 
 * Caches expensive operations like:
 * - Database discovery scans
 * - Knowledge graph computations
 * - AI model responses
 * - Parsed SQL results
 */

export interface CacheEntry<T> {
  key: string;
  data: T;
  timestamp: number;
  expiresAt: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface CacheConfig {
  enabled: boolean;
  directory: string;
  defaultTTL: number; // seconds
  maxSize: number; // bytes
  maxEntries: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  enabled: true,
  directory: join(process.cwd(), ".datachonk", "cache"),
  defaultTTL: 3600, // 1 hour
  maxSize: 100 * 1024 * 1024, // 100MB
  maxEntries: 1000,
};

let config: CacheConfig = { ...DEFAULT_CONFIG };

/**
 * Initialize the cache with custom configuration
 */
export function initCache(customConfig: Partial<CacheConfig> = {}): void {
  config = { ...DEFAULT_CONFIG, ...customConfig };
  
  if (config.enabled && !existsSync(config.directory)) {
    mkdirSync(config.directory, { recursive: true });
  }
}

/**
 * Generate a cache key from input data
 */
export function generateCacheKey(namespace: string, ...args: unknown[]): string {
  const input = JSON.stringify({ namespace, args });
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

/**
 * Get cache file path for a key
 */
function getCachePath(key: string): string {
  return join(config.directory, `${key}.json`);
}

/**
 * Get a value from cache
 */
export function get<T>(key: string): T | null {
  if (!config.enabled) return null;

  const path = getCachePath(key);
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(content);

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      unlinkSync(path);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Set a value in cache
 */
export function set<T>(
  key: string,
  data: T,
  options: { ttl?: number; tags?: string[]; metadata?: Record<string, unknown> } = {}
): void {
  if (!config.enabled) return;

  const entry: CacheEntry<T> = {
    key,
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + (options.ttl || config.defaultTTL) * 1000,
    tags: options.tags || [],
    metadata: options.metadata,
  };

  const path = getCachePath(key);
  writeFileSync(path, JSON.stringify(entry, null, 2));
}

/**
 * Delete a cache entry
 */
export function del(key: string): boolean {
  const path = getCachePath(key);
  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }
  return false;
}

/**
 * Clear cache entries by tag
 */
export function clearByTag(tag: string): number {
  if (!existsSync(config.directory)) return 0;

  let cleared = 0;
  const files = readdirSync(config.directory).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const path = join(config.directory, file);
      const content = readFileSync(path, "utf-8");
      const entry: CacheEntry<unknown> = JSON.parse(content);

      if (entry.tags.includes(tag)) {
        unlinkSync(path);
        cleared++;
      }
    } catch {
      // Skip invalid entries
    }
  }

  return cleared;
}

/**
 * Clear all expired entries
 */
export function clearExpired(): number {
  if (!existsSync(config.directory)) return 0;

  let cleared = 0;
  const files = readdirSync(config.directory).filter((f) => f.endsWith(".json"));
  const now = Date.now();

  for (const file of files) {
    try {
      const path = join(config.directory, file);
      const content = readFileSync(path, "utf-8");
      const entry: CacheEntry<unknown> = JSON.parse(content);

      if (now > entry.expiresAt) {
        unlinkSync(path);
        cleared++;
      }
    } catch {
      // Skip invalid entries
    }
  }

  return cleared;
}

/**
 * Clear all cache entries
 */
export function clearAll(): number {
  if (!existsSync(config.directory)) return 0;

  const files = readdirSync(config.directory).filter((f) => f.endsWith(".json"));
  
  for (const file of files) {
    try {
      unlinkSync(join(config.directory, file));
    } catch {
      // Skip errors
    }
  }

  return files.length;
}

/**
 * Get cache statistics
 */
export function getStats(): {
  entries: number;
  size: number;
  oldestEntry: number | null;
  newestEntry: number | null;
} {
  if (!existsSync(config.directory)) {
    return { entries: 0, size: 0, oldestEntry: null, newestEntry: null };
  }

  const files = readdirSync(config.directory).filter((f) => f.endsWith(".json"));
  let size = 0;
  let oldest: number | null = null;
  let newest: number | null = null;

  for (const file of files) {
    try {
      const path = join(config.directory, file);
      const stat = statSync(path);
      size += stat.size;

      const content = readFileSync(path, "utf-8");
      const entry: CacheEntry<unknown> = JSON.parse(content);

      if (oldest === null || entry.timestamp < oldest) {
        oldest = entry.timestamp;
      }
      if (newest === null || entry.timestamp > newest) {
        newest = entry.timestamp;
      }
    } catch {
      // Skip invalid entries
    }
  }

  return { entries: files.length, size, oldestEntry: oldest, newestEntry: newest };
}

/**
 * Decorator-style cache wrapper for async functions
 */
export function cached<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: { namespace: string; ttl?: number; tags?: string[] }
): T {
  return (async (...args: Parameters<T>) => {
    const key = generateCacheKey(options.namespace, ...args);
    
    // Try to get from cache
    const cached = get(key);
    if (cached !== null) {
      return cached;
    }

    // Execute function and cache result
    const result = await fn(...args);
    set(key, result, { ttl: options.ttl, tags: options.tags });
    
    return result;
  }) as T;
}

/**
 * Cache wrapper for scan results
 */
export function cacheScanResult(
  connectionId: string,
  schemas: string[],
  result: unknown
): void {
  const key = generateCacheKey("scan", connectionId, schemas.sort().join(","));
  set(key, result, {
    ttl: 24 * 3600, // 24 hours
    tags: ["scan", `connection:${connectionId}`],
    metadata: { connectionId, schemas, scannedAt: new Date().toISOString() },
  });
}

/**
 * Get cached scan result
 */
export function getCachedScanResult(
  connectionId: string,
  schemas: string[]
): unknown | null {
  const key = generateCacheKey("scan", connectionId, schemas.sort().join(","));
  return get(key);
}

/**
 * Cache wrapper for knowledge graph
 */
export function cacheKnowledgeGraph(
  projectPath: string,
  graph: unknown
): void {
  const key = generateCacheKey("knowledge-graph", projectPath);
  set(key, graph, {
    ttl: 3600, // 1 hour
    tags: ["knowledge-graph", `project:${projectPath}`],
  });
}

/**
 * Get cached knowledge graph
 */
export function getCachedKnowledgeGraph(projectPath: string): unknown | null {
  const key = generateCacheKey("knowledge-graph", projectPath);
  return get(key);
}

/**
 * Print cache status to console
 */
export function printCacheStatus(): void {
  const stats = getStats();
  
  console.log(chalk.bold("\nCache Status"));
  console.log(chalk.gray("─".repeat(40)));
  console.log(`  Entries: ${stats.entries}`);
  console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  
  if (stats.oldestEntry) {
    const oldestAge = Math.round((Date.now() - stats.oldestEntry) / 1000 / 60);
    console.log(`  Oldest: ${oldestAge} minutes ago`);
  }
  if (stats.newestEntry) {
    const newestAge = Math.round((Date.now() - stats.newestEntry) / 1000 / 60);
    console.log(`  Newest: ${newestAge} minutes ago`);
  }
}

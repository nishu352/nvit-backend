/**
 * Lightweight, bounded in-memory LRU Cache with TTL support.
 * Zero external dependencies. Uses Map insertion order for O(1) LRU eviction.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class SimpleLRUCache<T> {
  private maxEntries: number;
  private defaultTtlMs: number;
  private cache: Map<string, CacheEntry<T>>;

  constructor(maxEntries: number = 500, defaultTtlMs: number = 5 * 60 * 1000) {
    this.maxEntries = Math.max(1, maxEntries);
    this.defaultTtlMs = Math.max(1000, defaultTtlMs);
    this.cache = new Map();
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check expiration (lazy eviction)
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU position by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry (first key in map)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    const expiresAt = Date.now() + (ttlMs !== undefined ? Math.max(100, ttlMs) : this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Global bounded instance for company autocomplete suggestions
export const companyAutocompleteCache = new SimpleLRUCache<any[]>(500, 5 * 60 * 1000);

export function clearCompanyCache(): void {
  companyAutocompleteCache.clear();
}

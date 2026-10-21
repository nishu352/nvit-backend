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

// Global bounded instances for company autocomplete, search results, and partner banks
export const companyAutocompleteCache = new SimpleLRUCache<any[]>(1000, 5 * 60 * 1000);
export const companySearchCache = new SimpleLRUCache<any>(500, 3 * 60 * 1000);
export const partnerBanksCache = new SimpleLRUCache<any[]>(10, 15 * 60 * 1000);
export const companyAliasesCache = new SimpleLRUCache<any[]>(10, 15 * 60 * 1000);

/**
 * Singleflight Request Coalescing
 * Prevents "thundering herd" by sharing an in-flight Promise among identical concurrent requests.
 */
export class Singleflight {
  private inFlight = new Map<string, Promise<any>>();

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = fn()
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }
}

export const searchSingleflight = new Singleflight();
export const autocompleteSingleflight = new Singleflight();

export function clearCompanyCache(): void {
  companyAutocompleteCache.clear();
  companySearchCache.clear();
  partnerBanksCache.clear();
  companyAliasesCache.clear();
}


export class LRUCache<T> {
  private cache = new Map<string, { value: T; expiry: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiry: Date.now() + this.ttlMs });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export class InflightMap<T> {
  private map = new Map<string, Promise<T>>();

  async getOrSet(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.map.get(key);
    if (existing) return existing;
    const promise = factory().finally(() => { this.map.delete(key); });
    this.map.set(key, promise);
    return promise;
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}

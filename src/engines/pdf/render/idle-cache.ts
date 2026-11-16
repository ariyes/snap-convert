interface Entry<V> {
  value: V;
  users: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Keeps one value per key while it is in use, and for `ttlMs` after its last use ends.
 * Then the value is disposed. Using it again within the TTL restarts the clock.
 */
export class IdleCache<K, V> {
  readonly #entries = new Map<K, Entry<V>>();
  readonly #ttlMs: number;
  readonly #create: (key: K) => V;
  readonly #dispose: (value: V) => void;

  constructor(ttlMs: number, create: (key: K) => V, dispose: (value: V) => void) {
    this.#ttlMs = ttlMs;
    this.#create = create;
    this.#dispose = dispose;
  }

  get size(): number {
    return this.#entries.size;
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  async use<T>(key: K, task: (value: V) => Promise<T>): Promise<T> {
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = { value: this.#create(key), users: 0, timer: undefined };
      this.#entries.set(key, entry);
    }
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.users += 1;
    try {
      return await task(entry.value);
    } finally {
      entry.users -= 1;
      if (entry.users === 0) {
        const idle = entry;
        idle.timer = setTimeout(() => {
          this.#entries.delete(key);
          this.#dispose(idle.value);
        }, this.#ttlMs);
      }
    }
  }

  /** Disposes every value now, in use or not (tests). */
  clear(): void {
    for (const entry of this.#entries.values()) {
      clearTimeout(entry.timer);
      this.#dispose(entry.value);
    }
    this.#entries.clear();
  }
}

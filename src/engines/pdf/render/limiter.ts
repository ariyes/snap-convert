interface Waiter {
  grant: () => void;
  signal: AbortSignal | undefined;
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError');
}

/** First-come-first-served slots: at most `max` holders at once. Waiting can be aborted. */
export class Limiter {
  readonly max: number;
  #active = 0;
  readonly #queue: Waiter[] = [];

  constructor(max: number) {
    this.max = max;
  }

  /** Slots currently held. */
  get active(): number {
    return this.#active;
  }

  /** Resolves with a release function once a slot is free; rejects with the abort reason if aborted first. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const waiter: Waiter = {
        signal,
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          this.#active += 1;
          resolve(this.#releaser());
        },
      };
      const onAbort = () => {
        const index = this.#queue.indexOf(waiter);
        if (index !== -1) this.#queue.splice(index, 1);
        reject(abortReason(signal));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#queue.push(waiter);
      this.#next();
    });
  }

  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      this.#next();
    };
  }

  #next(): void {
    while (this.#active < this.max) {
      const waiter = this.#queue.shift();
      if (!waiter) return;
      if (waiter.signal?.aborted) continue;
      waiter.grant();
    }
  }
}

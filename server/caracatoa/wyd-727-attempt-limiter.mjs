/** Bounded in-memory failure counter for one listener process. */
export class Wyd727AttemptLimiter {
  #attempts = new Map();

  constructor({ maxFailures = 5, windowMs = 60_000, maxKeys = 512, now = Date.now } = {}) {
    if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 100) {
      throw new RangeError('maxFailures deve ficar entre 1 e 100.');
    }
    if (!Number.isInteger(windowMs) || windowMs < 1 || windowMs > 3_600_000) {
      throw new RangeError('windowMs deve ficar entre 1 e 3600000.');
    }
    if (!Number.isInteger(maxKeys) || maxKeys < 1 || maxKeys > 65_536) {
      throw new RangeError('maxKeys deve ficar entre 1 e 65536.');
    }
    if (typeof now !== 'function') throw new TypeError('now precisa ser uma função.');
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
  }

  canAttempt(key) {
    if (typeof key !== 'string' || key.length === 0) return false;
    const time = this.now();
    const current = this.#attempts.get(key);
    if (current && time - current.startedAt >= this.windowMs) {
      this.#attempts.delete(key);
      return true;
    }
    if (!current && this.#attempts.size >= this.maxKeys) {
      this.#prune(time);
      if (this.#attempts.size >= this.maxKeys) return false;
    }
    return !current || current.failures < this.maxFailures;
  }

  recordFailure(key) {
    if (!this.canAttempt(key)) return this.maxFailures;
    const time = this.now();
    const current = this.#attempts.get(key);
    const next = current && time - current.startedAt < this.windowMs
      ? { startedAt: current.startedAt, failures: current.failures + 1 }
      : { startedAt: time, failures: 1 };
    this.#attempts.set(key, next);
    return next.failures;
  }

  clear(key) {
    if (typeof key === 'string') this.#attempts.delete(key);
  }

  #prune(time) {
    for (const [key, entry] of this.#attempts) {
      if (time - entry.startedAt >= this.windowMs) this.#attempts.delete(key);
    }
  }
}

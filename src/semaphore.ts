import { Governor } from "./governor.js";

export class Semaphore extends Governor {
  #limit: number;
  #acquired: number = 0;
  #wait: PromiseWithResolvers<void> | null = null;
  #idleListeners: (() => void)[] = [];

  constructor(limit: number) {
    if ((limit >>> 0) !== limit) {
      throw new TypeError("Limit must be an integer");
    }
    if (limit < 0) {
      throw new RangeError("Limit must be non-negative");
    }
    super();

    this.#limit = limit;
  }

  async acquire() {
    while (this.#acquired >= this.#limit) {
      if (!this.#wait) {
        this.#wait = Promise.withResolvers<void>();
      }
      await this.#wait.promise;
    }
    ++this.#acquired;

    let hasReleased = false;

    const dispose = () => {
      if (hasReleased) {
        throw new Error("Already released");
      }
      hasReleased = true;
      --this.#acquired;
      if (this.#wait) {
        this.#wait.resolve();
        this.#wait = null;
      } else if (this.#acquired === 0) {
        this.#notifyIdleListeners();
      }
    };

    return {
      release: dispose,
      [Symbol.dispose]: dispose,
    };
  }

  addIdleListener(cb: () => void) {
    this.#idleListeners.push(cb);
  }

  removeIdleListener(cb: () => void) {
    const idx = this.#idleListeners.indexOf(cb);
    if (idx >= 0) {
      this.#idleListeners.splice(idx, 1);
    }
  }

  #notifyIdleListeners() {
    for (const cb of this.#idleListeners) {
      try {
        cb();
      } catch {}
    }
  }
}

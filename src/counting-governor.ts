import { AbortableGovernor } from "./abortable-governor.js";

export class CountingGovernor extends AbortableGovernor {
  #capacity: number;
  #acquired: number = 0;
  #wait: PromiseWithResolvers<void> | null = null;
  #idleListeners: (() => void)[] = [];

  constructor(capacity: number) {
    if ((capacity >>> 0) !== capacity) {
      throw new TypeError("capacity must be an integer");
    }
    if (capacity < 0) {
      throw new RangeError("capacity must be non-negative");
    }
    super();

    this.#capacity = capacity;
  }

  async #acquire(abortToken?: { isAborted: boolean }) {
    while (this.#acquired >= this.#capacity) {
      if (!this.#wait) {
        this.#wait = Promise.withResolvers<void>();
      }
      await this.#wait.promise;
      if (abortToken?.isAborted) {
        throw new ReferenceError("Acquire was aborted");
      }
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

  override async acquire() {
    return this.#acquire();
  }

  override acquireAbortable() {
    const abortToken = { isAborted: false };
    const abort = () => {
      abortToken.isAborted = true;
      if (this.#wait) {
        this.#wait.resolve();
        this.#wait = null;
      }
    };
    const token = this.#acquire(abortToken);
    return { token, abort };
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

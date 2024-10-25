import { GovernorToken } from "./abortable-governor";

export abstract class Governor {
  abstract acquire(): Promise<GovernorToken>;

  with<R>(fn: (...args: []) => R): Promise<Awaited<R>> {
    return this.wrap(fn)();
  }

  wrap<T, A extends unknown[], R>(
    fn: (this: T, ...args: A) => R,
  ): (this: T, ...args: A) => Promise<Awaited<R>> {
    const _this = this;
    return async function (...args): Promise<Awaited<R>> {
      const token = await _this.acquire();
      try {
        return await fn.apply(this, args);
      } finally {
        token[Symbol.dispose]();
      }
    };
  }

  wrapIterator<T>(iter: Iterator<T> | AsyncIterator<T>): AsyncIterator<T> {
    return {
      next: async (n) =>
        await this.wrap(iter.next as Iterator<T>["next"]).call(iter, n),
      return: async () =>
        typeof iter.return === "function"
          ? iter.return()
          : { done: true, value: undefined },
    };
  }

  static all(...governors: Governor[]): Governor {
    return new ComposedGovernorAll(governors);
  }
}

class ComposedGovernorAll extends Governor {
  #governors;
  #ongoingAcquire: Promise<void> | null = null;

  constructor(governors: Governor[]) {
    super();
    this.#governors = governors;
  }

  async acquire(): Promise<GovernorToken> {
    while (this.#ongoingAcquire) {
      await this.#ongoingAcquire;
    }
    const pwr = Promise.withResolvers<void>();
    let tokens: GovernorToken[];
    try {
      this.#ongoingAcquire = pwr.promise;
      // todo: when any acquire fails, we should release all already acquired tokens / cancel acquisitions
      tokens = await Promise.all(this.#governors.map((g) => g.acquire()));
    } finally {
      this.#ongoingAcquire = null;
      pwr.resolve();
    }
    function dispose() {
      let deferred;
      let didError = false;
      for (let t of tokens) {
        try {
          t.release();
        } catch (e) {
          if (!didError) {
            deferred = e;
            didError = true;
          }
        }
      }
      if (didError) {
        throw deferred;
      }
    }
    return {
      release: dispose,
      [Symbol.dispose]: dispose,
    } satisfies GovernorToken;
  }
}
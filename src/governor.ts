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
  #currentlyAcquiring: boolean = false;
  #waitingToAcquireQueue: ((tokens: (GovernorToken | null)[]) => void)[];

  constructor(governors: Governor[]) {
    super();
    this.#governors = governors;
    this.#waitingToAcquireQueue = [];
  }

  async acquire(): Promise<GovernorToken> {
    let leftoverTokens: (GovernorToken | null)[] = [];
    if (this.#currentlyAcquiring) {
      const pwr = Promise.withResolvers<(GovernorToken | null)[]>();
      this.#waitingToAcquireQueue.push(pwr.resolve);
      leftoverTokens = await pwr.promise;
    }
    this.#currentlyAcquiring = true;
    const promises = this.#governors.map((g, i) => {
      if (leftoverTokens[i]) {
        return Promise.resolve(leftoverTokens[i]);
      } else {
        return g.acquire();
      }
    });
    const results = await Promise.allSettled(promises);
    this.#currentlyAcquiring = false;
    const firstRejection = results.find((r) => r.status === "rejected");
    const tokens: (GovernorToken | null)[] = results.map((r) =>
      r.status === "fulfilled" ? r.value : null
    );
    if (firstRejection) {
      const nextAcquire = this.#waitingToAcquireQueue.shift();
      if (nextAcquire) {
        nextAcquire(tokens);
      } else {
        for (const token of tokens) {
          if (token) {
            try {
              token.release();
            } catch {
              // Ignore errors during release
            }
          }
        }
      }
      throw firstRejection.reason;
    }

    function dispose() {
      let deferred;
      let didError = false;
      for (let t of tokens) {
        try {
          t!.release();
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

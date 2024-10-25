export abstract class Governor {
  abstract acquire(): Promise<GovernorToken>;

  with<R>(fn: (...args: []) => R): Promise<Awaited<R>> {
    return this.wrap(fn)();
  }

  wrap<T, A extends unknown[], R>(fn: (this: T, ...args: A) => R): ((this: T, ...args: A) => Promise<Awaited<R>>) {
    const _this = this;
    return async function(...args): Promise<Awaited<R>> {
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
        await this.wrap(iter.next as Iterator<T>['next']).call(iter, n)
      ,
      return: async () =>
        typeof iter.return === "function"
          ? iter.return()
          : { done: true, value: undefined }
    }
  }

  // wrapIterable<T>(iter: Iterable<T> | AsyncIterable<T>): AsyncIterable<T> {
  // }

  static all(...governors: Governor[]): Governor {
    return new ComposedGovernorAll(governors);
  }

  static any(...governors: Governor[]): Governor {
    return new ComposedGovernorAny(governors);
  }
}

class ComposedGovernorAll extends Governor {
  #governors;

  constructor(governors: Governor[]) {
    super();
    this.#governors = governors
  }

  async acquire(): Promise<GovernorToken> {
    let tokens = await Promise.all(this.#governors.map(g => g.acquire()));
    function dispose() {
      let deferred = null;
      for (let t of tokens) {
        try {
          t.release();
        } catch (e) {
          deferred ??= e;
        }
      };
      if (deferred) {
        throw deferred;
      }
    }
    return {
      release: dispose,
      [Symbol.dispose]: dispose,
    } as GovernorToken;
  }
}

class ComposedGovernorAny extends Governor {
  #governors;

  constructor(governors: Governor[]) {
    // Governor.any([]) would be impossible to acquire
    if (governors.length === 0) {
      throw new RangeError("at least one governor must be provided");
    }
    super();
    this.#governors = governors
  }

  acquire(): Promise<GovernorToken> {
    let settled = false;
    let { promise, resolve, reject } = Promise.withResolvers<GovernorToken>();
    let tokenPromises = this.#governors.map(g => g.acquire());
    // resolve with the first token we acquire, and insta-release all others
    for (let p of tokenPromises) {
      p.then(token => {
        if (!settled) {
          settled = true;
          resolve(token);
        } else {
          token.release();
        }
      });
    };
    // if all tokenPromises reject, we should reject with an AggregateError
    Promise.any(tokenPromises).catch(e => {
      reject(e);
    });
    return promise;
  }
}

export interface GovernorToken {
  release(): void;
  [Symbol.dispose](): void;
}
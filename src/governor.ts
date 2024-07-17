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
    const _this = this;
    return {
      next: async function(n) {
        return await _this.wrap(iter.next as Iterator<T>['next']).call(iter, n);
      },
      return: async () =>
        typeof iter.return === "function"
          ? iter.return()
          : { done: true, value: undefined }
    }
  }

  // wrapIterable<T>(iter: Iterable<T> | AsyncIterable<T>): AsyncIterable<T> {
  // }
}

export interface GovernorToken {
  release(): void;
  [Symbol.dispose](): void;
}
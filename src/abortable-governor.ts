import { Governor, GovernorToken } from "./governor";

export abstract class AbortableGovernor extends Governor {
  override acquire(): Promise<GovernorToken> {
    return this.acquireAbortable().token;
  }

  abstract acquireAbortable(): {
    token: Promise<GovernorToken>;
    abort: () => void; // todo: abort or requestAbort
  };

  override wrapIterator<T>(
    iter: Iterator<T> | AsyncIterator<T>,
  ): AsyncIterator<T> {
    const pendingAcquireAborts = new Set<() => void>();
    return {
      next: async (n) => {
        const { token: promise, abort } = this.acquireAbortable();
        pendingAcquireAborts.add(abort);
        let token: GovernorToken;
        try {
          token = await promise;
        } finally {
          pendingAcquireAborts.delete(abort);
        }
        try {
          // todo: should we forward n here?
          return await iter.next(n);
        } finally {
          token[Symbol.dispose]();
        }
      },
      return: async () => {
        const value = typeof iter.return === "function"
          ? iter.return()
          : { done: true, value: undefined } as const;
        let error: unknown;
        let hasErrored = false;
        for (const abort of pendingAcquireAborts) {
          try {
            abort();
          } catch (e) {
            if (!hasErrored) {
              error = e;
              hasErrored = true;
            }
          }
        }
        if (hasErrored) {
          throw error;
        }
        return value;
      },
    };
  }

  static any(...governors: AbortableGovernor[]): AbortableGovernor {
    return new ComposedGovernorAny(governors);
  }
}

class ComposedGovernorAny extends AbortableGovernor {
  #governors;

  constructor(governors: AbortableGovernor[]) {
    super();
    this.#governors = governors;
  }

  acquireAbortable() {
    // Governor.any([]) should be infinitely acquire-able
    if (this.#governors.length === 0) {
      // throw here
    }
    let settled = false;
    let { promise, resolve, reject } = Promise.withResolvers<GovernorToken>();
    let tokenPromises = this.#governors.map((g) => g.acquire());
    // resolve with the first token we acquire, and insta-release all others
    for (let p of tokenPromises) {
      p.then((token) => {
        if (!settled) {
          settled = true;
          resolve(token);
        } else {
          token.release();
        }
      });
    }
    // if all tokenPromises reject, we should reject with the AggregateError
    Promise.any(tokenPromises).catch((e) => {
      reject(e);
    });
    return promise;
  }
}

export interface GovernorToken {
  release(): void;
  [Symbol.dispose](): void;
}

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
}

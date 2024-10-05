JavaScript Concurrency Control Proposal
=======================================

**Stage:** 1

**Champions:** Michael Ficarra, Luca Casonato

**Authors:** Michael Ficarra, Luca Casonato, Kevin Gibbons

This proposal aims to provide a mechanism for describing a desired amount of concurrency and a coordination mechanism to achieve it. This could be for limiting concurrent access to a shared resource or for setting a target concurrency for an otherwise unbounded workload.

A major motivator for this proposal is the concurrency support in the [async iterator helpers proposal](https://github.com/tc39/proposal-async-iterator-helpers). While that proposal has gone to great lengths to allow for concurrent iteration of its produced async iterators (such as through `map` and `filter`), it does not provide any way to consume async iterators concurrently (such as through `some` or `forEach`). Additionally, there is no mechanism provided by that proposal for generically limiting concurrent iteration of async iterators. This propsal attempts to address those deferred needs.

The concurrency control mechanism proposed here is also motivated by many other use cases outside of async iteration. For example, an application may want to limit the concurrency of a certain function being invoked, or limit concurrent file reads, writes, or network requests. This proposal aims to provide a generic mechanism for controlling concurrency in JavaScript that can be used in a wide variety of use cases.

## Presentations to Committee

- [October 2024 presentation to TC39-TG5](https://docs.google.com/presentation/d/1Pf0s8XXVCxlERmJU_YZY6YwEULXDS_HaBH3zuMUyrPo)
- [July 2024: Stage 1](https://docs.google.com/presentation/d/1rLIzouj1zTr4KdjNrYMZt-FbvEGMPmVeJ8HjOtB6wOU)

## Proposal

This proposal consists of 3 major components: a Governor interface, the CountingGovernor class, and the AsyncIterator.prototype integration.

### Governor

The Governor interface is used for gaining access to a limited resource and later signalling that you are finished with that resource. It is intentionally designed in a way that permits dynamically changing limits.

There is only a single method required by the Governor interface: `acquire`, returning a Promise that eventually resolves with a `GovernorToken`. A `GovernorToken` has a `release` method to indicate that the resource is no longer needed. The `GovernorToken` can also be automatically disposed using `using` syntax from the [Explicit Resource Management proposal](https://github.com/tc39/proposal-explicit-resource-management).

A Governor is meant to control access to resources among mutually trustworthy parties. For adversarial scenarios, a [Capability](https://gist.github.com/michaelficarra/415941f94ed2249b5322d077aeaa6f96) should be used instead.

The Governor name is taken from [the speed-limiting device in motor vehicles](https://en.wikipedia.org/wiki/Governor_%28device%29).

<details>
<summary>
There is also a Governor constructor with helpers on its prototype.
</summary>

The constructor unconditionally throws when it is the `new.target`. To make the helpers available, a concrete Governor can be implemented as follows:

```js
const someGovernor = {
  __proto__: Governor.prototype,
  acquire() {
    // ...
  },
};
```

The `with(fn: () => R): Promise<R>` helper takes a function and automatically acquires/releases a GovernorToken. An approximation:

```js
Governor.prototype.with = async (fn) => {
  using void = await this.acquire();
  return await fn();
};
```

The `wrap(fn: (...args) => R): (...args) => Promise<R>` helper takes a function and returns a function with the same behaviour but limited in its concurrency by this Governor. An approximation:

```js
Governor.prototype.wrap = fn => {
  const governor = this;
  return async function() {
    using void = await governor.acquire();
    return await fn.apply(this, arguments);
  };
};
```

Similarly, `wrapIterator(it: Iterator<T> | AsyncIterator<T>): AsyncIterator<T>` takes an Iterator or AsyncIterator and returns an AsyncIterator that yields the same values but limited in concurrency by this Governor.
</details>

#### Open Questions

- should the protocol be Symbol-based?
- maybe a sync/throwing acquire?
  - `tryAcquire(): GovernorToken`
  - or maybe not throwing? `tryAcquire(): GovernorToken | null`
- non-throwing Governor() constructor
  - takes an `acquire: () => Promise<GovernorToken>` function
  - also takes a `tryAcquire` function?
  - easy enough to live without it
- alternative name: Regulator?

### CountingGovernor

This proposal subsumes Luca's [Semaphore proposal](https://github.com/lucacasonato/proposal-semaphore).

CountingGovernor is a [counting semaphore](https://en.wikipedia.org/wiki/Semaphore_%28programming%29) that implements the Governor interface and extends Governor. It can be given a non-negative integral Number *capacity* and it is responsible for ensuring that there are no more than that number of active GovernorTokens simultaneously.

#### Open Questions

- are idle listeners useful?
  - triggered whenever the CountingGovernor hits "full" capacity (0 active GovernorTokens)
  - `addIdleListener(cb: () => void): void`
  - `removeIdleListener(cb: () => void): void`
  - callback interface or EventTarget?
- are there concerns about sharing CountingGovernors across Agents?
- alternative name: CountingGovernor? CountingRegulator?

### AsyncIterator.prototype integration

This proposal adds an optional concurrency parameter to the following async iterator helper methods:

- `.toArray([ governor ])`
- `.forEach(fn [, governor ])`
- `.some(predicate [, governor ])`
- `.every(predicate [, governor ])`
- `.find(predicate [, governor ])`
- `.reduce(reducer [, initialValue [, governor ]])`

When not passed, these methods operate serially, as they do in the async iterator helpers proposal.

This proposal also adds a `limit(governor)` method (the dual of `governor.wrapIterator(iterator)`) that returns a concurrency-limited AsyncIterator.

Because CountingGovernor will be an extremely commonly-used Governor, anywhere a Governor is accepted in any AsyncIterator.prototype method, a non-negative integral Number may be passed instead. It will be treated as if a CountingGovernor with that capacity was passed. Because of this, we are able to widen the first parameter of the `buffered` helper to accept a Governor in addition to the non-negative integral Number that it accepts as part of the async iterator helpers proposal.

#### Open Questions

- `reduce` parameter order: gross?
- `buffered` parameter order

## Proposal Summary

- Governors
  - Governor Interface
    - `acquire(): Promise<GovernorToken>`
  - Governor() constructor
    - throws when constructed directly
  - Governor.prototype
    - `with(fn: () => R): Promise<R>`
    - `wrap(fn: (...args) => R): (...args) => Promise<R>`
    - `wrapIterator(it: Iterator<T> | AsyncIterator<T>): AsyncIterator<T>`
  - GovernorToken.prototype
    - `release(): void` === `[Symbol.dispose](): void`
- CountingGovernors
  - `CountingGovernor(capacity: number)` constructor
  - extending Governor
  - implementing the Governor interface
  - shareable across threads
- AsyncIterator.prototype
  - `buffered(limit: Governor | integer, prepopulate = false)`
  - `limit(limit: Governor | integer)`
  - a concurrency param (`Governor | integer`) added to all consuming methods


## FAQ

### Why the generic Governor interface?

While a counting semaphore is a common concurrency control mechanism, there are many other ways to control concurrency. Some examples of these:

- A governor that allows for a burst of activity before enforcing a limit (e.g. a semaphore that allows for 10 concurrent operations, but allows for 20 concurrent operations for the first 5 seconds).
- A distributed governor that enforces a concurrency limit across multiple machines using a distributed lock or consensus algorithm.
- A governor that enforces a concurrency limit based on the current load of the system (e.g. a semaphore that allows for 10 concurrent operations, but allows for 20 concurrent operations if the system is under 50% load).

Because of this variety of use cases, it is important to give developers the flexibility to use their own concurrency control mechanisms with built in JavaScript APIs.

The `CountingGovernor` class provides a simple and common concurrency control mechanism that can be used in many cases. It is expected that many developers will use `CountingGovernor` for their concurrency control needs. However, because APIs don't explicitly take a `CountingGovernor` instance, but any object that implements the `Governor` interface, developers can use their own concurrency control mechanisms if they need to.

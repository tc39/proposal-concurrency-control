import { AbortableGovernor, CountingGovernor, Governor } from "./index.js";

Object.defineProperty(globalThis, "Governor", {
  configurable: true,
  writable: true,
  enumerable: false,
  value: Governor,
});

Object.defineProperty(globalThis, "AbortableGovernor", {
  configurable: true,
  writable: true,
  enumerable: false,
  value: AbortableGovernor,
});

Object.defineProperty(globalThis, "CountingGovernor", {
  configurable: true,
  writable: true,
  enumerable: false,
  value: CountingGovernor,
});

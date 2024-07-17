
import { Governor, Semaphore } from "./index.js";

Object.defineProperty(globalThis, "Governor", {
  configurable: true,
  writable: true,
  enumerable: false,
  value: Governor,
});

Object.defineProperty(globalThis, "Semaphore", {
  configurable: true,
  writable: true,
  enumerable: false,
  value: Semaphore,
});
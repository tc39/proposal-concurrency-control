
import { Governor, CountingGovernor } from "./index.js";

Object.defineProperty(globalThis, "Governor", {
  configurable: true,
  writable: true,
  enumerable: false,
  value: Governor,
});

Object.defineProperty(globalThis, "CountingGovernor", {
  configurable: true,
  writable: true,
  enumerable: false,
  value: CountingGovernor,
});
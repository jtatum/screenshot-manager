import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollIntoView; stub it to a no-op for tests
if (!Element.prototype.scrollIntoView) {
  // @ts-expect-error jsdom environment
  Element.prototype.scrollIntoView = () => {};
}

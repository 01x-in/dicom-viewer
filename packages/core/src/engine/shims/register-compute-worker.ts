// Replaces @cornerstonejs/tools' utilities/registerComputeWorker.js in the engine bundle.
// The original registers a worker through `new Worker(new URL('../workers/computeWorker.js',
// import.meta.url))`, which host bundlers try to resolve relative to our chunk and fail.
// The engine registers the prebuilt 'compute' worker itself, before tools can ask for it.
export function registerComputeWorker(): void {
  // Intentionally empty.
}

// Entry of the prebuilt compute worker (segment statistics, contours). `scripts/build-workers.ts`
// bundles it self-contained, so hosts never see @cornerstonejs/tools' own `new URL(...)` worker.
import 'dv-upstream-compute-worker';

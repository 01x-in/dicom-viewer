# M12 report: multi-frame images

**Done by the spec's criteria, except for a SEG on the frames of one instance**, with the limits listed at the end. The spec is [specs/multi-frame.md](specs/multi-frame.md), the decisions are in [ADR 0015](adr/0015-multi-frame-images.md), and the spike is [m12-spike.md](m12-spike.md).

## Done-when, item by item

| Spec item | Where | Evidence |
|---|---|---|
| Frames become slices | [data/frame-geometry.ts](../packages/core/src/data/frame-geometry.ts), [data/series.ts](../packages/core/src/data/series.ts) | An Enhanced CT is one stack of its frames, with spacing 2.5 mm and `reconstructable`. Unit tests of the reader (shared and per-frame values, a frame with no item, wrong types named by tag and frame, 1,000 frames) and of the series model (layers, mixed with single-frame instances, loops in recorded order). The geometry of frame *k* read from the local file equals that of slice *k* of `ct-j2k` to 1e-6 |
| DICOMweb frames | [data/dicomweb.ts](../packages/core/src/data/dicomweb.ts) | `.../frames/<n>#<owner>`; frame 1 ids are as before; every frame is owned by the source's frame policy |
| Local files | [data/local.ts](../packages/core/src/data/local.ts), [data/local-parse.ts](../packages/core/src/data/local-parse.ts) | One id on the file and `?frame=<k>` for each frame; the groups are read into the DICOMweb JSON shape; the file is registered once |
| Engine | [engine/index.ts](../packages/core/src/engine/index.ts), [data/instance-key.ts](../packages/core/src/data/instance-key.ts) | The whole instance is registered once and forgotten with its last frame. The matrix leak check passes with the Enhanced CT, a plane of it, in both asset modes |
| Pictures are right | `scripts/matrix/multi-frame.ts` | HU of the four inserts, the body, the marker, and the air, on frames 10, 32, and 55, over DICOMweb in the OncoTrace proxy mode (16 frames a request, no whole-instance retrieval; the mock refused none) and from the local file. A coronal plane is a volume of 128 images; its picture, and the sagittal one, are pixel for pixel those of `ct-j2k` (spike) |
| Frame references | [measurements/](../packages/core/src/measurements/), [viewer-core.ts](../packages/core/src/viewer-core.ts) | A measurement on frame 40 is on frame 40, jumped to, in `slices()`, exported, and imported; frame 65 is rejected naming 64 frames; no frame number is frame 1; `frame-lookups.test.ts` fails for a lookup by SOP alone |
| SR by frame | [engine/sr.ts](../packages/core/src/engine/sr.ts) | A report written for frame 3 is read to frame 3; a report for a frame the study lacks is counted unreadable |
| Cine | [cine.ts](../packages/core/src/cine.ts) | A loop with a frame time of 40 ms plays at 25 a second when no rate is asked for; the matrix plays the phantom loop and asks for a plane (`missing-geometry`) |
| Phantom | [tools/phantom](../tools/phantom/phantom.py) | `multiframe-ct` and `multiframe-loop` in `study-multiframe`, with their pytests (the pixels and positions equal the legacy slices; the loop has no geometry and moves a step each frame; both reproducible) |

## What was not built

- **A SEG on the frames of one multi-frame instance.** Loading rejects with a reason. The matching of a SEG's frames to images is by SOP instance; it must go by `(sop, frame)`, and the phantom needs a `multiframe-seg`.
- **The frame number in the SR writer** (it is M11, and not on `main`).
- **`multiframe-sr`** in the phantom. The reader is tested with a report written by Cornerstone's writer for frame 3.

## Limits

- Not tried with a real scanner's file, a large loop, or Safari's engine.
- Each frame is one request.
- The series browser shows the instance count, so one Enhanced CT file shows as one image.
- An Enhanced MR with several dimensions at one position splits into unnamed stacks.
- `SeriesInstance` has three new required fields: a host with its own data source that builds it by hand must add them.

# ADR 0015: A frame is a slice, and the engine registers the whole instance once

Status: accepted (M12). Builds on [ADR 0004](0004-viewer-state-and-ordering.md) (one queue), [ADR 0005](0005-engine-runtime-lifecycle.md) (give back what the engine took), [ADR 0008](0008-measurements.md) (measurements are plain data), and [ADR 0012](0012-layouts-and-mpr.md) (MPR is decided from the stack). It changes one line of [ADR 0013](0013-structured-reports-and-pdf.md): a shape on a frame of a multi-frame image is no longer looked up as frame 1. The spec is [specs/multi-frame.md](../specs/multi-frame.md), and the spike is [m12-spike.md](../m12-spike.md).

## Context

The viewer refused a series with a multi-frame instance: "Multi-frame image series are not supported yet". A host project met it with real studies. Enhanced CT and MR put a whole series in one file, with a position for each frame in functional groups. Ultrasound and angiography are loops with no geometry.

## Decision

- **A frame is made to look like a single-frame instance.** `buildSeries` turns a multi-frame instance into one `SeriesInstance` for each frame: the same SOP instance UID, a `frameNumber`, a `frameCount`, and its own image id. The frame's `metadata` is the instance's JSON without the two functional group sequences, with what they say about this frame (position, orientation, pixel spacing, rescale, window) at the top level, under the tags a single-frame instance uses. The stack split, the sort along the normal, the layers, `reconstructable`, and `decideMpr` then work on frames with no change. The reader is the pure `data/frame-geometry.ts` (Zod for what it reads; a wrong type names the tag and the frame).
- **The engine registers the whole instance, once.** Cornerstone keeps one metadata record for each instance (the key is the image id with `/frames/N` or `?frame=N` taken out) and combines the groups for the frame it is asked about. The first try gave it the metadata of each frame: it kept the record of frame 1 for all frames, so every frame would have had frame 1's position. So `SeriesInstance.instanceMetadata` is the raw JSON, the same object for each frame, and `registerInstance` is keyed by the instance. The engine counts the images that use an instance and forgets its record only with the last (`engine/index.ts`, `data/instance-key.ts`).
- **Image ids.** DICOMweb: `.../frames/<n>#<owner>`, so the frame request policy (a prefix) works for every frame. Local files: `dicomfile:<n>?frame=<k>` on one id for the file, which Cornerstone's loader reads the frame from; the file is registered once. Single-frame ids do not change.
- **A frame is named with the SOP instance.** `sliceKey(sop, frame)` and `findSlice` are the one way to find an image of a stack. A test (`frame-lookups.test.ts`) fails for a lookup by SOP instance UID alone, except in the few places where an instance is the right key.
- **`ViewerStateV1` does not change.** `imageIndex` is still the place in the stack. The frame is worked out from the stack (`stack.instances[imageIndex].frameNumber`) and is in the `viewport:image` event and in the result of `navigateTo`.
- **A measurement has an optional `frameNumber` in its reference.** It is left out for frame 1 and for an instance of one frame, so a reference has one form for them and a single-frame export is the same byte for byte. `measurements/v1` stays version 1: an older viewer cannot open a multi-frame series, so it could not draw a measurement of one on the wrong frame.
- **SR is read by frame.** The engine gives the reader every frame of the stack under `<SOP UID>:<frame>`, the key the reader looks up, and takes the frame of a shape from the image id the reader gives back. A shape on a frame the study does not have is counted as on an image it does not have. A report that names a multi-frame image with no frame number is read as frame 1, which is what the reader does and what the standard's default means: telling the two apart needs a second parse of the report.
- **A SEG on the frames of one instance is refused.** The mapping of a SEG's frames to images is by SOP instance, and the frames of one instance share it, so a SEG would be drawn on one frame. Loading rejects and says why. Matching by frame is a later change.
- **Cine takes its rate from the image.** With no `fps` asked for and nothing playing, the rate is the first of `RecommendedDisplayFrameRate`, `CineRate`, and `1000 / FrameTime`, within 1 to 60.

## Consequences

- `SeriesInstance` has three new required fields (`frameNumber`, `frameCount`, `instanceMetadata`). Reading is not affected. A host with its own data source that builds `SeriesInstance` by hand must add them, or use `buildSeries`. The changeset says so.
- Each frame is a request, so a large Enhanced CT makes many requests. Batching (`frames/1,2,3`) is a later optimization.
- The local source reads a whole file to read its header, as it did. A large multi-frame file takes memory while it does.
- An Enhanced MR with several dimensions at one position splits into one stack for each repeat, with no names. Naming them needs `DimensionIndexSequence`.
- The series browser counts instances, not frames.

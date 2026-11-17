---
'@01x/dicom-viewer-core': minor
---

Multi-frame images open. A series of Enhanced CT, MR, or PT instances shows each frame as one slice, with the position, orientation, and rescale of its own, over DICOMweb and from local files, and reformats into planes when the frames are even and parallel. A loop with no geometry (ultrasound, angiography) shows its frames in the order they were recorded, and cine plays at the rate the image states (`RecommendedDisplayFrameRate`, `CineRate`, or `FrameTime`) unless `fps` is given. Single-frame series are unchanged.

`navigateTo` takes a `frameNumber` (from 1, default 1) and rejects a frame the instance does not have, naming how many it has. A measurement on a frame above 1 has `reference.frameNumber`; a measurement with none is on frame 1, and `measurements/v1` stays version 1. `measurements.list` takes a `frameNumber` filter. The `viewport:image` event and the result of `navigateTo` say the frame. A Structured Report is read by frame. A SEG on the frames of one multi-frame instance is not drawn yet: loading it rejects and says why.

`SeriesInstance` has three new fields: `frameNumber`, `frameCount`, and `instanceMetadata`. A host with its own data source that builds `SeriesInstance` by hand must add them (`buildSeries` does), and its `imageIdFor` is called with the frame number as a third argument.

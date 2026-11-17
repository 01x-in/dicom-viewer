# M12 spike: can the engine show an Enhanced CT?

**Go.** The spike is step 0 of [the multi-frame spec](specs/multi-frame.md). It was run on the synthetic `multiframe-ct` phantom (an Enhanced CT of 64 frames, JPEG 2000 lossless, made from the 64 slices of `ct-j2k`), over DICOMweb from `tools/dicomweb-mock` and from a local file, in Chromium. No real data was used, and none is in this repository.

## Answers to the six questions of the spec

1. **Does Cornerstone read the shared and per-frame groups itself?** Yes, but only from the metadata of the whole instance. Cornerstone keeps one metadata record for each instance: the key is the image id with the frame taken out (`/frames/N`, or `?frame=N` for a local file). It combines the groups for the frame it is asked about (`combineFrameInstance`). The first spike run gave it the metadata of each frame, with the position at the top level and the groups left out. Cornerstone kept the record of frame 1 for all 64 frames, and logged "Metadata add skipped ... already has a value" for the others. The pixels were right, but every frame would have had the position of frame 1. **So the engine registers the raw instance JSON, once for all its frames** (`SeriesInstance.instanceMetadata`), and the frame's hoisted copy (`metadata`) is for the series model only.
2. **Do frames draw with the right HU and plane?** Yes. Frames 1, 32, and 64 read the HU of the phantom (outside −1000, body 40, marker 200; the four inserts on frame 32 and none on frame 3). The axial pixels match `ct-j2k`.
3. **Local file ids.** `dicomfile:<n>?frame=<k>` works with Cornerstone's `loadImageFromNaturalizedMetadata` (it reads `frame=` from the id). The file is registered once, under the id without the frame, and the metadata is parsed once. The 64 frames show with the right HU.
4. **MPR from per-frame ids.** `renderVolume` makes a volume (`mode: "volume"`) from the frames, from both sources. A coronal and a sagittal plane of the Enhanced CT are **pixel for pixel the same** as those of `ct-j2k` (the difference of the two canvases is 0).
5. **Metadata size and parse time.** Reading the groups of 1,000 frames takes under 50 ms (a unit test). The phantom's own JSON is small. A large real series has not been measured here: that needs a maintainer's own file, tried by hand.
6. **Engine chunk size.** No new Cornerstone import: the engine chunk gains only the instance bookkeeping.

## What the spike changed in the design

- `SeriesInstance` has a third new field, `instanceMetadata`, beside `frameNumber` and `frameCount`.
- The engine counts users for each instance as well as for each image, so the record of an instance is forgotten only when the last frame of it is released (`engine/index.ts`).
- Added fields on `SeriesInstance` are required. A host that wrote its own data source and builds `SeriesInstance` by hand must add the three fields (the fix is to use `buildSeries`, which the DICOMweb and local sources use). This is listed in the changeset.

## Not covered

- A real scanner's file. The phantom is uniform and parallel; real enhanced MR can differ per frame (see the risks in the spec).
- Large files: the local source reads a whole file to parse its header (as it does for single-frame files), so a 300 MB file takes memory for a moment.
- Safari's engine (WebKit) was not run.

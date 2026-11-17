# Spec: multi-frame images

Status: proposed (M12). Nothing is built. Six decisions are open and marked **Maintainer decides** (see "Decisions" at the end). The order of the phases follows the maintainer's answer to the question of which data the host project needs: both, enhanced first.

## Why

A host project that uses `@01x/dicom-viewer-core` got this error:

> Multi-frame image series are not supported yet. Convert the series to single-frame instances.

The viewer refuses on purpose. It was a safe choice at M2, when there was no fixture and no code that reads the geometry of a frame ([plan.md](../plan.md), "M2 outcome"). It is now the main reason a real study will not open. Many CT and MR studies from newer scanners are *Enhanced* instances: one file holds the whole series. Ultrasound and angiography are multi-frame by nature.

Where the refusal is today:

| Place | What it does |
|---|---|
| `packages/core/src/data/series.ts`, in `buildSeries` | Throws if any displayable instance has `NumberOfFrames` (0028,0008) over 1 |
| `packages/core/src/viewer-core.ts`, `NavigateTarget` and `assertNavigateTarget` | Say that only frame 1 exists, and throw for a frame number above 1 |
| `packages/core/src/data/local-parse.ts` | Reads `NumberOfFrames`, but not the functional groups |
| `packages/core/src/data/dicomweb.ts`, `frameImageId` | Always builds `.../frames/1` |
| `packages/core/src/engine/sr.ts` | Gives every image to the report reader as `<SOP UID>:1` |
| [ADR 0013](../adr/0013-structured-reports-and-pdf.md) | Says a shape on a frame of a multi-frame image is looked up as frame 1 |

## Scope

In:
- **Phase 1: Enhanced CT, MR, and PT.** One instance holds many frames. Each frame has its own position and orientation in `SharedFunctionalGroupsSequence` and `PerFrameFunctionalGroupsSequence`. They scroll as a stack, reformat as MPR when the geometry allows it, and take measurements and SEGs.
- **Phase 2: cine and loops with no geometry.** Ultrasound, X-ray angiography, and multi-frame secondary capture. An ordered list of frames, played as cine, never reformatted.
- Both DICOMweb frame retrieval and local files.
- A frame number on a measurement's reference, and in the SR reader.
- A synthetic multi-frame phantom, tests, the matrix, docs, and a changeset.

Out (each can be a later spec):
- Multi-frame instances in more than one dimension that must be shown as separate sets (diffusion b-values, echoes, phases). They are split into stacks as repeated positions are today (see "Risks"), with no named dimensions.
- Real-world calibration of ultrasound (`SequenceOfUltrasoundRegions`). A cine frame with no pixel spacing has no length in millimetres.
- Batching several frames in one request (`frames/1,2,3`). One request for each frame, as now.
- Parametric maps, and other multi-frame objects that are not pictures (waveforms, video encodings such as MPEG-4).
- Writing a multi-frame image.

## Design

### The idea: a frame is made to look like a single-frame instance

Everything above `getSeries` (the stack split, the sort, `decideMpr`, the engine, the overlay) already works on a list of "images, each with its own position". So the smallest change is to turn each frame into one entry of that list, with the same kind of metadata a single-frame instance has. The rest of the code then needs few changes, and a single-frame series goes through the same path as before.

### Phases

**Recommendation: build the shared base once, ship enhanced volumes first, then cine.** This follows the maintainer's answer. The base (a frame is a slice, frame retrieval, the frame number on references) is the same for both. Phase 2 adds only the order of frames with no geometry, the cine rate, and a second phantom. It is small once phase 1 is done, so the order of the two costs little.

- **Phase 1** ships when an Enhanced CT file loads, scrolls, reformats (when uniform), takes measurements, a SEG, and an SR, over DICOMweb and from local files.
- **Phase 2** ships when a loop with no geometry loads, plays at its own rate, and takes the keyboard and cine.

Phase 2 may go out in the same release as phase 1. The split is about the order of work and the order of the tests, not about two releases.

### Data model

`SeriesInstance` (exported from the package) is one displayable image. It gets two fields:

```ts
interface SeriesInstance {
  readonly sopInstanceUID: string;
  readonly frameNumber: number;   // 1-based; 1 for a single-frame instance
  readonly frameCount: number;    // NumberOfFrames; 1 for a single-frame instance
  readonly instanceNumber: number | undefined;
  readonly imageId: string;       // one for each frame
  readonly metadata: DicomJsonInstance; // see below
}
```

- A single-frame instance becomes one entry, with `frameNumber: 1` and `frameCount: 1`. Its image id and its metadata are the same as today. A test pins this.
- A multi-frame instance becomes `frameCount` entries. They share the SOP instance UID, and each has its own image id and its own `frameNumber`.
- `LoadedSeriesData.instances` stays a list of real instances (one for each SOP instance, `frameNumber: 1`). It is what SEG and SR retrieval use to ask the data source for a file. `SeriesStack.instances` is the list of displayable images, so for a multi-frame series it holds frames. The name stays (**Maintainer decides**: keep it, or rename the stack's list to `slices`; see "Decisions").
- A lookup by SOP instance UID alone is no longer enough. A helper `sliceKey(sop, frame)` and `findSlice(stack, sop, frame)` in `data/series.ts` do it, and every place that loops over `stack.instances` for a SOP UID uses them (see "Frame references").

### The metadata of a frame

`metadata` of a frame entry is the instance's DICOM JSON, with three changes:

1. The two big sequences (`SharedFunctionalGroupsSequence`, `PerFrameFunctionalGroupsSequence`) are left out. A series of 1,000 frames must not keep 1,000 copies of a 1,000-item sequence. The new record is a shallow copy, so everything else is shared by reference.
2. The values that the functional groups give for *this frame* are put at the top level, under the tags a single-frame instance uses. Per-frame values win over shared values:

| Functional group item | Hoisted to |
|---|---|
| `PlanePositionSequence` (0020,9113) | `ImagePositionPatient` (0020,0032) |
| `PlaneOrientationSequence` (0020,9116) | `ImageOrientationPatient` (0020,0037) |
| `PixelMeasuresSequence` (0028,9110) | `PixelSpacing` (0028,0030), `SliceThickness` (0018,0050), `SpacingBetweenSlices` (0018,0088) |
| `PixelValueTransformationSequence` (0028,9145) | `RescaleIntercept` (0028,1052), `RescaleSlope` (0028,1053), `RescaleType` (0028,1054) |
| `FrameVOILUTSequence` (0028,9132) | `WindowCenter` (0028,1050), `WindowWidth` (0028,1051) |

3. `InstanceNumber` stays the instance's. The order inside a stack comes from the geometry or, with none, from `(instanceNumber, frameNumber)`.

Because the frame now says what a single-frame instance would say, the existing code needs no change to split by orientation, sort along the normal, layer repeated positions, and judge `reconstructable` (`orientationOf`, `stacksForOrientation`, `reconstructability`, `decideMpr`). The test that matters here: the hoisted geometry of frame *k* of the enhanced phantom equals the metadata of slice *k* of `ct-j2k` (see the test plan).

### Reading the geometry (Zod)

A new pure module `packages/core/src/data/frame-geometry.ts`:

- `readFrames(metadata): FrameSet | undefined` returns `undefined` for an instance with no `NumberOfFrames` over 1. Otherwise it returns one entry for each frame, with the hoisted values.
- It reads `SharedFunctionalGroupsSequence` once and `PerFrameFunctionalGroupsSequence` item by item. Each item the code reads (a sequence with one item, and the attributes inside it) is checked with a small Zod schema. A value of the wrong type is an error that names the tag and the frame, not a silent `NaN`.
- An instance whose `PerFrameFunctionalGroupsSequence` has fewer items than `NumberOfFrames` keeps all its frames. The frames with no item get no geometry, so they fall in the existing `missing-geometry` stack, and the series says so in `diagnostics`. This is a damaged file, and showing it is better than refusing it.
- `NumberOfFrames` that is not a whole number from 1 is an error that says so. A very large one is checked against the pixel data size only by the engine, when it decodes.
- A series that has no functional groups at all (a cine loop) gives frames with no geometry. That is phase 2's case, and it falls out of the same code.

The series metadata comes from DICOMweb as one JSON document. It is already Zod-checked as a record. The per-frame sequences are read from it after that check, and the budget is 50 ms for 1,000 frames (a test).

### Image ids and what Cornerstone is given

- **DICOMweb:** `frameImageId` takes a frame number. The id is `wadors:<root>/studies/<s>/series/<r>/instances/<i>/frames/<n>#<owner>`. For a single-frame instance `<n>` is 1, so the id is the same as today. The frame request policy matches ids by prefix, so the headers and the token refresh work for every frame with no change.
- **Local files:** the source allocates one id for a file today (`addLocalFile`). A multi-frame file needs one id for each frame, all pointing at one file, and the file must be read and parsed once, not once for each frame. The id for a frame names the file and the frame (the form is for the spike to settle: a fragment or a query on the existing `dicomfile:` id). `dispose()` removes the file and so every frame id of it.
- **Registering metadata:** the engine's `registerInstance` is keyed by image id and calls `addDicomWebInstance(imageId, instance.metadata)`. For a frame it is called with the frame's metadata (above). Whether Cornerstone's own metadata layer already merges functional groups, and so makes our hoisting only a need of the stack split, is **question 1 of the spike**. If it does, the engine is given the raw instance JSON with the frame id, and the hoisting is still used for the series model.

### Retrieval

- **DICOMweb.** `tools/dicomweb-mock` already splits a multi-frame instance into frames (`splitFrames`) and answers `frames/N`, with encapsulated data needing one fragment for each frame. The viewer asks for one frame for each image id, so the `oncotrace-proxy` rule of at most 16 frames in a request cannot be broken. Whole-instance retrieval stays off for images (`seg-sr-only`). A multi-frame instance must therefore be shown from its frames and the series metadata only.
- **Local files.** `parseLocalInstance` reads a fixed list of flat attributes. It gets the two functional group sequences, read with `dicom-parser`'s sequence items and turned into the same DICOM JSON shape as DICOMweb gives, so one reader (`frame-geometry.ts`) serves both sources. They are before the pixel data, so `untilTag: 'x7fe00010'` still stops in time.
- **`RenderingPort`.** No method changes its signature. A `SeriesStack` already carries `imageIds` and the entries, so `renderStack`, `renderVolume`, and `renderThumbnail` work on frames. The report and SEG methods take `SeriesInstance` entries that now carry a frame number. What changes is inside `engine/`: registering and releasing one image id for each frame. The architecture rules hold:
  - Only `engine/**` imports `@cornerstonejs/*`. `frame-geometry.ts` and the series changes are pure data in `data/`.
  - Everything the host asks for still goes through the queue in `viewer-core.ts`. Frames add no new call.
  - The engine gives back what it takes: `imageUsers`, the cache, and the metadata are counted for each frame id and cleared by `releaseImages` ([ADR 0005](../adr/0005-engine-runtime-lifecycle.md)). The leak check (20 cycles) runs on a multi-frame series.

### State and the public API

- `ViewerStateV1` stays version 1 and gets no new field. `imageIndex` still means the index of the image in the stack, as it does for every stack. For a stack made from one instance that is in frame order it is the frame number minus 1, but a stack sorted by position may differ, so **the frame number is not in the state**. It is worked out from the stack: `stack.instances[imageIndex].frameNumber`.
- `NavigateTarget.frameNumber` already exists (1-based). It starts to mean what it says: `navigateTo({ seriesInstanceUID, sopInstanceUID, frameNumber: 40 })` finds the slice `(sop, 40)`. A frame above the instance's `frameCount` rejects with a message that names the count. A frame number above 1 for a single-frame instance rejects the same way.
- The viewport info (`viewer.viewports.get`) and the `viewport:image` event gain `frameNumber`. Both are additive.
- Single-frame behaviour does not change: the same image ids, the same stacks, the same state, the same links. A golden test of the series model on the existing phantom pins it.
- The public API shows no Cornerstone type. `viewer.unsafe` is untouched.
- A link made before M12 keeps working. A link made after M12 for a multi-frame series holds an `imageIndex` into a stack whose order is deterministic (position, then frame number), so it restores the same image.

### Frame references

This is the part with the most places to change. Today a reference is `(study, series, sopInstanceUID)` and means "the image", which is right only when an instance is one image.

**Measurements** (`packages/core/src/measurements/model.ts`). `MeasurementReference` gets `frameNumber?: number` (a whole number from 1).
- It is set only for a frame above 1 of an instance whose `frameCount` is over 1, and **absent means frame 1**. One form for frame 1, so two measurements on the same place compare equal and a single-frame export does not change by a byte.
- `measurements/v1` stays version 1. The field is optional, so every old file is valid. An older viewer reading a new file would drop the unknown key (the schema is not strict), but an older viewer cannot open a multi-frame series at all, so the measurement could never be drawn in the wrong place (**Maintainer decides**: this argument, or `measurements/v2`).
- The registry finds the slice with `findSlice(stack, sop, frame ?? 1)`. The places to change are the lookups at `registry.ts` (the filter by SOP, the stack match, the reference built from an instance, the export, and the read-back of an SR). A test lists them: no code compares a reference's `sopInstanceUID` to a slice without the frame.
- The statistics and `readSlice` use the slice's image index, so they read the right frame with no change.

**SR reader** (`engine/sr.ts`, `measurements/sr.ts`). The engine gives the reader a map keyed `<SOP UID>:<frame>`. It is built from every slice of the stack, not `:1` for every instance. The reader already reads `ReferencedFrameNumber`. `SrShape` gets the frame it is on, and `referenceOf` in the registry takes `(sop, frame)`. A shape on a frame the stack does not have is counted `unreadable`, as a missing instance is. A shape that names a multi-frame instance with no frame number is counted the same way, with its own line in the guide (**Maintainer decides**: that, or treat it as frame 1). Ids stay `sr:<SR SOP UID>:<position>`.

**SR writer.** It is **not on `main`**. `main` has the reader and the PDF (M10). The writer is the M11 work on `milestone/11-sr-writer`, which also has [ADR 0014](../adr/0014-sr-export-and-text.md) and `docs/m11-spike.md`; I could not check its code from `main`. The M11 spec has it pass a `frameNumber` to Cornerstone's writer, and it writes the one it is given. M12 adds the frame from the measurement's reference to what the writer is given, and a test that exports a measurement on frame 40 and reads it back to frame 40. This is **step 11, after M11 is merged**. Until then, a viewer built from M12 and M11 together has no export of the frame number, so M11 should not merge after M12 without the step. The order of the two milestones is **Maintainer decides**; recommended: M11 first, since it is built.

**SEG.** `segmentations/validate.ts` maps SOP UID to instance to check the planes, and `segmentations/registry.ts` counts the images a SEG covers and its segment index uses the image index. These change to `(sop, frame)`. A SEG that names a multi-frame instance gives `ReferencedFrameNumber` in its referenced-instance or derivation items. A SEG that gives no frame number is matched to the frames by plane position (the code already measures how far a SEG's plane is from its image, to warn). A SEG over a frame that cannot be matched is not drawn and says why through `segmentation:warning`. This part has its own timebox (see the steps): if it takes over 2 days, a SEG on a multi-frame image says "not supported yet" with a warning, and moves to its own spec. **Maintainer decides** whether SEG is in phase 1.

**Thumbnails.** `renderThumbnail(stack, imageIndex, size)` works on frames as it is. The series browser shows the image count from the stack once it is loaded. Before then it shows the instance count from the server, which counts files, not frames, so a series of one Enhanced CT file shows "1". The panel shows the stack's count when it has one.

**MPR.** `decideMpr` works on the stack, and the stack's slices carry the geometry, so an Enhanced CT whose frames are uniform and parallel can be reformatted. A series that is tilted or has uneven spacing falls back to slices with its reason, as now. A loop with no geometry falls back with `missing-geometry`. Volume memory is counted from rows, columns, and the number of frames, so a large Enhanced CT is held back by `memory.maxCacheBytes` as any series is.

**Overlay.** `Image n / N` counts the stack's images, so it counts frames. The overlay's tag lines read `stack.instances[index].metadata`, so a tag that a frame carries (position, for one) shows the frame's value. No new line is added, and the shell does not change, so there are no new visual baselines.

**Keyboard and cine.** Both work on `imageIndex` and `imageCount`, so nothing changes for phase 1. Phase 2 adds the default cine rate: if the host gives no `fps`, the viewer uses the series' own rate when it states one (`RecommendedDisplayFrameRate` (0008,2144), then `CineRate` (0018,0040), then `FrameTime` (0018,1063) in milliseconds), limited to the existing 1 to 60 range, and 10 as now when there is none. The user's `fps` always wins.

## Test data

Only the synthetic phantom in `fixtures/phantom` may be committed. Never real, licensed, or de-identified data. A maintainer's own sample files (an Enhanced CT or a cine loop from a real scanner) may be used to try the work **by hand**, by choosing them in the local-files example, and must not be committed, copied into an issue, or described with patient details in a note.

`tools/phantom/phantom.py` gets two new series, each with its own pytest in `test_phantom.py`. They go in **a study of their own** (`study-multiframe`), as the tilted and non-uniform series did, so the main study's series list does not change and no existing test or baseline moves. The mock reads directories by name and the first study is the main one, so the new directory names must sort after `ct-evrle`. `multiframe-*` does. (`ct-enhanced` would not: it sorts first.)

| Series | What it is | Used for |
|---|---|---|
| `multiframe-ct` | An Enhanced CT image (SOP class 1.2.840.10008.5.1.4.1.1.2.1), 64 frames, JPEG 2000 lossless, made from the same 64 slices as `ct-j2k`. Shared groups: orientation, pixel measures, rescale. Per-frame groups: position. Same picture, so every HU the matrix already checks holds | Phase 1: stack, HU, MPR, measurements, local files, the proxy rule |
| `multiframe-sr` | A highdicom TID 1500 report with shapes on named frames of `multiframe-ct` (`ReferencedFrameNumber`) | SR reader |
| `multiframe-seg` | A binary SEG made by highdicom from the enhanced instance as the source image | SEG on frames |
| `multiframe-cine` | A 24-frame loop with no geometry: an 8-bit grey circle that moves, with `FrameTime` of 40 ms. Ultrasound Multi-frame Image Storage (1.2.840.10008.5.1.4.1.1.3.1) | Phase 2: order, cine rate, no MPR |

How to make `multiframe-ct`: highdicom's `highdicom.legacy.LegacyConvertedEnhancedCTImage` takes the legacy datasets of a series and writes an Enhanced CT with both groups. If the phantom's slices lack an attribute it asks for, the phantom adds it to every slice (a change of the legacy phantom that must not change a byte of `ct-evrle` and `ct-j2k`), or the Enhanced CT is written with pydicom directly (**step 0** finds out which). As the SEG and SR already do, dates and UIDs are fixed so regenerating is byte-for-byte the same, and `SHA256SUMS` and the fixtures README are updated. Compressing is `ds.compress(JPEG2000Lossless, generate_instance_uid=False)`, with one fragment for each frame, which is what the mock needs. Size: the J2K of 64 frames of 128 by 128 is about 1 MB, so the folder grows from 4.5 MB by a few MB.

Pytest for the new series: the SOP class and frame count; that frame *k*'s position, orientation, spacing, and rescale equal the legacy slice *k* to 1e-6 and the pixels are equal; that the file is deterministic; that highdicom reads it back; that the SR names frames that exist and the SEG's frames follow the CT's geometry; that the cine has no position or orientation and its frames differ.

## Test plan (tests first)

Each item is written before the code it tests, and an assertion is never weakened to pass.

1. **Frame geometry** (`data/frame-geometry.test.ts`): shared values only; per-frame values win; one frame with no item; fewer items than frames; a wrong value type names the tag and the frame; `NumberOfFrames` of 0, 1.5, and "abc"; 1,000 frames inside 50 ms; and the one that matters: the hoisted metadata of frame *k* of `multiframe-ct` equals `ct-j2k` slice *k* for every tag the series model reads.
2. **Series model** (`data/series.test.ts`): `multiframe-ct` gives one stack of 64 slices, reconstructable with spacing 2.5 mm; two instances at the same positions give two layers; frames with no geometry give a `missing-geometry` stack in `(instanceNumber, frameNumber)` order; the old refusal is gone; **a golden test**: the existing single-frame phantom gives the same stacks, image ids, and metadata as before.
3. **Image ids and sources** (`dicomweb.test.ts`, `local.test.ts`, `local-parse.test.ts`): `.../frames/N#owner`; frame 1 of a single-frame instance has the id it has today; the frame policy owns every frame id; a local multi-frame file gives one id for each frame and is read once; `dispose()` removes all of them; the functional groups of a local file give the same DICOM JSON as the DICOMweb metadata of the same file.
4. **Viewer** (`viewer-navigate.test.ts` and `viewer-core.test.ts`, fake port): `navigateTo` frame 40 shows slice index 39 and reports `frameNumber: 40`; a frame above the count rejects naming the count; a frame above 1 for a single-frame instance rejects; `imageIndex` in the state is the stack index; a state round trip through the URL codec restores the same frame; `ViewerStateV1` still parses every old fixture.
5. **References** (`measurements/model.test.ts`, `registry.test.ts`, `sr.test.ts`): `frameNumber` omitted equals 1; 0 and 1.5 are rejected; two measurements on one SOP at two frames stay apart, list, filter, and jump to the right frame; `measurements/v1` JSON with and without the field round-trips, and a single-frame export is byte-identical to before; a report on frames 5 and 40 is read to those frames; a shape on a frame the stack lacks, and a shape with no frame number on a multi-frame instance, are counted `unreadable`. A source-level test lists every comparison of a reference's SOP to a slice and fails if one does not use the frame.
6. **SEG** (`segmentations/*.test.ts`): a SEG over frames matches by `(sop, frame)`; one with no frame numbers matches by plane; a plane that matches nothing gives a warning and no drawing.
7. **Phantom** (`tools/phantom`, `uv run pytest -q`): the list above.
8. **Matrix** (`scripts/matrix/headless.ts`, a new `multi-frame` scenario, and `local-files`): the mock serves `study-multiframe`. The scenario:
   - loads the study and scrolls the 64 frames, with the HU of the four inserts at the known pixels (`EXPECTED_HU`) on frames 10, 32, and 55;
   - draws a length on frame 40, reloads the state, and finds it on frame 40 only;
   - loads `multiframe-sr` and finds each shape on its frame, and `multiframe-seg` and finds the overlay on its frame;
   - shows axial, coronal, and sagittal planes from `multiframe-ct` and compares them with the same planes of `ct-j2k`;
   - runs once in `oncotrace-proxy` mode, with the 16-frames-per-request rule and no whole-instance retrieval, and checks that no request breaks the rule;
   - runs the 20-cycle leak check with `multiframe-ct` on screen;
   - plays `multiframe-cine` at its own rate (phase 2), and checks that MPR says `missing-geometry`.
   The local-files scenario adds the one `multiframe-ct` file and checks the same HU. `DV_BROWSER=webkit pnpm matrix --only headless` runs it in Safari's engine, with the leak check skipped as it is now.
9. **No visual change.** The shell and the overlay do not change, so no visual baselines move. If they do, that is a bug.

## Steps

Each step is one commit, `M12: ...`, with its tests. A step leaves `pnpm check` green.

0. **Spike (about a day).** See below. Writes `docs/m12-spike.md` and changes no source file of `packages/`. Go or no-go.
1. Phantom: `multiframe-ct`, its pytest, the checksums, the README, and a check that the mock serves it (`tools/dicomweb-mock` tests). Nothing else uses it yet.
2. `data/frame-geometry.ts` and its tests (pure, Zod).
3. Series model: frames become slices, `frameNumber` and `frameCount`, `sliceKey` and `findSlice`, the refusal removed, the golden test.
4. Image ids, DICOMweb frames, and the engine's registration and release for each frame id.
5. Local files: the functional groups in `local-parse.ts`, one id for each frame, one read for each file.
6. Frame references: `frameNumber` on the reference, the registry's lookups, `navigateTo`, the viewport info and the event, and the SR reader. Phantom `multiframe-sr`.
7. SEG on frames, with its own timebox of 2 days. Phantom `multiframe-seg`.
8. Shell and UI: the series browser count, and a check of the overlay, thumbnails, and keyboard. No visual change.
9. Matrix: the `multi-frame` and `local-files` scenarios, the proxy run, and the leak check.
10. **Phase 2:** phantom `multiframe-cine`, the order of frames with no geometry, the default cine rate, the matrix steps, and a test with a large loop (see "Risks").
11. **After M11 is merged:** the frame number in the SR writer (see "Frame references").
12. Docs: a guide section on multi-frame series (what is supported, what is not, and the limits), ADR 0015 (the next free number: 0014 is on the M11 branch), a note in ADR 0013 that frame 1 is no longer the rule, the plan's M12 outcome, `docs/m12-report.md`, a changeset (minor, core), and the size budgets.
13. Release: after the pull request is merged, run the *Release* workflow (`docs/guides/releasing.md`).

**Estimate.** About 14 days of focused work: the spike 1, the phantom 1, the reader 1, the series model 1.5, retrieval and the engine 1.5, local files 1, references 1.5, SEG 1.5 (timeboxed), the shell 0.5, the matrix 1, phase 2 and its phantom 2, and docs 1. With the 20% buffer, about 17. Phase 1 is about 11 of these days, and phase 2 about 3, with the SR writer step (half a day) counted in phase 2. If SEG moves out, take off 1.5.

### Spike (step 0)

Check that one Enhanced CT file loads in the engine, before any source changes. Use the generated `multiframe-ct` (made in a scratch folder, not committed), and, by hand, a maintainer's own enhanced file if there is one. Answer these:

1. Does Cornerstone's metadata layer read the shared and per-frame groups itself for `wadors:.../frames/N`, or does it need the frame's metadata with the values at the top level? (This sets the engine's `registerInstance`.)
2. Do frame 1, 32, and 64 draw with the right HU (within 0.5) and the right plane metadata?
3. For a local file, what image id form gives one id for each frame, and is the file read and parsed once? How long does a 300-frame file take to show its first frame?
4. Does `renderVolume` give the right MPR planes from a stack of per-frame ids?
5. How large is the series metadata JSON for 1,000 frames, and how long does parsing and reading the groups take?
6. Is the engine chunk still within its budget? (It should be: no new import.)

**Go** if frames 1, 32, and 64 give the right HU and plane through both sources, and the file is read once. **No-go for local files only** if Cornerstone cannot take a frame of a local file without one read for each frame: then phase 1 ships DICOMweb only, a local multi-frame file says why it is not shown, and local files get a follow-up spec. **No-go overall** if Cornerstone cannot show frame N of a wadors multi-frame instance at all: stop, and write down what we found. Hand-testing notes name no patient and no study.

## Risks

- **Transfer syntaxes that decode for each frame.** JPEG 2000, JPEG-LS, and RLE are decoded frame by frame by the codecs in the workers, which suits this. Uncompressed data in a local file is sliced, which is cheap. JPEG baseline and video-style multi-frame encodings are not all the same: MPEG-4 and similar are out of scope and must be refused with a clear message, not decoded wrongly. The spike lists what the phantom covers (J2K, uncompressed) and what it does not.
- **Memory with large cine loops.** A 600-frame loop of 800 by 600 pixels in RGB is about 860 MB decoded. The stack cache is limited by `memory.maxCacheBytes` with LRU purge and prefetch is 64 either way, so a stack does not exceed the cache, but cine over a loop longer than the cache decodes frames again at each turn. Phase 2 adds a test with a generated large loop (not committed) and states the limit in the guide. (**Maintainer decides** whether to add a warning event above a frame count.)
- **Per-frame geometry that is not uniform.** Frames of an Enhanced MR may differ in orientation, spacing, or rescale. The stack split already handles orientation and repeated positions, and `reconstructability` already reports `non-uniform-spacing` and `tilted`. A per-frame rescale is hoisted, so each frame has its own. The risk is frames that Cornerstone reads with only the shared rescale: the spike (question 2) and a test with a per-frame rescale phantom frame cover it.
- **More than one dimension.** An Enhanced MR with several echoes, b-values, or phases has many frames at the same position. The existing layering makes one stack for each repeat, in the order they come, with no names. That is usable and not good. Naming them from `DimensionIndexSequence` is a later change.
- **Many requests.** Each frame is one request, so a 600-frame Enhanced CT is 600 requests, not 38 batches of 16. The prefetch radius limits how many are in flight, and HTTP/2 helps, but a slow server will be slow. Batching is a later optimization and out of scope.
- **Large metadata.** The series metadata of a big enhanced instance can be several megabytes of JSON, because of the per-frame groups. The budget and a test cover parsing. A server that leaves the per-frame groups out of the series metadata gives frames with no geometry, which shows in `diagnostics` and in the `missing-geometry` stack. We do not fetch the whole instance to find out, because `seg-sr-only` forbids it.
- **A lookup that was missed.** The most likely bug is a lookup by SOP UID alone that was not changed, so a measurement or SEG lands on frame 1. The source-level test in step 6 and the matrix steps on frame 40 are there for this.
- **Measurements without calibration.** A frame with no pixel spacing (most ultrasound) has no length in millimetres, and the model works in patient millimetres. What a measurement does on a stack with no geometry should be checked in step 10 before phase 2 claims it. If it does not work today, phase 2 says so in the guide and leaves it.
- **Cornerstone changes.** Per-frame behaviour is the kind of thing that moves between Cornerstone majors. Everything is behind `RenderingPort`, the packages are exact-pinned, and the matrix scenario runs on every change.

## Decisions

Settled by the maintainer:

1. **Phasing:** both kinds of data, enhanced volumes first. (The answer was one option label. If it meant cine first, swap the two phases: the base is shared, so only the order of steps 9 and 10 changes.)

**Maintainer decides** (each has a recommendation):

2. **Naming.** Keep `SeriesStack.instances` and `SeriesInstance`, and add `frameNumber` and `frameCount` (recommended: the types are exported, and a new field is additive), or rename the stack's list to `slices` (clearer, and a breaking change to an exported type).
3. **`measurements/v1` and the reference.** Add an optional `frameNumber` and stay at version 1 (recommended, for the reason in "Frame references"), or make `measurements/v2`.
4. **An SR shape on a multi-frame instance with no frame number.** Count it as `unreadable` (recommended: the standard asks for a frame number), or treat it as frame 1.
5. **SEG on frames in phase 1.** Include it with the 2-day timebox (recommended), or leave it for its own spec and warn.
6. **Order against M11.** Merge M11 (the SR writer) first, then do step 11 inside M12 (recommended), or merge M12 first and have M11 add the frame number.
7. **A frame-count warning.** No new limit, and the memory budget does the work (recommended), or a warning event above a set count of frames.
8. **Milestone ID.** `M12`, as the plan's table continues after M11. The plan's M9 (OncoTrace readiness) is not built, and this does not change that.

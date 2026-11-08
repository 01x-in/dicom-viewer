# M11 spike: can Cornerstone's writer make the SR?

**Go.** Cornerstone's writer makes all six types from the viewer's measurements, highdicom reads the file, and the viewer's own reader reads it back. It does not make a file we should ship as it is: it needs a post-processing step, listed below. The spec is [specs/sr-export.md](specs/sr-export.md).

## What was tried

A throwaway test (not committed) built six measurements on two images of the phantom CT, in an order that mixes the images: probe, length, ellipse, angle, bidirectional, rectangle. It called `MeasurementReport.generateReport` with no Cornerstone annotation on screen, as the spec asks, wrote the dataset with `dcmjs`, and then:

- read it with the M10 reader (`readStructuredReport`),
- read it with `pydicom` and `highdicom` (`srread`, and `get_planar_roi_measurement_groups`),
- checked every value for its DICOM length limit,
- compared it with the highdicom-written phantom report (`sr-measurements`).

## Go or no-go

| Check | Result |
|---|---|
| The writer makes all six types from `Measurement` data | Yes. The input is `{ data: { handles.points, cachedStats }, metadata: { referencedImageId, FrameOfReferenceUID }, finding, findingSites }` for each image and tool |
| highdicom reads the file | Yes: `srread` gives a report object with the whole tree |
| The M10 reader reads it | Yes: six shapes, none unreadable |
| Engine chunk within budget | Yes. The writer is in the same adapters module that the reader already uses, so it is already in the chunk (800.9 kB brotli against 880 kB). The only growth is our own post-processing, a few kilobytes |

## What the writer does that we must fix

| What | Why it matters | Fix (in the engine, after `generateReport`) |
|---|---|---|
| The **tracking unique identifier is random** (`DicomMetaDictionary.uid()` inside dcmjs, with no way to pass one) | The same measurement must have the same identifier every export | Set each group's identifier from the measurement id, after the call. A hash of the id (128 bits, as `2.25.<number>`) |
| **Groups come out by image, then by tool type**, not in list order | The report order must be the list order, and the ids of a re-read report (`sr:<uid>:<position>`) follow the order | The engine knows the order it built the tool state in, so it reorders the groups to match the list |
| **No `SpecificCharacterSet`** is written (the adapter sets it on the wrapper object, not the dataset) | Any label with a character outside ASCII would be read wrongly | Set `ISO_IR 192` on the dataset |
| **The label code is 19 characters** in a field that holds 16 (`CORNERSTONEFREETEXT` as a Finding code) and the meaning holds 64 | Not valid DICOM. pydicom warns. A strict PACS may refuse. A label over 64 characters would be cut | See decision 2 |
| **A probe has no value**: the writer puts a placeholder number `0` with the unit `1` | A reader that shows numbers shows 0 HU for every probe | Replace it with the viewer's value in Hounsfield units (`[hnsf'U]`) |
| **ROI statistics have the unit `1`** | Mean, minimum, maximum, and spread are in HU, and say nothing | Pass `modalityUnit` in the statistics, so the writer writes `[hnsf'U]` (checked) |
| **Two evidence entries for one study** (one for each image, the same study twice) | The standard has one entry for the study, with series and images inside | Group images by study and series |
| **Dummy equipment values** (`SoftwareVersions` `0`, serial `1`, model `Unspecified`) and a clock read inside the writer | Honest equipment, and a clock the test can fix | Set them, with the injected clock |
| An **angle is written with the code "Cobb angle"** (SCT 285285000) and as two lines (four points, the middle two the same) | Another tool will call a plain angle a Cobb angle | The M10 reader reads it. We leave the code, and say so in the guide |
| The SOP class is **Enhanced SR** | The spec said Comprehensive SR. highdicom reads both (Comprehensive: checked) | Set Comprehensive SR (`1.2.840.10008.5.1.4.1.1.88.33`) |

What the writer gets right: it copies the patient and study of the source images (name, ID, birth date, study UID, date), refers to each image by SOP instance, and puts the shapes in the right place in image pixels, with the half-pixel offset that the M10 reader removes.

## Two decisions

### 1. Where the shape goes

The standard (and highdicom, and the phantom report from M10) puts a measurement's shape **beside** its number in the group, as an Image Region. Cornerstone's writer puts it **inside** the number. highdicom's finder for planar measurements, `get_planar_roi_measurement_groups`, found **0** groups in the file as the writer makes it. After moving the shape beside the number, it found **5 of 6**. The sixth is the bidirectional measurement, which has two shapes, so there is no one place for them. The M10 reader reads both forms.

The cost: Cornerstone's own reader, and so OHIF's way of putting a report on the image, looks for the shape inside the number (this is why M10 had to move it the other way). It would not read a group that is moved. This was not tried in OHIF.

| Option | Another tool that follows the standard | OHIF and Cornerstone's reader |
|---|---|---|
| **A. Beside the number** (the standard) | Reads 5 of 6 groups as measurements | Does not read the groups |
| **B. Inside the number** (the writer's own) | Reads the tree, but finds no measurements | Reads them |

### 2. The label

| Option | Valid DICOM | Label seen by OHIF | Label length |
|---|---|---|---|
| **A. A short local code for the Finding, and the full label in a Comment** | Yes | No (it reads the Finding only) | No limit |
| **B. Cornerstone's code** (`CORNERSTONEFREETEXT`) | No (19 characters in a 16-character field) | Yes | 64, cut |
| **C. Both**: Cornerstone's code, and the full label in a Comment | No (the same problem) | Yes | 64 in the Finding, the full text in the Comment |

The M10 reader needs a small change to read the Comment (and the short code) for the label. The Cornerstone reader does not read a Comment as the label.

## What this changes in the spec

- The writer is the engine's job, as designed, and the registry's `exportSr` is as designed. Step 3 grows a post-processing function (pure, tested on its own) with the rows of the table above.
- The SOP class is Comprehensive SR.
- The test plan item "another tool reads it" now checks, with highdicom: the tree, one group for each measurement in list order, the planar finder (when the shape is beside the number), the labels, the units, and the identifiers (the same on two exports).
- Estimate: the spike was on time. The SR is still 3 to 4 days.

## What was not tried

- OHIF, Slicer, or any viewer other than highdicom.
- A PACS. Nothing here shows that one accepts the file.
- `dciodvfy` (dicom3tools), which checks a file against the standard in full. It is the next check to add, if someone has it.
- Multi-frame images (the writer takes a frame number; the viewer reads frame 1).

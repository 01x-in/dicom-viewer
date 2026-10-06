"""Deterministic synthetic CT phantom for the viewer's tests.

The same CT volume is written twice, as Explicit VR Little Endian and as JPEG 2000 lossless,
which are the two transfer syntaxes the viewer must decode first (see docs/plan.md).
Five DICOM SEG series reference the JPEG 2000 series (see SEG_SERIES below): the body and the
bone insert, the four inserts, two overlapping segments, a SEG whose geometry does not match the
CT it names, and one of the fractional type (the other four are binary).

Contents of every slice (LPS coordinates, orientation [1,0,0,0,1,0], so columns run toward
the patient's left and rows toward the patient's back):
- air outside the body (-1000 HU)
- a circular body of soft tissue (40 HU)
- a small marker block on the patient's LEFT, for orientation tests (200 HU)
- four cylindrical inserts with exact HU values, present only in the middle slices

Usage: uv run python phantom.py <output-dir>
"""

from __future__ import annotations

import hashlib
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

import highdicom as hd
import numpy as np
from numpy.typing import NDArray
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sr.coding import Code
from pydicom.uid import (
    CTImageStorage,
    ExplicitVRLittleEndian,
    JPEG2000Lossless,
    PYDICOM_IMPLEMENTATION_UID,
    UID,
)

UID_NAMESPACE = uuid.UUID("6f1b8f8e-2f4e-4c55-9a3e-6c1b2d7c0a01")
RESCALE_INTERCEPT = -1024
AIR_HU = -1000
BODY_HU = 40
LEFT_MARKER_HU = 200


@dataclass(frozen=True)
class CtSpec:
    rows: int
    columns: int
    slices: int
    pixel_spacing_mm: float
    slice_spacing_mm: float
    body_radius_px: float
    insert_radius_px: float
    insert_slices: range


@dataclass(frozen=True)
class Insert:
    name: str
    hu: int
    center_rc: tuple[int, int]


CT_SPEC = CtSpec(
    rows=128,
    columns=128,
    slices=64,
    pixel_spacing_mm=1.5,
    slice_spacing_mm=2.5,
    body_radius_px=56.0,
    insert_radius_px=9.0,
    insert_slices=range(8, 56),
)

INSERTS: tuple[Insert, ...] = (
    Insert("air", -1000, (36, 64)),  # anterior
    Insert("water", 0, (92, 64)),  # posterior
    Insert("fat", -100, (64, 36)),  # patient right
    Insert("bone", 1000, (64, 92)),  # patient left
)

# Rows 40-46, columns 100-106: inside the body, on the patient's left, clear of every insert.
LEFT_MARKER_ROWS = slice(40, 47)
LEFT_MARKER_COLS = slice(100, 107)


def uid(name: str) -> UID:
    """A stable 2.25 UID derived from a name, so every run produces identical files."""
    return UID(f"2.25.{uuid.uuid5(UID_NAMESPACE, name).int}")


def slice_hu(spec: CtSpec, index: int) -> NDArray[np.int16]:
    rows, cols = np.mgrid[0 : spec.rows, 0 : spec.columns]
    center_r = (spec.rows - 1) / 2
    center_c = (spec.columns - 1) / 2

    hu = np.full((spec.rows, spec.columns), AIR_HU, dtype=np.int16)
    hu[(rows - center_r) ** 2 + (cols - center_c) ** 2 <= spec.body_radius_px**2] = BODY_HU
    hu[LEFT_MARKER_ROWS, LEFT_MARKER_COLS] = LEFT_MARKER_HU

    if index in spec.insert_slices:
        for insert in INSERTS:
            r, c = insert.center_rc
            inside = (rows - r) ** 2 + (cols - c) ** 2 <= spec.insert_radius_px**2
            hu[inside] = insert.hu
    return hu


def ct_dataset(spec: CtSpec, index: int, series: str, series_number: int) -> Dataset:
    sop_uid = uid(f"{series}/instance/{index}")

    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = CTImageStorage
    meta.MediaStorageSOPInstanceUID = sop_uid
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.ImplementationClassUID = PYDICOM_IMPLEMENTATION_UID

    ds = Dataset()
    ds.file_meta = meta
    ds.SOPClassUID = CTImageStorage
    ds.SOPInstanceUID = sop_uid
    ds.Modality = "CT"
    ds.Manufacturer = "dicom-viewer phantom"
    ds.PatientName = "Phantom^CT"
    ds.PatientID = "PHANTOM-001"
    ds.PatientBirthDate = ""
    ds.PatientSex = "O"
    ds.PatientIdentityRemoved = "YES"
    ds.StudyInstanceUID = uid("study")
    ds.StudyID = "1"
    ds.StudyDate = "20260101"
    ds.StudyTime = "090000"
    ds.AccessionNumber = ""
    ds.ReferringPhysicianName = ""
    ds.StudyDescription = "Synthetic CT phantom"
    ds.SeriesInstanceUID = uid(f"{series}/series")
    ds.SeriesNumber = series_number
    ds.SeriesDescription = f"Phantom CT ({series})"
    ds.FrameOfReferenceUID = uid("frame-of-reference")
    ds.PositionReferenceIndicator = ""
    ds.InstanceNumber = index + 1
    ds.PatientPosition = "HFS"

    x0 = -(spec.columns - 1) / 2 * spec.pixel_spacing_mm
    y0 = -(spec.rows - 1) / 2 * spec.pixel_spacing_mm
    z = index * spec.slice_spacing_mm
    ds.ImagePositionPatient = [round(x0, 4), round(y0, 4), round(z, 4)]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.PixelSpacing = [spec.pixel_spacing_mm, spec.pixel_spacing_mm]
    ds.SliceThickness = spec.slice_spacing_mm
    ds.SliceLocation = round(z, 4)

    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows = spec.rows
    ds.Columns = spec.columns
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.RescaleIntercept = RESCALE_INTERCEPT
    ds.RescaleSlope = 1
    ds.RescaleType = "HU"
    ds.WindowCenter = 40
    ds.WindowWidth = 400

    stored = (slice_hu(spec, index).astype(np.int32) - RESCALE_INTERCEPT).astype(np.uint16)
    ds.PixelData = stored.tobytes()
    return ds


SERIES: tuple[tuple[str, int, UID], ...] = (
    ("ct-evrle", 1, ExplicitVRLittleEndian),
    ("ct-j2k", 2, JPEG2000Lossless),
)


SEG_SOURCE_SERIES = "ct-j2k"
# Fixed so that regenerating the phantom reproduces every SEG byte for byte.
SEG_DATE = "20260101"
SEG_TIME = "090500"

BODY_SEGMENT = 1
BONE_SEGMENT = 2
SEG_SERIES = "seg-body-bone"
INSERTS_SEG_SERIES = "seg-inserts"
OVERLAP_SEG_SERIES = "seg-overlap"
MISMATCH_SEG_SERIES = "seg-mismatch"
FRACTIONAL_SEG_SERIES = "seg-fractional"

# The slices (0-based) the smaller SEGs cover. A tumour covers a few slices, not the whole series.
PARTIAL_SLICES = range(20, 41)
# How far the mismatch SEG's planes are from the CT's, along the columns, and the frame of reference it names.
MISMATCH_SHIFT_MM = 12.0
MISMATCH_FRAME_OF_REFERENCE = "other-frame-of-reference"
# Where the overlap SEG's two segments meet: a horizontal slab and a disc that crosses it.
OVERLAP_SLAB_ROWS = slice(56, 73)
OVERLAP_DISC_CENTER_RC = (64, 64)
OVERLAP_DISC_RADIUS_PX = 20.0


@dataclass(frozen=True)
class SegmentSpec:
    number: int
    label: str
    type_code: Code


@dataclass(frozen=True)
class SegSpec:
    series: str
    series_number: int
    segments: tuple[SegmentSpec, ...]
    # The 0-based slices of the CT that the SEG covers, in order.
    slices: range
    # (slices, rows, columns) segment numbers, or (slices, rows, columns, segments) booleans when segments overlap.
    pixels: NDArray[np.uint8] | NDArray[np.bool_] | NDArray[np.float32]
    description: str
    fractional: bool = False


TISSUE = Code("85756007", "SCT", "Tissue")


def _disc(spec: CtSpec, center_rc: tuple[int, int], radius: float) -> NDArray[np.bool_]:
    rows, cols = np.mgrid[0 : spec.rows, 0 : spec.columns]
    return (rows - center_rc[0]) ** 2 + (cols - center_rc[1]) ** 2 <= radius**2


def _body(spec: CtSpec) -> NDArray[np.bool_]:
    return _disc(spec, ((spec.rows - 1) / 2, (spec.columns - 1) / 2), spec.body_radius_px)  # type: ignore[arg-type]


def _insert_disc(spec: CtSpec, name: str) -> NDArray[np.bool_]:
    insert = next(item for item in INSERTS if item.name == name)
    return _disc(spec, insert.center_rc, spec.insert_radius_px)


def seg_labelmap(spec: CtSpec) -> NDArray[np.uint8]:
    """Per-slice segment numbers: the body disc is 1, and the bone insert inside it is 2."""
    body = _body(spec)
    bone = _insert_disc(spec, "bone")
    labelmap = np.zeros((spec.slices, spec.rows, spec.columns), dtype=np.uint8)
    for index in range(spec.slices):
        labelmap[index][body] = BODY_SEGMENT
        if index in spec.insert_slices:
            labelmap[index][bone] = BONE_SEGMENT
    return labelmap


def inserts_labelmap(spec: CtSpec) -> NDArray[np.uint8]:
    """One segment per insert, on the slices that have inserts: air 1, water 2, fat 3, bone 4."""
    labelmap = np.zeros((len(spec.insert_slices), spec.rows, spec.columns), dtype=np.uint8)
    for offset in range(len(spec.insert_slices)):
        for number, insert in enumerate(INSERTS, start=1):
            labelmap[offset][_insert_disc(spec, insert.name)] = number
    return labelmap


def overlap_pixels(spec: CtSpec) -> NDArray[np.bool_]:
    """Two segments that share pixels, so they cannot be one labelmap: a slab (1) and a disc (2)."""
    body = _body(spec)
    slab = np.zeros((spec.rows, spec.columns), dtype=bool)
    slab[OVERLAP_SLAB_ROWS, :] = True
    slab &= body
    disc = _disc(spec, OVERLAP_DISC_CENTER_RC, OVERLAP_DISC_RADIUS_PX) & body
    pixels = np.zeros((len(PARTIAL_SLICES), spec.rows, spec.columns, 2), dtype=bool)
    pixels[:, :, :, 0] = slab
    pixels[:, :, :, 1] = disc
    return pixels


def mismatch_labelmap(spec: CtSpec) -> NDArray[np.uint8]:
    """A single disc on the partial slices. Where it sits is right: only the planes it names are not."""
    labelmap = np.zeros((len(PARTIAL_SLICES), spec.rows, spec.columns), dtype=np.uint8)
    labelmap[:, _disc(spec, (64, 64), 16.0)] = 1
    return labelmap


def fractional_pixels(spec: CtSpec) -> NDArray[np.float32]:
    """Two segments with a fraction for each pixel, which here is only ever 0 or 1: the water insert (1) and the fat insert (2)."""
    water = _insert_disc(spec, "water")
    fat = _insert_disc(spec, "fat")
    pixels = np.zeros((len(PARTIAL_SLICES), spec.rows, spec.columns, 2), dtype=np.float32)
    pixels[:, :, :, 0] = water
    pixels[:, :, :, 1] = fat
    return pixels


def seg_specs(spec: CtSpec) -> tuple[SegSpec, ...]:
    return (
        SegSpec(
            series=SEG_SERIES,
            series_number=3,
            segments=(
                SegmentSpec(BODY_SEGMENT, "Body", Code("38266002", "SCT", "Entire body")),
                SegmentSpec(BONE_SEGMENT, "Bone insert", Code("272673000", "SCT", "Bone")),
            ),
            slices=range(spec.slices),
            pixels=seg_labelmap(spec),
            description=f"Phantom SEG ({SEG_SERIES})",
        ),
        SegSpec(
            series=INSERTS_SEG_SERIES,
            series_number=4,
            segments=(
                SegmentSpec(1, "Air", Code("39607008", "SCT", "Lung")),
                SegmentSpec(2, "Water", Code("181414000", "SCT", "Kidney")),
                SegmentSpec(3, "Fat", Code("23416004", "SCT", "Adipose tissue")),
                SegmentSpec(4, "Bone", Code("272673000", "SCT", "Bone")),
            ),
            slices=spec.insert_slices,
            pixels=inserts_labelmap(spec),
            description=f"Phantom SEG ({INSERTS_SEG_SERIES})",
        ),
        SegSpec(
            series=OVERLAP_SEG_SERIES,
            series_number=5,
            segments=(
                SegmentSpec(1, "Slab", Code("85756007", "SCT", "Tissue")),
                SegmentSpec(2, "Disc", Code("85756007", "SCT", "Tissue")),
            ),
            slices=PARTIAL_SLICES,
            pixels=overlap_pixels(spec),
            description=f"Phantom SEG ({OVERLAP_SEG_SERIES})",
        ),
        SegSpec(
            series=MISMATCH_SEG_SERIES,
            series_number=6,
            segments=(SegmentSpec(1, "Shifted disc", Code("85756007", "SCT", "Tissue")),),
            slices=PARTIAL_SLICES,
            pixels=mismatch_labelmap(spec),
            description=f"Phantom SEG ({MISMATCH_SEG_SERIES})",
        ),
        SegSpec(
            series=FRACTIONAL_SEG_SERIES,
            series_number=7,
            segments=(
                SegmentSpec(1, "Water", Code("181414000", "SCT", "Kidney")),
                SegmentSpec(2, "Fat", Code("23416004", "SCT", "Adipose tissue")),
            ),
            slices=PARTIAL_SLICES,
            pixels=fractional_pixels(spec),
            description=f"Phantom SEG ({FRACTIONAL_SEG_SERIES})",
            fractional=True,
        ),
    )


def seg_sources(spec: CtSpec, seg: SegSpec) -> list[Dataset]:
    """The CT instances a SEG says it segments. The mismatch SEG names the right instances with the wrong planes."""
    sources = [ct_dataset(spec, index, SEG_SOURCE_SERIES, 2) for index in seg.slices]
    if seg.series == MISMATCH_SEG_SERIES:
        for source in sources:
            position = [float(value) for value in source.ImagePositionPatient]
            position[0] += MISMATCH_SHIFT_MM
            source.ImagePositionPatient = position
            source.FrameOfReferenceUID = uid(MISMATCH_FRAME_OF_REFERENCE)
    return sources


def seg_dataset(spec: CtSpec, seg: SegSpec | None = None) -> Dataset:
    """A binary DICOM SEG, referencing instances of the J2K series."""
    seg = seg if seg is not None else seg_specs(spec)[0]
    descriptions = [
        hd.seg.SegmentDescription(
            segment_number=segment.number,
            segment_label=segment.label,
            segmented_property_category=TISSUE,
            segmented_property_type=segment.type_code,
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
        )
        for segment in seg.segments
    ]
    dataset = hd.seg.Segmentation(
        source_images=seg_sources(spec, seg),
        pixel_array=seg.pixels,
        segmentation_type=(
            hd.seg.SegmentationTypeValues.FRACTIONAL
            if seg.fractional
            else hd.seg.SegmentationTypeValues.BINARY
        ),
        **(
            {
                "fractional_type": hd.seg.SegmentationFractionalTypeValues.PROBABILITY,
                "max_fractional_value": 255,
            }
            if seg.fractional
            else {}
        ),
        segment_descriptions=descriptions,
        series_instance_uid=uid(f"{seg.series}/series"),
        series_number=seg.series_number,
        sop_instance_uid=uid(f"{seg.series}/instance"),
        instance_number=1,
        manufacturer="dicom-viewer phantom",
        manufacturer_model_name="phantom.py",
        software_versions="0.1.0",
        device_serial_number="0",
        series_description=seg.description,
        content_label="PHANTOM",
        content_creator_name="Phantom^Generator",
    )
    for keyword in ("InstanceCreationDate", "ContentDate", "SeriesDate"):
        if keyword in dataset:
            setattr(dataset, keyword, SEG_DATE)
    for keyword in ("InstanceCreationTime", "ContentTime", "SeriesTime"):
        if keyword in dataset:
            setattr(dataset, keyword, SEG_TIME)
    # highdicom stamps the wall clock and a random UID. Replace both so the file is reproducible.
    for item in dataset.ContributingEquipmentSequence:
        if "ContributionDateTime" in item:
            item.ContributionDateTime = f"{SEG_DATE}{SEG_TIME}.000000"
    organization_uid = uid(f"{seg.series}/dimension-organization")
    for item in [*dataset.DimensionOrganizationSequence, *dataset.DimensionIndexSequence]:
        item.DimensionOrganizationUID = organization_uid
    return dataset


def generate(out_dir: Path, spec: CtSpec = CT_SPEC) -> list[Path]:
    """Writes every phantom series under out_dir and returns the written files."""
    written: list[Path] = []
    for series, series_number, transfer_syntax in SERIES:
        series_dir = out_dir / series
        series_dir.mkdir(parents=True, exist_ok=True)
        for stale in series_dir.glob("*.dcm"):
            stale.unlink()
        for index in range(spec.slices):
            ds = ct_dataset(spec, index, series, series_number)
            if transfer_syntax != ExplicitVRLittleEndian:
                # Lossless, so the instance keeps its deterministic UID.
                ds.compress(transfer_syntax, generate_instance_uid=False)
            path = series_dir / f"{index + 1:04d}.dcm"
            ds.save_as(path, enforce_file_format=True)
            written.append(path)

    for seg in seg_specs(spec):
        seg_dir = out_dir / seg.series
        seg_dir.mkdir(parents=True, exist_ok=True)
        for stale in seg_dir.glob("*.dcm"):
            stale.unlink()
        seg_path = seg_dir / "0001.dcm"
        seg_dataset(spec, seg).save_as(seg_path, enforce_file_format=True)
        written.append(seg_path)
    return written


def write_checksums(out_dir: Path, files: list[Path]) -> Path:
    lines = [
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(out_dir).as_posix()}"
        for path in sorted(files)
    ]
    checksums = out_dir / "SHA256SUMS"
    checksums.write_text("\n".join(lines) + "\n")
    return checksums


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: python phantom.py <output-dir>", file=sys.stderr)
        return 2
    out_dir = Path(argv[1])
    files = generate(out_dir)
    write_checksums(out_dir, files)
    print(f"Wrote {len(files)} files to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

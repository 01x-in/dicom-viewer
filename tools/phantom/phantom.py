"""Deterministic synthetic CT phantom for the viewer's tests.

The same CT volume is written twice, as Explicit VR Little Endian and as JPEG 2000 lossless,
which are the two transfer syntaxes the viewer must decode first (see docs/plan.md).
A binary DICOM SEG with two segments (body, bone insert) references the JPEG 2000 series.

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


SEG_SERIES = "seg-body-bone"
SEG_SERIES_NUMBER = 3
SEG_SOURCE_SERIES = "ct-j2k"
BODY_SEGMENT = 1
BONE_SEGMENT = 2
# Fixed so that regenerating the phantom reproduces the SEG byte for byte.
SEG_DATE = "20260101"
SEG_TIME = "090500"


def seg_labelmap(spec: CtSpec) -> NDArray[np.uint8]:
    """Per-slice segment numbers: the body disc is 1, and the bone insert inside it is 2."""
    rows, cols = np.mgrid[0 : spec.rows, 0 : spec.columns]
    center_r = (spec.rows - 1) / 2
    center_c = (spec.columns - 1) / 2
    body = (rows - center_r) ** 2 + (cols - center_c) ** 2 <= spec.body_radius_px**2
    bone_insert = next(insert for insert in INSERTS if insert.name == "bone")
    bone_r, bone_c = bone_insert.center_rc
    bone = (rows - bone_r) ** 2 + (cols - bone_c) ** 2 <= spec.insert_radius_px**2

    labelmap = np.zeros((spec.slices, spec.rows, spec.columns), dtype=np.uint8)
    for index in range(spec.slices):
        labelmap[index][body] = BODY_SEGMENT
        if index in spec.insert_slices:
            labelmap[index][bone] = BONE_SEGMENT
    return labelmap


def seg_dataset(spec: CtSpec) -> Dataset:
    """A binary DICOM SEG with two segments, referencing every slice of the J2K series."""
    sources = [ct_dataset(spec, index, SEG_SOURCE_SERIES, 2) for index in range(spec.slices)]
    tissue = Code("85756007", "SCT", "Tissue")
    descriptions = [
        hd.seg.SegmentDescription(
            segment_number=BODY_SEGMENT,
            segment_label="Body",
            segmented_property_category=tissue,
            segmented_property_type=Code("38266002", "SCT", "Entire body"),
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
        ),
        hd.seg.SegmentDescription(
            segment_number=BONE_SEGMENT,
            segment_label="Bone insert",
            segmented_property_category=tissue,
            segmented_property_type=Code("272673000", "SCT", "Bone"),
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
        ),
    ]
    seg = hd.seg.Segmentation(
        source_images=sources,
        pixel_array=seg_labelmap(spec),
        segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
        segment_descriptions=descriptions,
        series_instance_uid=uid(f"{SEG_SERIES}/series"),
        series_number=SEG_SERIES_NUMBER,
        sop_instance_uid=uid(f"{SEG_SERIES}/instance"),
        instance_number=1,
        manufacturer="dicom-viewer phantom",
        manufacturer_model_name="phantom.py",
        software_versions="0.1.0",
        device_serial_number="0",
        series_description=f"Phantom SEG ({SEG_SERIES})",
        content_label="PHANTOM",
        content_creator_name="Phantom^Generator",
    )
    for keyword in ("InstanceCreationDate", "ContentDate", "SeriesDate"):
        if keyword in seg:
            setattr(seg, keyword, SEG_DATE)
    for keyword in ("InstanceCreationTime", "ContentTime", "SeriesTime"):
        if keyword in seg:
            setattr(seg, keyword, SEG_TIME)
    # highdicom stamps the wall clock and a random UID. Replace both so the file is reproducible.
    for item in seg.ContributingEquipmentSequence:
        if "ContributionDateTime" in item:
            item.ContributionDateTime = f"{SEG_DATE}{SEG_TIME}.000000"
    organization_uid = uid(f"{SEG_SERIES}/dimension-organization")
    for item in [*seg.DimensionOrganizationSequence, *seg.DimensionIndexSequence]:
        item.DimensionOrganizationUID = organization_uid
    return seg


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

    seg_dir = out_dir / SEG_SERIES
    seg_dir.mkdir(parents=True, exist_ok=True)
    for stale in seg_dir.glob("*.dcm"):
        stale.unlink()
    seg_path = seg_dir / "0001.dcm"
    seg_dataset(spec).save_as(seg_path, enforce_file_format=True)
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

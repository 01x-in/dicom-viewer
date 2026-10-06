"""A large SEG for the performance budget (docs/plan.md: 512x512x300 with 100 segments in under 3 s).

Not committed: it is generated on demand into a directory the caller chooses (the matrix uses
`.matrix/perf-fixtures`). It has the same shape as the phantom, in `ct` (uncompressed, with zeros
for pixels, which no timing here reads) and `seg-perf`: a grid of spheres, one segment each.

Usage: uv run python perf.py <output-dir> [rows columns slices segments]
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import highdicom as hd
import numpy as np
from numpy.typing import NDArray
from pydicom.sr.coding import Code

from phantom import (
    CT_SPEC,
    SEG_DATE,
    SEG_TIME,
    CtSpec,
    ct_dataset,
    uid,
)

PERF_CT_SERIES = "ct-perf"
PERF_SEG_SERIES = "seg-perf"


@dataclass(frozen=True)
class PerfSpec:
    rows: int
    columns: int
    slices: int
    segments: int

    @property
    def ct(self) -> CtSpec:
        return CtSpec(
            rows=self.rows,
            columns=self.columns,
            slices=self.slices,
            pixel_spacing_mm=0.8,
            slice_spacing_mm=1.0,
            body_radius_px=CT_SPEC.body_radius_px,
            insert_radius_px=CT_SPEC.insert_radius_px,
            insert_slices=range(0),
        )


FULL = PerfSpec(rows=512, columns=512, slices=300, segments=100)


def sphere_centers(spec: PerfSpec) -> list[tuple[int, int, int, int]]:
    """(row, column, slice, radius) of each segment's sphere, on a grid that never lets two touch."""
    side = int(np.ceil(np.sqrt(spec.segments)))
    cell_r = spec.rows // (side + 1)
    cell_c = spec.columns // (side + 1)
    radius = max(2, min(cell_r, cell_c) // 2 - 1)
    centers = []
    for number in range(spec.segments):
        row = (number // side + 1) * cell_r
        column = (number % side + 1) * cell_c
        slice_index = spec.slices // 2 + ((number * 7) % max(1, spec.slices // 2)) - spec.slices // 4
        centers.append((row, column, int(np.clip(slice_index, radius, spec.slices - radius - 1)), radius))
    return centers


def perf_labelmap(spec: PerfSpec) -> NDArray[np.uint8]:
    """Segment numbers 1..segments: one sphere each."""
    labelmap = np.zeros((spec.slices, spec.rows, spec.columns), dtype=np.uint8)
    rows, columns = np.ogrid[0 : spec.rows, 0 : spec.columns]
    for number, (row, column, centre, radius) in enumerate(sphere_centers(spec), start=1):
        for index in range(max(0, centre - radius), min(spec.slices, centre + radius + 1)):
            reach = radius**2 - (index - centre) ** 2
            if reach < 0:
                continue
            labelmap[index][(rows - row) ** 2 + (columns - column) ** 2 <= reach] = number
    return labelmap


def generate(out_dir: Path, spec: PerfSpec = FULL) -> list[Path]:
    ct = spec.ct
    written: list[Path] = []
    ct_dir = out_dir / PERF_CT_SERIES
    ct_dir.mkdir(parents=True, exist_ok=True)
    # The mock serves every file in a series directory, so slices of an earlier run would join the stack.
    for stale in ct_dir.glob("*.dcm"):
        stale.unlink()
    sources = []
    for index in range(spec.slices):
        ds = ct_dataset(ct, index, PERF_CT_SERIES, 1)
        # The timing reads headers and the SEG, never these pixels: zeros keep the files small to write.
        ds.PixelData = bytes(spec.rows * spec.columns * 2)
        path = ct_dir / f"{index + 1:04d}.dcm"
        ds.save_as(path, enforce_file_format=True)
        written.append(path)
        sources.append(ds)

    tissue = Code("85756007", "SCT", "Tissue")
    descriptions = [
        hd.seg.SegmentDescription(
            segment_number=number,
            segment_label=f"Segment {number}",
            segmented_property_category=tissue,
            segmented_property_type=Code("85756007", "SCT", "Tissue"),
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
        )
        for number in range(1, spec.segments + 1)
    ]
    seg = hd.seg.Segmentation(
        source_images=sources,
        pixel_array=perf_labelmap(spec),
        segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
        segment_descriptions=descriptions,
        series_instance_uid=uid(f"{PERF_SEG_SERIES}/series"),
        series_number=2,
        sop_instance_uid=uid(f"{PERF_SEG_SERIES}/instance"),
        instance_number=1,
        manufacturer="dicom-viewer phantom",
        manufacturer_model_name="perf.py",
        software_versions="0.1.0",
        device_serial_number="0",
        series_description=f"Phantom SEG ({PERF_SEG_SERIES})",
        content_label="PERF",
        content_creator_name="Phantom^Generator",
    )
    seg_dir = out_dir / PERF_SEG_SERIES
    seg_dir.mkdir(parents=True, exist_ok=True)
    for stale in seg_dir.glob("*.dcm"):
        stale.unlink()
    seg_path = seg_dir / "0001.dcm"
    seg.save_as(seg_path, enforce_file_format=True)
    written.append(seg_path)
    return written


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 6):
        print("Usage: python perf.py <output-dir> [rows columns slices segments]", file=sys.stderr)
        return 2
    spec = FULL if len(argv) == 2 else PerfSpec(*(int(value) for value in argv[2:6]))
    files = generate(Path(argv[1]), spec)
    print(f"Wrote {len(files)} files to {argv[1]} ({spec.segments} segments, {spec.slices} slices)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

"""Tests for the large SEG of the performance budget, on a small size so they run in a second."""

from pathlib import Path

import numpy as np
import pydicom
import pytest

import highdicom as hd

from perf import PERF_CT_SERIES, PERF_SEG_SERIES, PerfSpec, generate, perf_labelmap, sphere_centers

SMALL = PerfSpec(rows=64, columns=64, slices=24, segments=9)


def test_every_segment_is_a_sphere_that_touches_no_other() -> None:
    labelmap = perf_labelmap(SMALL)

    assert set(np.unique(labelmap)) == set(range(SMALL.segments + 1))
    for number, (row, column, centre, _radius) in enumerate(sphere_centers(SMALL), start=1):
        assert labelmap[centre, row, column] == number


def test_the_spheres_stay_inside_the_volume() -> None:
    for row, column, centre, radius in sphere_centers(SMALL):
        assert radius <= row < SMALL.rows - radius
        assert radius <= column < SMALL.columns - radius
        assert radius <= centre < SMALL.slices - radius


@pytest.fixture(scope="module")
def out_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("perf")
    generate(out, SMALL)
    return out


def test_writes_a_ct_stack_and_a_seg_that_names_every_slice(out_dir: Path) -> None:
    ct = sorted((out_dir / PERF_CT_SERIES).glob("*.dcm"))
    seg = hd.seg.segread(str(out_dir / PERF_SEG_SERIES / "0001.dcm"))

    assert len(ct) == SMALL.slices
    assert len(seg.get_source_image_uids()) == SMALL.slices
    assert {int(item.SegmentNumber) for item in seg.SegmentSequence} == set(range(1, SMALL.segments + 1))
    first = pydicom.dcmread(ct[0])
    assert (int(first.Rows), int(first.Columns)) == (SMALL.rows, SMALL.columns)

"""Tests for the synthetic CT phantom. The viewer's browser tests rely on these exact values."""

from pathlib import Path

import numpy as np
import pydicom
import pytest
from pydicom.uid import ExplicitVRLittleEndian, JPEG2000Lossless

from phantom import CT_SPEC, INSERTS, LEFT_MARKER_HU, Insert, generate


@pytest.fixture(scope="module")
def out_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("phantom")
    generate(out)
    return out


def _load_series(directory: Path) -> list[pydicom.Dataset]:
    datasets = [pydicom.dcmread(path) for path in sorted(directory.glob("*.dcm"))]
    return sorted(datasets, key=lambda ds: int(ds.InstanceNumber))


def _hu(ds: pydicom.Dataset) -> np.ndarray:
    return ds.pixel_array.astype(np.int32) * int(ds.RescaleSlope) + int(ds.RescaleIntercept)


def test_writes_one_series_per_transfer_syntax(out_dir: Path) -> None:
    evrle = _load_series(out_dir / "ct-evrle")
    j2k = _load_series(out_dir / "ct-j2k")

    assert len(evrle) == CT_SPEC.slices
    assert len(j2k) == CT_SPEC.slices
    assert {ds.file_meta.TransferSyntaxUID for ds in evrle} == {ExplicitVRLittleEndian}
    assert {ds.file_meta.TransferSyntaxUID for ds in j2k} == {JPEG2000Lossless}


def test_series_share_study_and_frame_of_reference_but_not_series(out_dir: Path) -> None:
    evrle = _load_series(out_dir / "ct-evrle")
    j2k = _load_series(out_dir / "ct-j2k")

    assert len({ds.StudyInstanceUID for ds in evrle + j2k}) == 1
    assert len({ds.FrameOfReferenceUID for ds in evrle + j2k}) == 1
    assert evrle[0].SeriesInstanceUID != j2k[0].SeriesInstanceUID
    assert len({ds.SOPInstanceUID for ds in evrle + j2k}) == 2 * CT_SPEC.slices


def test_geometry_is_axial_with_uniform_spacing(out_dir: Path) -> None:
    series = _load_series(out_dir / "ct-evrle")
    first = series[0]

    assert [float(v) for v in first.ImageOrientationPatient] == [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    assert (int(first.Rows), int(first.Columns)) == (CT_SPEC.rows, CT_SPEC.columns)
    z = [float(ds.ImagePositionPatient[2]) for ds in series]
    assert np.allclose(np.diff(z), CT_SPEC.slice_spacing_mm)


@pytest.mark.parametrize("insert", INSERTS, ids=lambda insert: insert.name)
def test_insert_centers_have_their_exact_hu(out_dir: Path, insert: Insert) -> None:
    series = _load_series(out_dir / "ct-evrle")
    middle = _hu(series[CT_SPEC.slices // 2])

    row, col = insert.center_rc
    assert middle[row, col] == insert.hu


def test_left_marker_is_on_the_patient_left(out_dir: Path) -> None:
    # LPS: +x is patient left, and with orientation [1,0,0,...] columns increase along +x.
    middle = _hu(_load_series(out_dir / "ct-evrle")[CT_SPEC.slices // 2])
    marker_cols = np.argwhere(middle == LEFT_MARKER_HU)[:, 1]

    assert marker_cols.size > 0
    assert marker_cols.min() > CT_SPEC.columns // 2


def test_inserts_are_absent_from_the_end_slices(out_dir: Path) -> None:
    series = _load_series(out_dir / "ct-evrle")
    for insert in INSERTS:
        row, col = insert.center_rc
        assert _hu(series[0])[row, col] != insert.hu


def test_j2k_is_lossless(out_dir: Path) -> None:
    evrle = _load_series(out_dir / "ct-evrle")
    j2k = _load_series(out_dir / "ct-j2k")
    for a, b in zip(evrle, j2k, strict=True):
        assert np.array_equal(a.pixel_array, b.pixel_array)


def test_output_is_byte_for_byte_deterministic(tmp_path: Path) -> None:
    first, second = tmp_path / "a", tmp_path / "b"
    generate(first)
    generate(second)

    files = sorted(p.relative_to(first) for p in first.rglob("*.dcm"))
    assert files == sorted(p.relative_to(second) for p in second.rglob("*.dcm"))
    for rel in files:
        assert (first / rel).read_bytes() == (second / rel).read_bytes(), rel

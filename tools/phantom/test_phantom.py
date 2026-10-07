"""Tests for the synthetic CT phantom. The viewer's browser tests rely on these exact values."""

from pathlib import Path

import numpy as np
import pydicom
import pytest
from pydicom.uid import ExplicitVRLittleEndian, JPEG2000Lossless

import highdicom as hd

from phantom import (
    CT_SPEC,
    FALLBACK_SERIES,
    FALLBACK_SLICES,
    INSERTS,
    NONUNIFORM_SERIES,
    TILT_DEGREES,
    TILTED_SERIES,
    FRACTIONAL_SEG_SERIES,
    INSERTS_SEG_SERIES,
    LEFT_MARKER_HU,
    MISMATCH_SEG_SERIES,
    MISMATCH_SHIFT_MM,
    OVERLAP_SEG_SERIES,
    PARTIAL_SLICES,
    SEG_SERIES,
    Insert,
    generate,
)


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


def _read_seg(out_dir: Path) -> hd.seg.Segmentation:
    return hd.seg.segread(str(out_dir / SEG_SERIES / "0001.dcm"))


def test_seg_is_a_single_multiframe_instance_in_the_same_study(out_dir: Path) -> None:
    files = sorted((out_dir / SEG_SERIES).glob("*.dcm"))
    j2k = _load_series(out_dir / "ct-j2k")
    seg = pydicom.dcmread(files[0])

    assert len(files) == 1
    assert seg.Modality == "SEG"
    assert seg.StudyInstanceUID == j2k[0].StudyInstanceUID
    assert seg.FrameOfReferenceUID == j2k[0].FrameOfReferenceUID
    assert seg.SeriesInstanceUID not in {ds.SeriesInstanceUID for ds in j2k}
    assert seg.SeriesDescription == f"Phantom SEG ({SEG_SERIES})"


def test_seg_references_every_slice_of_the_j2k_series(out_dir: Path) -> None:
    j2k = _load_series(out_dir / "ct-j2k")
    seg = _read_seg(out_dir)

    assert set(seg.get_source_image_uids()) == {
        (ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.SOPInstanceUID) for ds in j2k
    }


def test_seg_has_a_body_and_a_bone_segment(out_dir: Path) -> None:
    seg = _read_seg(out_dir)
    labels = {int(item.SegmentNumber): str(item.SegmentLabel) for item in seg.SegmentSequence}

    assert labels == {1: "Body", 2: "Bone insert"}


def test_seg_segments_follow_the_ct_geometry(out_dir: Path) -> None:
    j2k = _load_series(out_dir / "ct-j2k")
    seg = _read_seg(out_dir)
    sop_uids = [ds.SOPInstanceUID for ds in j2k]
    pixels = seg.get_pixels_by_source_instance(sop_uids, segment_numbers=[1, 2])
    body, bone = pixels[..., 0], pixels[..., 1]

    row, col = next(i.center_rc for i in INSERTS if i.name == "bone")
    middle = CT_SPEC.slices // 2
    # The bone insert disc is segment 2 and the body segment excludes it, so they never overlap.
    assert bone[middle, row, col] == 1
    assert body[middle, row, col] == 0
    assert not np.any(body & bone)
    # The body segment follows the 40 HU disc; the corner outside the body is empty.
    assert body[middle, 64, 40] == 1
    assert body[middle, 0, 0] == 0
    # The bone insert exists only on the slices where the CT has inserts.
    bone_slices = {int(i) for i in np.flatnonzero(bone.any(axis=(1, 2)))}
    assert bone_slices == set(CT_SPEC.insert_slices)


def _seg(out_dir: Path, series: str) -> hd.seg.Segmentation:
    return hd.seg.segread(str(out_dir / series / "0001.dcm"))


def _labels(seg: hd.seg.Segmentation) -> dict[int, str]:
    return {int(item.SegmentNumber): str(item.SegmentLabel) for item in seg.SegmentSequence}


def _source_sops(out_dir: Path, slices: range) -> list[str]:
    j2k = _load_series(out_dir / "ct-j2k")
    return [j2k[index].SOPInstanceUID for index in slices]


def test_the_other_segs_are_in_the_same_study_with_their_own_series(out_dir: Path) -> None:
    j2k = _load_series(out_dir / "ct-j2k")
    series = {
        pydicom.dcmread(out_dir / name / "0001.dcm").SeriesInstanceUID
        for name in (SEG_SERIES, INSERTS_SEG_SERIES, OVERLAP_SEG_SERIES, MISMATCH_SEG_SERIES)
    }

    assert len(series) == 4
    for name in (INSERTS_SEG_SERIES, OVERLAP_SEG_SERIES, MISMATCH_SEG_SERIES):
        seg = pydicom.dcmread(out_dir / name / "0001.dcm")
        assert seg.Modality == "SEG"
        assert seg.StudyInstanceUID == j2k[0].StudyInstanceUID
        assert seg.SeriesDescription == f"Phantom SEG ({name})"


def test_inserts_seg_has_one_segment_per_insert_on_the_insert_slices(out_dir: Path) -> None:
    seg = _seg(out_dir, INSERTS_SEG_SERIES)
    slices = CT_SPEC.insert_slices
    pixels = seg.get_pixels_by_source_instance(_source_sops(out_dir, slices), segment_numbers=[1, 2, 3, 4])

    assert _labels(seg) == {1: "Air", 2: "Water", 3: "Fat", 4: "Bone"}
    assert len(seg.get_source_image_uids()) == len(slices)
    for number, insert in enumerate(INSERTS, start=1):
        row, col = insert.center_rc
        assert pixels[0, row, col, number - 1] == 1
        assert pixels[..., number - 1].sum() == len(slices) * pixels[0, ..., number - 1].sum()
    # The inserts do not touch, so no pixel is in two segments.
    assert pixels.sum(axis=-1).max() == 1


def test_overlap_seg_has_two_segments_that_share_pixels(out_dir: Path) -> None:
    seg = _seg(out_dir, OVERLAP_SEG_SERIES)
    pixels = seg.get_pixels_by_source_instance(
        _source_sops(out_dir, PARTIAL_SLICES), segment_numbers=[1, 2]
    )
    slab, disc = pixels[..., 0], pixels[..., 1]

    assert _labels(seg) == {1: "Slab", 2: "Disc"}
    assert np.any(slab & disc)
    assert np.any(slab & ~disc)
    assert np.any(disc & ~slab)


def test_mismatch_seg_names_the_right_instances_with_the_wrong_planes(out_dir: Path) -> None:
    j2k = _load_series(out_dir / "ct-j2k")
    seg = pydicom.dcmread(out_dir / MISMATCH_SEG_SERIES / "0001.dcm")
    by_sop = {ds.SOPInstanceUID: ds for ds in j2k}
    referenced = [
        item.ReferencedSOPInstanceUID
        for item in seg.ReferencedSeriesSequence[0].ReferencedInstanceSequence
    ]

    # It names CT instances that exist, so a viewer that matches by SOP instance finds them.
    assert len(referenced) == len(PARTIAL_SLICES)
    assert all(sop in by_sop for sop in referenced)
    # Its own frame of reference is not the CT's, and its planes are shifted along the columns.
    assert seg.FrameOfReferenceUID != j2k[0].FrameOfReferenceUID
    offsets = {
        round(
            float(frame.PlanePositionSequence[0].ImagePositionPatient[0])
            - float(by_sop[sop].ImagePositionPatient[0]),
            3,
        )
        for frame, sop in zip(seg.PerFrameFunctionalGroupsSequence, referenced, strict=True)
    }
    assert offsets == {MISMATCH_SHIFT_MM}


def test_fractional_seg_is_a_fractional_type_with_two_segments_on_the_partial_slices(
    out_dir: Path,
) -> None:
    ds = pydicom.dcmread(out_dir / FRACTIONAL_SEG_SERIES / "0001.dcm")
    seg = _seg(out_dir, FRACTIONAL_SEG_SERIES)
    pixels = seg.get_pixels_by_source_instance(
        _source_sops(out_dir, PARTIAL_SLICES), segment_numbers=[1, 2]
    )

    assert ds.SegmentationType == "FRACTIONAL"
    assert int(ds.MaximumFractionalValue) == 255
    assert _labels(seg) == {1: "Water", 2: "Fat"}
    # The fractions are only ever 0 or 1, so the SEG is binary in all but its type, and the water
    # insert's centre belongs to segment 1 alone.
    water = next(i.center_rc for i in INSERTS if i.name == "water")
    assert set(np.unique(pixels)) == {0.0, 1.0}
    assert pixels[0, water[0], water[1], 0] == 1
    assert pixels[0, water[0], water[1], 1] == 0


def _positions(series: list[pydicom.Dataset]) -> np.ndarray:
    return np.array([[float(v) for v in ds.ImagePositionPatient] for ds in series])


def test_the_fallback_series_are_in_a_study_of_their_own(out_dir: Path) -> None:
    main = _load_series(out_dir / "ct-j2k")
    others = [_load_series(out_dir / name) for name in FALLBACK_SERIES]

    studies = {ds.StudyInstanceUID for series in others for ds in series}
    assert len(studies) == 1
    assert studies.isdisjoint({ds.StudyInstanceUID for ds in main})
    for series in others:
        assert len(series) == FALLBACK_SLICES
        assert (int(series[0].Rows), int(series[0].Columns)) == (CT_SPEC.rows, CT_SPEC.columns)
        assert {ds.file_meta.TransferSyntaxUID for ds in series} == {JPEG2000Lossless}
    assert len({ds.SOPInstanceUID for series in others for ds in series}) == 2 * FALLBACK_SLICES
    assert len({series[0].SeriesInstanceUID for series in others}) == 2
    assert len({ds.FrameOfReferenceUID for series in others for ds in series}) == 1


def test_the_tilted_series_leans_by_the_angle_it_says(out_dir: Path) -> None:
    series = _load_series(out_dir / TILTED_SERIES)
    positions = _positions(series)
    travel = positions[-1] - positions[0]

    # Same orientation as the others, so a viewer finds one stack; the slices are stacked along a line that leans.
    assert [float(v) for v in series[0].ImageOrientationPatient] == [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    angle = np.degrees(np.arccos(abs(travel[2]) / np.linalg.norm(travel)))
    assert angle == pytest.approx(TILT_DEGREES, abs=0.05)
    assert np.allclose(np.diff(positions[:, 2]), CT_SPEC.slice_spacing_mm)


def test_the_nonuniform_series_has_one_gap_twice_the_spacing(out_dir: Path) -> None:
    series = _load_series(out_dir / NONUNIFORM_SERIES)
    steps = np.diff(_positions(series)[:, 2])

    assert np.allclose(np.sort(np.unique(np.round(steps, 4))), [2.5, 5.0])
    assert int(np.sum(np.isclose(steps, 5.0))) == 1
    # Upright otherwise: no lean.
    assert np.allclose(_positions(series)[:, :2], _positions(series)[0, :2])


def test_the_fallback_series_hold_the_same_picture_as_the_main_one(out_dir: Path) -> None:
    main = _load_series(out_dir / "ct-j2k")
    for name in FALLBACK_SERIES:
        series = _load_series(out_dir / name)
        # The first slices of the main series: the inserts are absent from them, so the body is all there is.
        assert np.array_equal(series[0].pixel_array, main[0].pixel_array)

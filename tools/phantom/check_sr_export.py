"""Reads a Structured Report that the viewer wrote, with highdicom and pydicom, and says what is wrong.

The viewer's own reader agreeing with its own writer proves little. This is another tool reading
the file: highdicom parses it (`srread`) and finds its planar measurements, and pydicom walks the
content tree. It is run by the browser matrix with what the viewer was asked to write.

    uv run python check_sr_export.py REPORT.dcm --expect expect.json --source DIR_OF_THE_IMAGES
"""

from __future__ import annotations

import argparse
import json
import sys
import warnings
from dataclasses import dataclass
from pathlib import Path

import highdicom as hd
import pydicom

NUMBER_TOLERANCE = 0.05
GROUP = "125007"
MEASUREMENTS = "126010"
COMMENT = "121106"
FINDING = "121071"
TRACKING_UID = "112040"


@dataclass
class Group:
    tracking_uid: str | None
    label: str | None
    numbers: dict[str, tuple[float, str]]
    graphic_type: str | None
    sop: str | None


def read(path: Path) -> pydicom.Dataset:
    with warnings.catch_warnings():
        # A long value in a short field is reported by the length check below, with its place.
        warnings.simplefilter("ignore")
        return pydicom.dcmread(path)


def _code(item: pydicom.Dataset) -> str:
    names = item.get("ConceptNameCodeSequence")
    return str(names[0].CodeValue) if names else ""


def _children(item: pydicom.Dataset) -> list[pydicom.Dataset]:
    return list(item.get("ContentSequence", []))


def _region(item: pydicom.Dataset) -> tuple[str | None, str | None]:
    """The shape beside the numbers, or inside one of them, and the image it is on."""
    for child in _children(item):
        if child.ValueType == "SCOORD":
            images = [c for c in _children(child) if c.ValueType == "IMAGE"]
            sop = images[0].ReferencedSOPSequence[0].ReferencedSOPInstanceUID if images else None
            return str(child.GraphicType), None if sop is None else str(sop)
    return None, None


def groups_of(ds: pydicom.Dataset) -> list[Group]:
    root = next((i for i in ds.get("ContentSequence", []) if _code(i) == MEASUREMENTS), None)
    if root is None:
        return []
    found: list[Group] = []
    for group in (i for i in _children(root) if _code(i) == GROUP):
        label = None
        uid = None
        numbers: dict[str, tuple[float, str]] = {}
        graphic, sop = _region(group)
        for child in _children(group):
            if child.ValueType == "TEXT" and _code(child) == COMMENT:
                label = str(child.TextValue)
            elif child.ValueType == "CODE" and _code(child) == FINDING and label is None:
                label = str(child.ConceptCodeSequence[0].CodeMeaning)
            elif child.ValueType == "UIDREF" and _code(child) == TRACKING_UID:
                uid = str(child.UID)
            elif child.ValueType == "NUM":
                measured = child.MeasuredValueSequence[0]
                meaning = str(child.ConceptNameCodeSequence[0].CodeMeaning)
                numbers[meaning] = (float(measured.NumericValue), str(measured.MeasurementUnitsCodeSequence[0].CodeValue))
                if graphic is None:
                    graphic, sop = _region(child)
        found.append(Group(uid, label, numbers, graphic, sop))
    return found


def _values_too_long(ds: pydicom.Dataset, path: str = "") -> list[str]:
    limits = {"SH": 16, "LO": 64, "CS": 16, "UI": 64, "AE": 16}
    problems: list[str] = []
    for element in ds:
        if element.VR == "SQ":
            for at, item in enumerate(element.value):
                problems += _values_too_long(item, f"{path}{element.keyword}[{at}].")
            continue
        limit = limits.get(element.VR)
        if limit is None:
            continue
        values = element.value if isinstance(element.value, (list, pydicom.multival.MultiValue)) else [element.value]
        for value in values:
            if value is not None and len(str(value)) > limit:
                problems.append(f"{path}{element.keyword} ({element.VR}) is {len(str(value))} characters, over {limit}")
    return problems


def _source(sources: list[Path]) -> list[pydicom.Dataset]:
    return [pydicom.dcmread(p, stop_before_pixels=True) for source in sources for p in sorted(source.glob("*.dcm"))]


def check(path: Path, expect: dict, source: Path | list[Path], allow_extra_groups: bool = False) -> list[str]:
    problems: list[str] = []
    try:
        ds = read(path)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            hd.sr.srread(str(path))
    except Exception as error:  # noqa: BLE001 - a file that cannot be read is the finding
        return [f"highdicom could not read the file as a report: {error}"]
    templates = [t.TemplateIdentifier for t in ds.get("ContentTemplateSequence", [])]
    if templates != ["1500"]:
        return [f"the file is not a TID 1500 report (templates {templates}), the only kind the viewer writes"]
    if "sop_class" in expect and str(ds.SOPClassUID) != expect["sop_class"]:
        problems.append(f"the SOP class is {ds.SOPClassUID}, expected {expect['sop_class']}")
    if ds.file_meta.MediaStorageSOPClassUID != ds.SOPClassUID:
        problems.append("the file meta names another SOP class than the dataset")
    if ds.file_meta.MediaStorageSOPInstanceUID != ds.SOPInstanceUID:
        problems.append("the file meta names another SOP instance than the dataset")
    if str(getattr(ds, "SpecificCharacterSet", "")) != "ISO_IR 192" and expect.get("utf8", False):
        problems.append("the character set is not ISO_IR 192")

    sources = source if isinstance(source, list) else [source]
    images = _source(sources)
    if not images:
        problems.append(f"no images to compare with in {sources}")
    else:
        image = images[0]
        if ds.StudyInstanceUID != image.StudyInstanceUID:
            problems.append(f"the study is {ds.StudyInstanceUID}, the study of the images is {image.StudyInstanceUID}")
        for name in ("PatientID", "PatientName", "PatientBirthDate"):
            if str(getattr(ds, name, "")) != str(getattr(image, name, "")):
                problems.append(f"{name} differs from the images")
        evidence = list(ds.get("CurrentRequestedProcedureEvidenceSequence", []))
        if len(evidence) != 1:
            problems.append(f"{len(evidence)} evidence entries for the study, expected 1")
        known = {str(i.SOPInstanceUID) for i in images}
        for entry in evidence:
            for series in entry.ReferencedSeriesSequence:
                for ref in series.ReferencedSOPSequence:
                    if str(ref.ReferencedSOPInstanceUID) not in known:
                        problems.append(f"the evidence names an image that is not in the study: {ref.ReferencedSOPInstanceUID}")

    problems += [f"too long: {text}" for text in _values_too_long(ds)]

    groups = groups_of(ds)
    wanted = expect.get("groups", [])
    if (len(groups) != len(wanted)) if not allow_extra_groups else (len(groups) < len(wanted)):
        problems.append(f"{len(groups)} groups, expected {len(wanted)}")
    for at, (group, want) in enumerate(zip(groups, wanted)):
        if "label" in want and group.label != want["label"]:
            problems.append(f"group {at}: the label is {group.label!r}, expected {want['label']!r}")
        if "graphic_type" in want and group.graphic_type != want["graphic_type"]:
            problems.append(f"group {at}: the shape is {group.graphic_type}, expected {want['graphic_type']}")
        if want.get("sop") is not None and group.sop != want["sop"]:
            problems.append(f"group {at}: on image {group.sop}, expected {want['sop']}")
        for meaning, number in want.get("numbers", {}).items():
            have = group.numbers.get(meaning)
            if have is None:
                problems.append(f"group {at}: no {meaning}")
                continue
            if abs(have[0] - number["value"]) > NUMBER_TOLERANCE:
                problems.append(f"group {at}: {meaning} is {have[0]}, expected {number['value']}")
            if have[1] != number["unit"]:
                problems.append(f"group {at}: {meaning} has the unit {have[1]}, expected {number['unit']}")
        if not group.tracking_uid:
            problems.append(f"group {at}: no tracking unique identifier")
    if len({g.tracking_uid for g in groups}) != len(groups):
        problems.append("two groups have the same tracking unique identifier")

    if "planar" in expect:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            planar = hd.sr.srread(str(path)).content.get_planar_roi_measurement_groups()
        if len(planar) != expect["planar"]:
            problems.append(f"highdicom finds {len(planar)} planar measurements, expected {expect['planar']}")
    return problems


def same_identifiers(first: Path, second: Path) -> list[str]:
    a, b = read(first), read(second)
    uids = [g.tracking_uid for g in groups_of(a)]
    problems: list[str] = []
    if uids != [g.tracking_uid for g in groups_of(b)]:
        problems.append("the tracking identifiers differ between the two exports")
    if a.SeriesInstanceUID == b.SeriesInstanceUID or a.SOPInstanceUID == b.SOPInstanceUID:
        problems.append("the two exports are the same series or instance: each should be new")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("report", type=Path)
    parser.add_argument("--expect", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True, nargs="+", help="the directories of the images the report is of")
    parser.add_argument("--same-as", type=Path)
    arguments = parser.parse_args()
    expect = json.loads(arguments.expect.read_text())
    problems = check(arguments.report, expect, list(arguments.source))
    if arguments.same_as is not None:
        problems += same_identifiers(arguments.report, arguments.same_as)
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

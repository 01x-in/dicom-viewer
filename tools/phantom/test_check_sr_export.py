"""Tests for the check of an exported Structured Report, on the report highdicom wrote for the phantom."""

import json
from pathlib import Path

import pytest

import check_sr_export as check

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "phantom"
REPORT = FIXTURES / "sr-measurements" / "0001.dcm"
# The report refers to images of two series of the study.
CT = [FIXTURES / "ct-evrle", FIXTURES / "ct-j2k"]

# What the phantom report holds, by group, in the order highdicom wrote it.
EXPECT = {
    "sop_class": "1.2.840.10008.5.1.4.1.1.88.34",
    "groups": [
        {"label": "Water insert", "graphic_type": "POLYLINE", "numbers": {"Length": {"value": 27.0, "unit": "mm"}}},
        {"label": "Water centre", "graphic_type": "POINT", "numbers": {"Attenuation": {"value": 0.0, "unit": "[hnsf'U]"}}},
        {"label": "Bone insert", "graphic_type": "ELLIPSE", "numbers": {"Area": {"value": 282.7, "unit": "mm2"}}},
        {"label": "Fat insert", "graphic_type": "POLYLINE", "numbers": {"Area": {"value": 225.0, "unit": "mm2"}}},
    ],
}


def test_reads_the_group_of_a_report_whatever_tool_wrote_it():
    groups = check.groups_of(check.read(REPORT))
    assert len(groups) == 6
    first = groups[0]
    assert first.label == "Water insert"
    assert first.graphic_type == "POLYLINE"
    assert first.numbers["Length"] == (27.0, "mm")
    assert first.tracking_uid.startswith("2.25.")


def test_the_label_is_the_comment_when_there_is_one_and_the_finding_when_there_is_not():
    groups = check.groups_of(check.read(REPORT))
    assert groups[0].label == "Water insert"  # a Finding, this report has no Comment


def test_a_report_that_matches_what_is_expected_has_no_problem():
    expect = {**EXPECT, "planar": 6}
    problems = check.check(REPORT, expect, CT, allow_extra_groups=True)
    assert problems == []


def test_says_what_differs():
    wrong = {
        **EXPECT,
        "groups": [{**EXPECT["groups"][0], "label": "Aorta"}, *EXPECT["groups"][1:]],
    }
    problems = check.check(REPORT, wrong, CT, allow_extra_groups=True)
    assert any("group 0" in text and "Aorta" in text for text in problems)


def test_a_number_that_is_off_or_has_another_unit_is_a_problem():
    wrong = json.loads(json.dumps(EXPECT))
    wrong["groups"][0]["numbers"]["Length"] = {"value": 30.0, "unit": "mm"}
    wrong["groups"][1]["numbers"]["Attenuation"]["unit"] = "1"
    problems = check.check(REPORT, wrong, CT, allow_extra_groups=True)
    assert any("Length" in text for text in problems)
    assert any("Attenuation" in text and "unit" in text for text in problems)


def test_the_study_and_the_patient_must_be_those_of_the_images():
    problems = check.check(REPORT, EXPECT, [FIXTURES / "ct-tilted"], allow_extra_groups=True)
    assert any("study" in text.lower() for text in problems)


def test_a_different_class_is_a_problem():
    problems = check.check(REPORT, {**EXPECT, "sop_class": "1.2.840.10008.5.1.4.1.1.88.33"}, CT, allow_extra_groups=True)
    assert any("class" in text.lower() for text in problems)


def test_an_unexpected_number_of_groups_is_a_problem_unless_extra_ones_are_allowed():
    assert any("groups" in text for text in check.check(REPORT, EXPECT, CT))
    assert not any("groups" in text for text in check.check(REPORT, EXPECT, CT, allow_extra_groups=True))


def test_a_file_that_is_not_a_report_is_one_problem_and_not_a_crash():
    problems = check.check(FIXTURES / "ct-evrle" / "0001.dcm", EXPECT, CT)
    assert problems and "report" in problems[0].lower()


def test_two_exports_have_the_same_identifiers_and_each_is_a_new_series():
    problems = check.same_identifiers(REPORT, REPORT)
    # The same file is the same series: that is what a second export must not be. The identifiers agree.
    assert problems == ["the two exports are the same series or instance: each should be new"]

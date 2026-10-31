"""课标骨架模板的结构完整性。"""

from app.goals.templates import SUBJECT_NAMES, get_template, semester_seed

EXPECTED_SUBJECTS = ("语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "道德与法治")


def test_nine_subjects_present():
    assert SUBJECT_NAMES == EXPECTED_SUBJECTS


def test_every_subject_has_at_least_three_domains():
    for subject in SUBJECT_NAMES:
        template = get_template(subject)
        assert template is not None, subject
        domains = template["domains"]
        assert len(domains) >= 3, subject
        for domain in domains:
            assert domain["name"], subject
            assert len(domain["themes"]) >= 1
            assert len(domain["competencies"]) >= 1
            assert domain["sample"]


def test_semester_seed_is_prefilled_draft():
    for subject in SUBJECT_NAMES:
        seed = semester_seed(subject)
        assert 3 <= len(seed) <= 8, subject
        for item in seed:
            assert item["title"] and item["description"] and item["verify_criteria"], subject


def test_unknown_subject_returns_none():
    assert get_template("书法") is None
    assert semester_seed("书法") == []

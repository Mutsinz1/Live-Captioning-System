"""Tests for caption casing post-processing."""
import pytest

from formatting import format_caption, formatting_enabled


@pytest.mark.parametrize("text,is_start,expected", [
    ("hello everyone welcome", True, "Hello everyone welcome"),
    ("hello everyone welcome", False, "hello everyone welcome"),
    ("i think i'll go and i've decided", False, "I think I'll go and I've decided"),
    ("i think i'll go", True, "I think I'll go"),
    ("invite him in", True, "Invite him in"),   # 'i' inside words untouched
    ("", True, ""),
    ("i", True, "I"),
])
def test_format_caption_english(text, is_start, expected):
    assert format_caption(text, "en", is_sentence_start=is_start) == expected


def test_no_terminal_punctuation_is_invented():
    """Vosk segments on silence, not sentence ends — see formatting.__doc__."""
    segments = [
        "so what i want to show you today",
        "is the new captioning",
        "system we built last month",
    ]
    rendered = " ".join(
        format_caption(s, "en", is_sentence_start=(i == 0))
        for i, s in enumerate(segments)
    )
    assert rendered == (
        "So what I want to show you today is the new captioning "
        "system we built last month"
    )
    assert "." not in rendered


def test_existing_punctuation_is_preserved():
    assert format_caption("really?", "en", is_sentence_start=True) == "Really?"
    assert format_caption("it is done.", "en", is_sentence_start=True) == "It is done."


@pytest.mark.parametrize("language", ["es", "fr"])
def test_pronoun_rule_is_english_only(language):
    # "i" is a real lowercase word in other languages; only casing at a
    # genuine sentence start should apply.
    assert format_caption("hay i luego", language, is_sentence_start=False) == "hay i luego"
    assert format_caption("hay i luego", language, is_sentence_start=True) == "Hay i luego"


def test_formatting_toggle(monkeypatch):
    monkeypatch.delenv("FORMAT_CAPTIONS", raising=False)
    assert formatting_enabled()
    monkeypatch.setenv("FORMAT_CAPTIONS", "false")
    assert not formatting_enabled()
    monkeypatch.setenv("FORMAT_CAPTIONS", "off")
    assert not formatting_enabled()
    monkeypatch.setenv("FORMAT_CAPTIONS", "true")
    assert formatting_enabled()

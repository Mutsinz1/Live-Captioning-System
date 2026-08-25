"""Tests for caption casing/punctuation post-processing."""
import pytest

from formatting import format_caption, formatting_enabled


@pytest.mark.parametrize("text,is_final,expected", [
    ("hello everyone welcome", True, "Hello everyone welcome."),
    ("i think i'll go and i've decided", True, "I think I'll go and I've decided."),
    ("hello wor", False, "Hello wor"),          # partials get no period
    ("it is done.", True, "It is done."),        # existing punctuation kept
    ("really?", True, "Really?"),
    ("", True, ""),
    ("i", True, "I."),
    ("invite him in", True, "Invite him in."),   # 'i' inside words untouched
])
def test_format_caption(text, is_final, expected):
    assert format_caption(text, is_final) == expected


def test_formatting_toggle(monkeypatch):
    monkeypatch.delenv("FORMAT_CAPTIONS", raising=False)
    assert formatting_enabled()
    monkeypatch.setenv("FORMAT_CAPTIONS", "false")
    assert not formatting_enabled()
    monkeypatch.setenv("FORMAT_CAPTIONS", "off")
    assert not formatting_enabled()
    monkeypatch.setenv("FORMAT_CAPTIONS", "true")
    assert formatting_enabled()

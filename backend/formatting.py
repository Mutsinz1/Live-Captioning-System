"""Lightweight caption post-processing: casing and punctuation.

Vosk emits lowercase, unpunctuated text ("hello everyone welcome i'm glad").
This module applies conservative, rule-based cleanup that needs no extra
models or downloads:

- capitalize the first letter of every caption
- capitalize the standalone pronoun "i" (including i'm, i've, i'll, i'd)
- add a terminal period to FINAL captions that end without punctuation

Disable entirely with the env var FORMAT_CAPTIONS=false.

For higher-quality punctuation (commas, question marks, mid-sentence
periods) consider a dedicated model such as recasepunc, or an engine like
faster-whisper that produces punctuated output natively — this module is
deliberately the zero-dependency baseline.
"""
import os
import re

_STANDALONE_I = re.compile(r"\bi\b")
_TERMINAL_PUNCTUATION = (".", "!", "?", ",", ";", ":", "…")


def formatting_enabled() -> bool:
    """Whether caption formatting is enabled (FORMAT_CAPTIONS env, default on)"""
    return os.environ.get("FORMAT_CAPTIONS", "true").strip().lower() not in (
        "0", "false", "no", "off",
    )


def format_caption(text: str, is_final: bool) -> str:
    """Apply casing/punctuation cleanup to a raw transcription string."""
    if not text:
        return text

    # "i think i'll go" -> "I think I'll go"
    # (\b matches before the apostrophe, so contractions are covered)
    formatted = _STANDALONE_I.sub("I", text)

    # Capitalize the first letter
    formatted = formatted[0].upper() + formatted[1:]

    # Final captions get a terminal period if none is present
    if is_final and not formatted.endswith(_TERMINAL_PUNCTUATION):
        formatted += "."

    return formatted

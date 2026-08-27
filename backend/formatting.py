"""Lightweight caption post-processing: casing and pronoun fixes.

Vosk emits lowercase, unpunctuated text ("hello everyone welcome i'm glad").
The tempting cleanup — capitalize each caption and end it with a period — is
wrong here: Vosk emits a final result on every silence pause, not at sentence
boundaries, so a speaker pausing mid-sentence would render as

    So what I want to show you today. Is the new captioning. System we built.

This module therefore only applies changes that do not assert a sentence
boundary the recognizer never reported:

- capitalize the first letter of the first caption in a session
- capitalize the standalone pronoun "i" (including i'm, i've, i'll, i'd),
  which is English-specific and is skipped for other languages

Disable entirely with the env var FORMAT_CAPTIONS=false.

Real sentence segmentation needs punctuation restoration — a dedicated model
such as recasepunc, or an engine like faster-whisper that emits punctuated
text natively. This module is deliberately the zero-dependency baseline and
does not guess.
"""
import os
import re

_STANDALONE_I = re.compile(r"\bi\b")

# The pronoun rule only makes sense for English; "i" is a real lowercase word
# in other languages this project ships models for.
_PRONOUN_I_LANGUAGES = frozenset({"en"})


def formatting_enabled() -> bool:
    """Whether caption formatting is enabled (FORMAT_CAPTIONS env, default on)"""
    return os.environ.get("FORMAT_CAPTIONS", "true").strip().lower() not in (
        "0", "false", "no", "off",
    )


def format_caption(
    text: str,
    language: str = "en",
    is_sentence_start: bool = False,
) -> str:
    """Apply conservative casing cleanup to a raw transcription string.

    is_sentence_start should only be True where a sentence genuinely begins —
    in practice the first caption of a session. Terminal punctuation is never
    added, because Vosk does not tell us where sentences end.
    """
    if not text:
        return text

    formatted = text

    # "i think i'll go" -> "I think I'll go"
    # (\b matches before the apostrophe, so contractions are covered)
    if language in _PRONOUN_I_LANGUAGES:
        formatted = _STANDALONE_I.sub("I", formatted)

    if is_sentence_start:
        formatted = formatted[0].upper() + formatted[1:]

    return formatted

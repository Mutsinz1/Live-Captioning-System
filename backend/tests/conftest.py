"""Shared test setup: stub the vosk module so tests run without the real
engine or model downloads, and make the backend package importable."""
import json
import os
import sys
import types

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)


class FakeModel:
    load_count = 0

    def __init__(self, path):
        FakeModel.load_count += 1
        self.path = path


class FakeRecognizer:
    """Scriptable stand-in for KaldiRecognizer.

    Set `mode` to "final" or "partial" to steer AcceptWaveform.
    """

    def __init__(self, model, sample_rate):
        self.model = model
        self.sample_rate = sample_rate
        self.words_enabled = False
        self.mode = "partial"
        self.final_payload = {
            "text": "hello world",
            "result": [
                {"word": "hello", "conf": 0.9},
                {"word": "world", "conf": 0.7},
            ],
        }
        self.partial_payload = {"partial": "hello wor"}

    def SetWords(self, flag):
        self.words_enabled = bool(flag)

    def AcceptWaveform(self, data):
        return self.mode == "final"

    def Result(self):
        return json.dumps(self.final_payload)

    def PartialResult(self):
        return json.dumps(self.partial_payload)

    def FinalResult(self):
        """Vosk flushes any buffered audio and returns a final result."""
        return json.dumps(self.final_payload)


# Stub vosk BEFORE any test imports transcription
fake_vosk = types.ModuleType("vosk")
fake_vosk.Model = FakeModel
fake_vosk.KaldiRecognizer = FakeRecognizer
sys.modules.setdefault("vosk", fake_vosk)


@pytest.fixture
def model_dirs():
    """Ensure the expected model directories exist; remove only what we created."""
    base = os.path.join(BACKEND_DIR, "models")
    names = [
        "vosk-model-small-en-us-0.15",
        "vosk-model-small-es-0.42",
        "vosk-model-small-fr-0.22",
    ]
    created = []
    for name in names:
        path = os.path.join(base, name)
        if not os.path.exists(path):
            os.makedirs(path)
            created.append(path)
    yield base
    for path in created:
        os.rmdir(path)
    if not os.listdir(base):
        os.rmdir(base)


@pytest.fixture
def service(model_dirs):
    import transcription

    FakeModel.load_count = 0
    return transcription.TranscriptionService()

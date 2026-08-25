"""Tests for TranscriptionService (vosk stubbed in conftest.py)."""
import asyncio

from conftest import FakeModel


def run(coro):
    return asyncio.run(coro)


def test_initialize_loads_default_model(service):
    run(service.initialize())
    assert "en" in service.models
    assert FakeModel.load_count == 1


def test_session_recognizer_has_words_enabled(service):
    async def scenario():
        await service.initialize()
        await service.start_session(1)
        assert service.recognizers[1].words_enabled
        assert "audio_chunks" not in service.sessions[1]

    run(scenario())


def test_partial_and_final_results(service):
    async def scenario():
        await service.initialize()
        await service.start_session(1)
        rec = service.recognizers[1]

        rec.mode = "partial"
        partial = await service.process_audio(1, b"\x00\x00" * 100)
        assert partial["is_final"] is False
        assert partial["text"].lower().startswith("hello wor")

        rec.mode = "final"
        final = await service.process_audio(1, b"\x00\x00" * 100)
        assert final["is_final"] is True
        # avg of word confidences 0.9 and 0.7
        assert abs(final["confidence"] - 0.8) < 1e-9
        assert service.sessions[1]["transcriptions"]

    run(scenario())


def test_no_audio_accumulation(service):
    async def scenario():
        await service.initialize()
        await service.start_session(1)
        service.recognizers[1].mode = "partial"
        for _ in range(200):
            await service.process_audio(1, b"\x00\x00" * 4096)
        assert set(service.sessions[1].keys()) == {
            "start_time", "transcriptions", "language",
        }

    run(scenario())


def test_per_client_language_and_model_cache(service):
    async def scenario():
        await service.initialize()
        await service.start_session(1)
        await service.start_session(2, "es")
        assert service.sessions[1]["language"] == "en"
        assert service.sessions[2]["language"] == "es"
        assert FakeModel.load_count == 2

        rec2 = service.recognizers[2]
        await service.set_session_language(1, "es")
        assert FakeModel.load_count == 2, "es model must come from cache"
        assert service.recognizers[2] is rec2, "other client untouched"
        assert service.recognizers[1].model is service.recognizers[2].model

    run(scenario())


def test_global_change_language_switches_everyone(service):
    async def scenario():
        await service.initialize()
        await service.start_session(1)
        await service.start_session(2, "es")
        await service.change_language("fr")
        assert service.default_language == "fr"
        assert service.sessions[1]["language"] == "fr"
        assert service.sessions[2]["language"] == "fr"
        await service.start_session(3)
        assert service.sessions[3]["language"] == "fr"

    run(scenario())


def test_end_session_cleans_up(service):
    async def scenario():
        await service.initialize()
        await service.start_session(1)
        await service.end_session(1)
        assert 1 not in service.recognizers
        assert 1 not in service.sessions

    run(scenario())


def test_status_reports_sessions(service):
    async def scenario():
        await service.initialize()
        await service.start_session(1)
        await service.start_session(2, "es")
        status = await service.get_status()
        assert status["default_language"] == "en"
        assert status["loaded_languages"] == ["en", "es"]
        assert status["active_sessions"] == 2

    run(scenario())

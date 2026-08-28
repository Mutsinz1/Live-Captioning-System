"""End-to-end tests for the HTTP and WebSocket endpoints.

These cover the wiring that the service-level tests cannot: the original
"dead language switcher" bug was a routing bug, not a service bug.
Vosk is stubbed in conftest.py, so no models are downloaded.
"""
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(model_dirs):
    import main
    # each test gets a service with no leftover sessions or cached models
    main.transcription_service.sessions.clear()
    main.transcription_service.recognizers.clear()
    main.transcription_service.models.clear()
    main.transcription_service.default_language = "en"
    with TestClient(main.app) as c:
        yield c


def only_recognizer():
    import main
    recognizers = list(main.transcription_service.recognizers.values())
    assert len(recognizers) == 1, f"expected 1 recognizer, got {len(recognizers)}"
    return recognizers[0]


def test_health(client):
    assert client.get("/health").json() == {
        "status": "healthy", "service": "live-captioning",
    }


def test_models_endpoint_lists_languages(client):
    models = client.get("/models").json()["models"]
    assert {m["language"] for m in models} == {"en", "es", "fr"}
    assert all(m["installed"] for m in models)


def test_audio_socket_returns_a_partial_transcription(client):
    with client.websocket_connect("/ws/audio") as ws:
        ws.send_bytes(b"\x00\x00" * 100)
        message = ws.receive_json()
    assert message["type"] == "transcription"
    assert message["is_final"] is False
    assert message["text"].lower().startswith("hello wor")


def test_audio_socket_returns_a_final_transcription(client):
    with client.websocket_connect("/ws/audio") as ws:
        only_recognizer().mode = "final"
        ws.send_bytes(b"\x00\x00" * 100)
        message = ws.receive_json()
    assert message["is_final"] is True
    # first caption of the session, so it starts a sentence
    assert message["text"] == "Hello world"
    assert abs(message["confidence"] - 0.8) < 1e-9


def test_language_change_over_the_audio_socket(client):
    """The regression the 'dead language switcher' fix was about."""
    import main
    with client.websocket_connect("/ws/audio") as ws:
        ws.send_text(json.dumps({"type": "change_language", "language": "es"}))
        reply = ws.receive_json()
        assert reply == {"type": "language_changed", "language": "es"}
        assert list(main.transcription_service.sessions.values())[0]["language"] == "es"


def test_language_change_is_per_client(client):
    import main
    with client.websocket_connect("/ws/audio") as a, \
            client.websocket_connect("/ws/audio") as b:
        a.send_text(json.dumps({"type": "change_language", "language": "fr"}))
        assert a.receive_json()["language"] == "fr"
        languages = sorted(
            s["language"] for s in main.transcription_service.sessions.values()
        )
        assert languages == ["en", "fr"], "the other client must keep its language"
        # the untouched client still transcribes normally
        b.send_bytes(b"\x00\x00" * 100)
        assert b.receive_json()["type"] == "transcription"


def test_unknown_language_reports_an_error_without_dropping_the_socket(client):
    with client.websocket_connect("/ws/audio") as ws:
        ws.send_text(json.dumps({"type": "change_language", "language": "kl"}))
        reply = ws.receive_json()
        assert reply["type"] == "error"
        # socket still usable
        ws.send_bytes(b"\x00\x00" * 100)
        assert ws.receive_json()["type"] == "transcription"


def test_malformed_audio_control_frame_is_ignored(client):
    with client.websocket_connect("/ws/audio") as ws:
        ws.send_text("not json at all")
        ws.send_bytes(b"\x00\x00" * 100)
        assert ws.receive_json()["type"] == "transcription"


def test_session_is_cleaned_up_on_disconnect(client):
    import main
    with client.websocket_connect("/ws/audio"):
        assert len(main.transcription_service.sessions) == 1
    assert main.transcription_service.sessions == {}
    assert main.transcription_service.recognizers == {}


def test_control_socket_sets_default_without_touching_live_sessions(client):
    import main
    with client.websocket_connect("/ws/audio"):
        session_id = next(iter(main.transcription_service.sessions))
        with client.websocket_connect("/ws/control") as ctl:
            ctl.send_text(json.dumps({"type": "change_language", "language": "fr"}))
            assert ctl.receive_json() == {"type": "language_changed", "language": "fr"}
        assert main.transcription_service.default_language == "fr"
        assert main.transcription_service.sessions[session_id]["language"] == "en"


def test_control_socket_survives_malformed_json(client):
    with client.websocket_connect("/ws/control") as ctl:
        ctl.send_text("{ this is not json")
        ctl.send_text(json.dumps({"type": "get_status"}))
        reply = ctl.receive_json()
        assert reply["type"] == "status"
        assert reply["status"]["default_language"] == "en"


def test_status_reports_live_sessions(client):
    with client.websocket_connect("/ws/audio"):
        with client.websocket_connect("/ws/control") as ctl:
            ctl.send_text(json.dumps({"type": "get_status"}))
            status = ctl.receive_json()["status"]
    assert status["active_sessions"] == 1
    assert status["sample_rate"] == 16000


def test_stop_recording_flushes_the_last_utterance(client):
    """Regression: without this the final sentence never reaches the export."""
    with client.websocket_connect("/ws/audio") as ws:
        ws.send_bytes(b"\x00\x00" * 100)          # arrives as a partial
        assert ws.receive_json()["is_final"] is False

        ws.send_text(json.dumps({"type": "stop_recording"}))
        final = ws.receive_json()

    assert final["type"] == "transcription"
    assert final["is_final"] is True
    assert final["text"] == "Hello world"

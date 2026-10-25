"""Wave API status, session binding and provider request flow."""
from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from autonoc.api import main as M
from autonoc.api import wave_ai


@pytest.fixture(autouse=True)
def use_openai_provider_by_default(monkeypatch):
    monkeypatch.setenv("WAVE_AI_PROVIDER", "openai")


async def idle_simulation_loop():
    """Keep API integration tests deterministic and avoid background ticks."""
    await asyncio.Event().wait()


def test_wave_status_is_session_free_and_missing_key_is_clear(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(
        wave_ai,
        "_provider_http_call",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider must not run")),
    )

    with TestClient(M.app) as client:
        status = client.get("/api/wave/status")
        assert status.status_code == 200
        assert status.json()["status"] == "missing_key"
        assert status.json()["configured"] is False
        assert "autonoc_session" not in client.cookies
        assert M._registry.count() == 0

        data = client.get("/api/delta?since=0").json()
        response = client.post(
            "/api/wave/chat",
            json={"question": "How is the network?", "run_id": data["run_id"], "history": []},
        )
        assert response.status_code == 503
        assert response.json()["code"] == "wave_ai_missing_key"
        assert "OPENAI_API_KEY" in response.json()["detail"]
        assert "autonoc_session" not in response.text


def test_wave_chat_uses_the_request_session_snapshot_without_holding_gate(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    seen: list[tuple[str, str, int]] = []

    async def fake_answer(question, snapshot, *, session_id, history):
        assert not M._gate.locked(), "provider work must not hold the global session gate"
        seen.append((session_id, snapshot["run_id"], snapshot["tick"]))
        assert question == "Describe this run."
        assert history == [{"role": "user", "content": "What changed?"}]
        return {
            "answer": f"Snapshot {snapshot['run_id']} at tick {snapshot['tick']}.",
            "provider": "openai",
            "model": "test-model",
            "ai_connected": True,
            "run_id": snapshot["run_id"],
            "tick": snapshot["tick"],
            "sim_time": snapshot["kpis"]["sim_time"],
        }

    monkeypatch.setattr(M, "answer_wave_question", fake_answer)
    with TestClient(M.app) as first:
        second = TestClient(M.app)
        first_data = first.get("/api/data").json()
        second_data = second.get("/api/data").json()
        assert first_data["run_id"] != second_data["run_id"]

        body = {
            "question": "Describe this run.",
            "history": [{"role": "user", "content": "What changed?"}],
        }
        first_response = first.post(
            "/api/wave/chat", json={**body, "run_id": first_data["run_id"]}
        )
        second_response = second.post(
            "/api/wave/chat", json={**body, "run_id": second_data["run_id"]}
        )

        assert first_response.status_code == second_response.status_code == 200
        assert first_response.json()["run_id"] == first_data["run_id"]
        assert second_response.json()["run_id"] == second_data["run_id"]
        assert {row[1] for row in seen} == {first_data["run_id"], second_data["run_id"]}
        assert len({row[0] for row in seen}) == 2
        assert M._registry.count() == 2


def test_mocked_openai_success_verifies_provider_and_receives_current_snapshot(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    key = "unit-test-openai-key-not-a-credential"
    monkeypatch.setenv("OPENAI_API_KEY", key)
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4.1-mini-test")
    wave_ai._rate_limiter.clear()
    captured: dict = {}

    def fake_http(payload, supplied_key, timeout):
        captured.update(payload=payload, supplied_key=supplied_key, timeout=timeout)
        return 200, {"choices": [{"message": {"content": "Grounded test reply."}}]}, {}

    monkeypatch.setattr(wave_ai, "_provider_http_call", fake_http)
    with TestClient(M.app) as client:
        before = client.get("/api/wave/status").json()
        assert before["status"] == "not_verified"
        assert before["verified"] is False
        data = client.get("/api/delta?since=0").json()
        response = client.post(
            "/api/wave/chat",
            json={
                "question": "What is the network state?",
                "run_id": data["run_id"],
                "history": [],
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["answer"] == "Grounded test reply."
        assert body["ai_connected"] is True
        assert body["run_id"] == data["run_id"]
        assert body["tick"] == data["tick"]
        assert body["sim_time"] == data["kpis"]["sim_time"]
        assert key not in response.text
        assert key not in json.dumps(client.get("/api/wave/status").json())
        assert client.get("/api/wave/status").json()["status"] == "connected"

    assert captured["supplied_key"] == key
    assert key not in json.dumps(captured["payload"])
    assert "tools" not in captured["payload"]
    user_message = captured["payload"]["messages"][-1]["content"]
    assert "TRUSTED SULINOC SNAPSHOT CONTEXT" in user_message
    assert '"is_live_operator_network":false' in user_message
    assert f'"tick":{data["tick"]}' in user_message


def test_mocked_groq_provider_flows_through_session_api_without_exposing_key(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    key = "unit-test-groq-api-key-not-a-credential"
    monkeypatch.setenv("WAVE_AI_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", key)
    monkeypatch.setenv("GROQ_MODEL", "test-groq-model")
    wave_ai._rate_limiter.clear()
    captured: dict = {}

    def fake_http(payload, supplied_key, timeout):
        captured.update(payload=payload, key=supplied_key, timeout=timeout)
        return 200, {"choices": [{"message": {"content": "Grounded Groq reply."}}]}, {}

    monkeypatch.setattr(wave_ai, "_provider_http_call", fake_http)
    with TestClient(M.app) as client:
        status = client.get("/api/wave/status").json()
        assert status["provider"] == "groq"
        assert status["status"] == "not_verified"
        data = client.get("/api/delta?since=0").json()
        response = client.post(
            "/api/wave/chat",
            json={
                "question": "Summarize the current simulation.",
                "run_id": data["run_id"],
                "history": [],
            },
        )
        body = response.json()
        assert response.status_code == 200
        assert body["provider"] == "groq"
        assert body["answer"] == "Grounded Groq reply."
        assert body["ai_connected"] is True
        assert key not in response.text
        assert key not in json.dumps(client.get("/api/wave/status").json())
        assert client.get("/api/wave/status").json()["status"] == "connected"

    assert captured["key"] == key
    assert captured["payload"]["model"] == "test-groq-model"
    assert captured["payload"]["max_tokens"] == 700
    assert key not in json.dumps(captured["payload"])


def test_wave_chat_stream_emits_deltas_and_done(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    key = "unit-test-openai-key-not-a-credential"
    monkeypatch.setenv("OPENAI_API_KEY", key)
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4.1-mini-test")
    wave_ai._rate_limiter.clear()
    captured: dict = {}

    def fake_stream(payload, supplied_key, timeout, emit):
        captured.update(payload=payload, supplied_key=supplied_key)
        emit(("delta", "Grounded "))
        emit(("delta", "streamed reply."))
        return ("ok", {})

    monkeypatch.setattr(wave_ai, "_provider_stream_call", fake_stream)
    with TestClient(M.app) as client:
        data = client.get("/api/delta?since=0").json()
        response = client.post(
            "/api/wave/chat/stream",
            json={"question": "What is the network state?", "run_id": data["run_id"], "history": []},
        )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = response.text
        assert 'event: delta\ndata: {"text": "Grounded "}' in body
        assert 'event: delta\ndata: {"text": "streamed reply."}' in body
        assert 'event: error' not in body
        done_line = next(
            line for line in body.splitlines() if line.startswith("data: {") and "answer" in line
        )
        done = json.loads(done_line[6:])
        assert done["answer"] == "Grounded streamed reply."
        assert done["ai_connected"] is True
        assert done["run_id"] == data["run_id"]
        assert done["model"] == "gpt-4.1-mini-test"
        assert key not in body
        assert client.get("/api/wave/status").json()["status"] == "connected"

    assert captured["supplied_key"] == key
    assert "TRUSTED SULINOC SNAPSHOT CONTEXT" in captured["payload"]["messages"][-1]["content"]


def test_wave_chat_stream_missing_key_stays_a_json_error(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with TestClient(M.app) as client:
        data = client.get("/api/delta?since=0").json()
        response = client.post(
            "/api/wave/chat/stream",
            json={"question": "Status?", "run_id": data["run_id"], "history": []},
        )
        assert response.status_code == 503
        assert response.json()["code"] == "wave_ai_missing_key"
        assert "text/event-stream" not in response.headers.get("content-type", "")


def test_wave_chat_stream_maps_mid_flight_provider_errors(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-openai-key-not-a-credential")
    wave_ai._rate_limiter.clear()

    def fake_stream(payload, supplied_key, timeout, emit):
        emit(("delta", "Partial "))
        return ("status", 429, {"retry-after": "7"})

    monkeypatch.setattr(wave_ai, "_provider_stream_call", fake_stream)
    with TestClient(M.app) as client:
        data = client.get("/api/delta?since=0").json()
        response = client.post(
            "/api/wave/chat/stream",
            json={"question": "Status?", "run_id": data["run_id"], "history": []},
        )
        body = response.text
        assert 'event: delta\ndata: {"text": "Partial "}' in body
        assert "event: error" in body
        assert "rate-limiting Wave" in body
        assert "event: done" not in body
        # The failed stream must not verify the key.
        assert client.get("/api/wave/status").json()["status"] != "connected"

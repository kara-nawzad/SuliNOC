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


def session_delta(client):
    """Claim this client's own run, then read it.

    A token-less read is served from the server's shared engine, while Wave is
    bound to one session's run — so the client introduces itself first.
    """
    client.post("/api/session")
    return client.get("/api/delta?since=0").json()


async def idle_simulation_loop():
    """Keep API integration tests deterministic and avoid background ticks."""
    await asyncio.Event().wait()


def test_wave_without_a_key_answers_locally_and_never_contacts_the_provider(monkeypatch):
    """A missing key is a degraded mode, not a dead assistant.

    Wave used to 503 here, which left the demo silent for reasons a visitor
    cannot fix. He now answers from the run snapshot and says so.
    """
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
        assert status.json()["mode"] == "local"
        assert "OPENAI_API_KEY" in status.json()["detail"]
        assert "autonoc_session" not in client.cookies
        assert M._registry.count() == 0

        data = session_delta(client)
        response = client.post(
            "/api/wave/chat",
            json={"question": "How is the network?", "run_id": data["run_id"], "history": []},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["provider"] == "local"
        assert body["ai_connected"] is False
        assert body["run_id"] == data["run_id"]
        assert "Local mode" in body["answer"]
        assert "availability" in body["answer"]
        # The setup hint is about the deployment, never a credential value.
        assert "OPENAI_API_KEY" not in response.text
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
        first.post("/api/session"); second.post("/api/session")
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
        data = session_delta(client)
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
        data = session_delta(client)
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
    assert captured["payload"]["max_tokens"] == 1500
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
        data = session_delta(client)
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


def test_wave_chat_stream_still_streams_a_local_answer_without_a_key(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with TestClient(M.app) as client:
        data = session_delta(client)
        response = client.post(
            "/api/wave/chat/stream",
            json={
                "question": "What is O-RAN - Non-RT RIC?",
                "run_id": data["run_id"],
                "history": [],
            },
        )
        body = response.text
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")
        assert "Local mode" in body
        assert "Non-RT RIC" in body
        assert "event: done" in body
        assert '"provider": "local"' in body
        assert "event: error" not in body


def test_wave_chat_stream_maps_mid_flight_provider_errors(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-openai-key-not-a-credential")
    wave_ai._rate_limiter.clear()

    def fake_stream(payload, supplied_key, timeout, emit):
        emit(("delta", "Partial "))
        return ("status", 429, {"retry-after": "7"})

    monkeypatch.setattr(wave_ai, "_provider_stream_call", fake_stream)
    with TestClient(M.app) as client:
        data = session_delta(client)
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


def test_wave_chat_accepts_a_long_earlier_answer_as_history(monkeypatch):
    """Regression: a single long answer used to poison every later question.

    The browser echoes Wave's own replies back as conversation history. When
    the request schema capped a turn at 1200 characters while Wave's answers
    may be 4000, the next question failed FastAPI validation with an opaque
    HTTP 422 — for the rest of that conversation, on any topic. That looked
    like Wave refusing to answer, so the ceiling now covers a full answer.
    """
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    received: list[str] = []

    async def fake_answer(question, snapshot, *, session_id, history):
        received.extend(turn["content"] for turn in history)
        return {
            "answer": "Explained.",
            "provider": "openai",
            "model": "test-model",
            "ai_connected": True,
            "run_id": snapshot["run_id"],
            "tick": snapshot["tick"],
            "sim_time": snapshot["kpis"]["sim_time"],
        }

    monkeypatch.setattr(M, "answer_wave_question", fake_answer)
    long_answer = "Z" * 3000

    with TestClient(M.app) as client:
        data = session_delta(client)
        response = client.post(
            "/api/wave/chat",
            json={
                "question": "what is O-RAN - Non-RT RIC?",
                "run_id": data["run_id"],
                "history": [
                    {"role": "user", "content": "How is power?"},
                    {"role": "assistant", "content": long_answer},
                ],
            },
        )

    assert response.status_code == 200, response.text
    assert received == ["How is power?", long_answer]


def test_wave_chat_still_bounds_an_oversized_turn_and_history(monkeypatch):
    """The ceiling is generous, not absent: hostile payloads stay rejected."""
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-openai-key-not-a-credential")
    wave_ai._rate_limiter.clear()

    with TestClient(M.app) as client:
        data = session_delta(client)
        too_long = client.post(
            "/api/wave/chat",
            json={
                "question": "Status?",
                "run_id": data["run_id"],
                "history": [{"role": "assistant", "content": "z" * 8001}],
            },
        )
        too_many = client.post(
            "/api/wave/chat",
            json={
                "question": "Status?",
                "run_id": data["run_id"],
                "history": [{"role": "user", "content": "hi"}] * 9,
            },
        )

    assert too_long.status_code == 422
    assert too_many.status_code == 422


def test_provider_outage_degrades_to_a_local_answer(monkeypatch):
    """A provider 5xx must not end the conversation."""
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-openai-key-not-a-credential")
    wave_ai._rate_limiter.clear()
    monkeypatch.setattr(
        wave_ai,
        "_provider_http_call",
        lambda *_args, **_kwargs: (503, {"error": {"message": "upstream down"}}, {}),
    )

    with TestClient(M.app) as client:
        data = session_delta(client)
        response = client.post(
            "/api/wave/chat",
            json={
                "question": "Are there any active power problems?",
                "run_id": data["run_id"],
                "history": [],
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "local"
    assert body["ai_connected"] is False
    assert "Local mode" in body["answer"]
    assert "provider is unreachable" in body["answer"]
    assert "Power snapshot" in body["answer"]


def test_a_run_restart_is_answered_instead_of_refused(monkeypatch):
    """A Day-30 rollover between poll and question used to be a hard 409."""
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-openai-key-not-a-credential")
    wave_ai._rate_limiter.clear()

    def fake_http(_payload, _key, _timeout):
        return 200, {"choices": [{"message": {"content": "Grounded in the new run."}}]}, {}

    monkeypatch.setattr(wave_ai, "_provider_http_call", fake_http)
    with TestClient(M.app) as client:
        data = session_delta(client)
        restart = client.post(
            "/api/wave/chat",
            json={"question": "Status?", "run_id": "stale-run-id", "history": []},
        )
        stream = client.post(
            "/api/wave/chat/stream",
            json={"question": "Status?", "run_id": "stale-run-id", "history": []},
        )

    assert restart.status_code == 200
    assert restart.json()["run_restarted"] is True
    assert restart.json()["run_id"] == data["run_id"]
    assert restart.json()["answer"] == "Grounded in the new run."
    assert stream.status_code == 200
    assert '"run_restarted": true' in stream.text


def test_a_mid_stream_provider_failure_before_any_text_goes_local(monkeypatch):
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-openai-key-not-a-credential")
    wave_ai._rate_limiter.clear()

    def fake_stream(_payload, _key, _timeout, _emit):
        return ("status", 503, {})

    monkeypatch.setattr(wave_ai, "_provider_stream_call", fake_stream)
    with TestClient(M.app) as client:
        data = session_delta(client)
        response = client.post(
            "/api/wave/chat/stream",
            json={"question": "How is the network?", "run_id": data["run_id"], "history": []},
        )

    assert response.status_code == 200
    assert "event: error" not in response.text
    assert "Local mode" in response.text
    assert '"provider": "local"' in response.text
    assert "event: done" in response.text


def test_our_own_rate_limit_is_still_a_refusal(monkeypatch):
    """Abuse controls stay hard errors: a busy dashboard waits its turn."""
    monkeypatch.setattr(M, "simulation_loop", idle_simulation_loop)
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-openai-key-not-a-credential")
    monkeypatch.setenv("WAVE_AI_RATE_LIMIT_PER_MINUTE", "1")
    wave_ai._rate_limiter.clear()

    def fake_http(_payload, _key, _timeout):
        return 200, {"choices": [{"message": {"content": "ok"}}]}, {}

    monkeypatch.setattr(wave_ai, "_provider_http_call", fake_http)
    with TestClient(M.app) as client:
        data = session_delta(client)
        body = {"question": "Status?", "run_id": data["run_id"], "history": []}
        assert client.post("/api/wave/chat", json=body).status_code == 200
        limited = client.post("/api/wave/chat", json=body)

    assert limited.status_code == 429
    assert limited.json()["code"] == "wave_rate_limited"
    assert "ask again" in limited.json()["detail"]
    assert int(limited.headers["Retry-After"]) >= 1

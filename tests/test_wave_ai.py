"""Wave provider boundary, session grounding and non-invention guarantees."""
from __future__ import annotations

import asyncio
import json

import pytest

from autonoc.api import wave_ai
from autonoc.engine import config as C


def snapshot(*, ai_enabled: bool = False) -> dict:
    return {
        "tick": 12,
        "run_id": "run-wave-test",
        "control": {"paused": True},
        "kpis": {
            "sim_time": "D1 01:00",
            "availability": 99.4,
            "healthy": 290,
            "power": 2,
            "grid_failures": 1,
            "fuel_thefts": 0,
        },
        "dashboard": {
            "current": {
                "sim_time": "D1 01:00",
                "availability": 99.4,
                "online": 290,
                "degraded": 8,
                "offline": 2,
                "throughput_gbps": 12.5,
                "prb": 41.2,
                "drop_rate": 0.3,
            },
            "history": [
                {
                    "tick": 10,
                    "sim_time": "D1 00:50",
                    "availability": 99.6,
                    "incidents": 1,
                    "throughput_gbps": 12.8,
                    "prb": 39.0,
                    "offline": 1,
                    "degraded": 6,
                },
                {
                    "tick": 12,
                    "sim_time": "D1 01:00",
                    "availability": 99.4,
                    "incidents": 2,
                    "throughput_gbps": 12.5,
                    "prb": 41.2,
                    "offline": 2,
                    "degraded": 8,
                },
            ],
            "incidents": [
                {
                    "severity": "MAJOR",
                    "node_id": "S001",
                    "title": "Power failure",
                    "detail": "Backup battery is active.",
                    "affected": 1,
                    "since_tick": 11,
                    "dispatched": False,
                }
            ],
            "forecast": {
                "node_id": "S009",
                "probability": 0.82,
                "label": "Thermal Overheat",
            },
            "actionable_predictions": 1,
            "power": [{"name": "Grid", "count": 278, "fraction": 0.9267}],
            "active_ats": 1,
            "fuel_thefts": 0,
        },
        "agg": [{"id": 0, "name": "Bakrajo"}],
        "nodes": [
            {
                "id": "S001",
                "agg": 0,
                "status": C.STATUS_POWER,
                "critical": True,
                "power": "Battery",
                "ats": True,
                "battery": 34.2,
                "fuel": 88.0,
                "throughput": 1.1,
                "prb": 64.0,
                "loss": 0.8,
                "temp": 29.0,
                "cpu": 55.0,
                "warn": True,
                "dispatched": False,
                "repairing": False,
            },
            {
                "id": "S009",
                "agg": 0,
                "status": C.STATUS_HEALTHY,
                "critical": False,
                "power": "Grid",
                "ats": False,
                "battery": 99.0,
                "fuel": 100.0,
                "throughput": 4.2,
                "prb": 31.0,
                "loss": 0.1,
                "temp": 26.0,
                "cpu": 30.0,
                "warn": True,
                "dispatched": False,
                "repairing": False,
            },
        ],
        "teams": [
            {
                "id": 1,
                "name": "Team 1",
                "skill": "POWER",
                "state": "IDLE",
                "available": True,
                "target": None,
                "eta": 0,
                "missions": 2,
            }
        ],
        "logs": [
            {
                "tick": 11,
                "time": "D1 00:55",
                "severity": "MAJOR",
                "message": "S001 entered Power Failure",
                "node_id": "S001",
            }
        ],
        "ai": {
            "ai_enabled": ai_enabled,
            "ai_mode": "ml" if ai_enabled else "off",
            "pending": [
                {
                    "node_id": "S009",
                    "probability": 0.82,
                    "label": "Thermal Overheat",
                    "action": "inspect cooling",
                    "tier": 2,
                    "state": "pending",
                }
            ],
        },
    }


def test_provider_status_requires_key_and_successful_request(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    missing = wave_ai.provider_status()
    assert missing["status"] == "missing_key"
    assert missing["configured"] is False
    assert missing["verified"] is False
    assert "OPENAI_API_KEY" in missing["detail"]
    assert "api_key" not in {name.casefold() for name in missing}

    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-key-not-a-credential")
    pending = wave_ai.provider_status()
    assert pending["status"] == "not_verified"
    assert pending["configured"] is True
    assert pending["verified"] is False


def test_missing_key_fails_without_contacting_provider(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(
        wave_ai,
        "_openai_http_call",
        lambda *_args, **_kwargs: pytest.fail("provider must not be called without a key"),
    )

    with pytest.raises(wave_ai.WaveAIError) as error:
        asyncio.run(
            wave_ai.answer_question("What is happening?", snapshot(), session_id="no-key-test")
        )
    assert error.value.status_code == 503
    assert error.value.code == "wave_ai_missing_key"
    assert "OPENAI_API_KEY" in error.value.detail


def test_context_uses_session_snapshot_and_does_not_promote_disabled_predictions():
    context = wave_ai.build_context(snapshot(ai_enabled=False), "What is S001 doing?")

    assert context["source"] == "SuliNOC deterministic network simulation"
    assert context["is_live_operator_network"] is False
    assert context["simulation"]["tick"] == 12
    assert context["simulation"]["paused"] is True
    assert context["current_incidents"]["active_count"] == 1
    assert context["current_incidents"]["items"][0]["site_id"] == "S001"
    assert context["predictor"]["enabled"] is False
    assert context["predictor"]["mode"] == "off"
    assert context["predictor"]["highest_displayed_risk"] is None
    assert context["predictor"]["pending_actions"] == []
    assert context["sites_relevant_to_question_or_attention"][0]["id"] == "S001"
    assert context["sites_relevant_to_question_or_attention"][0]["status"] == "Power Failure"
    assert context["sites_relevant_to_question_or_attention"][0]["commander_warning"] is None
    assert any("not present" in note for note in context["data_window_notes"])


def test_enabled_predictions_are_labelled_separately_from_observations():
    context = wave_ai.build_context(snapshot(ai_enabled=True), "What does the predictor say?")
    assert context["predictor"]["enabled"] is True
    assert context["predictor"]["mode"] == "ml"
    assert context["predictor"]["highest_displayed_risk"]["node_id"] == "S009"
    assert context["predictor"]["pending_actions"][0]["site_id"] == "S009"
    s009 = next(
        site for site in context["sites_relevant_to_question_or_attention"]
        if site["id"] == "S009"
    )
    assert s009["commander_warning"] is True


def test_context_marks_bounded_incident_site_log_and_pending_lists():
    data = snapshot(ai_enabled=True)
    data["nodes"] = [
        {
            **data["nodes"][0],
            "id": f"S{index:03d}",
            "critical": False,
            "ats": False,
            "warn": False,
        }
        for index in range(13)
    ]
    data["dashboard"]["incidents"] = [
        {
            "severity": "MAJOR",
            "node_id": f"S{index:03d}",
            "title": f"Incident {index}",
            "detail": "Current simulated event.",
            "affected": 1,
            "since_tick": 1,
            "dispatched": False,
        }
        for index in range(17)
    ]
    data["logs"] = [
        {
            "tick": index,
            "time": f"D1 00:{index:02d}",
            "severity": "INFO",
            "message": f"Event {index}",
            "node_id": f"S{index:03d}",
        }
        for index in range(61)
    ]
    data["ai"]["pending"] = [
        {"node_id": f"S{index:03d}", "probability": 0.5, "label": "Risk"}
        for index in range(9)
    ]

    context = wave_ai.build_context(data, "Summarize Bakrajo.")
    assert len(context["sites_relevant_to_question_or_attention"]) == 12
    assert context["sites_truncated"] is True
    assert context["current_incidents"]["active_count"] == 17
    assert context["current_incidents"]["truncated"] is True
    assert len(context["current_incidents"]["items"]) == 16
    assert len(context["recent_event_log"]) == 12
    assert context["recent_event_log_truncated"] is True
    assert context["api_delta_event_log_at_limit"] is True
    assert context["event_log_entries_available"] == 61
    assert context["predictor"]["pending_action_count"] == 9
    assert context["predictor"]["pending_actions_truncated"] is True
    assert len(context["predictor"]["pending_actions"]) == 8


def test_successful_provider_call_is_the_only_way_to_mark_connected(monkeypatch):
    key = "unit-test-key-success-not-a-credential"
    monkeypatch.setenv("OPENAI_API_KEY", key)
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    wave_ai._rate_limiter.clear()
    captured: dict = {}

    def fake_http(payload, supplied_key, timeout):
        captured.update(payload=payload, key=supplied_key, timeout=timeout)
        return 200, {"choices": [{"message": {"content": "Observed simulated state."}}]}, {}

    monkeypatch.setattr(wave_ai, "_openai_http_call", fake_http)
    assert wave_ai.provider_status()["status"] == "not_verified"
    result = asyncio.run(
        wave_ai.answer_question(
            "What is happening at S001?",
            snapshot(),
            session_id="success-session",
            history=[{"role": "user", "content": "Tell me about power."}],
        )
    )

    assert result["answer"] == "Observed simulated state."
    assert result["ai_connected"] is True
    assert result["provider"] == "openai"
    assert result["run_id"] == "run-wave-test"
    assert result["tick"] == 12
    assert captured["key"] == key
    assert key not in json.dumps(captured["payload"])
    assert captured["payload"]["model"] == "test-model"
    assert "tools" not in captured["payload"]
    sent = json.dumps(captured["payload"]["messages"], ensure_ascii=False)
    user_context = captured["payload"]["messages"][-1]["content"]
    assert "SuliNOC deterministic network simulation" in sent
    assert '"is_live_operator_network":false' in user_context
    assert '"tick":12' in user_context
    assert wave_ai.provider_status()["status"] == "connected"
    assert key not in json.dumps(wave_ai.provider_status())
    assert key not in json.dumps(result)


@pytest.mark.parametrize(
    ("status", "headers", "expected_status", "code"),
    [
        (401, {}, 503, "wave_ai_auth_failed"),
        (429, {"Retry-After": "9"}, 429, "wave_ai_provider_rate_limited"),
        (503, {}, 503, "wave_ai_unavailable"),
    ],
)
def test_provider_errors_are_sanitized(status, headers, expected_status, code, monkeypatch):
    key = f"unit-test-provider-error-{status}"
    monkeypatch.setenv("OPENAI_API_KEY", key)
    monkeypatch.setenv("OPENAI_MODEL", "error-test-model")
    wave_ai._rate_limiter.clear()
    monkeypatch.setattr(
        wave_ai,
        "_openai_http_call",
        lambda *_args, **_kwargs: (status, {"error": {"message": key}}, headers),
    )

    with pytest.raises(wave_ai.WaveAIError) as error:
        asyncio.run(
            wave_ai.answer_question("How is power?", snapshot(), session_id=f"error-{status}")
        )
    assert error.value.status_code == expected_status
    assert error.value.code == code
    assert key not in error.value.detail
    if status == 429:
        assert error.value.headers["Retry-After"] == "9"
    assert wave_ai.provider_status()["status"] == "unavailable"


def test_rate_limiter_is_per_session_and_expires_the_window():
    limiter = wave_ai._SessionRateLimiter()
    assert limiter.consume("a", limit=2, now=0.0) is None
    assert limiter.consume("a", limit=2, now=1.0) is None
    assert limiter.consume("a", limit=2, now=2.0) == 58
    assert limiter.consume("b", limit=2, now=2.0) is None
    assert limiter.consume("a", limit=2, now=60.1) is None


def test_global_rate_limit_bounds_public_api_key_usage(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-global-rate-key")
    monkeypatch.setenv("WAVE_AI_RATE_LIMIT_PER_MINUTE", "8")
    monkeypatch.setenv("WAVE_AI_GLOBAL_RATE_LIMIT_PER_MINUTE", "1")
    wave_ai._rate_limiter.clear()
    calls = 0

    def fake_http(_payload, _key, _timeout):
        nonlocal calls
        calls += 1
        return 200, {"choices": [{"message": {"content": "ok"}}]}, {}

    monkeypatch.setattr(wave_ai, "_openai_http_call", fake_http)
    asyncio.run(wave_ai.answer_question("first", snapshot(), session_id="global-a"))
    with pytest.raises(wave_ai.WaveAIError) as error:
        asyncio.run(wave_ai.answer_question("second", snapshot(), session_id="global-b"))

    assert error.value.status_code == 429
    assert error.value.code == "wave_global_rate_limited"
    assert calls == 1
    assert wave_ai.provider_status()["status"] == "connected"

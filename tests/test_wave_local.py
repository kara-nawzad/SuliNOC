"""Unit tests for Wave's deterministic, offline answer path."""
from __future__ import annotations

from autonoc.api import wave_local


def context():
    return {
        "simulation": {"tick": 42, "sim_time": "D1 12:00", "paused": False},
        "network_structure": {
            "clusters": [
                {"name": "Cluster 1", "sites": 100},
                {"name": "Cluster 2", "sites": 100},
                {"name": "Cluster 3", "sites": 100},
            ],
            "o_ran": {
                "rapp_roles": {
                    "doctor": "RCA rApp — 3GPP PM/FM correlation",
                    "oracle": "Predictive Maintenance rApp — time-series telemetry",
                }
            },
        },
        "aggregate_kpis": {
            "availability_pct": 97.81,
            "in_service_sites": 293,
            "power_failure_sites": 1,
            "sites_without_grid_power": 2,
            "active_field_crews": 2,
        },
        "current_telemetry": {
            "sim_time": "D1 12:00",
            "availability_pct": 97.81,
            "throughput_gbps": 37.01,
            "prb_pct": 41.2,
        },
        "current_incidents": {
            "active_count": 1,
            "items": [
                {
                    "severity": "MAJOR",
                    "site_id": "SLY-eNB-072",
                    "title": "VSWR alarm",
                    "detail": "Feedline mismatch",
                    "since_tick": 30,
                    "crew_dispatched": True,
                }
            ],
            "truncated": False,
        },
        "power": {
            "distribution": [{"name": "Grid", "count": 269}, {"name": "Battery", "count": 31}],
            "active_ats_failures": 1,
            "run_total_fuel_theft_events": 0,
        },
        "predictor": {"enabled": True, "mode": "ml", "actionable_forecast_count": 2,
                      "pending_action_count": 1,
                      "pending_actions": [{"site_id": "SLY-eNB-009", "label": "Thermal Overheat",
                                           "probability": 0.82, "tier": 2,
                                           "action": "inspect cooling"}]},
        "crews": [
            {"name": "Crew 2", "skill": "RF", "state": "EN_ROUTE",
             "target_site": "SLY-eNB-072", "eta_ticks": 4, "available": False}
        ],
        "sites_relevant_to_question_or_attention": [
            {
                "id": "SLY-eNB-072",
                "district": "Goizha Mountain",
                "cluster": 1,
                "ring": 2,
                "status": "Warning",
                "power_source": "Grid",
                "ats_failure_active": False,
                "battery_pct": 88.0,
                "fuel_pct": 64.0,
                "throughput_gbps": 0.42,
                "prb_pct": 33.0,
                "packet_loss_pct": 0.4,
                "temperature_c": 41.0,
                "crew_dispatched": True,
                "repair_in_progress": False,
            }
        ],
        "recent_telemetry_samples": [
            {"tick": 36, "availability_pct": 98.0, "throughput_gbps": 38.2,
             "prb_pct": 39.0, "incidents": 0},
            {"tick": 42, "availability_pct": 97.81, "throughput_gbps": 37.01,
             "prb_pct": 41.2, "incidents": 1},
        ],
        "recent_event_log": [],
    }


def test_every_answer_says_why_it_is_local():
    body = wave_local.answer("How is the network?", context(), code="wave_ai_missing_key")
    assert body.startswith("*(Local mode")
    assert "no provider API key" in body


def test_status_question_reports_the_snapshot_numbers():
    body = wave_local.answer("How is the network right now?", context(), code="")
    assert "97.81 %" in body
    assert "293/300" in body
    assert "1 active incident" in body


def test_site_question_answers_from_the_supplied_site():
    body = wave_local.answer("What is wrong with SLY-eNB-072?", context())
    assert "SLY-eNB-072" in body
    assert "Goizha Mountain" in body
    assert "Crew dispatched." in body


def test_incident_question_lists_alarms():
    body = wave_local.answer("Any active incidents?", context())
    assert "MAJOR" in body
    assert "SLY-eNB-072" in body
    assert "crew dispatched" in body


def test_power_question_beats_the_generic_incident_intent():
    body = wave_local.answer("Are there any active power problems?", context())
    assert "Power snapshot" in body
    assert "31" in body  # battery count in the power mix


def test_crew_question_uses_the_roster():
    body = wave_local.answer("Which crews are dispatched?", context())
    assert "Crew 2" in body
    assert "EN_ROUTE" in body
    assert "SLY-eNB-072" in body


def test_trend_question_compares_the_bounded_window():
    body = wave_local.answer("Compare recent telemetry and explain the trend", context())
    assert "last 2 samples" in body
    assert "98.00 %" in body and "97.81 %" in body


def test_predictor_question_respects_the_enabled_flag():
    body = wave_local.answer("What is the forecast?", context())
    assert "SLY-eNB-009" in body
    assert "Thermal Overheat" in body
    disabled = wave_local.answer(
        "What is the forecast?", {**context(), "predictor": {"enabled": False}}
    )
    assert "**off**" in disabled


def test_o_ran_question_explains_the_concept_and_the_rapp_mapping():
    body = wave_local.answer("what is O-RAN - Non-RT RIC?", context())
    assert "Non-RT RIC" in body
    assert "A1" in body
    assert "RCA rApp" in body


def test_unknown_questions_are_honest_about_the_limit():
    body = wave_local.answer("Write me a poem about cats", context())
    assert "can't reach the live model" in body
    assert "SLY-eNB-072" in body or "availability" in body  # still gives the headline
    assert "Try me on" in body


def test_recoverable_codes_cover_provider_failures_but_not_our_limits():
    assert "wave_ai_missing_key" in wave_local.RECOVERABLE_CODES
    assert "wave_ai_unavailable" in wave_local.RECOVERABLE_CODES
    assert "wave_rate_limited" not in wave_local.RECOVERABLE_CODES
    assert "wave_context_too_large" not in wave_local.RECOVERABLE_CODES

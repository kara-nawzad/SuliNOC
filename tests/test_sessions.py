"""Anonymous browser sessions are isolated, bounded and always recoverable.

The "at capacity" lockout came from two rules that were individually reasonable
and together unrecoverable: only a handful of slots, and a flat refusal once
they were taken. These tests pin the recovery paths — a quiet dashboard is
reclaimed, a waiting visitor is never refused, and probes/crawlers/assets never
consume a dashboard slot at all.
"""
import time

import pytest

from autonoc.api.sessions import (Session, SessionCapacityError, SessionRegistry,
                                  requires_session)


class FakeWorker:
    def __init__(self):
        self.stops = 0

    def stop(self):
        self.stops += 1


def build_registry(**kwargs):
    """Registry with lightweight sessions (no engines, no threads)."""
    created: list[Session] = []
    dropped: list[Session] = []

    def factory(token: str) -> Session:
        session = Session(token, object(), object(), 1.0, object(), token,
                          worker=FakeWorker())
        created.append(session)
        return session

    registry = SessionRegistry(factory, on_drop=dropped.append, **kwargs)
    return registry, created, dropped


# ------------------------------------------------------------- live dashboard
def test_two_browser_clients_have_independent_controls():
    from fastapi.testclient import TestClient
    from autonoc.api import main as M

    with TestClient(M.app) as first:
        second = TestClient(M.app)
        a = first.get("/api/data"); b = second.get("/api/data")
        assert a.status_code == b.status_code == 200
        da, db = a.json(), b.json()
        assert da["run_id"] != db["run_id"]
        run_a, run_b = da["run_id"], db["run_id"]
        node = da["nodes"][0]["id"]
        assert first.post("/api/control/speed", params={"value": 4, "run_id": run_a}).status_code == 200
        assert first.post("/api/control/pause", params={"run_id": run_a}).status_code == 200
        assert first.post("/api/control/ai", params={"enabled": "true", "run_id": run_a}).status_code == 200
        assert first.post("/api/control/inject", params={"node_id": node, "kind": 3, "run_id": run_a}).status_code == 200
        a2, b2 = first.get("/api/data").json(), second.get("/api/data").json()
        assert a2["control"]["speed"] == 4 and a2["control"]["paused"]
        assert a2["ai"]["ai_enabled"] is True
        assert b2["control"]["speed"] == 1 and not b2["control"]["paused"]
        assert b2["ai"]["ai_enabled"] is False
        assert next(n for n in a2["nodes"] if n["id"] == node)["status"] == 3
        assert next(n for n in b2["nodes"] if n["id"] == node)["status"] != 3
        assert second.post("/api/control/pause", params={"run_id": run_a}).status_code == 409


# ------------------------------------------------------------------ capacity
def test_idle_sessions_expire_and_free_the_slot():
    registry, created, dropped = build_registry(max_sessions=1, idle_timeout=30.0)
    first, is_new = registry.get(None)
    assert is_new and registry.count() == 1
    first.last_seen = time.monotonic() - 31          # that tab was closed
    second, is_new = registry.get(None)
    assert is_new and second.token != first.token
    assert registry.count() == 1
    assert dropped == [first]
    assert first.worker.stops == 1


def test_capacity_reclaims_a_session_that_went_quiet():
    registry, created, dropped = build_registry(max_sessions=2, reclaim_grace=15.0)
    first, _ = registry.get(None)
    second, _ = registry.get(None)
    # Every dashboard is still polling: refusing a newcomer is correct here.
    with pytest.raises(SessionCapacityError) as refusal:
        registry.get(None)
    assert "capacity" in str(refusal.value)
    assert refusal.value.retry_after > 0
    first.last_seen = time.monotonic() - 60          # ...but that one went quiet
    third, is_new = registry.get(None)
    assert is_new and third.token not in {first.token, second.token}
    assert registry.count() == 2
    assert dropped == [first]
    assert first.worker.stops == 1


def test_waiting_visitor_always_gets_a_dashboard():
    """The retry path may adopt a busy session; a refusal must never stick."""
    registry, created, dropped = build_registry(max_sessions=1, reclaim_grace=600.0)
    busy, _ = registry.get(None)
    with pytest.raises(SessionCapacityError):
        registry.get(None)
    adopted, is_new = registry.get_or_default(None)
    assert is_new and adopted.token != busy.token
    assert registry.count() == 1
    assert dropped == [busy]


def test_capacity_can_be_turned_off_for_pinned_deployments():
    registry, created, _ = build_registry(max_sessions=1, reclaim=False)
    registry.get(None)
    with pytest.raises(SessionCapacityError):
        registry.get(None)
    # Even a hard cap stays escapable for a visitor who is waiting.
    assert registry.get_or_default(None)[1] is True
    assert registry.count() == 1


def test_cookie_tokens_are_not_client_selected_ids():
    registry, created, _ = build_registry(max_sessions=3)
    a, _ = registry.get(None)
    b, _ = registry.get(None)
    assert a.token != b.token
    # A token resolves only to its own record; an arbitrary client value does not.
    c, new = registry.get("not-a-real-token")
    assert new and c.token not in {a.token, b.token}


def test_health_reports_live_capacity():
    registry, _, _ = build_registry(max_sessions=7, idle_timeout=90.0,
                                    reclaim_grace=5.0)
    registry.get(None)
    stats = registry.stats()
    assert stats == {"active": 1, "max": 7, "idle_timeout_seconds": 90.0,
                     "reclaim_grace_seconds": 5.0, "reclaim_enabled": True,
                     "reclaimed": 0}


def test_retiring_a_session_releases_its_summary_directory(tmp_path):
    from autonoc.api import main as M

    summary_root = tmp_path / "sessions" / "abc123"
    summary_root.mkdir(parents=True)
    (summary_root / "run_summaries.sqlite3").write_text("x")
    session = Session("abc123", object(), object(), 1.0, object(), "run",
                      data_dir=str(summary_root))
    M._drop_session_assets(session)
    assert not summary_root.exists()


# --------------------------------------------------------------- slot owners
def test_only_api_traffic_needs_a_session():
    assert requires_session("/api/config") is True
    assert requires_session("/api/delta") is True
    assert requires_session("/api/control/pause") is True
    # Probes, the dashboard shell, crawlers and assets cannot keep a cookie,
    # so they must never hold a slot.
    assert requires_session("/api/health") is False
    assert requires_session("/") is False
    assert requires_session("/favicon.svg") is False
    assert requires_session("/static/app.js") is False
    assert requires_session("/assets/index-abc.js") is False


def test_health_checks_and_assets_never_consume_capacity(monkeypatch):
    from fastapi.testclient import TestClient
    from autonoc.api import main as M

    monkeypatch.setenv("AUTONOC_MAX_SESSIONS", "1")
    with TestClient(M.app) as client:
        for path in ("/api/health", "/", "/static/app.js", "/api/health"):
            assert client.get(path).status_code == 200, path
        assert M._registry.count() == 0
        assert "autonoc_session" not in client.cookies
        stats = client.get("/api/health").json()["sessions"]
        assert stats["active"] == 0 and stats["max"] == 1
        # Only real dashboard traffic takes the single available slot.
        assert client.get("/api/config").status_code == 200
        assert M._registry.count() == 1
        assert "autonoc_session" in client.cookies


def test_a_second_dashboard_reclaims_the_quiet_slot(monkeypatch):
    from fastapi.testclient import TestClient
    from autonoc.api import main as M

    monkeypatch.setenv("AUTONOC_MAX_SESSIONS", "1")
    monkeypatch.setenv("AUTONOC_SESSION_RECLAIM_GRACE", "0")
    with TestClient(M.app) as first:
        assert first.get("/api/config").status_code == 200
        second = TestClient(M.app)
        response = second.get("/api/delta?since=0")
        assert response.status_code == 200
        assert "autonoc_session" in second.cookies
        assert M._registry.count() == 1


def test_capacity_refusal_is_transient_and_the_retry_succeeds(monkeypatch):
    """The 503 stays reachable, documented and recoverable — never a dead end."""
    from fastapi.testclient import TestClient
    from autonoc.api import main as M

    monkeypatch.setenv("AUTONOC_MAX_SESSIONS", "1")
    monkeypatch.setenv("AUTONOC_SESSION_RECLAIM", "0")
    with TestClient(M.app) as first:
        assert first.get("/api/config").status_code == 200
        second = TestClient(M.app)
        refused = second.get("/api/delta?since=0")
        assert refused.status_code == 503
        assert refused.json()["code"] == "session_capacity"
        assert "at capacity" in refused.json()["detail"]
        assert "retry-after" in {key.lower() for key in refused.headers}
        # The dashboard marks its retry, so the visitor is served instead of
        # being told to close a dashboard they may not own.
        retry = second.get("/api/delta?since=0", headers={"X-AutoNOC-Retry": "1"})
        assert retry.status_code == 200
        assert "autonoc_session" in second.cookies
        assert M._registry.count() == 1

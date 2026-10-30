"""Warm engine pool: a handover must be a *fresh* world, only faster.

``NOCEngine()`` costs ~640 ms of CPU (300 sites, 30 days of timelines). Building
it inside a request froze every other dashboard, so worlds are built ahead of
time in a background thread. These tests pin the two properties that make that
safe: a pooled world is indistinguishable from a freshly built one (same seed,
never stepped), and handing it over never builds anything.
"""
from __future__ import annotations

import hashlib
import time

import pytest


def _fingerprint(engine) -> str:
    """Order-independent fingerprint of the physical state (as in test_invariants)."""
    rows = sorted(
        (n.node_id, round(n.rsrp, 6), round(n.speed_dl, 6) if hasattr(n, "speed_dl")
         else 0, round(n.temperature, 6), n.status)
        for n in engine.nodes
    )
    return hashlib.sha256(repr(rows).encode()).hexdigest()


def _drain_pool(monkeypatch) -> None:
    """Stop the refill thread and empty the pool, so a test starts from nothing."""
    from autonoc.api import main as M

    monkeypatch.setattr(M, "_WARM_ENGINES", 0)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and M._pool_building:
        with M._pool_lock:
            M._pool.clear()
        time.sleep(0.02)
    with M._pool_lock:
        M._pool.clear()


def _fill_pool(monkeypatch, size: int) -> None:
    from autonoc.api import main as M

    monkeypatch.setattr(M, "_WARM_ENGINES", size)
    M._refill_pool()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        with M._pool_lock:
            if len(M._pool) >= size and not M._pool_building:
                return
        time.sleep(0.05)
    raise AssertionError("warm pool did not fill in time")


def test_a_pooled_world_is_the_same_world_as_a_fresh_build(monkeypatch):
    from autonoc.api import main as M

    _drain_pool(monkeypatch)
    pooled = M._build_engine()
    fresh = M._build_engine()

    # Tick 0: identical to the last decimal, both handed out at tick 0.
    assert pooled.tick == fresh.tick == 0
    assert _fingerprint(pooled) == _fingerprint(fresh)

    # And the same evolution: a pooled world is not "ahead" of a fresh one.
    for _ in range(25):
        pooled.step()
        fresh.step()
    assert _fingerprint(pooled) == _fingerprint(fresh)
    assert pooled.tick == fresh.tick == 25


def _local_registry(monkeypatch, tmp_path, size: int = 4):
    """A registry wired to the real session factory, on a throwaway data dir."""
    from autonoc.api import main as M
    from autonoc.api.sessions import SessionRegistry

    monkeypatch.setenv("AUTONOC_DATA_DIR", str(tmp_path))
    return SessionRegistry(M._make_session, max_sessions=size)


def test_a_handover_from_the_pool_never_builds_a_world(monkeypatch, tmp_path):
    from autonoc.api import main as M

    _fill_pool(monkeypatch, 1)
    # Stop the refill thread for the handover window: it would build (correctly)
    # and this test is about what the *handover* does.
    monkeypatch.setattr(M, "_WARM_ENGINES", 0)
    registry = _local_registry(monkeypatch, tmp_path)
    builds = []
    real_build = M._build_engine

    def counting_build():
        builds.append(1)
        return real_build()

    monkeypatch.setattr(M, "_build_engine", counting_build)
    try:
        session, created = registry.get(None)
        assert created is True
        assert session.engine.tick == 0
        assert builds == [], "a warm handover must not build an engine"
        # And the pool tops itself back up, ready for the next visitor.
        monkeypatch.undo()
        monkeypatch.setenv("AUTONOC_DATA_DIR", str(tmp_path))
        M._WARM_ENGINES = 1
        M._refill_pool()
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline and len(M._pool) < 1:
            time.sleep(0.02)
        assert len(M._pool) >= 1, "the pool must refill after a handover"
    finally:
        registry.clear()
        monkeypatch.undo()
        _drain_pool(monkeypatch)


def test_three_new_visitors_are_served_from_the_warm_pool(monkeypatch, tmp_path):
    from autonoc.api import main as M

    _fill_pool(monkeypatch, 3)
    monkeypatch.setattr(M, "_WARM_ENGINES", 0)   # no refill during the handovers
    registry = _local_registry(monkeypatch, tmp_path)
    builds = []
    real_build = M._build_engine
    monkeypatch.setattr(M, "_build_engine",
                        lambda: (builds.append(1), real_build())[1])
    try:
        sessions = [registry.get(None)[0] for _ in range(3)]
        assert len({id(s.engine) for s in sessions}) == 3   # never the same world
        assert all(s.engine.tick == 0 for s in sessions)
        assert builds == [], "three warm visitors must not build anything"
    finally:
        registry.clear()
        monkeypatch.undo()
        _drain_pool(monkeypatch)


def test_the_pool_is_bounded_and_never_handed_out_twice(monkeypatch):
    from autonoc.api import main as M

    _drain_pool(monkeypatch)
    monkeypatch.setattr(M, "_WARM_ENGINES", 2)
    M._refill_pool()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline and len(M._pool) < 2:
        time.sleep(0.05)
    with M._pool_lock:
        assert len(M._pool) == 2

    first = M._take_warm_engine()
    second = M._take_warm_engine()
    assert first is not None and second is not None
    assert first is not second
    # Emptied: the next take falls back to a cold build rather than erroring.
    assert M._take_warm_engine() is None
    with M._pool_lock:
        assert len(M._pool) <= 2
    monkeypatch.undo()
    _drain_pool(monkeypatch)


def test_a_cold_claim_does_not_hold_the_registry_lock(monkeypatch):
    """The registry must stay readable while a world is being built.

    Holding the lock across ``factory`` would make every token lookup (which the
    event loop performs for unrelated requests) wait for a build.
    """
    from autonoc.api import sessions as sessions_mod

    gate = sessions_mod.threading.Event()
    finished = sessions_mod.threading.Event()

    class SlowRegistry(sessions_mod.SessionRegistry):
        def factory(self, token):                     # noqa: D401 - test double
            gate.set()
            finished.wait(5)
            return sessions_mod.Session(token, object(), sessions_mod.threading.Lock(),
                                        1.0, object(), token)

    registry = SlowRegistry(lambda token: None, max_sessions=4)
    registry.factory = SlowRegistry.__dict__["factory"].__get__(registry)

    import threading
    claim = threading.Thread(target=registry.get, args=(None,))
    claim.start()
    try:
        assert gate.wait(5), "the factory never started"
        started = time.perf_counter()
        assert registry.peek("nope") is None          # lock is free
        assert time.perf_counter() - started < 0.05
    finally:
        finished.set()
        claim.join(10)
    assert registry.count() == 1

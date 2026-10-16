"""Each browser visitor keeps their own simulation clock and speed.

These tests drive the real ``simulation_loop`` on a fake clock, so the
scheduling is checked exactly and does not depend on wall-clock timing.
A visitor at 10x must not speed up anyone else, pausing one visitor must not
stop the others, and a visitor who falls behind must not be stepped in bursts.
"""
from __future__ import annotations

import asyncio
import threading

import pytest

from autonoc.api import main as M
from autonoc.api.sessions import Session, SessionRegistry


class FakeClock:
    """Stands in for the ``time`` module inside the loop."""

    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def perf_counter(self):
        return self.now


class FakeEngine:
    def __init__(self, name):
        self.name = name
        self.paused = False
        self.tick = 0


class Harness:
    def __init__(self, monkeypatch):
        self.clock = FakeClock()
        self.steps: list[tuple[float, str]] = []   # (fake time, visitor) per advancing step
        self.stall: dict[str, float] = {}          # visitor -> seconds its next step takes
        self.actions: list[tuple[float, object]] = []
        self.end = None
        real_sleep = asyncio.sleep

        async def fake_sleep(delay, result=None):
            self.clock.now += max(float(delay), 0.0)
            while self.actions and self.clock.now >= self.actions[0][0]:
                _, fn = self.actions.pop(0)
                fn()
            if self.end is not None and self.clock.now >= self.end:
                raise asyncio.CancelledError()
            await real_sleep(0)

        def fake_step(automatic=True, expected_run_id=None):
            eng = M.engine
            if automatic and eng.paused:
                return {"advanced": False, "tick": eng.tick}
            self.steps.append((round(self.clock.now, 3), eng.name))
            eng.tick += 1
            self.clock.now += self.stall.pop(eng.name, 0.0)
            return {"advanced": True, "tick": eng.tick}

        # The loop reads module globals that _activate() rewrites. Snapshot them so
        # the test cannot leak a fake engine into other tests.
        for name in ("engine", "_lock", "_speed", "_slow_ticks", "_run_id",
                     "_reset_notice", "_run_error", "_history", "_summary_store", "worker"):
            monkeypatch.setattr(M, name, getattr(M, name))
        monkeypatch.setattr(M, "time", self.clock)
        monkeypatch.setattr(M.asyncio, "sleep", fake_sleep)
        monkeypatch.setattr(M, "_step_locked", fake_step)
        monkeypatch.setattr(M, "_gate", asyncio.Lock())
        monkeypatch.setattr(M, "_speed", 1.0)
        self.registry = SessionRegistry(lambda token: None, max_sessions=16, reclaim=False)
        monkeypatch.setattr(M, "_registry", self.registry)

    def add(self, name, speed=1.0):
        session = Session(token=name, engine=FakeEngine(name), lock=threading.Lock(),
                          speed=speed, history=None, run_id=f"{name}-run")
        self.registry._sessions[name] = session
        return session

    def at(self, when, fn):
        self.actions.append((when, fn))
        self.actions.sort(key=lambda item: item[0])

    def run(self, seconds):
        self.end = self.clock.now + seconds

        async def go():
            try:
                await M.simulation_loop()
            except asyncio.CancelledError:
                pass

        asyncio.run(go())

    def count(self, name, start=0.0, end=float("inf")):
        return sum(1 for t, who in self.steps if who == name and start <= t < end)

    def gaps(self, name, start=0.0):
        times = [t for t, who in self.steps if who == name and t >= start]
        return [b - a for a, b in zip(times, times[1:])]


@pytest.fixture
def harness(monkeypatch):
    return Harness(monkeypatch)


def test_each_visitor_runs_at_their_own_speed(harness):
    harness.add("A", speed=10.0)
    harness.add("B", speed=1.0)
    harness.run(10)
    # 10x is one tick every 0.1 s; 1x is one tick per second.
    assert abs(harness.count("A") - 100) <= 2
    assert abs(harness.count("B") - 10) <= 1


def test_changing_one_visitors_speed_leaves_others_alone(harness):
    a = harness.add("A", speed=1.0)
    harness.add("B", speed=1.0)
    harness.run(4)
    before_a, before_b = harness.count("A"), harness.count("B")
    a.speed = 10.0            # what POST /api/control/speed does for visitor A
    harness.run(4)
    assert abs(harness.count("B") - before_b - 4) <= 1
    assert harness.count("A") - before_a >= 35


def test_pausing_one_visitor_does_not_stop_the_others(harness):
    harness.add("A", speed=2.0)
    harness.add("B", speed=2.0)
    harness.at(2.0, lambda: setattr(harness.registry._sessions["A"].engine, "paused", True))
    harness.run(10)
    assert harness.count("A", start=2.05) == 0
    assert abs(harness.count("B") - 20) <= 2


def test_a_new_visitor_does_not_change_existing_clocks(harness):
    harness.add("B", speed=1.0)
    harness.run(5)
    b_first_half = harness.count("B")
    harness.add("C", speed=10.0)
    harness.add("D", speed=1.0)
    harness.run(5)
    b_second_half = harness.count("B") - b_first_half
    assert abs(b_first_half - 5) <= 1
    assert abs(b_second_half - 5) <= 1
    assert abs(harness.count("D") - 5) <= 1


def test_a_stalled_step_does_not_make_other_visitors_burst(harness):
    # The loop steps visitors one after another, so a slow step for B delays A.
    # When the loop catches up, A must get one step per second, not a burst.
    harness.add("A", speed=1.0)
    harness.add("B", speed=1.0)
    harness.stall["B"] = 3.0      # B's first step takes 3 s
    harness.run(10)
    for name in ("A", "B"):
        gaps = harness.gaps(name, start=3.0)
        assert gaps, f"{name} should keep running after the stall"
        assert min(gaps) >= 0.9, f"{name} stepped in a burst: gaps {gaps[:5]}"


def test_without_sessions_the_legacy_clock_still_runs(harness, monkeypatch):
    monkeypatch.setattr(M, "_registry", None)
    monkeypatch.setattr(M, "engine", FakeEngine("legacy"))
    monkeypatch.setattr(M, "_speed", 2.0)
    harness.run(4)
    assert 7 <= harness.count("legacy") <= 9      # 2x is one tick every 0.5 s


def test_loop_waits_while_a_request_holds_the_session_gate(harness):
    """A request that has activated a visitor holds the gate across its awaits.

    The loop must not switch the active visitor underneath it. This pins the fix
    for interleaving across awaits, which a threading lock on the event loop
    thread could not prevent.
    """
    harness.add("A", speed=1.0)
    harness.end = 3.0
    real_sleep = asyncio.sleep

    async def go():
        await M._gate.acquire()              # a request is mid-flight
        loop_task = asyncio.create_task(M.simulation_loop())
        for _ in range(200):                 # let the loop reach the gate
            await real_sleep(0)
        blocked_steps = len(harness.steps)
        M._gate.release()
        try:
            await asyncio.wait_for(loop_task, timeout=5)
        except asyncio.CancelledError:
            pass
        return blocked_steps

    blocked_steps = asyncio.run(go())
    assert blocked_steps == 0, "loop stepped a visitor while a request held the gate"
    assert harness.count("A") >= 2, "loop should resume once the gate is released"

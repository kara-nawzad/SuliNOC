"""
Power-fleet state machine and noise-uniformity guards.

The "Site power & fleet" donut showed Grid: 300 forever because
NoisePool.random() squashed a Gaussian around 0.5 — configured grid
dropout/restoration coins could never fire — and because update_power let
every architecture run on the mains regardless of its plant (A/B/C).

These tests pin the repaired contract:

  - NoisePool.random()/uniform() are genuinely uniform (event coins fire)
  - Type C (Goizha) is off-grid: Solar by day, Battery/DG at night, never Grid
  - Type A urban sites ride Grid -> Battery -> Generator, and only Type C
    gets the Solar branch (no phantom PV on urban rooftops)
  - grid dropout/restore fire at approximately the configured rates
  - the dashboard "power" slice tallies the live per-node power_source values
    (the donut contract the frontend renders)
"""
from __future__ import annotations

from collections import Counter

from autonoc.api import presentation as P
from autonoc.engine import config as C
from autonoc.engine import physics as PHY
from autonoc.engine.engine import NOCEngine
from autonoc.engine.noise import NoisePool


def _tier_node(engine: NOCEngine, agg_id: int):
    return next(n for n in engine.nodes if n.agg_id == agg_id)


# ------------------------------------------------------------------ noise
def test_noise_pool_random_is_uniform():
    """Decile buckets of NoisePool.random() must be ~flat.

    The old squash (0.5 + 0.5·(v/(1+|v|))) piled every draw near 0.5 and
    made P(x < 0.0045) indistinguishable from zero — the bug that froze the
    power-fleet donut at Grid: 300.
    """
    import random as _random

    pool = NoisePool(_random.Random(1234), size=16_384)
    n = 20_000
    buckets = [0] * 10
    small = 0
    for _ in range(n):
        x = pool.random()
        assert 0.0 <= x < 1.0
        buckets[min(9, int(x * 10))] += 1
        if x < 0.0045:
            small += 1
    expected = n / 10
    for count in buckets:
        assert abs(count - expected) < expected * 0.25, buckets
    # P(x < 0.0045) ≈ 0.0045 → ~90 draws in 20k; generous band, and the old
    # bug produced exactly 0.
    assert 20 <= small <= 250, small


def test_noise_pool_draw_order_is_deterministic():
    import random as _random

    def trace(seed: int):
        pool = NoisePool(_random.Random(seed), size=101)
        return [(pool.gauss(), pool.random()) for _ in range(50)]

    assert trace(7) == trace(7)
    assert trace(7) != trace(8)


# ------------------------------------------------------------------ Type C
def test_type_c_sites_are_off_grid_and_run_solar_by_day(monkeypatch):
    e = NOCEngine(seed=42)
    node = _tier_node(e, 0)                    # Goizha ridge -> Type C
    assert node.power_config == "C"

    PHY.update_power(node, 100, e.noise)       # 08:20 — inside solar window
    assert node.grid_available is False
    assert node.power_source == "Solar"

    PHY.update_power(node, 10, e.noise)        # 00:50 — dark
    assert node.power_source == "Battery"

    # crank the plant at the start threshold (transfer switch passes)
    monkeypatch.setattr(C, "ATS_CRANK_FAIL_CHANCE", 0.0)
    node.battery_pct = C.GEN_START_BATTERY_PCT
    node.generator_fuel_pct = 80.0
    e._power_events(node)
    assert node.dg_running
    PHY.update_power(node, 10, e.noise)
    assert node.power_source == "Generator"

    node.dg_running = False
    PHY.update_power(node, 100, e.noise)       # back to daylight
    assert node.power_source == "Solar"


def test_type_c_never_reports_grid_in_a_long_run():
    """Donut regression: over a full simulated day not one Goizha site may
    read Grid, and at least one must read Solar in daylight."""
    e = NOCEngine(seed=131)
    goizha = [n for n in e.nodes if n.agg_id == 0]
    assert goizha
    saw_solar = False
    for _ in range(C.TICKS_PER_DAY):
        e.step()
        for n in goizha:
            assert n.power_source != "Grid", (n.node_id, e.tick)
            if n.power_source == "Solar":
                saw_solar = True
    assert saw_solar


# ------------------------------------------------------------------ Type A/B
def test_type_a_sites_stay_on_grid_or_ride_backup_chain(monkeypatch):
    e = NOCEngine(seed=42)
    node = _tier_node(e, 2)                    # Salim Street -> Type A
    assert node.power_config == "A"

    # pin the mains state so the chain is deterministic, outage included
    monkeypatch.setattr(C, "GRID_DROPOUT_CHANCE",
                        {k: 0.0 for k in C.GRID_DROPOUT_CHANCE})
    monkeypatch.setattr(C, "GRID_RESTORE_CHANCE",
                        {k: 0.0 for k in C.GRID_RESTORE_CHANCE})
    node.grid_available = True

    PHY.update_power(node, 100, e.noise)       # daylight, mains up
    assert node.power_source == "Grid"

    # force an outage to persist so the chain is observable: no phantom Solar
    # on an urban site without PV.
    node.grid_available = False
    node.battery_pct = 80.0
    PHY.update_power(node, 100, e.noise)
    assert node.power_source == "Battery"

    # crank the plant at the start threshold (transfer switch passes)
    monkeypatch.setattr(C, "ATS_CRANK_FAIL_CHANCE", 0.0)
    node.battery_pct = C.GEN_START_BATTERY_PCT
    node.generator_fuel_pct = 80.0
    e._power_events(node)
    assert node.dg_running
    PHY.update_power(node, 100, e.noise)
    assert node.power_source == "Generator"


def test_grid_dropout_and_restore_fire_at_configured_rates():
    """The coin that froze the donut. Bakrajo (UNSTABLE) nodes over 2,000
    ticks must actually cycle off the mains, at a rate within a wide band of
    GRID_DROPOUT_CHANCE — the old non-uniform helper produced zero events."""
    e = NOCEngine(seed=42)
    bakrajo = [n for n in e.nodes if n.agg_id == 5 and n.power_config == "B"]
    assert bakrajo
    dropouts = 0
    restores = 0
    prev = {n.node_id: n.grid_available for n in bakrajo}
    for _ in range(2_000):
        e.step()
        for n in bakrajo:
            now = n.grid_available
            if prev[n.node_id] and not now:
                dropouts += 1
            elif not prev[n.node_id] and now:
                restores += 1
            prev[n.node_id] = now
    expected = 2_000 * len(bakrajo) * C.GRID_DROPOUT_CHANCE["UNSTABLE"]
    assert dropouts > 0
    assert expected * 0.25 <= dropouts <= expected * 4.0, \
        (dropouts, expected)
    assert restores > 0


# ------------------------------------------------------------------ donut contract
def test_dashboard_power_slice_tallies_live_sources():
    """presentation.dashboard()['power'] must be the live Counter of
    node.power_source — the numbers the React donut and legend render."""
    e = NOCEngine(seed=131)
    for _ in range(60):
        e.step()
    history = P.History()
    history.reset(e)
    payload = P.dashboard(e, history)
    live = Counter(n.power_source for n in e.nodes)
    by_name = {row["name"]: row for row in payload["power"]}
    assert set(by_name) == {"Grid", "Solar", "Battery", "Generator"}
    total = 0
    for name, row in by_name.items():
        assert row["count"] == live.get(name, 0)
        assert abs(row["fraction"] - row["count"] / len(e.nodes)) < 1e-9
        total += row["count"]
    assert total == len(e.nodes) == 300
    # seed 131 after 60 ticks is daytime (tick 60, solar window from 48):
    # the Goizha Type C fleet must be on Solar in the tally.
    assert by_name["Solar"]["count"] >= 1

"""
Deterministic gaussian noise pool — plus a true-uniform pool.

Profiling showed random.gauss() dominating the tick: 595,297 calls across 200
ticks, roughly 10 per node per tick, at 0.527 s of a 3.0 s profile.

A pool of pre-drawn unit-normal samples turns each draw into an index lookup
and a multiply. Determinism is preserved exactly: both pools are filled once
from the seeded stream, and consumption is a single monotonically increasing
index over fixed-order iteration.

Pool size is deliberately coprime-ish with the per-tick draw count so the
sequence does not visibly repeat against the tick cycle.

uniformity bug (fixed): an earlier version "derived" uniform draws by squashing
a normal through 0.5 + 0.5·(v/(1+|v|)). That distribution is piled up around
0.5 — P(x < 0.0045) is effectively zero — so configured event coins (grid
dropout/restoration in physics.update_power) never fired and every simulated
site sat on Grid forever. Uniform draws now come from a real U(0,1) pool,
drawn interleaved with the gaussians from the same seeded stream.
"""
from __future__ import annotations


class NoisePool:
    __slots__ = ("_pool", "_upool", "_n", "_i")

    def __init__(self, rng, size: int = 65_521) -> None:
        # 65521 is prime — avoids aliasing against 300 nodes x ~10 draws
        pool = []
        upool = []
        for _ in range(size):
            pool.append(rng.gauss(0.0, 1.0))
            upool.append(rng.random())
        self._pool = pool
        self._upool = upool
        self._n = size
        self._i = 0

    def _next_index(self) -> int:
        i = self._i
        self._i = i + 1 if i + 1 < self._n else 0
        return i

    def gauss(self, mu: float = 0.0, sigma: float = 1.0) -> float:
        return mu + self._pool[self._next_index()] * sigma

    def random(self) -> float:
        """Uniform in [0, 1) from the pre-drawn uniform pool.

        Anything that must match a specific probability distribution can rely
        on this being genuinely uniform — event coins, jitter, sampling.
        """
        return self._upool[self._next_index()]

    def uniform(self, lo: float, hi: float) -> float:
        return lo + (hi - lo) * self.random()

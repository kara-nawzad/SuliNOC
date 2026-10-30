"""
Pydantic validation. Restored — v1 deleted this layer as "simplification"
and lost its only guard against the engine shipping nonsense to the browser.

At ~300 records per tick the cost is negligible, and it catches engine bugs
at the boundary rather than as a blank screen.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

from autonoc.engine import config as C


class NodeModel(BaseModel):
    id: str
    lat: float = Field(ge=C.LAT_MIN - 0.01, le=C.LAT_MAX + 0.01)
    lon: float = Field(ge=C.LON_MIN - 0.01, le=C.LON_MAX + 0.01)
    agg: int = Field(ge=0, le=9)
    ring: int = Field(ge=-1, le=C.NUM_RINGS)
    cluster: int = Field(ge=1, le=3)      # derived from the ring, never set
    gen: int = Field(ge=0, le=2)
    critical: bool
    status: int = Field(ge=0, le=5)

    rsrp: float = Field(ge=-140.0, le=-40.0)
    sinr: float = Field(ge=-10.0, le=40.0)
    s11: float = Field(ge=-40.0, le=5.0)
    latency: float = Field(ge=0.0, le=1000.0)
    jitter: float = Field(ge=0.0, le=50.0)
    loss: float = Field(ge=0.0, le=100.0)
    throughput: float = Field(ge=0.0, le=400.0)
    temp: float = Field(ge=-20.0, le=100.0)
    cpu: float = Field(ge=0.0, le=100.0)

    # derived 3GPP readouts (VSWR from S11, CQI from SINR, PRB utilisation)
    vswr: float = Field(ge=1.0, le=60.0)
    cqi: int = Field(ge=0, le=15)
    prb: float = Field(ge=0.0, le=100.0)

    power: Literal["Grid", "Solar", "Battery", "Generator"]
    # site power architecture: A grid+standby DG, B hybrid DG+battery,
    # C off-grid solar PV + DG backup
    pwr: Literal["A", "B", "C"]
    voltage: float = Field(ge=0.0, le=20.0)
    battery: float = Field(ge=0.0, le=100.0)
    fuel: float = Field(ge=0.0, le=100.0)
    ats: bool = False                  # ATS failure-to-crank alarm latched
    dust: float = Field(ge=0.0, le=1.0)

    dispatched: bool
    repairing: bool
    # predictive rApp: a live Commander verdict sits at/above break-even
    warn: bool = False


class TeamModel(BaseModel):
    id: int = Field(ge=1, le=C.NUM_TEAMS)
    name: str
    skill: Literal["RF", "POWER", "GENERAL"]
    cluster: int = Field(default=1, ge=1, le=3)   # home cluster of the crew
    lat: float
    lon: float
    state: Literal["IDLE", "EN_ROUTE", "STANDBY", "REPAIRING", "RETURNING"]
    available: bool
    target: Optional[str] = None
    target_lat: Optional[float] = None
    target_lon: Optional[float] = None
    eta: int = Field(ge=0)
    missions: int = Field(ge=0)


class KPIModel(BaseModel):
    tick: int = Field(ge=0)
    sim_time: str
    availability: float = Field(ge=0.0, le=100.0)
    healthy: int = Field(ge=0)
    congestion: int = Field(ge=0)
    overheat: int = Field(ge=0)
    rf: int = Field(ge=0)
    power: int = Field(ge=0)
    backhaul: int = Field(ge=0)
    active_teams: int = Field(ge=0, le=C.NUM_TEAMS)
    grid_failures: int = Field(ge=0)
    mttr_min: float = Field(ge=0.0)
    injected: int = Field(ge=0)
    masked: int = Field(ge=0)
    repairs: int = Field(ge=0)
    # site-power facility alarms (OPEX story)
    ats_failures: int = Field(0, ge=0)
    fuel_thefts: int = Field(0, ge=0)


class AggModel(BaseModel):
    id: int
    name: str
    lat: float
    lon: float
    color: str
    node_count: int
    health: float = Field(ge=0.0, le=100.0)
    weather: str
    wind: float
    clutter: float
    pwr: Literal["A", "B", "C"] = "A"   # district site-power configuration


class LogModel(BaseModel):
    tick: int
    time: str
    # ITU-T X.733 perceived severity classes (plus INFO for operational
    # notices). The event log is a telecom FM log, not an app console.
    severity: Literal["INFO", "WARNING", "MINOR", "MAJOR", "CRITICAL", "CLEARED"]
    message: str
    node_id: Optional[str] = None


class RingModel(BaseModel):
    id: int
    cluster: int = Field(default=1, ge=1, le=3)
    # Only the count was ever read (topology panel, cut dialog); the full id list
    # cost ~3 KB of every 1 Hz frame.
    node_count: int = Field(ge=0)
    path: list[list[float]]
    circumference_km: float
    cut: Optional[dict] = None
    cuts: list[dict] = Field(default_factory=list)
    isolated: bool = False


class TelemetrySample(BaseModel):
    tick: int
    sim_time: str
    availability: float
    incidents: int
    power_events: int
    throughput_gbps: float
    drop_rate: float
    prb: float
    online: int
    degraded: int
    offline: int


class TelemetryHistoryResponse(BaseModel):
    """A bounded, current-run history window for the traffic inspector."""
    run_id: str
    timeframe: Literal["30m", "24h", "7d"]
    tick_minutes: int
    samples: list[TelemetrySample]


class ActiveIncident(BaseModel):
    id: str
    node_id: Optional[str]
    title: str
    detail: str
    severity: str
    affected: int
    since_tick: int
    dispatched: bool


class DashboardModel(BaseModel):
    current: TelemetrySample
    history: list[TelemetrySample]
    traffic_change_pct: Optional[float]
    operational_pct: float
    incidents: list[ActiveIncident]
    top_cells: list[dict]
    forecast: Optional[dict]
    actionable_predictions: int
    power: list[dict]
    active_ats: int
    fuel_thefts: int
    fleet: dict[str, int]


class RunSummary(BaseModel):
    """Aggregate record for one completed 30-day demo; never a checkpoint."""
    completed_at: str
    simulated_days: int = Field(ge=1)
    completed_sim_time: str
    seed: int
    availability: float = Field(ge=0.0, le=100.0)
    injected: int = Field(ge=0)
    masked: int = Field(ge=0)
    repairs: int = Field(ge=0)
    mttr_min: float = Field(ge=0.0)
    ats_failures: int = Field(ge=0)
    fuel_thefts: int = Field(ge=0)
    active_incidents: int = Field(ge=0)
    ai_enabled: bool
    ai_mode: str
    pre_empted: int = Field(ge=0)
    acted_upon: int = Field(ge=0)
    false_dispatches: int = Field(ge=0)
    crew_hours_saved: float = Field(ge=0.0)
    precision: Optional[float] = None


class RunHistoryResponse(BaseModel):
    summaries: list[RunSummary]


class ActivityResponse(BaseModel):
    """On-demand event log for the Activity/History dialog."""
    run_id: str
    tick: int
    logs: list[LogModel]


class DeltaResponse(BaseModel):
    """Bounded current snapshot at the legacy tick-cursor endpoint.

    resync=True tells consumers to replace nodes, teams and recent logs. This
    avoids dirty-flag races without changing the simulation's tick semantics.
    run_id changes whenever the 30-day world is safely reset.
    """
    tick: int
    resync: bool
    run_id: str
    reset_notice: bool = False
    run_error: Optional[str] = None
    control: dict
    dashboard: DashboardModel
    kpis: KPIModel
    agg: list[AggModel]
    nodes: list[NodeModel]
    teams: list[TeamModel]
    # ``logs`` moved to GET /api/activity: the Activity dialog is closed almost
    # always, and the array grew to ~8 KB of every 1 Hz frame.
    rings: list[RingModel] = []
    ai: Optional[dict] = None        # M6 — Commander panel payload


# Bound on a single resent turn. The browser echoes Wave's own answers back as
# history, and those can be WAVE_ANSWER_MAX_CHARS long, so the turn ceiling has
# to sit at or above that. When it was 1200, one long answer made every later
# question in that conversation fail request validation with a bare HTTP 422 —
# a permanent, self-inflicted outage that looked like Wave refusing to answer.
# The prompt itself is still trimmed per turn inside autonoc/api/wave_ai.py.
WAVE_ANSWER_MAX_CHARS = 8000
WAVE_CHAT_TURN_MAX_CHARS = WAVE_ANSWER_MAX_CHARS
WAVE_CHAT_HISTORY_MAX_TURNS = 8
WAVE_CHAT_QUESTION_MAX_CHARS = 1000


class WaveChatTurn(BaseModel):
    """A bounded, untrusted turn supplied by the current browser session."""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=WAVE_CHAT_TURN_MAX_CHARS)


class WaveChatRequest(BaseModel):
    """Read-only Wave request; live context is always captured server-side."""

    question: str = Field(min_length=1, max_length=WAVE_CHAT_QUESTION_MAX_CHARS)
    run_id: str = Field(min_length=1, max_length=100)
    history: list[WaveChatTurn] = Field(
        default_factory=list, max_length=WAVE_CHAT_HISTORY_MAX_TURNS
    )


class WaveChatResponse(BaseModel):
    answer: str = Field(min_length=1, max_length=WAVE_ANSWER_MAX_CHARS)
    # "local" is Wave's deterministic snapshot reader: it answers from the run
    # data and built-in telecom notes whenever no live model can be reached,
    # so the assistant never goes silent mid-demo.
    provider: Literal["openai", "groq", "local"] = "openai"
    model: str
    ai_connected: bool
    run_id: str
    tick: int
    sim_time: str
    # The run restarted (Day-30 rollover) while the question was in flight; the
    # answer is grounded in the new run instead of being thrown away.
    run_restarted: bool = False


class SessionStartResponse(BaseModel):
    """Identity of the run this browser now owns (``POST /api/session``)."""
    run_id: str
    tick: int = Field(ge=0)


class ConfigResponse(BaseModel):
    """Single source of truth for anything the frontend renders.

    v1 defined STATUS_COLORS, thresholds and region metadata in BOTH the
    backend and the JavaScript. They drifted, which is how SLY-032 ended up
    showing "Critical Fault" on the map and "Normal" in the sidebar.
    The frontend now hard-codes none of this.
    """
    status_names: dict[int, str]
    status_colors: dict[int, str]
    thresholds: dict[str, float]
    # 3GPP telecom layer: display labels, inspector gauge specs, X.733
    # classes, site-power configurations and O-RAN rApp roles — all served
    # from the engine config, hard-coded nowhere in the frontend (I5).
    metric_labels: dict[str, str] = {}
    gauges: dict[str, dict] = {}
    x733_severity: dict[int, str] = {}
    power_configs: dict[str, str] = {}
    vswr_alarm: float = 1.5
    rapp_roles: dict[str, str] = {}
    map_center: list[float]
    map_zoom: int
    bounds: dict[str, float]
    # LTE core: one node above the clusters, with its EPC elements and the
    # static cluster/ring/site hierarchy. Live cluster health is derived by
    # the client from the node stream.
    core: dict
    depot: dict
    agg_sites: list[dict]
    num_nodes: int
    num_teams: int
    tick_minutes: int
    break_even_precision: float
    presentation: dict

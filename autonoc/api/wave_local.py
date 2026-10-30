"""Deterministic, offline answers for Wave.

Wave normally forwards a question to an LLM. That boundary can be unavailable
for reasons a visitor cannot fix: no provider key is configured, the provider
rejects the key, rate-limits the demo, times out, or returns nothing usable.
Going silent in those cases is the one thing an operations assistant must not
do, so this module answers from the snapshot the API already captured plus a
small set of telecom notes written by hand.

Rules that keep it honest:
  * no network access and no credentials — it cannot leak either;
  * every network figure comes from the supplied snapshot, never invented;
  * it never claims an action was taken (Wave stays read-only);
  * when it has nothing specific, it says so and lists what it can answer.

The caller labels these answers as local (`provider="local"`), so the browser
can show that the live model is offline.
"""
from __future__ import annotations

import re
from typing import Any, Mapping

# Provider-boundary failures that are worth degrading for. Our own abuse
# controls (429) and the context-size guard (413) stay hard errors on purpose.
RECOVERABLE_CODES = frozenset({
    "wave_ai_missing_key",
    "wave_ai_provider_config",
    "wave_ai_auth_failed",
    "wave_ai_provider_rate_limited",
    "wave_ai_unavailable",
    "wave_ai_timeout",
    "wave_ai_malformed_response",
    "wave_ai_provider_rejected",
})

REASONS = {
    "wave_ai_missing_key": "no provider API key is configured on the server",
    "wave_ai_provider_config": "the server has no valid provider selected",
    "wave_ai_auth_failed": "the provider rejected the server-side key",
    "wave_ai_provider_rate_limited": "the provider is rate-limiting the demo",
    "wave_ai_unavailable": "the provider is unreachable right now",
    "wave_ai_timeout": "the provider took too long to answer",
    "wave_ai_malformed_response": "the provider returned nothing usable",
    "wave_ai_provider_rejected": "the provider refused the request",
}

_SITE_ID = re.compile(r"\bsly-enb-\s?(\d{1,3})\b", re.IGNORECASE)

# Short, hand-written notes. Keyword tuples are matched casefolded; the first
# two matches are used so "what is O-RAN vs Non-RT RIC?" still reads well.
_GLOSSARY: tuple[tuple[tuple[str, ...], str], ...] = (
    (
        ("non-rt ric", "non rt ric", "non-real-time ric", "non real time ric",
         "nonrtric"),
        "**Non-RT RIC** — the non-real-time RAN Intelligent Controller. It lives "
        "in the SMO, runs control loops slower than about one second (policy, "
        "ML training, rApp orchestration) and reaches the near-RT RIC over the "
        "**A1** interface. In this dashboard the Commander is its A1 policy "
        "engine.",
    ),
    (
        ("near-rt ric", "near rt ric", "near-real-time ric", "xapp"),
        "**Near-RT RIC** — the real-time sibling: it hosts xApps and runs loops "
        "of roughly 10 ms to 1 s over the **E2** interface to the RAN. It is the "
        "layer that would retune a cell or steer traffic inside a second.",
    ),
    (
        ("o-ran", "open ran", "open-ran", "oran"),
        "**O-RAN (Open RAN)** — disaggregates the base station into interoperable "
        "units (O-RU radio, O-DU high-PHY/MAC/RLC, O-CU RRC/PDCP/SDAP) with open "
        "fronthaul, midhaul and A1/E2/O1 interfaces, so software from one vendor "
        "can drive radios from another.",
    ),
    (
        ("rapp", "r-app", "r app"),
        "**rApps** — modular applications hosted on the Non-RT RIC: root-cause "
        "analysis, predictive maintenance, policy automation. This project maps "
        "its AI layer onto them (Doctor, Oracle, Commander).",
    ),
    (
        ("epc", "mme", "s-gw", "pgw", "p-gw", "hss", "core network", "4g core"),
        "**EPC** — the 4G core: **MME** for signalling and mobility, **S-GW** "
        "anchoring the user plane, **P-GW** as the IP anchor with QoS and "
        "charging, and **HSS** for the subscriber database. One EPC serves all "
        "three clusters here, and it is also the crew depot.",
    ),
    (
        ("enodeb", "enb", "lte", "4g", "base station", "basestation"),
        "**LTE / eNodeB** — in 4G the base station is an eNodeB; it terminates the "
        "radio link and sits directly on the IP backhaul. This simulation is "
        "4G/LTE only: every eNodeB hangs off a fibre ring inside its cluster, "
        "with no intermediate switching node to blame.",
    ),
    (
        ("prb", "resource block", "congestion", "utilisation", "utilization"),
        "**PRB utilisation** — the share of physical resource blocks a cell "
        "schedules. Sustained use above roughly 80 % is congestion: users still "
        "connect, but throughput and latency suffer before anyone drops.",
    ),
    (
        ("vswr", "standing wave", "s11", "return loss"),
        "**VSWR** — voltage standing-wave ratio at the antenna. 1.0 is a perfect "
        "match; above about 1.5 (the alarm threshold here) it points at the "
        "feedline, connectors or jumpers rather than the radio itself, and "
        "transmit power gets reflected back instead of radiated.",
    ),
    (
        ("rsrp", "sinr", "cqi", "rf quality", "coverage", "signal"),
        "**RF readouts** — RSRP is received power (roughly -80 dBm is good, "
        "-110 dBm is marginal), SINR is signal-to-noise-plus-interference (the "
        "real driver of throughput), and CQI is the scheduler's view (0-15) of "
        "how much modulation the link can carry.",
    ),
    (
        ("ats", "transfer switch", "generator", "genset", "battery", "fuel"),
        "**Site power** — grid first, then the ATS cranks the generator; if the "
        "ATS fails to transfer, the site runs on battery and dies at zero state "
        "of charge no matter how much fuel sits in the tank. Fuel theft is a "
        "separate, cumulative failure mode in these runs.",
    ),
    (
        ("mttr", "mean time to repair", "restore", "repair time"),
        "**MTTR** — mean time to repair: the average time from a fault being "
        "raised to the site being restored. It shortens when a crew is already "
        "near the cluster and lengthens with travel time and queueing.",
    ),
    (
        ("ring", "backhaul", "fibre", "fiber", "transport", "cluster"),
        "**Rings and clusters** — each cluster is built from fibre rings, and "
        "every eNodeB on a ring shares that path. One cut therefore looks like "
        "dozens of simultaneous site alarms: correlate by ring before believing "
        "the alarm count.",
    ),
    (
        ("x733", "itut", "severity", "alarm class"),
        "**X.733** — the ITU-T alarm model this console uses: raised, cleared, "
        "severity, probable cause and correlated notifications. It is why one "
        "fibre cut appears as a critical transport alarm plus dependent site "
        "alarms.",
    ),
)

_SUMMARY_KEYS = ("status", "network", "happening", "health", "overview", "right now",
                 "how is", "summary", "summarise", "summarize")
_INCIDENT_KEYS = ("incident", "alarm", "fault", "outage", "problem", "broken", "down")
_POWER_KEYS = ("power", "battery", "generator", "solar", "fuel", "ats", "grid")
_CREW_KEYS = ("crew", "dispatch", "team", "repair", "eta", "engineer", "field")
_TREND_KEYS = ("trend", "compare", "history", "throughput", "prb", "loss",
               "latency", "over time", "dropping", "improving")
_PREDICT_KEYS = ("forecast", "predict", "risk", "commander", "oracle", "doctor",
                 "next failure", "proactive")


def _mentions(keyword: str, text: str) -> bool:
    """Word-boundary match for single words, substring for phrases.

    Plain substring matching looked fine until "cats" matched the ATS note and
    "stats" matched nothing useful — short acronyms need boundaries.
    """
    if " " in keyword or "-" in keyword:
        return keyword in text
    # Plural-tolerant: "incidents" must still match "incident".
    return re.search(rf"\b{re.escape(keyword)}(?:s|es)?\b", text) is not None


def _format_number(value: Any, digits: int = 1, suffix: str = "") -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "n/a"
    return f"{value:.{digits}f}{suffix}"


def _kpis(context: Mapping[str, Any]) -> Mapping[str, Any]:
    return context.get("aggregate_kpis") or {}


def _current(context: Mapping[str, Any]) -> Mapping[str, Any]:
    return context.get("current_telemetry") or {}


def _sim(context: Mapping[str, Any]) -> Mapping[str, Any]:
    return context.get("simulation") or {}


def _sites(context: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    sites = context.get("sites_relevant_to_question_or_attention") or []
    return [site for site in sites if isinstance(site, Mapping)]


def _incidents(context: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    block = context.get("current_incidents") or {}
    items = block.get("items") or []
    return [item for item in items if isinstance(item, Mapping)]


def _crews(context: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    crews = context.get("crews") or []
    return [crew for crew in crews if isinstance(crew, Mapping)]


def _total_sites(context: Mapping[str, Any]) -> int | None:
    clusters = (context.get("network_structure") or {}).get("clusters") or []
    sizes = [row.get("sites") for row in clusters if isinstance(row, Mapping)]
    sizes = [size for size in sizes if isinstance(size, int)]
    return sum(sizes) if sizes else None


def _headline(context: Mapping[str, Any]) -> str:
    kpis = _kpis(context)
    current = _current(context)
    sim = _sim(context)
    incidents = (context.get("current_incidents") or {}).get("active_count", 0)
    total = _total_sites(context)
    in_service = kpis.get("in_service_sites")
    sites = (
        f"{in_service}/{total} sites in service"
        if total and isinstance(in_service, int)
        else f"{in_service if in_service is not None else 'n/a'} sites in service"
    )
    when = sim.get("sim_time") or "the current tick"
    return (
        f"{_format_number(kpis.get('availability_pct'), 2, ' %')} availability, "
        f"{sites}, {incidents} active incident(s) at {when}"
        + (" (simulation paused)" if sim.get("paused") else "")
        + f". Throughput {_format_number(current.get('throughput_gbps'), 2, ' Gbps')}, "
        f"PRB {_format_number(current.get('prb_pct'), 1, ' %')}."
    )


def _glossary_answer(question: str, context: Mapping[str, Any]) -> str | None:
    matches = [text for keywords, text in _GLOSSARY
               if any(_mentions(keyword, question) for keyword in keywords)]
    if not matches:
        return None
    body = "\n\n".join(matches[:2])
    roles = ((context.get("network_structure") or {}).get("o_ran") or {}).get(
        "rapp_roles"
    )
    if roles and any(word in question for word in ("rapp", "o-ran", "oran", "ric")):
        joined = "; ".join(
            f"**{str(name).title()}** — {role}" for name, role in roles.items()
        )
        body += f"\n\nIn this simulation: {joined}."
    return body


def _site_answer(question: str, context: Mapping[str, Any]) -> str | None:
    match = _SITE_ID.search(question)
    if not match:
        return None
    wanted = f"SLY-eNB-{int(match.group(1)):03d}"
    for site in _sites(context):
        if str(site.get("id", "")).casefold() == wanted.casefold():
            parts = [
                f"**{site.get('id')}** — {site.get('status')}, {site.get('district')} "
                f"(Cluster {site.get('cluster')}, Ring {site.get('ring')}).",
                f"Power: {site.get('power_source')}"
                + (" with an ATS failure latched" if site.get("ats_failure_active") else "")
                + f", battery {_format_number(site.get('battery_pct'), 0, ' %')}"
                f", fuel {_format_number(site.get('fuel_pct'), 0, ' %')}.",
                f"Radio: {_format_number(site.get('throughput_gbps'), 2, ' Gbps')}, "
                f"PRB {_format_number(site.get('prb_pct'), 1, ' %')}, "
                f"loss {_format_number(site.get('packet_loss_pct'), 2, ' %')}, "
                f"temp {_format_number(site.get('temperature_c'), 1, ' °C')}.",
                "Crew on site." if site.get("repair_in_progress")
                else ("Crew dispatched." if site.get("crew_dispatched") else "No crew assigned yet."),
            ]
            return " ".join(parts)
    return None


def _incident_answer(context: Mapping[str, Any]) -> str:
    items = _incidents(context)
    block = context.get("current_incidents") or {}
    if not items:
        return "No active incidents in this snapshot. Quiet run — enjoy it while it lasts."
    lines = [f"**{block.get('active_count', len(items))} active incident(s)** right now:"]
    for item in items[:6]:
        crew = "crew dispatched" if item.get("crew_dispatched") else "no crew yet"
        lines.append(
            f"- **{item.get('severity')}** {item.get('site_id')} — {item.get('title')} "
            f"({crew}, since tick {item.get('since_tick')})"
        )
    if block.get("truncated") or len(items) > 6:
        lines.append("- …more in the incident panel; I only received the top rows.")
    return "\n".join(lines)


def _power_answer(context: Mapping[str, Any]) -> str:
    power = context.get("power") or {}
    kpis = _kpis(context)
    distribution = power.get("distribution") or []
    mix = ", ".join(
        f"{row.get('name')}: {row.get('count')}"
        for row in distribution
        if isinstance(row, Mapping) and row.get("count")
    )
    lines = [
        f"**Power snapshot** — {kpis.get('power_failure_sites', 0)} site(s) on a power "
        f"alarm, {kpis.get('sites_without_grid_power', 0)} without grid power, "
        f"{power.get('active_ats_failures', 0)} latched ATS failure(s), "
        f"{power.get('run_total_fuel_theft_events', 0)} fuel-theft event(s) this run."
    ]
    if mix:
        lines.append(f"Power mix: {mix}.")
    battery_sites = [site for site in _sites(context) if site.get("power_source") == "Battery"]
    if battery_sites:
        names = ", ".join(str(site.get("id")) for site in battery_sites[:6])
        lines.append(
            f"On battery: {names} — these die at zero state of charge, so they are "
            "the ones worth dispatching to first."
        )
    return "\n\n".join(lines)


def _crew_answer(context: Mapping[str, Any]) -> str:
    crews = _crews(context)
    if not crews:
        return "I have no crew roster in this snapshot."
    lines = ["**Field crews**:"]
    for crew in crews[:6]:
        target = crew.get("target_site") or "—"
        eta = crew.get("eta_ticks")
        lines.append(
            f"- {crew.get('name')} ({crew.get('skill')}) — {crew.get('state')}, "
            f"target {target}" + (f", ETA {eta} ticks" if eta else "")
        )
    lines.append(
        "Crews stage at the Core and only appear on the map while dispatched; "
        "Wave is read-only, so approve a dispatch in the console and I can explain it."
    )
    return "\n".join(lines)


def _trend_answer(context: Mapping[str, Any]) -> str:
    samples = context.get("recent_telemetry_samples") or []
    rows = [row for row in samples if isinstance(row, Mapping)]
    if len(rows) < 2:
        return ("I only have one telemetry sample so far in this run — ask again "
                "after a few ticks and I can compare.")
    first, last = rows[0], rows[-1]

    def delta(key: str) -> str:
        start, end = first.get(key), last.get(key)
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            return "n/a"
        change = end - start
        arrow = "▲" if change > 0 else ("▼" if change < 0 else "→")
        return f"{arrow} {abs(change):.2f}"

    return "\n".join([
        f"**Trend over the last {len(rows)} samples** "
        f"(tick {first.get('tick')} → {last.get('tick')}):",
        f"- Availability {_format_number(first.get('availability_pct'), 2, ' %')} → "
        f"{_format_number(last.get('availability_pct'), 2, ' %')} ({delta('availability_pct')})",
        f"- Throughput {_format_number(first.get('throughput_gbps'), 2)} → "
        f"{_format_number(last.get('throughput_gbps'), 2)} Gbps "
        f"({delta('throughput_gbps')})",
        f"- PRB {_format_number(first.get('prb_pct'), 1)} → "
        f"{_format_number(last.get('prb_pct'), 1)} % ({delta('prb_pct')})",
        f"- Incidents {first.get('incidents')} → {last.get('incidents')}",
        "",
        "Only this bounded window is available, so treat it as a recent "
        "direction of travel, not a full-day baseline.",
    ])


def _predictor_answer(context: Mapping[str, Any]) -> str:
    predictor = context.get("predictor") or {}
    if not predictor.get("enabled"):
        return ("The predictive layer is **off** in this run, so there is no "
                "forecast to quote — only live alarms.")
    lines = [
        f"**Predictor** — {predictor.get('mode')} mode, "
        f"{predictor.get('actionable_forecast_count', 0)} actionable forecast(s), "
        f"{predictor.get('pending_action_count', 0)} pending action(s)."
    ]
    pending = predictor.get("pending_actions") or []
    for item in pending[:4]:
        lines.append(
            f"- {item.get('site_id')} — {item.get('label')} "
            f"(p={item.get('probability')}, tier {item.get('tier')}) → {item.get('action')}"
        )
    return "\n".join(lines)


def _summary_answer(context: Mapping[str, Any]) -> str:
    sites = _sites(context)
    lines = [f"**Right now** — {_headline(context)}"]
    if sites:
        names = ", ".join(f"{site.get('id')} ({site.get('status')})" for site in sites[:5])
        lines.append(f"Sites worth a look: {names}.")
    if sites and sites[0].get("ats_failure_active"):
        lines.append(
            f"{sites[0].get('id')} has an ATS failure latched — battery will run out "
            "before the fuel does."
        )
    return "\n\n".join(lines)


def _unsupported(context: Mapping[str, Any]) -> str:
    return (
        "I can't reach the live model right now, so I'm limited to this run's "
        f"snapshot — and I'd rather say that than invent an answer.\n\n{_headline(context)}\n\n"
        "Try me on: network status, incidents, site power, field crews, recent "
        "trends, the predictor, a site ID (e.g. `SLY-eNB-072`), or a telecom "
        "concept (O-RAN, Non-RT RIC, rApps, EPC, PRB, VSWR, ATS, MTTR)."
    )


# Most specific intent first: it wins ties, so "any power problems?" reads as a
# power question instead of a generic incident question.
_INTENTS = (
    (_POWER_KEYS, _power_answer),
    (_INCIDENT_KEYS, _incident_answer),
    (_CREW_KEYS, _crew_answer),
    (_TREND_KEYS, _trend_answer),
    (_PREDICT_KEYS, _predictor_answer),
    (_SUMMARY_KEYS, _summary_answer),
)


def _best_intent(text: str):
    """Pick the intent with the most keyword hits; earliest wins a tie."""
    best = None
    best_score = 0
    for keywords, handler in _INTENTS:
        score = sum(1 for keyword in keywords if _mentions(keyword, text))
        if score > best_score:
            best = handler
            best_score = score
    return best


def answer(question: str, context: Mapping[str, Any], *, code: str = "") -> str:
    """Return a grounded answer for `question` without calling any provider."""
    text = question.casefold()
    reason = REASONS.get(code, "the live model is unavailable")
    note = (
        f"*(Local mode — {reason}. Answering from this run's snapshot and my "
        "built-in notes.)*"
    )

    body = _site_answer(text, context) or _glossary_answer(text, context)
    if body is None:
        handler = _best_intent(text)
        body = handler(context) if handler else _unsupported(context)
    return f"{note}\n\n{body}"

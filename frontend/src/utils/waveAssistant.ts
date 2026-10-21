import type { Config, NodeData, Snapshot } from "../types/api";
import type { WaveExpression } from "../types/wave";

export interface WaveReply {
  text: string;
  expression: WaveExpression;
}

const severityOrder: Record<string, number> = {
  CRITICAL: 0,
  MAJOR: 1,
  MINOR: 2,
  WARNING: 3,
  INFO: 4,
  CLEARED: 5,
};

function number(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function capturedAt(data: Snapshot): string {
  return `${data.kpis.sim_time} · tick ${number(data.tick)}`;
}

function urgentIncident(data: Snapshot): boolean {
  return data.dashboard.incidents.some(
    (incident) =>
      incident.severity === "CRITICAL" || incident.severity === "MAJOR",
  );
}

function siteReply(node: NodeData, data: Snapshot, config: Config): WaveReply {
  const district = config.agg_sites.find((site) => site.id === node.agg)?.name;
  const state = config.status_names[node.status] ?? `status ${node.status}`;
  const expression =
    node.status === config.presentation.healthy_status ? "focused" : "alert";
  return {
    expression,
    text: [
      `${node.id}${district ? ` · ${district}` : ""}: ${state}.`,
      `Power ${node.power.toLowerCase()}${node.ats ? " · ATS failure active" : ""}; throughput ${number(node.throughput, 1)} Gbps, PRB ${number(node.prb)}%, packet loss ${number(node.loss, 2)}%, and battery ${number(node.battery)}%.`,
      `Read from the current simulation snapshot (${capturedAt(data)}).`,
    ].join("\n"),
  };
}

function districtReply(
  districtId: number,
  data: Snapshot,
  config: Config,
): WaveReply {
  const district = config.agg_sites.find((site) => site.id === districtId);
  const nodes = data.nodes.filter((node) => node.agg === districtId);
  if (!district || !nodes.length) {
    return {
      expression: "focused",
      text: `I don't have current site rows for that district in this snapshot (${capturedAt(data)}).`,
    };
  }
  const healthy = nodes.filter(
    (node) => node.status === config.presentation.healthy_status,
  ).length;
  const incidents = data.dashboard.incidents.filter((incident) =>
    nodes.some((node) => node.id === incident.node_id),
  );
  const expression = incidents.some(
    (incident) =>
      incident.severity === "CRITICAL" || incident.severity === "MAJOR",
  )
    ? "alert"
    : incidents.length === 0
      ? "excited"
      : "focused";
  return {
    expression,
    text: `${district.name}: ${healthy} of ${nodes.length} sites are healthy; ${incidents.length} active incident${incidents.length === 1 ? "" : "s"} in the latest snapshot (${capturedAt(data)}).`,
  };
}

function networkReply(data: Snapshot): WaveReply {
  const current = data.dashboard.current;
  const incidents = data.dashboard.incidents.length;
  return {
    expression: urgentIncident(data)
      ? "alert"
      : incidents === 0
        ? "excited"
        : "focused",
    text: `At ${capturedAt(data)}, network availability is ${number(data.kpis.availability, 2)}%. ${number(current.online)} sites are online, ${number(current.degraded)} degraded, and ${number(current.offline)} offline. Traffic is ${number(current.throughput_gbps, 1)} Gbps at ${number(current.prb)}% PRB; packet loss is ${number(current.drop_rate, 2)}%. There ${incidents === 1 ? "is" : "are"} ${incidents} active incident${incidents === 1 ? "" : "s"}.`,
  };
}

function incidentReply(data: Snapshot): WaveReply {
  const incidents = [...data.dashboard.incidents].sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99) ||
      a.since_tick - b.since_tick,
  );
  if (!incidents.length) {
    return {
      expression: "excited",
      text: `No active incidents are reported in the latest snapshot (${capturedAt(data)}).`,
    };
  }
  const list = incidents.slice(0, 4).map((incident) => {
    const site = incident.node_id ? ` · ${incident.node_id}` : "";
    return `• ${incident.severity}${site}: ${incident.title} (${incident.affected} affected)`;
  });
  const more =
    incidents.length > list.length
      ? `\n…plus ${incidents.length - list.length} more.`
      : "";
  return {
    expression: urgentIncident(data) ? "alert" : "focused",
    text: `${incidents.length} active incident${incidents.length === 1 ? "" : "s"} at ${capturedAt(data)}:\n${list.join("\n")}${more}`,
  };
}

function powerReply(data: Snapshot): WaveReply {
  const mix = data.dashboard.power
    .filter((source) => source.count > 0)
    .map((source) => `${source.name.toLowerCase()} ${number(source.count)}`)
    .join(" · ");
  const activeAts = data.dashboard.active_ats;
  return {
    expression: activeAts > 0 ? "alert" : "focused",
    text: `Power snapshot (${capturedAt(data)}): ${mix || "no power-source counts available"}. ${number(activeAts)} active ATS failure${activeAts === 1 ? "" : "s"}; ${number(data.dashboard.fuel_thefts)} run-total fuel-theft event${data.dashboard.fuel_thefts === 1 ? "" : "s"}.`,
  };
}

function predictionReply(data: Snapshot): WaveReply {
  if (!data.ai.ai_enabled) {
    return {
      expression: "focused",
      text: `SuliNOC forecasting is currently off (${capturedAt(data)}). The configured Doctor/Oracle predictor reports ${String(data.ai.ai_mode).toUpperCase()} mode, so no active AI recommendations are being issued. Enable AI from the dashboard controls to resume forecasts.`,
    };
  }
  const pending = data.ai.pending;
  const head = `Predictor: ${String(data.ai.ai_mode).toUpperCase()} mode; ${number(data.dashboard.actionable_predictions)} actionable forecast${data.dashboard.actionable_predictions === 1 ? "" : "s"} at ${capturedAt(data)}.`;
  if (!pending.length) {
    const forecast = data.dashboard.forecast;
    return {
      expression:
        data.dashboard.actionable_predictions > 0 ? "focused" : "excited",
      text: forecast?.node_id
        ? `${head} Highest displayed risk is ${forecast.node_id} (${number(forecast.probability * 100, 1)}%): ${forecast.label}. No crew recommendations are awaiting approval.`
        : `${head} No crew recommendations are awaiting approval.`,
    };
  }
  const lines = pending
    .slice(0, 3)
    .map(
      (action) =>
        `• ${action.node_id}: ${action.label} · ${number(action.probability * 100, 1)}% risk`,
    );
  return {
    expression: "focused",
    text: `${head}\nAwaiting review:\n${lines.join("\n")}${pending.length > lines.length ? `\n…plus ${pending.length - lines.length} more.` : ""}`,
  };
}

function fleetReply(data: Snapshot): WaveReply {
  const fleet = data.dashboard.fleet;
  const assigned = data.teams.filter((team) => team.target).length;
  return {
    expression: assigned ? "focused" : "idle",
    text: `Fleet snapshot (${capturedAt(data)}): ${data.teams.length} crews · ${number(fleet.IDLE)} idle, ${number(fleet.EN_ROUTE)} en route, ${number(fleet.REPAIRING)} repairing, ${number(fleet.STANDBY)} standby, and ${number(fleet.RETURNING)} returning. ${assigned} crew${assigned === 1 ? " has" : "s have"} an active target.`,
  };
}

const HELP_REPLY: WaveReply = {
  expression: "idle",
  text: "Ask me about the current network, incidents, power, crew availability, forecasts, or a site ID or district name. I use the latest SuliNOC simulation snapshot; I don't make up live operator-network data.",
};

/**
 * Compose an operations answer strictly from a backend Snapshot. This is a
 * small, transparent local assistant—not a generative chat model.
 */
export function answerWave(
  question: string,
  data: Snapshot,
  config: Config,
): WaveReply {
  const query = question.trim().toLowerCase();
  if (!query) return HELP_REPLY;

  const site = data.nodes.find((node) => query.includes(node.id.toLowerCase()));
  if (site) return siteReply(site, data, config);

  const district = config.agg_sites.find((area) =>
    query.includes(area.name.toLowerCase()),
  );
  if (district) return districtReply(district.id, data, config);

  if (
    /\b(help|what can you do|who are you|what are you|how do i use)\b/.test(
      query,
    )
  )
    return HELP_REPLY;

  if (/\b(power|grid|ats|battery|fuel|generator|solar)\b/.test(query))
    return powerReply(data);

  if (/\b(fleet|crew|crews|team|teams|maintenance|dispatch)\b/.test(query))
    return fleetReply(data);

  if (
    /\b(predict|prediction|forecast|risk|oracle|doctor|commander|ai)\b/.test(
      query,
    )
  )
    return predictionReply(data);

  if (
    /\b(incident|incidents|alarm|alarms|alert|alerts|fault|failure|failed|offline|outage|down)\b/.test(
      query,
    )
  )
    return incidentReply(data);

  if (
    /\b(network|status|health|availability|traffic|throughput|prb|loss|overview|how are things)\b/.test(
      query,
    )
  )
    return networkReply(data);

  return HELP_REPLY;
}

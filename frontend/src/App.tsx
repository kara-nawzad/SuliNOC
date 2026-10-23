import { TowerList } from "./components/TowerList";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Boxes,
  ChevronRight,
  CircleHelp,
  Clock3,
  Layers3,
  LayoutDashboard,
  Loader2,
  RadioTower,
  Home,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  Wifi,
  X,
} from "lucide-react";
import { useTelemetry } from "./hooks/useTelemetry";
import { KpiGrid } from "./components/KpiGrid";
import { HeroFrame } from "./components/HeroFrame";
import { NetworkMap } from "./components/NetworkMap";
import { greetingFor } from "./utils/greeting";
import { simTimeToMinutes } from "./adapters.js";
import { AlertsSidebar, type Execute } from "./components/AlertsSidebar";
import { PowerCard } from "./components/AnalyticsRow";
import { AnalyticsRow } from "./components/AnalyticsRow";
import { PanelNote } from "./components/PanelNote";
import { Inspector } from "./components/Inspector";
import { HistoryModal } from "./components/HistoryModal";
import { WaveChat } from "./components/WaveChat";
import { CounterfactualModal } from "./components/CounterfactualModal";
import { SimControls, ScenarioModal } from "./components/SimControls";
import { Dot, Modal, tone } from "./components/ui";
import { api } from "./services/api";

type Dialog =
  | "cut"
  | "inject"
  | "activity"
  | "fleet"
  | "search"
  | "settings"
  | "about"
  | "impact"
  | null;

function Console({
  heroOpen,
  setHeroOpen,
}: {
  heroOpen: boolean;
  setHeroOpen: (open: boolean) => void;
}) {
  const { config, data, status, error, refresh } = useTelemetry();
  const activeRunId = useRef<string | null>(null);
  const observedRunId = useRef<string | null>(null);
  if (data?.run_id) activeRunId.current = data.run_id;
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [injectNode, setInjectNode] = useState<string>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [section, setSection] = useState("overview");
  const selectNode = useCallback((id: string) => {
    setSelected(id);
  }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  useEffect(() => {
    if (!data) return;
    const previousRunId = observedRunId.current;
    observedRunId.current = data.run_id;
    if (previousRunId === null) {
      if (data.reset_notice)
        setToast({ text: "Demo restarted · Day 1", error: false });
      return;
    }
    if (previousRunId === data.run_id) return;

    // A successful reset replaces the world; no old modal, search target,
    // inspector selection, optimistic approval, or command toast may survive.
    setSelected(null);
    setDialog(null);
    setInjectNode(undefined);
    setQuery("");
    setSection("overview");
    busyRef.current = false;
    setBusy(false);
    setToast(
      data.reset_notice
        ? { text: "Demo restarted · Day 1", error: false }
        : null,
    );
  }, [data]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setDialog("search");
      }
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const execute: Execute = useCallback(
    async (command, label, commandRunId) => {
      if (
        busyRef.current ||
        activeRunId.current === null ||
        commandRunId !== activeRunId.current
      )
        return false;
      busyRef.current = true;
      setBusy(true);
      try {
        const result = await command();
        if (activeRunId.current !== commandRunId) {
          refresh();
          return false;
        }
        setToast({
          text: result.late
            ? "Approval arrived after failure; reactive dispatch is handling the site."
            : label,
          error: false,
        });
        refresh();
        return true;
      } catch (err) {
        if (activeRunId.current !== commandRunId) {
          refresh();
          return false;
        }
        setToast({
          text:
            err instanceof Error
              ? err.message
              : "Command failed. Please retry.",
          error: true,
        });
        refresh();
        return false;
      } finally {
        if (activeRunId.current === commandRunId) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [refresh],
  );
  // Keep the rail highlight on the section currently in view.
  useEffect(() => {
    const ids = [
      "overview",
      "network",
      "incidents",
      "analytics",
      "commander",
      "towers",
    ];
    let frame = 0;
    const update = () => {
      frame = 0;
      const h = window.innerHeight;
      if (window.scrollY < 120) {
        setSection((prev) => (prev === "overview" ? prev : "overview"));
        return;
      }
      // Towers is the last section: once its top edge is on screen it is the one in view.
      const towers = document.getElementById("towers");
      if (towers && towers.getBoundingClientRect().top <= h * 0.75) {
        setSection((prev) => (prev === "towers" ? prev : "towers"));
        return;
      }
      // A1 Commander sits inside the telemetry row: it owns the highlight only
      // when its panel reaches the top quarter of the screen.
      const cmd = document.getElementById("commander");
      if (cmd) {
        const t = cmd.getBoundingClientRect().top;
        if (t >= 0 && t <= h * 0.25) {
          setSection((prev) => (prev === "commander" ? prev : "commander"));
          return;
        }
      }
      // Otherwise the section whose top is closest above the 60% line wins.
      let best: string | null = null;
      let bestTop = -Infinity;
      for (const id of ids) {
        if (id === "commander") continue;
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= h * 0.6 && top > bestTop) {
          bestTop = top;
          best = id;
        }
      }
      if (best) setSection((prev) => (prev === best ? prev : best!));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    update();
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, [Boolean(config && data)]);

  function navigate(id: string) {
    setSection(id);
    if (id === "fleet") setDialog("fleet");
    else
      document
        .getElementById(id === "overview" ? "overview" : id)
        ?.scrollIntoView({
          // Page switch is immediate: the prompt sets a <200 ms target.
          behavior: "instant",
          block: "start",
        });
  }
  // Keep all console surfaces off-screen while the welcome iframe is loading or open.
  if (heroOpen) return null;

  if (!config || !data) {
    return (
      <div className="boot-screen">
        <img
          className="brand-logo"
          src="/assets/suli-noc-logo-dark.png"
          alt="SuliNOC"
        />
        <h1>
          SuliNOC<span> / NETWORK COMMAND</span>
        </h1>
        <Loader2 className="spin" size={22} />
        <p>{error ?? "Establishing telemetry uplink…"}</p>
        {error && (
          <button className="button secondary" onClick={refresh}>
            Retry connection
          </button>
        )}
        <small>LIVE SIMULATION · NO SYNTHETIC UI DATA</small>
      </div>
    );
  }
  const p = config.presentation.palette;
  const theme = Object.fromEntries(
    Object.entries(p).map(([key, val]) => [`--${key}`, val]),
  ) as CSSProperties;
  const matched = data.nodes
    .filter((n) =>
      `${n.id} ${config.agg_sites.find((a) => a.id === n.agg)?.name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 12);
  // Greeting follows the simulation clock (the hour of the sim time shown on the dashboard).
  const simMinutes = simTimeToMinutes(data.kpis.sim_time);
  const greetingText = greetingFor(
    simMinutes == null
      ? new Date().getHours()
      : Math.floor((simMinutes % 1440) / 60),
  );

  return (
    <MotionConfig reducedMotion="user">
      <div
        className={`app-shell ${data.control.paused ? "is-paused" : ""}`}
        style={theme}
      >
        <a className="skip-link" href="#overview">
          Skip to network overview
        </a>
        <nav className="navigation-rail" aria-label="Main navigation">
          <div className="nav-items">
            {[
              { id: "overview", icon: LayoutDashboard, label: "Overview" },
              { id: "network", icon: Layers3, label: "Live network" },
              { id: "incidents", icon: Bell, label: "Incidents" },
              { id: "analytics", icon: Activity, label: "Analytics" },
              { id: "fleet", icon: Truck, label: "Maintenance" },
              { id: "towers", icon: RadioTower, label: "Towers" },
            ].map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                className={`nav-item ${section === id ? "active" : ""}`}
                aria-label={label}
                data-tip={label}
                aria-current={section === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={20} />
                {id === "incidents" && data.dashboard.current.incidents > 0 && (
                  <i className="nav-alert" />
                )}
              </button>
            ))}
          </div>
          <div className="nav-bottom">
            <button
              className="nav-item"
              title="Hero"
              data-tip="Hero"
              aria-label="Hero"
              onClick={() => setHeroOpen(true)}
            >
              <Home size={19} />
            </button>
            <button
              className="nav-item"
              title="Simulation settings"
              data-tip="Simulation settings"
              aria-label="Simulation settings"
              onClick={() => setDialog("settings")}
            >
              <Settings2 size={19} />
            </button>
            <button
              className="nav-item"
              title="About this simulation"
              data-tip="About this simulation"
              aria-label="About this simulation"
              onClick={() => setDialog("about")}
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </nav>
        <PanelNote />
        <div className="main-shell">
          <header className="global-header">
            <button
              className="wordmark"
              onClick={() => navigate("overview")}
              aria-label="SuliNOC overview"
            >
              <img
                className="brand-logo"
                src="/assets/suli-noc-logo-dark.png"
                alt="SuliNOC"
              />
            </button>
            <span className="header-divider" />
            <div className="network-switch">
              <span className="network-symbol">
                <RadioTower size={17} />
              </span>
              <div>
                <strong>{config.presentation.network_name}</strong>
                <span>LTE network · Digital twin</span>
              </div>
              <ChevronRight size={14} />
            </div>
            <div className="header-spacer" />
            <button
              className="header-bell icon-button"
              aria-label="Open network event history"
              onClick={() => setDialog("activity")}
            >
              <Bell size={18} />
              {data.dashboard.current.incidents > 0 && <i />}
            </button>
            {/* Phones only (see phone-layout.css): these three live in the bottom bar on desktop. */}
            <div className="phone-tools">
              <button
                className="icon-button"
                aria-label="Welcome screen"
                onClick={() => setHeroOpen(true)}
              >
                <Home size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Simulation settings"
                onClick={() => setDialog("settings")}
              >
                <Settings2 size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="About this simulation"
                onClick={() => setDialog("about")}
              >
                <CircleHelp size={18} />
              </button>
            </div>
            <span
              className="build-stamp mono"
              title="Build: commit and build time"
            >
              build {__BUILD_STAMP__.sha}
            </span>
            <span className="header-divider" />
            <div className="header-system">
              <ShieldCheck size={16} />
              <div>O-RAN · Non-RT RIC</div>
            </div>
          </header>
          <main id="overview">
            <div className="overview-heading">
              <div>
                <h1 key={greetingText} className="overview-hi gslow">
                  {greetingText}, Slemani.
                </h1>
              </div>
              <div className="overview-meta">
                <span className={`connection ${status}`}>
                  <Dot
                    color={status === "live" ? p.healthy : p.warning}
                    pulse={status === "live" && !data.control.paused}
                  />
                  {status === "live"
                    ? data.control.paused
                      ? "PAUSED"
                      : "LIVE TELEMETRY"
                    : "RECONNECTING"}
                </span>
                <div className="sim-clock">
                  <Clock3 size={13} />
                  <span className="mono">{data.kpis.sim_time}</span>
                </div>
              </div>
            </div>
            <div className="command-bar">
              <div className="command-context">
                <span className="live-line" />
                <span>NETWORK COMMAND</span>
                <span className="soft-separator">/</span>
                <span className="command-context-sub">
                  {config.num_nodes} sites · {data.agg.length} districts
                </span>
              </div>
              <SimControls
                data={data}
                config={config}
                busy={busy || status !== "live"}
                execute={execute}
                onCut={() => setDialog("cut")}
                onInject={() => {
                  setInjectNode(undefined);
                  setDialog("inject");
                }}
                onImpact={() => setDialog("impact")}
              />
            </div>
            {status !== "live" && (
              <div className="connection-banner" role="alert">
                <Wifi size={16} />
                <span>
                  Telemetry connection interrupted. Showing the last received
                  state. {error}
                </span>
                <button onClick={refresh}>Reconnect</button>
              </div>
            )}
            {data.run_error && (
              <div className="run-error-banner" role="alert">
                <X size={16} />
                <span>{data.run_error}</span>
              </div>
            )}
            <KpiGrid data={data} config={config} />
            <div className="primary-grid">
              <NetworkMap
                config={config}
                data={data}
                selectedId={selected}
                onSelect={selectNode}
              />
              <AlertsSidebar
                key={data.run_id}
                config={config}
                data={data}
                onSelect={selectNode}
                onActivity={() => setDialog("activity")}
                execute={execute}
              >
                <PowerCard
                  data={data}
                  config={config}
                  onFleet={() => setDialog("fleet")}
                />
              </AlertsSidebar>
            </div>
            <div className="section-label">
              <span>
                <Activity size={13} /> TELEMETRY & INTELLIGENCE
              </span>
              <span>
                Server-derived metrics <span className="label-dot">·</span> Last{" "}
                {config.presentation.history_ticks} ticks
              </span>
            </div>
            <AnalyticsRow
              key={data.run_id}
              data={data}
              config={config}
              onSelect={(id) => {
                selectNode(id);
                navigate("network");
              }}
              commander={
                <AlertsSidebar
                  key={`cmd-${data.run_id}`}
                  part="commander"
                  config={config}
                  data={data}
                  onSelect={selectNode}
                  onActivity={() => setDialog("activity")}
                  execute={execute}
                />
              }
            />
            <TowerList
              data={data}
              config={config}
              onSelect={(id) => {
                selectNode(id);
                navigate("network");
              }}
            />
            <footer className="app-footer">
              <span>
                <Dot color={status === "live" ? p.healthy : p.warning} /> Engine{" "}
                {status === "live" ? "connected" : "disconnected"}
              </span>
              <span>Deterministic world. Predictive operations.</span>
            </footer>
          </main>
        </div>
        <Inspector
          node={data.nodes.find((n) => n.id === selected)}
          config={config}
          onClose={() => setSelected(null)}
          onInject={(id) => {
            setInjectNode(id);
            setDialog("inject");
          }}
        />
        {(dialog === "cut" || dialog === "inject") && (
          <ScenarioModal
            type={dialog}
            initialNode={injectNode}
            data={data}
            config={config}
            execute={execute}
            onClose={closeDialog}
          />
        )}
        {dialog === "activity" && (
          <HistoryModal data={data} config={config} onClose={closeDialog} />
        )}
        <AnimatePresence>
          {dialog === "impact" && (
            <CounterfactualModal
              key="counterfactual-impact"
              data={data}
              onClose={closeDialog}
            />
          )}
        </AnimatePresence>
        {dialog === "fleet" && (
          <Modal title="Maintenance fleet" onClose={closeDialog} wide>
            <p className="dialog-intro">
              {config.num_teams} crews · {data.dashboard.fleet.IDLE} available.
              Travel and repairs are controlled by the engine.
            </p>
            <div className="fleet-grid">
              {data.teams.map((team) => (
                <article key={team.id} className="fleet-card">
                  <div>
                    <Truck size={18} />
                    <strong>{team.name}</strong>
                    <span>{team.skill}</span>
                  </div>
                  <span
                    className="fleet-state"
                    style={{ color: team.available ? p.healthy : p.crew }}
                  >
                    {team.state.replaceAll("_", " ")}
                  </span>
                  <p>{team.target ?? "Returning / available at depot"}</p>
                  <div className="fleet-card-foot">
                    <span>ETA {team.eta} ticks</span>
                    <span>
                      {team.missions}{" "}
                      {team.missions === 1 ? "mission" : "missions"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </Modal>
        )}
        {dialog === "search" && (
          <Modal title="Find a network site" onClose={closeDialog}>
            <label className="search-field">
              <Search size={17} />
              <input
                autoFocus
                placeholder="Search site ID or district..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search site ID or district"
              />
            </label>
            <div className="search-results">
              {matched.map((node) => (
                <button
                  key={node.id}
                  onClick={() => {
                    selectNode(node.id);
                    closeDialog();
                    navigate("network");
                  }}
                >
                  <Dot color={config.status_colors[node.status]} />
                  <div>
                    <strong className="mono">{node.id}</strong>
                    <span>
                      {config.agg_sites.find((a) => a.id === node.agg)?.name}
                    </span>
                  </div>
                  <ArrowUpRight size={14} />
                </button>
              ))}
              {!matched.length && (
                <p className="empty-state">No sites match “{query}”.</p>
              )}
            </div>
            <p className="small-muted">
              Showing up to 12 matches · use Tab and Enter to select.
            </p>
          </Modal>
        )}
        {dialog === "settings" && (
          <Modal title="Simulation settings" onClose={closeDialog}>
            <small className="build-stamp mono">
              build {__BUILD_STAMP__.sha} · {__BUILD_STAMP__.built}
            </small>
            <div className="setting-row">
              <div>
                <strong>Auto-approve crew requests (demo)</strong>
                <p>
                  When On, the system approves a pending crew dispatch by itself
                  after 10 seconds. When Off, a person must approve each one.
                </p>
              </div>
              <div
                className="approval-choice"
                role="group"
                aria-label="Demo auto-approval"
              >
                {[
                  { label: "Off", seconds: 0 },
                  { label: "On · 10 s", seconds: 10 },
                ].map((option) => {
                  const active =
                    data.control.auto_approve_seconds > 0 ===
                    option.seconds > 0;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={active ? "selected" : ""}
                      aria-pressed={active}
                      disabled={busy || active}
                      onClick={() =>
                        void execute(
                          () => api.ai(true, data.run_id, option.seconds),
                          "Approval policy updated",
                          data.run_id,
                        )
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="settings-info">
              <span>Predictor</span>
              <strong>{data.ai.ai_mode.toUpperCase()}</strong>
              <span>Action threshold</span>
              <strong className="mono">
                p &gt; {config.break_even_precision}
              </strong>
              <span>Forecast horizon</span>
              <strong>
                {config.presentation.prediction_horizon_min} sim minutes
              </strong>
              <span>Tick duration</span>
              <strong>{config.tick_minutes} sim minutes</strong>
              <span>Run seed</span>
              <strong>{data.control.seed}</strong>
            </div>
            <p className="small-muted">
              ML or rules fallback is selected by model availability, not a
              cosmetic mode switch. All connected users share these controls.
            </p>
          </Modal>
        )}
        {dialog === "about" && (
          <Modal title="Predictive network operations" onClose={closeDialog}>
            <div className="about-icon">
              <Boxes size={30} />
            </div>
            <p className="dialog-intro">
              SuliNOC is a deterministic LTE digital twin of{" "}
              {config.presentation.network_name}. The Doctor diagnoses, the
              Oracle forecasts, and the Commander applies cost-based policies.
            </p>
            <div className="about-roles">
              {Object.entries(config.rapp_roles).map(([key, value]) => (
                <p key={key}>
                  <Sparkles size={14} />
                  <span>{value}</span>
                </p>
              ))}
            </div>
            <p className="small-muted">
              This is a simulation, not a live operator network or certified
              O-RAN implementation. KPIs and model predictions come from the
              Python backend. The live ROI pill is an illustrative scenario
              using disclosed assumptions; paired M7 cost units are not USD, and
              the study does not show crew-hour savings.
            </p>
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="button secondary"
            >
              Explore the API <ArrowUpRight size={13} />
            </a>
          </Modal>
        )}
        <AnimatePresence>
          {toast && (
            <motion.div
              className={`toast ${toast.error ? "error" : ""}`}
              style={tone(toast.error ? p.critical : p.healthy)}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              role={toast.error ? "alert" : "status"}
            >
              <Dot color={toast.error ? p.critical : p.healthy} />
              <span>{toast.text}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setToast(null)}
              >
                <X size={15} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <WaveChat
          key={data.run_id}
          data={data}
          connection={status}
          refresh={refresh}
        />
      </div>
    </MotionConfig>
  );
}

// The welcome screen lives outside the console tree, so its iframe mounts once
// and is not remounted when telemetry arrives (remounting restarted its animation).
export default function App() {
  const [heroOpen, setHeroOpen] = useState(true);
  return (
    <>
      <HeroFrame open={heroOpen} onEnter={() => setHeroOpen(false)} />
      <Console heroOpen={heroOpen} setHeroOpen={setHeroOpen} />
    </>
  );
}

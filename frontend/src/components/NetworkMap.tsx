import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  MapContainer,
  Pane,
  CircleMarker,
  Polyline,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { useReducedMotion } from "framer-motion";
import {
  Layers3,
  LocateFixed,
  Minus,
  Plus,
  CloudLightning,
  MapPin,
} from "lucide-react";
import type {
  Config,
  Cut,
  District,
  LatLng,
  NodeData,
  Ring,
  Snapshot,
} from "../types/api";
import { Dot, PanelHeading, PanelInfoButton, tone } from "./ui";
import { CrewLayer } from "./CrewLayer";
import TileBasemap, { type StreetStatus } from "./TileBasemap";

/** Self-contained geographic schematic: only the engine's existing road
 * corridors are drawn. There are deliberately no remote image tiles, API keys,
 * fabricated streets or inferred district boundaries. A dedicated lower pane
 * keeps these reference routes behind the live operational overlays. */
const LocalBasemap = memo(function LocalBasemap({
  config,
}: {
  config: Config;
}) {
  const renderer = useMemo(
    () => L.svg({ pane: "local-basemap", padding: 0.15 }),
    [],
  );
  return (
    <Pane name="local-basemap" style={{ zIndex: 250 }}>
      {config.presentation.roads.map((road) => (
        <Polyline
          key={road.name}
          positions={road.path}
          renderer={renderer}
          className="local-road-casing"
          interactive={false}
          pathOptions={{
            color: config.presentation.palette.muted,
            weight: 7,
            opacity: 0.12,
          }}
        />
      ))}
      {config.presentation.roads.map((road) => (
        <Polyline
          key={road.name}
          positions={road.path}
          renderer={renderer}
          className="local-road"
          pathOptions={{
            color: config.presentation.palette.muted,
            weight: 2,
            opacity: 0.65,
          }}
        >
          <Tooltip className="network-tooltip" sticky>
            {road.name} · schematic corridor
          </Tooltip>
        </Polyline>
      ))}
    </Pane>
  );
});

/** Site dots draw on one shared canvas renderer instead of 300 individual DOM
 * markers. Geometry and palette mirror the previous `.tw` DOM rules exactly:
 * a 12 px dot (path radius 5 + 2 px white ring), a 1 px navy 20 % outline
 * around non-haloed sites, and a 6 px 22 % status halo around selected,
 * faulty and AI-flagged sites (drawn on top via bringToFront). */
const SITE_FILL: Record<string, string> = {
  "": "#0c9c83",
  warn: "#c27400",
  crit: "#d42f52",
  ai: "#6a4bd8",
};
const SITE_SELECTED_HALO = "#1479c4";
const SITE_OUTLINE = "rgba(16, 38, 92, 0.2)";
const SITE_HALO_ALPHA = 0.22;

function siteClass(
  node: NodeData,
  config: Config,
  selected: boolean,
  aiOn: boolean,
) {
  const offline = config.presentation.offline_statuses.includes(node.status);
  const faulty = node.status !== config.presentation.healthy_status;
  const aiFlag = !!node.warn && aiOn;
  return {
    cls: aiFlag ? "ai" : offline ? "crit" : faulty ? "warn" : "",
    halo: selected || faulty || aiFlag,
  };
}

interface TowerMarkerProps {
  node: NodeData;
  config: Config;
  selected: boolean;
  onSelect: (id: string) => void;
  aiOn: boolean;
  renderer: L.Canvas;
  haloLayers: RefObject<Map<string, L.CircleMarker>>;
}

function sameTowerMarker(previous: TowerMarkerProps, next: TowerMarkerProps) {
  const a = previous.node;
  const b = next.node;
  return (
    previous.config === next.config &&
    previous.selected === next.selected &&
    previous.onSelect === next.onSelect &&
    previous.aiOn === next.aiOn &&
    previous.renderer === next.renderer &&
    previous.haloLayers === next.haloLayers &&
    a.id === b.id &&
    a.lat === b.lat &&
    a.lon === b.lon &&
    a.status === b.status &&
    a.warn === b.warn &&
    a.vswr === b.vswr &&
    a.prb === b.prb
  );
}

const TowerMarker = memo(function TowerMarker({
  node,
  config,
  selected,
  onSelect,
  aiOn,
  renderer,
  haloLayers,
}: TowerMarkerProps) {
  const { cls, halo } = siteClass(node, config, selected, aiOn);
  const position = useMemo<[number, number]>(
    () => [node.lat, node.lon],
    [node.lat, node.lon],
  );
  const handleSelect = useCallback(
    () => onSelect(node.id),
    [node.id, onSelect],
  );
  const eventHandlers = useMemo(
    () => ({ click: handleSelect }),
    [handleSelect],
  );
  const dotOptions = useMemo(
    () => ({
      color: "#ffffff",
      weight: 2,
      fillColor: SITE_FILL[cls],
      fillOpacity: 1,
      opacity: 1,
    }),
    [cls],
  );
  const haloOptions = useMemo(
    () => ({
      stroke: true,
      fill: false,
      color: cls ? SITE_FILL[cls] : SITE_SELECTED_HALO,
      weight: 6,
      opacity: SITE_HALO_ALPHA,
    }),
    [cls],
  );
  // Register the interactive dot so the Towers pass can lift haloed sites to
  // the top of the canvas draw order (the old zIndexOffset 300 behaviour).
  const setDotLayer = useCallback(
    (element: L.CircleMarker | null) => {
      if (element && halo) haloLayers.current?.set(node.id, element);
      else haloLayers.current?.delete(node.id);
    },
    [halo, haloLayers, node.id],
  );

  return (
    <>
      {halo ? (
        <CircleMarker
          renderer={renderer}
          center={position}
          radius={9}
          interactive={false}
          pathOptions={haloOptions}
        />
      ) : (
        <CircleMarker
          renderer={renderer}
          center={position}
          radius={6.5}
          interactive={false}
          pathOptions={{
            stroke: true,
            fill: false,
            color: SITE_OUTLINE,
            weight: 1,
            opacity: 1,
          }}
        />
      )}
      <CircleMarker
        ref={setDotLayer}
        renderer={renderer}
        center={position}
        radius={5}
        eventHandlers={eventHandlers}
        pathOptions={dotOptions}
      >
        <Tooltip className="network-tooltip" direction="top" offset={[0, -7]}>
          <strong>{node.id}</strong>
          <br />
          {config.status_names[node.status]}
          <br />
          {config.metric_labels.vswr} {node.vswr.toFixed(2)} ·{" "}
          {config.metric_labels.prb} {node.prb.toFixed(1)}%
        </Tooltip>
      </CircleMarker>
    </>
  );
}, sameTowerMarker);

/** The slice Towers renders: marker + tooltip fields only. Ticks that change
 * nothing visible skip the whole 300-site pass. Exported for the slice
 * tests. */
export function sameSiteNodes(a: NodeData[], b: NodeData[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.lat !== y.lat ||
      x.lon !== y.lon ||
      x.status !== y.status ||
      x.warn !== y.warn ||
      x.vswr !== y.vswr ||
      x.prb !== y.prb
    )
      return false;
  }
  return true;
}

const Towers = memo(
  function Towers({
    nodes,
    config,
    aiOn,
    selectedId,
    onSelect,
  }: {
    nodes: NodeData[];
    config: Config;
    selectedId: string | null;
    onSelect: (id: string) => void;
    aiOn: boolean;
  }) {
    // Own renderer + pane, so toggling the sites layer unmounts both together
    // (same lifecycle LocalBasemap uses). The pane sits above the SVG overlays
    // (z 400) and below the crew markers (marker pane z 600) — the stacking
    // the DOM markers used to have.
    const renderer = useMemo(
      () => L.canvas({ pane: "sites-canvas", padding: 0.15 }),
      [],
    );
    const haloLayers = useRef(new Map<string, L.CircleMarker>());
    useEffect(() => {
      // Selected/faulty/AI-flagged sites draw on top of the canvas draw list,
      // matching the old zIndexOffset 300. Runs only when the slice changed.
      for (const layer of haloLayers.current.values()) layer.bringToFront();
    });
    return (
      <Pane name="sites-canvas" style={{ zIndex: 560 }}>
        {nodes.map((node) => (
          <TowerMarker
            key={node.id}
            node={node}
            config={config}
            aiOn={aiOn}
            selected={node.id === selectedId}
            onSelect={onSelect}
            renderer={renderer}
            haloLayers={haloLayers}
          />
        ))}
      </Pane>
    );
  },
  (previous, next) =>
    previous.config === next.config &&
    previous.onSelect === next.onSelect &&
    previous.selectedId === next.selectedId &&
    previous.aiOn === next.aiOn &&
    sameSiteNodes(previous.nodes, next.nodes),
);

function sameCoordinates(previous: LatLng[], next: LatLng[]) {
  return (
    previous === next ||
    (previous.length === next.length &&
      previous.every(
        (point, index) =>
          point[0] === next[index][0] && point[1] === next[index][1],
      ))
  );
}

function sameCut(previous: Cut, next: Cut) {
  return (
    previous.lat === next.lat &&
    previous.lon === next.lon &&
    previous.seg === next.seg &&
    previous.cause === next.cause &&
    ((previous.path === undefined && next.path === undefined) ||
      (previous.path !== undefined &&
        next.path !== undefined &&
        sameCoordinates(previous.path, next.path)))
  );
}

function sameRingLayers(previous: Ring[], next: Ring[]) {
  return (
    previous === next ||
    (previous.length === next.length &&
      previous.every((ring, index) => {
        const other = next[index];
        return (
          ring.id === other.id &&
          ring.isolated === other.isolated &&
          sameCoordinates(ring.path, other.path) &&
          ring.cuts.length === other.cuts.length &&
          ring.cuts.every((cut, cutIndex) => sameCut(cut, other.cuts[cutIndex]))
        );
      }))
  );
}

const FiberOverlays = memo(
  function FiberOverlays({
    rings,
    renderer,
    fiber,
    warning,
    critical,
  }: {
    rings: Ring[];
    renderer: L.Renderer;
    fiber: string;
    warning: string;
    critical: string;
  }) {
    return (
      <>
        {rings.map((ring) => (
          <Fragment key={ring.id}>
            <Polyline
              positions={ring.path}
              renderer={renderer}
              className="fiber-flow"
              pathOptions={{
                color: fiber,
                weight: 1.3,
                opacity: 0.48,
                dashArray: "5 7",
              }}
            />
            {ring.cuts.map((cut, index) => (
              <Fragment key={index}>
                <Polyline
                  renderer={renderer}
                  className="cut-segment"
                  positions={
                    cut.path ?? [
                      [cut.lat, cut.lon],
                      [cut.lat, cut.lon],
                    ]
                  }
                  pathOptions={{
                    color: ring.isolated ? critical : warning,
                    weight: 3,
                    opacity: 0.95,
                  }}
                />
                {/* Cut pulse markers live here (not as loose children of
                    MapContainer) so the sameRingLayers memo covers them too. */}
                <CircleMarker
                  renderer={renderer}
                  className="cut-pulse"
                  center={[cut.lat, cut.lon]}
                  radius={10}
                  pathOptions={{
                    color: ring.isolated ? critical : warning,
                    weight: 2,
                    fillOpacity: 0.22,
                  }}
                >
                  <Tooltip className="network-tooltip">
                    {cut.seg} · {cut.cause} ·{" "}
                    {ring.isolated ? "Isolated" : "Unprotected"}
                  </Tooltip>
                </CircleMarker>
              </Fragment>
            ))}
          </Fragment>
        ))}
      </>
    );
  },
  (previous, next) =>
    previous.renderer === next.renderer &&
    previous.fiber === next.fiber &&
    previous.warning === next.warning &&
    previous.critical === next.critical &&
    sameRingLayers(previous.rings, next.rings),
);

/** AI-flagged sites keep their pulsing halo on the SVG overlay (only a
 * handful at a time). Memoized on the warn/position slice. */
const PredictionPulses = memo(
  function PredictionPulses({
    nodes,
    color,
    renderer,
  }: {
    nodes: NodeData[];
    color: string;
    renderer: L.Renderer;
  }) {
    return (
      <>
        {nodes
          .filter((n) => n.warn)
          .map((n) => (
            <CircleMarker
              key={`prediction-${n.id}`}
              center={[n.lat, n.lon]}
              radius={13}
              renderer={renderer}
              className="predictive-pulse"
              interactive={false}
              pathOptions={{
                color,
                fillOpacity: 0,
                weight: 1.4,
              }}
            />
          ))}
      </>
    );
  },
  (previous, next) =>
    previous.color === next.color &&
    previous.renderer === next.renderer &&
    sameWarnNodes(previous.nodes, next.nodes),
);

function sameWarnNodes(a: NodeData[], b: NodeData[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.warn !== y.warn ||
      x.lat !== y.lat ||
      x.lon !== y.lon
    )
      return false;
  }
  return true;
}

/** District dots + permanent name labels; memoized on the district slice. */
const DistrictLabels = memo(
  function DistrictLabels({
    districts,
    color,
  }: {
    districts: District[];
    color: string;
  }) {
    return (
      <>
        {districts.map((a) => (
          <CircleMarker
            key={a.id}
            center={[a.lat, a.lon]}
            radius={2}
            pathOptions={{ opacity: 0.5, color, fillOpacity: 0.8 }}
            interactive={false}
          >
            <Tooltip
              permanent
              direction="top"
              offset={[0, -4]}
              className="district-label"
            >
              {a.name}
            </Tooltip>
          </CircleMarker>
        ))}
      </>
    );
  },
  (previous, next) =>
    previous.color === next.color &&
    sameDistricts(previous.districts, next.districts),
);

function sameDistricts(a: District[], b: District[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].id !== b[i].id ||
      a[i].lat !== b[i].lat ||
      a[i].lon !== b[i].lon ||
      a[i].name !== b[i].name
    )
      return false;
  }
  return true;
}

function MapTools({
  config,
  selected,
  district,
  resetKey,
}: {
  config: Config;
  selected?: NodeData;
  district: number | null;
  resetKey: number;
}) {
  const map = useMap();
  const reduced = useReducedMotion();
  useEffect(() => {
    const scale = L.control
      .scale({ position: "bottomright", imperial: false, maxWidth: 80 })
      .addTo(map);
    return () => {
      scale.remove();
    };
  }, [map]);
  // Pause the decorative fiber-flow/cut/predictive animations while the user
  // pans or zooms (class rules live in app.css) — no repaints for motion that
  // is blurred by the gesture anyway.
  useEffect(() => {
    const container = map.getContainer();
    let interactions = 0;
    const bump = (delta: number) => () => {
      interactions = Math.max(0, interactions + delta);
      container.classList.toggle("map-interacting", interactions > 0);
    };
    const start = bump(1);
    const end = bump(-1);
    map.on({ movestart: start, zoomstart: start, moveend: end, zoomend: end });
    return () => {
      map.off({
        movestart: start,
        zoomstart: start,
        moveend: end,
        zoomend: end,
      });
      container.classList.remove("map-interacting");
    };
  }, [map]);
  // Refs read by the resize observer, so it always sees the latest config and selection.
  const configRef = useRef(config);
  configRef.current = config;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const fitAll = useCallback(() => {
    const b = configRef.current.bounds;
    map.fitBounds(
      [
        [b.lat_min, b.lon_min],
        [b.lat_max, b.lon_max],
      ],
      { padding: [15, 15], animate: false },
    );
  }, [map]);
  useEffect(() => {
    // On resize: recompute the map size, then refit all towers (unless one is selected).
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      if (!selectedRef.current) fitAll();
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, fitAll]);
  useEffect(() => {
    fitAll();
  }, [fitAll, config, resetKey]);
  useEffect(() => {
    if (selected)
      map.flyTo(
        [selected.lat, selected.lon],
        Math.max(map.getZoom(), config.map_zoom + 1),
        { duration: reduced ? 0 : 0.85 },
      );
    // Telemetry updates must not re-center the viewport every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selected?.id, reduced, config.map_zoom]);
  useEffect(() => {
    if (district !== null) {
      const site = config.agg_sites.find((s) => s.id === district);
      if (site)
        map.flyTo([site.lat, site.lon], config.map_zoom + 1, {
          duration: reduced ? 0 : 0.85,
        });
    }
  }, [map, config, district, reduced]);
  return (
    <div className="map-zoom" onMouseDown={(e) => e.stopPropagation()}>
      <button aria-label="Zoom in" onClick={() => map.zoomIn()}>
        <Plus size={18} />
      </button>
      <button aria-label="Zoom out" onClick={() => map.zoomOut()}>
        <Minus size={18} />
      </button>
    </div>
  );
}

export function NetworkMap({
  config,
  data,
  selectedId,
  onSelect,
}: {
  config: Config;
  data: Snapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Padding trimmed from 0.4: the overlay canvas used to paint ~3.2x the
  // viewport on every redraw; 0.15 keeps ~1.3x and no visible clipping.
  const svgRenderer = useMemo(() => L.svg({ padding: 0.15 }), []);
  const [layers, setLayers] = useState({
    sites: true,
    fiber: true,
    crews: true,
    districts: true,
    streets: true,
  });
  const [layerMenu, setLayerMenu] = useState(false);
  const [streetStatus, setStreetStatus] = useState<StreetStatus>("loading");
  const [streetAttempt, setStreetAttempt] = useState(0);
  const [district, setDistrict] = useState<number | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const p = config.presentation.palette;
  const selected = data.nodes.find((n) => n.id === selectedId);
  const storm = data.agg.find((a) => a.weather === "Storm");
  const b = config.bounds;
  return (
    <section
      id="network"
      className="glass map-panel"
      aria-label="Live network map"
    >
      <PanelHeading
        title="Live network"
        right={
          <div className="map-heading-right">
            <Dot color={p.healthy} pulse={!data.control.paused} />
            <span>LIVE NETWORK</span>
            <span className="divider" />
            <span>{config.num_nodes} sites</span>
          </div>
        }
      />
      <p className="note">
        Live from the current simulation run. Crews move between confirmed
        positions.
      </p>
      <div className="map-stage" data-street-status={streetStatus}>
        <MapContainer
          center={config.map_center}
          zoom={config.map_zoom}
          minZoom={config.map_zoom - 2}
          maxZoom={19}
          maxBounds={L.latLngBounds([
            [b.lat_min, b.lon_min],
            [b.lat_max, b.lon_max],
          ]).pad(0.8)}
          zoomSnap={0.1}
          zoomDelta={0.5}
          zoomControl={false}
          attributionControl
          scrollWheelZoom
        >
          {(!layers.streets || streetStatus !== "ready") && (
            <LocalBasemap config={config} />
          )}
          {layers.streets && (
            <TileBasemap key={streetAttempt} onStatus={setStreetStatus} />
          )}
          {layers.fiber && (
            <FiberOverlays
              rings={data.rings}
              renderer={svgRenderer}
              fiber={p.fiber}
              warning={p.warning}
              critical={p.critical}
            />
          )}
          {layers.sites && (
            <Towers
              nodes={data.nodes}
              config={config}
              selectedId={selectedId}
              aiOn={data.ai.ai_enabled}
              onSelect={onSelect}
            />
          )}
          {layers.sites && data.ai.ai_enabled && (
            <PredictionPulses
              nodes={data.nodes}
              color={p.prediction}
              renderer={svgRenderer}
            />
          )}
          {layers.districts && (
            <DistrictLabels districts={data.agg} color={p.fiber} />
          )}
          {selected && (
            <CircleMarker
              center={[selected.lat, selected.lon]}
              radius={13}
              pathOptions={{ color: p.crew, weight: 1.5, fillOpacity: 0 }}
              interactive={false}
            />
          )}
          {layers.crews && <CrewLayer data={data} config={config} />}
          <MapTools
            config={config}
            selected={selected}
            district={district}
            resetKey={resetKey}
          />
        </MapContainer>
        <div className="map-top-overlay">
          <select
            aria-label="Focus district"
            value={district ?? ""}
            onChange={(e) => {
              setDistrict(
                e.target.value === "" ? null : Number(e.target.value),
              );
              if (!e.target.value) setResetKey((k) => k + 1);
            }}
          >
            <option value="">All districts</option>
            {config.agg_sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label="Map style">
            <button
              type="button"
              className={layers.streets ? "selected" : ""}
              aria-pressed={layers.streets}
              onClick={() => setLayers((v) => ({ ...v, streets: true }))}
            >
              Map
            </button>
            <button
              type="button"
              className={!layers.streets ? "selected" : ""}
              aria-pressed={!layers.streets}
              onClick={() => setLayers((v) => ({ ...v, streets: false }))}
            >
              Schematic
            </button>
          </div>
          <div className="layer-control">
            <button
              className={`map-button ${layerMenu ? "active" : ""}`}
              aria-expanded={layerMenu}
              aria-label="Map layers"
              onClick={() => setLayerMenu((v) => !v)}
            >
              <Layers3 size={14} />
            </button>
            {layerMenu && (
              <div className="layer-menu">
                {Object.entries(layers).map(([key, value]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={() =>
                        setLayers((v) => ({ ...v, [key]: !value }))
                      }
                    />
                    {key}
                  </label>
                ))}
              </div>
            )}
            <button
              className="map-button"
              aria-label="Reset map view"
              onClick={() => {
                setDistrict(null);
                setResetKey((k) => k + 1);
              }}
            >
              <LocateFixed size={14} />
            </button>
          </div>
        </div>
        <div className="map-location">
          <MapPin size={14} /> IRAQ <span> / </span> KURDISTAN <span> / </span>{" "}
          SULAYMANIYAH
        </div>
        {storm && (
          <div
            key={storm.id}
            className="weather-chip"
            style={tone(p.warning)}
            role="status"
            aria-live="polite"
          >
            <CloudLightning size={14} />
            <div>
              <strong>Storm over {storm.name}</strong>
              <span>
                Wind {storm.wind} km/h · {storm.node_count} sites in area
              </span>
            </div>
          </div>
        )}
        {layers.streets && streetStatus === "unavailable" && (
          <div className="map-mode" aria-live="polite">
            <span aria-hidden="true" />
            <span className="map-mode-label">
              Streets unavailable · schematic
            </span>
            <button
              type="button"
              onClick={() => setStreetAttempt((n) => n + 1)}
            >
              Retry streets
            </button>
          </div>
        )}
        <div className="map-north" aria-label="North is up">
          <span>N</span>
          <span aria-hidden="true">↑</span>
        </div>
      </div>
      <div className="map-footer">
        <div className="map-legend">
          {Object.entries(config.status_names).map(([id, name]) => (
            <span key={id}>
              <Dot color={config.status_colors[Number(id)]} />
              {name}
            </span>
          ))}
        </div>
        <span className="map-footer-hint">
          Select a site to inspect <span>↗</span>
        </span>
      </div>
      <div className="ring-list" aria-label="Fibre rings">
        <div className="ring-list-heading">
          <h3 className="ring-list-title">Fibre rings</h3>
          <PanelInfoButton title="Fibre rings" compact />
        </div>
        <ul>
          {data.rings.map((r) => (
            <li key={r.id}>
              <span className="mono">RING {r.id}</span>
              <span>{r.nodes.length} sites</span>
              <span>{r.circumference_km.toFixed(1)} km</span>
              <span>
                {r.isolated
                  ? "isolated"
                  : r.cuts.length
                    ? `${r.cuts.length} cut${r.cuts.length > 1 ? "s" : ""}`
                    : "intact"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

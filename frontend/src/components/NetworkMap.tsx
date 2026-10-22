import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MapContainer,
  Pane,
  CircleMarker,
  Marker,
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
    () => L.svg({ pane: "local-basemap", padding: 0.4 }),
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

/** Tower markers follow the kit's `.tw` rules (theme.css): solid fill, white
 * 2 px ring, 12 px on screen at every zoom. A halo is drawn only for the
 * selected tower, faulty towers (warn/crit) and flagged towers (prediction). */
const towerIconCache = new Map<string, L.DivIcon>();
function towerIcon(cls: string, halo: boolean): L.DivIcon {
  const key = `${cls}|${halo}`;
  let icon = towerIconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: "tw-wrapper",
      html: `<span class="tw ${cls}${halo ? " sel" : ""}"></span>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    towerIconCache.set(key, icon);
  }
  return icon;
}

interface TowerMarkerProps {
  node: NodeData;
  config: Config;
  selected: boolean;
  onSelect: (id: string) => void;
  aiOn: boolean;
}

function sameTowerMarker(previous: TowerMarkerProps, next: TowerMarkerProps) {
  const a = previous.node;
  const b = next.node;
  return (
    previous.config === next.config &&
    previous.selected === next.selected &&
    previous.onSelect === next.onSelect &&
    previous.aiOn === next.aiOn &&
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
}: TowerMarkerProps) {
  const offline = config.presentation.offline_statuses.includes(node.status);
  const faulty = node.status !== config.presentation.healthy_status;
  const aiFlag = !!node.warn && aiOn;
  const cls = aiFlag ? "ai" : offline ? "crit" : faulty ? "warn" : "";
  const halo = selected || faulty || aiFlag;
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

  return (
    <Marker
      position={position}
      icon={towerIcon(cls, halo)}
      zIndexOffset={halo ? 300 : 0}
      eventHandlers={eventHandlers}
    >
      <Tooltip className="network-tooltip" direction="top" offset={[0, -7]}>
        <strong>{node.id}</strong>
        <br />
        {config.status_names[node.status]}
        <br />
        {config.metric_labels.vswr} {node.vswr.toFixed(2)} ·{" "}
        {config.metric_labels.prb} {node.prb.toFixed(1)}%
      </Tooltip>
    </Marker>
  );
}, sameTowerMarker);

const Towers = memo(function Towers({
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
  return (
    <>
      {nodes.map((node) => (
        <TowerMarker
          key={node.id}
          node={node}
          config={config}
          aiOn={aiOn}
          selected={node.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
});

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
              <Polyline
                key={index}
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
        <Plus size={16} />
      </button>
      <button aria-label="Zoom out" onClick={() => map.zoomOut()}>
        <Minus size={16} />
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
  const svgRenderer = useMemo(() => L.svg({ padding: 0.4 }), []);
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
          {layers.sites &&
            data.nodes
              .filter((n) => n.warn && data.ai.ai_enabled)
              .map((n) => (
                <CircleMarker
                  key={`prediction-${n.id}`}
                  center={[n.lat, n.lon]}
                  radius={13}
                  renderer={svgRenderer}
                  className="predictive-pulse"
                  interactive={false}
                  pathOptions={{
                    color: p.prediction,
                    fillOpacity: 0,
                    weight: 1.4,
                  }}
                />
              ))}
          {layers.districts &&
            data.agg.map((a) => (
              <CircleMarker
                key={a.id}
                center={[a.lat, a.lon]}
                radius={2}
                pathOptions={{ opacity: 0.5, color: p.fiber, fillOpacity: 0.8 }}
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
          {layers.fiber &&
            data.rings.flatMap((r) =>
              r.cuts.map((c, i) => (
                <CircleMarker
                  key={`cut-${r.id}-${i}`}
                  renderer={svgRenderer}
                  className="cut-pulse"
                  center={[c.lat, c.lon]}
                  radius={10}
                  pathOptions={{
                    color: r.isolated ? p.critical : p.warning,
                    weight: 2,
                    fillOpacity: 0.22,
                  }}
                >
                  <Tooltip className="network-tooltip">
                    {c.seg} · {c.cause} ·{" "}
                    {r.isolated ? "Isolated" : "Unprotected"}
                  </Tooltip>
                </CircleMarker>
              )),
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
              <Layers3 size={15} />
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
              <LocateFixed size={15} />
            </button>
          </div>
        </div>
        <div className="map-location">
          <MapPin size={12} /> IRAQ <span> / </span> KURDISTAN <span> / </span>{" "}
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
            <CloudLightning size={15} />
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

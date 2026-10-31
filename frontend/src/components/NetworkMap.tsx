import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  MapContainer,
  Marker,
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

/** A fly-to request raised by the topology panel (cluster or ring click). */
type ClusterFocus = { bounds: L.LatLngBounds; key: number };

/** Cluster health reads blue when healthy (the kit's link blue), amber when
 * degraded and red when critical — green stays reserved for site status. */
const CLUSTER_HEALTHY_BLUE = "#1479c4";
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
  /** The map keeps ONE tooltip; a marker only says when it is hovered. */
  onHover: (id: string) => void;
  onHoverEnd: () => void;
  aiOn: boolean;
  renderer: L.Canvas;
  haloLayers: RefObject<Map<string, L.CircleMarker>>;
}

/** The tooltip that used to be mounted inside all 300 markers.
 *
 * Same markup, same text, same `.network-tooltip` class (Leaflet renders it in
 * one shared element while a site is hovered), so the stylesheet is untouched.
 * Values are read from the node object it is handed, i.e. still live.
 */
export function siteTooltipHtml(node: NodeData, config: Config) {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    `<strong>${escape(node.id)}</strong><br>` +
    `${escape(config.status_names[node.status])}<br>` +
    `${escape(config.metric_labels.vswr)} ${node.vswr.toFixed(2)} · ` +
    `${escape(config.metric_labels.prb)} ${node.prb.toFixed(1)}%`
  );
}

function sameTowerMarker(previous: TowerMarkerProps, next: TowerMarkerProps) {
  return (
    previous.config === next.config &&
    previous.selected === next.selected &&
    previous.onSelect === next.onSelect &&
    previous.onHover === next.onHover &&
    previous.onHoverEnd === next.onHoverEnd &&
    previous.aiOn === next.aiOn &&
    previous.renderer === next.renderer &&
    previous.haloLayers === next.haloLayers &&
    sameSiteAppearance(previous.node, next.node)
  );
}

const TowerMarker = memo(function TowerMarker({
  node,
  config,
  selected,
  onSelect,
  onHover,
  onHoverEnd,
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
  const handleHover = useCallback(() => onHover(node.id), [node.id, onHover]);
  const eventHandlers = useMemo(
    () => ({
      click: handleSelect,
      mouseover: handleHover,
      mouseout: onHoverEnd,
    }),
    [handleSelect, handleHover, onHoverEnd],
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
      />
    </>
  );
}, sameTowerMarker);

/** Does this site draw differently on screen?
 *
 * A dot is 12 px: its colour comes from `status` (+`warn`), its halo from
 * selection/status/warn and its position from lat/lon — that is the whole
 * marker. `vswr` and `prb` are printed in the tooltip only (see SiteTooltip,
 * which keeps them live), so a value that moves in the second decimal must not
 * redraw a canvas marker: prb moved for ~298/300 sites and vswr for ~137/300
 * every second, which re-rendered the entire 300-marker layer one second at a
 * time. Exported for the slice tests. */
export function sameSiteAppearance(x: NodeData, y: NodeData) {
  return (
    x.id === y.id &&
    x.lat === y.lat &&
    x.lon === y.lon &&
    x.status === y.status &&
    x.warn === y.warn
  );
}

/** The slice Towers renders: marker + tooltip fields only. Ticks that change
 * nothing visible skip the whole 300-site pass. Exported for the slice
 * tests. */
export function sameSiteNodes(a: NodeData[], b: NodeData[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!sameSiteAppearance(a[i], b[i])) return false;
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
    onHover,
    onHoverEnd,
  }: {
    nodes: NodeData[];
    config: Config;
    selectedId: string | null;
    onSelect: (id: string) => void;
    aiOn: boolean;
    onHover: (id: string) => void;
    onHoverEnd: () => void;
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

    // 300 markers used to each carry their own <Tooltip>. None do now: a marker
    // only reports hover, and the single shared SiteTooltip is mounted once for
    // the whole map.
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
            onHover={onHover}
            onHoverEnd={onHoverEnd}
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
    previous.onHover === next.onHover &&
    previous.onHoverEnd === next.onHoverEnd &&
    sameSiteNodes(previous.nodes, next.nodes),
);

/** The one site tooltip the map owns.
 *
 * Replaces 300 per-marker <Tooltip> trees. It renders nothing in React — it moves
 * one Leaflet tooltip to the hovered site and re-labels it — and because it is
 * re-rendered by the map on every tick, the numbers it prints stay live while it
 * is open. Nothing about it runs when no site is hovered.
 */
const SiteTooltip = memo(function SiteTooltip({
  nodes,
  config,
  hoveredId,
  onHide,
}: {
  nodes: NodeData[];
  config: Config;
  hoveredId: string | null;
  onHide: () => void;
}) {
  const map = useMap();
  const tooltip = useMemo(
    () =>
      L.tooltip({
        className: "network-tooltip",
        direction: "top",
        offset: [0, -7],
      }),
    [],
  );
  const shown = useRef<{ id: string; html: string } | null>(null);

  useEffect(() => {
    if (!hoveredId) {
      shown.current = null;
      tooltip.remove();
      return;
    }
    const node = nodes.find((candidate) => candidate.id === hoveredId);
    if (!node) {
      shown.current = null;
      onHide();
      return;
    }
    const html = siteTooltipHtml(node, config);
    if (shown.current?.id === node.id && shown.current.html === html) return;
    shown.current = { id: node.id, html };
    tooltip.setLatLng([node.lat, node.lon]).setContent(html);
    tooltip.openOn(map);
  }, [nodes, config, hoveredId, map, onHide, tooltip]);

  useEffect(() => {
    // A click on the bare map closes it. On a phone a tap closes it too: the
    // inspector is the readout there and a tooltip cannot be dismissed by moving
    // away.
    const onMapClick = (event: L.LeafletMouseEvent) => {
      const coarse =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches;
      const target = (event as unknown as { sourceTarget?: unknown })
        .sourceTarget;
      if (coarse || target === map) onHide();
    };
    map.on("click", onMapClick);
    return () => {
      map.off("click", onMapClick);
      tooltip.remove();
    };
  }, [map, onHide, tooltip]);

  return null;
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

/** Flat-top hexagon points around (cx, cy) — used for the Core badge. */
function hexPoints(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let a = 0; a < 6; a += 1) {
    const rad = (a * Math.PI) / 3;
    pts.push(
      `${(cx + r * Math.cos(rad)).toFixed(2)},${(cy + r * Math.sin(rad)).toFixed(2)}`,
    );
  }
  return pts.join(" ");
}

/** The LTE Core (EPC): one distinct marker above every site dot and truck —
 * a solid midnight hexagon badge with a cyan inner ring and a cobalt outer
 * ring, a white server glyph and a soft static glow. It is never one of the
 * sites: it joins no counts, lists or KPIs. */
const CoreMarker = memo(function CoreMarker({
  core,
  onCoreClick,
}: {
  core: Config["core"];
  onCoreClick: () => void;
}) {
  const icon = useMemo(
    () =>
      L.divIcon({
        className: "core-marker",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        html: `<svg viewBox="0 0 44 44" width="40" height="40" role="img" aria-hidden="true" focusable="false">
          <polygon points="${hexPoints(22, 22, 19)}" fill="#060B18" stroke="#3768F5" stroke-width="2"/>
          <polygon points="${hexPoints(22, 22, 15.5)}" fill="none" stroke="#36DFFF" stroke-width="1.25" class="core-pulse"/>
          <g fill="#FFFFFF">
            <rect x="15.5" y="14.6" width="13" height="3.4" rx="1.2"/>
            <rect x="15.5" y="20.3" width="13" height="3.4" rx="1.2"/>
            <rect x="15.5" y="26" width="13" height="3.4" rx="1.2"/>
          </g>
          <g fill="#36DFFF">
            <circle cx="25.9" cy="16.3" r="0.9"/>
            <circle cx="25.9" cy="22" r="0.9"/>
            <circle cx="25.9" cy="27.7" r="0.9"/>
          </g>
        </svg>`,
      }),
    [],
  );
  return (
    <Marker
      position={[core.lat, core.lon]}
      icon={icon}
      zIndexOffset={1000}
      eventHandlers={{ click: onCoreClick }}
    >
      <Tooltip direction="top" offset={[0, -16]}>
        <strong>{core.name}</strong> · {core.place} · crew depot
        <br />
        EPC: {core.epc.map((el) => el.id).join(" · ")}
      </Tooltip>
    </Marker>
  );
});

/** When the Core's thin backhaul links are shown:
 *  - "all": every Core-to-aggregation link (Schematic view, or the Core panel
 *    is open in Map view),
 *  - a cluster id: only that cluster's rings (a cluster is selected in Map
 *    view),
 *  - "none": hidden (Map view default). */
export type CoreLinkMode = "all" | "none" | number;

const pathElement = (line: L.Polyline | null): SVGElement | null =>
  (line as unknown as { _path?: SVGElement } | null)?._path ?? null;

/** Thin light-styled backhaul links from the Core to each ring's
 * aggregation node. The paths stay mounted and fade through a CSS class
 * toggle on the SVG element, so selections fade in and out instead of
 * popping. Purely decorative, so they never catch pointer events. */
const CoreLinks = memo(function CoreLinks({
  config,
  renderer,
  color,
  mode,
}: {
  config: Config;
  renderer: L.SVG;
  color: string;
  mode: CoreLinkMode;
}) {
  const lines = useRef<(L.Polyline | null)[]>([]);
  const core: LatLng = [config.core.lat, config.core.lon];
  useLayoutEffect(() => {
    // Runs before paint, so a fresh "none" never flashes the links.
    config.agg_sites.forEach((site, i) => {
      const element = pathElement(lines.current[i]);
      if (!element) return;
      const visible =
        mode === "all" || (typeof mode === "number" && site.cluster === mode);
      element.classList.toggle("core-link-hidden", !visible);
    });
  }, [mode, config]);
  return (
    <>
      {config.agg_sites.map((site, i) => (
        <Polyline
          key={site.id}
          ref={(instance) => {
            lines.current[i] = instance;
          }}
          positions={[core, [site.lat, site.lon]]}
          renderer={renderer}
          interactive={false}
          pathOptions={{
            color,
            weight: 1,
            opacity: 0.4,
            className: "core-link",
          }}
        />
      ))}
    </>
  );
});

function MapTools({
  config,
  selected,
  district,
  resetKey,
  focus,
}: {
  config: Config;
  selected?: NodeData;
  district: number | null;
  resetKey: number;
  focus: ClusterFocus | null;
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
  // Also pause the decorative animations (Core pulse) while the tab is
  // hidden: CSS cannot see document visibility, so toggle a helper class.
  useEffect(() => {
    const container = map.getContainer();
    const onVisibility = () =>
      container.classList.toggle("map-tab-hidden", document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      container.classList.remove("map-tab-hidden");
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
  // Topology requests: zoom to a cluster (or a faulted ring) from the panel
  // below the map. `key` lets the same target be re-requested.
  useEffect(() => {
    if (focus)
      map.flyToBounds(focus.bounds, {
        padding: [18, 18],
        duration: reduced ? 0 : 0.9,
      });
  }, [map, focus, reduced]);
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
  onCoreClick,
  coreActive,
}: {
  config: Config;
  data: Snapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCoreClick: () => void;
  coreActive: boolean;
}) {
  // Padding trimmed from 0.4: the overlay canvas used to paint ~3.2x the
  // viewport on every redraw; 0.15 keeps ~1.3x and no visible clipping.
  const svgRenderer = useMemo(() => L.svg({ padding: 0.15 }), []);

  // Apply Maintenance Fleet layout class when clicking a tower
  const inspectorClass = selectedId !== null ? "maintenance-layout" : "";
  const [layers, setLayers] = useState({
    sites: true,
    fiber: true,
    crews: true,
    core: true,
    streets: true,
  });
  const [layerMenu, setLayerMenu] = useState(false);
  const [streetStatus, setStreetStatus] = useState<StreetStatus>("loading");
  const [streetAttempt, setStreetAttempt] = useState(0);
  const [district, setDistrict] = useState<number | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [clusterFocus, setClusterFocus] = useState<ClusterFocus | null>(null);
  // The cluster whose Core links are shown in Map view (toggle in the
  // topology panel); cleared by the reset-view button.
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  // The hovered site, if any. Hover state is held here (not in the 300 markers)
  // so one shared tooltip can follow it without touching the marker layer.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const handleHover = useCallback((id: string) => setHoveredId(id), []);
  const handleHoverEnd = useCallback(() => setHoveredId(null), []);
  const p = config.presentation.palette;
  const selected = data.nodes.find((n) => n.id === selectedId);
  const storm = data.agg.find((a) => a.weather === "Storm");
  const b = config.bounds;
  // ---- topology panel helpers -------------------------------------------
  const healthyStatus = config.presentation.healthy_status;
  // Live per-cluster health, computed from the node stream (sites inherit
  // their cluster from their ring; the Core joins no count).
  const clusterHealth = useMemo(() => {
    const stats = [
      { id: 1, sites: 0, healthy: 0 },
      { id: 2, sites: 0, healthy: 0 },
      { id: 3, sites: 0, healthy: 0 },
    ];
    for (const n of data.nodes) {
      const row = stats[n.cluster - 1];
      if (!row) continue;
      row.sites += 1;
      if (n.status === healthyStatus) row.healthy += 1;
    }
    return stats;
  }, [data.nodes, healthyStatus]);
  // Sites per ring that are not healthy right now — the "affected" count a
  // fiber cut or ring fault highlights.
  const ringAffected = useMemo(() => {
    const counts = new Map<number, number>();
    for (const n of data.nodes) {
      if (n.status === healthyStatus) continue;
      counts.set(n.ring, (counts.get(n.ring) ?? 0) + 1);
    }
    return counts;
  }, [data.nodes, healthyStatus]);
  const focusCluster = (clusterId: number) => {
    const bounds = L.latLngBounds([]);
    for (const r of data.rings)
      if (r.cluster === clusterId) bounds.extend(r.path);
    if (bounds.isValid()) setClusterFocus({ bounds, key: Date.now() });
  };
  const focusRing = (ring: Ring) => {
    const bounds = L.latLngBounds(ring.path);
    if (bounds.isValid()) setClusterFocus({ bounds, key: Date.now() });
  };
  // Core links: permanent in Schematic; in Map view only while the Core
  // panel is open (all rings) or a cluster is selected (its rings only).
  const linksMode: CoreLinkMode =
    !layers.streets || coreActive ? "all" : (selectedCluster ?? "none");
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
          className={inspectorClass}
        >
          {(!layers.streets || streetStatus !== "ready") && (
            <LocalBasemap config={config} />
          )}
          {layers.streets && (
            <TileBasemap key={streetAttempt} onStatus={setStreetStatus} />
          )}
          {layers.core && (
            <CoreLinks
              config={config}
              renderer={svgRenderer}
              color={p.fiber}
              mode={linksMode}
            />
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
              onHover={handleHover}
              onHoverEnd={handleHoverEnd}
            />
          )}
          {layers.sites && (
            <SiteTooltip
              nodes={data.nodes}
              config={config}
              hoveredId={hoveredId}
              onHide={handleHoverEnd}
            />
          )}
          {layers.sites && data.ai.ai_enabled && (
            <PredictionPulses
              nodes={data.nodes}
              color={p.prediction}
              renderer={svgRenderer}
            />
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
          {layers.core && (
            <CoreMarker core={config.core} onCoreClick={onCoreClick} />
          )}
          <MapTools
            config={config}
            selected={selected}
            district={district}
            resetKey={resetKey}
            focus={clusterFocus}
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
                setSelectedCluster(null);
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
      <div className="ring-list" aria-label="Network topology">
        <div className="ring-list-heading">
          <h3 className="ring-list-title">Network topology</h3>
          <PanelInfoButton title="Network topology" compact />
        </div>
        <button
          type="button"
          className="topology-core"
          onClick={onCoreClick}
          title="Core — Salim Street"
        >
          <span className="topology-core-badge" aria-hidden="true">
            <svg viewBox="0 0 44 44" width="28" height="28" focusable="false">
              <polygon
                points={hexPoints(22, 22, 19)}
                fill="#060B18"
                stroke="#3768F5"
                strokeWidth="2"
              />
              <polygon
                points={hexPoints(22, 22, 15.5)}
                fill="none"
                stroke="#36DFFF"
                strokeWidth="1.25"
              />
              <g fill="#FFFFFF">
                <rect x="15.5" y="14.6" width="13" height="3.4" rx="1.2" />
                <rect x="15.5" y="20.3" width="13" height="3.4" rx="1.2" />
                <rect x="15.5" y="26" width="13" height="3.4" rx="1.2" />
              </g>
            </svg>
          </span>
          <span className="topology-core-text">
            <strong>Core</strong>
            <span>
              {config.core.place} · EPC:{" "}
              {config.core.epc.map((e) => e.id).join(" · ")}
            </span>
          </span>
          <span className="topology-core-sites">{config.num_nodes} sites</span>
        </button>
        {clusterHealth.map((cluster) => {
          const rings = data.rings.filter((r) => r.cluster === cluster.id);
          const pct = cluster.sites
            ? Math.round((cluster.healthy / cluster.sites) * 100)
            : 100;
          const healthTone =
            pct >= 99
              ? CLUSTER_HEALTHY_BLUE
              : pct >= 95
                ? p.warning
                : p.critical;
          return (
            <div className="cluster-block" key={cluster.id}>
              <button
                type="button"
                className={`cluster-head${selectedCluster === cluster.id ? " selected" : ""}`}
                aria-pressed={selectedCluster === cluster.id}
                title={`Zoom to Cluster ${cluster.id}`}
                onClick={() => {
                  if (selectedCluster === cluster.id) {
                    // Deselect: the cluster's Core links fade out.
                    setSelectedCluster(null);
                  } else {
                    setSelectedCluster(cluster.id);
                    focusCluster(cluster.id);
                  }
                }}
              >
                <strong>Cluster {cluster.id}</strong>
                <span className="cluster-meta">
                  {rings.length} rings · {cluster.sites} sites
                </span>
                <span
                  className="cluster-health"
                  style={tone(healthTone)}
                >{`${pct}% healthy`}</span>
              </button>
              <ul>
                {rings.map((r) => {
                  const cuts = r.cuts.length;
                  const faulted = cuts > 0;
                  const affected = ringAffected.get(r.id) ?? 0;
                  const status = !faulted
                    ? "intact"
                    : `${r.isolated ? "isolated" : `${cuts} cut${cuts > 1 ? "s" : ""}`} · ${affected} hit`;
                  const row = (
                    <>
                      <span className="mono">RING {r.id}</span>
                      <span>{r.node_count} sites</span>
                      <span>{r.circumference_km.toFixed(1)} km</span>
                      <span
                        className={
                          faulted ? "ring-status fault" : "ring-status"
                        }
                      >
                        {status}
                      </span>
                    </>
                  );
                  return (
                    <li key={r.id} className={faulted ? "fault" : undefined}>
                      {faulted ? (
                        <button
                          type="button"
                          className="ring-row ring-row-button"
                          onClick={() => focusRing(r)}
                          title={`Zoom to Ring ${r.id} — ${cuts} open cut${cuts > 1 ? "s" : ""}, ${affected} affected site${affected === 1 ? "" : "s"}`}
                        >
                          {row}
                        </button>
                      ) : (
                        <span className="ring-row">{row}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Config, Snapshot, Team } from "../types/api";
import { CrewMotion } from "../crew-motion.js";
import { CREW_MOTION } from "../crew-motion.config.js";
import { CrewTrips } from "../adapters.js";

const projectLatLng = (lat: number, lon: number): [number, number] => {
  const p = L.CRS.EPSG3857.project(L.latLng(lat, lon));
  return [p.x, p.y];
};

// Repair-ring geometry, derived once from the config's tunables.
const RING = CREW_MOTION.repairRing;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING.radiusPx;
const RING_STEP = RING_CIRCUMFERENCE / RING.segments;
const RING_DASH = RING_STEP * 0.7;
const RING_GAP = RING_STEP - RING_DASH;

/** First repair snapshot seen for a crew: the ETA at that moment is the
 * mission's total, so later ETAs read as a fraction of it. */
export interface RepairTrack {
  target: string | null;
  startEta: number;
}

/** Records repair missions as crews enter REPAIRING and returns the crew's
 * repair progress (0..1) from its live ETA. Pure bookkeeping on the map it
 * is given — no rendering, so it is unit-testable without a map. */
export function updateRepairTrack(
  tracks: Map<number, RepairTrack>,
  team: Pick<Team, "id" | "state" | "target" | "eta">,
): number {
  if (team.state !== "REPAIRING") {
    tracks.delete(team.id);
    return 0;
  }
  let track = tracks.get(team.id);
  if (!track || track.target !== team.target) {
    track = { target: team.target, startEta: Math.max(1, team.eta) };
    tracks.set(team.id, track);
  }
  return Math.min(1, Math.max(0, 1 - team.eta / track.startEta));
}

/** SVG stroke-dasharray that lights the first `lit` of the ring's segments,
 * starting at 12 o'clock (the svg itself is rotated -90°). Zero lights
 * nothing — the faint track ring alone says "repair under way". */
export function repairRingDasharray(lit: number): string {
  const count = Math.min(RING.segments, Math.max(0, Math.round(lit)));
  const pairs = Array.from(
    { length: count },
    () => `${RING_DASH.toFixed(2)} ${RING_GAP.toFixed(2)}`,
  );
  // Trailing 0-dash + full-circumference gap: nothing else may light up, and
  // the pattern total must exceed the circumference so it never repeats.
  return `${pairs.join(" ")} 0 ${RING_CIRCUMFERENCE.toFixed(2)}`.trim();
}

/** Leaflet rounds latLngToLayerPoint to integer pixels. Keep its normal marker
 * lifecycle/zoom handling but use fractional translation during RAF movement;
 * otherwise a slow-moving truck visibly hops one pixel at a time. */
export class SubpixelCrewMarker extends L.Marker {
  override setLatLng(latlng: L.LatLngExpression): this {
    super.setLatLng(latlng);
    const element = this.getElement();
    if (element && this._map) {
      const point = this._map
        .project(this.getLatLng())
        .subtract(this._map.getPixelOrigin());
      L.DomUtil.setPosition(element, point);
    }
    return this;
  }
}

/** Crew motion uses the shared local CrewMotion module. Backend updates
 * go in through motion.set() with a route and progress from the server; the RAF
 * loop only renders positions. Projection: EPSG3857 before set(), unproject() in
 * render(). Markers are created once per team and moved with setLatLng(). */
export function CrewLayer({
  data,
  config,
}: {
  data: Snapshot;
  config: Config;
}) {
  const map = useMap();
  const markers = useRef(new Map<number, L.Marker>());
  const movingCrews = useRef(new Map<number, boolean>());
  const truePositions = useRef(new Map<number, L.LatLng>());
  const repairTracks = useRef(new Map<number, RepairTrack>());
  const trips = useMemo(() => new CrewTrips(projectLatLng), []);
  // Parked crews that share a spot with another parked crew are nudged onto a
  // deterministic golden-angle ring (config: CREW_MOTION.spread), so trucks
  // never render exactly stacked. Moving crews and the first crew on a spot
  // keep the true position; offsets always derive from the true position.
  const placeCrew = useCallback(
    (id: number, latlng: L.LatLng, moving: boolean) => {
      const marker = markers.current.get(id);
      if (!marker) return;
      movingCrews.current.set(id, moving);
      truePositions.current.set(id, latlng);
      let placed = latlng;
      if (!moving) {
        const { minSeparationPx, radiusPx, angleDeg } = CREW_MOTION.spread;
        const point = map.latLngToLayerPoint(latlng);
        for (const [otherId, other] of markers.current) {
          if (otherId === id || movingCrews.current.get(otherId)) continue;
          if (
            point.distanceTo(map.latLngToLayerPoint(other.getLatLng())) <
            minSeparationPx
          ) {
            const angle = (((id * angleDeg) % 360) * Math.PI) / 180;
            placed = map.layerPointToLatLng(
              point.add(
                L.point(radiusPx * Math.cos(angle), radiusPx * Math.sin(angle)),
              ),
            );
            break;
          }
        }
      }
      marker.setLatLng(placed);
    },
    [map],
  );
  // Re-evaluates every parked crew from its true position. Called when a crew
  // departs (parked -> moving) or disappears, so crews that were nudged away
  // from it drift back to their real spot.
  const replaceParkedCrews = useCallback(() => {
    for (const [id, latlng] of truePositions.current) {
      if (!movingCrews.current.get(id)) placeCrew(id, latlng, false);
    }
  }, [placeCrew]);
  const motion = useMemo(
    () =>
      new CrewMotion({
        render: (id, frame) => {
          const marker = markers.current.get(id);
          if (!marker) return;
          const wasMoving = movingCrews.current.get(id);
          placeCrew(
            id,
            L.CRS.EPSG3857.unproject(L.point(frame.x, frame.y)),
            frame.moving,
          );
          // A departure frees the spot it was sharing: settle the neighbours.
          if (wasMoving === false && frame.moving) replaceParkedCrews();
          marker.getElement()?.classList.toggle("crew-moving", frame.moving);
          marker.getElement()?.classList.toggle("crew-parked", !frame.moving);
        },
      }),
    [placeCrew, replaceParkedCrews],
  );

  // Zoom changes recompute layer points, so the parked spread is re-applied
  // from each crew's true position to keep the separation at every zoom.
  useEffect(() => {
    map.on("zoomend", replaceParkedCrews);
    return () => {
      map.off("zoomend", replaceParkedCrews);
    };
  }, [map, replaceParkedCrews]);

  useEffect(() => {
    const now = performance.now();
    motion.setPaused(!!data.control.paused);
    const ids = new Set<number>();
    for (const team of data.teams) {
      ids.add(team.id);
      // Depot visibility rule: the Core (Salim Street) is the crew depot and
      // idle crews are not drawn. A crew appears only when dispatched, stays
      // visible while on site, and disappears again once it has returned to
      // the Core. Motion, icon and tooltip are unchanged — this only decides
      // whether a marker exists at all.
      if (team.available) {
        const parked = markers.current.get(team.id);
        if (parked) {
          parked.remove();
          markers.current.delete(team.id);
          movingCrews.current.delete(team.id);
          truePositions.current.delete(team.id);
          repairTracks.current.delete(team.id);
          motion.remove(team.id);
        }
        continue;
      }
      let marker = markers.current.get(team.id);
      if (!marker) {
        const vehicle = document.createElement("div");
        vehicle.className = "crew-marker";
        vehicle.style.color = config.presentation.palette.crew;
        // Static SVG only; server-provided names below always use textContent.
        // The truck viewBox tightly frames the glyph (incl. its stroke), so the
        // icon sits dead-centre in the tile at any size. The repair ring is a
        // segmented circle just outside the tile; CSS shows it only while the
        // crew is REPAIRING and JS lights its notches as the ETA counts down.
        const ringCentre = RING.sizePx / 2;
        vehicle.innerHTML =
          '<svg viewBox="2 5 20 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h11v11H3zM14 10h4l3 4v3h-7"/><circle cx="7" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/></svg>' +
          `<svg class="crew-repair-ring" viewBox="0 0 ${RING.sizePx} ${RING.sizePx}" aria-hidden="true"><circle class="crew-repair-track" cx="${ringCentre}" cy="${ringCentre}" r="${RING.radiusPx}" fill="none" stroke="currentColor" stroke-width="${RING.strokePx}" stroke-dasharray="${RING_DASH.toFixed(2)} ${RING_GAP.toFixed(2)}"/><circle class="crew-repair-fill" cx="${ringCentre}" cy="${ringCentre}" r="${RING.radiusPx}" fill="none" stroke="currentColor" stroke-width="${RING.strokePx}" stroke-dasharray="0 ${RING_CIRCUMFERENCE.toFixed(2)}"/></svg>`;
        marker = new SubpixelCrewMarker(L.latLng(team.lat, team.lon), {
          icon: L.divIcon({
            className: "crew-wrapper",
            html: vehicle,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          zIndexOffset: 800,
        }).addTo(map);
        marker.bindTooltip("", { className: "network-tooltip" });
        marker.getElement()!.dataset.crewId = String(team.id);
        markers.current.set(team.id, marker);
      }
      const track = trips.update(team);
      motion.set(
        team.id,
        { route: track.route, progress: track.progress, moving: track.moving },
        now,
      );
      const text = `Crew ${team.id}, Cluster ${team.cluster} · ${team.name} · ${team.state.replaceAll("_", " ")} · ETA ${team.eta} ticks`;
      if (marker.options.title !== text) {
        const content = document.createElement("span");
        content.textContent = text;
        marker.setTooltipContent(content);
        marker.options.title = text;
        marker.getElement()?.setAttribute("aria-label", text);
      }
      marker.getElement()?.classList.toggle("crew-idle", team.available);
      // Repair ring: the marker div's class shows/hides it, the fill circle's
      // dash pattern lights one notch per elapsed fraction of the mission.
      const repairing = team.state === "REPAIRING";
      const progress = updateRepairTrack(repairTracks.current, team);
      const vehicleElement = marker.getElement()?.firstElementChild;
      vehicleElement?.classList.toggle("crew-repairing", repairing);
      const fill = vehicleElement?.querySelector(".crew-repair-fill");
      fill?.setAttribute(
        "stroke-dasharray",
        repairRingDasharray(progress * RING.segments),
      );
    }
    for (const [id, marker] of markers.current) {
      if (!ids.has(id)) {
        marker.remove();
        markers.current.delete(id);
        movingCrews.current.delete(id);
        truePositions.current.delete(id);
        repairTracks.current.delete(id);
        motion.remove(id);
      }
    }
    // A removed crew frees the spot it was sharing: settle the neighbours.
    replaceParkedCrews();
  }, [map, data, config, motion, trips, replaceParkedCrews]);

  useEffect(() => {
    const fleet = markers.current;
    return () => {
      fleet.forEach((marker, id) => {
        motion.remove(id);
        marker.remove();
      });
      fleet.clear();
      movingCrews.current.clear();
      truePositions.current.clear();
      repairTracks.current.clear();
    };
  }, [motion]);
  return null;
}

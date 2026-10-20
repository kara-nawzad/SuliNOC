import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Config, Snapshot } from "../types/api";
import { CrewMotion } from "../crew-motion.js";
import { CrewTrips } from "../adapters.js";

const projectLatLng = (lat: number, lon: number): [number, number] => {
  const p = L.CRS.EPSG3857.project(L.latLng(lat, lon));
  return [p.x, p.y];
};

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
  const trips = useMemo(() => new CrewTrips(projectLatLng), []);
  const motion = useMemo(
    () =>
      new CrewMotion({
        render: (id, frame) => {
          const marker = markers.current.get(id);
          if (!marker) return;
          marker.setLatLng(
            L.CRS.EPSG3857.unproject(L.point(frame.x, frame.y)),
          );
          marker.getElement()?.classList.toggle("crew-parked", !frame.moving);
        },
      }),
    [],
  );

  useEffect(() => {
    const now = performance.now();
    motion.setPaused(!!data.control.paused);
    const ids = new Set<number>();
    for (const team of data.teams) {
      ids.add(team.id);
      let marker = markers.current.get(team.id);
      if (!marker) {
        const vehicle = document.createElement("div");
        vehicle.className = "crew-marker";
        vehicle.style.color = config.presentation.palette.crew;
        // Static SVG only; server-provided names below always use textContent.
        vehicle.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h11v11H3zM14 10h4l3 4v3h-7"/><circle cx="7" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/></svg>';
        marker = new SubpixelCrewMarker(L.latLng(team.lat, team.lon), {
          icon: L.divIcon({
            className: "crew-wrapper",
            html: vehicle,
            iconSize: [38, 38],
            iconAnchor: [19, 19],
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
      const text = `${team.name} · ${team.state.replaceAll("_", " ")} · ETA ${team.eta} ticks`;
      if (marker.options.title !== text) {
        const content = document.createElement("span");
        content.textContent = text;
        marker.setTooltipContent(content);
        marker.options.title = text;
        marker.getElement()?.setAttribute("aria-label", text);
      }
      marker.getElement()?.classList.toggle("crew-idle", team.available);
    }
    for (const [id, marker] of markers.current) {
      if (!ids.has(id)) {
        marker.remove();
        markers.current.delete(id);
        motion.remove(id);
      }
    }
  }, [map, data, config, motion, trips]);

  useEffect(() => {
    const fleet = markers.current;
    return () => {
      fleet.forEach((marker, id) => {
        motion.remove(id);
        marker.remove();
      });
      fleet.clear();
    };
  }, [motion]);
  return null;
}

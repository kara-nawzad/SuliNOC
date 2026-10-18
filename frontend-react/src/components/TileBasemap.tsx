import { useEffect, useRef } from "react";
import { TileLayer } from "react-leaflet";

export type StreetStatus = "loading" | "ready" | "unavailable";

/** Street basemap as a plain Leaflet raster tile layer (Esri World Street Map, free
 * public tiles with attribution). OpenStreetMap's tile server blocks this app's
 * requests ("Access blocked"), so it is not used. Leaflet
 * owns the map, navigation and overlays. The layer reports "ready" on the first
 * tile that actually loads, and "unavailable" if tiles keep failing before any
 * loads, so the schematic stays visible instead of a blank map. */
const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const FAILURES_BEFORE_FALLBACK = 4;

export default function TileBasemap({
  onStatus,
}: {
  onStatus: (status: StreetStatus) => void;
}) {
  const loaded = useRef(false);
  const failures = useRef(0);
  useEffect(() => {
    loaded.current = false;
    failures.current = 0;
    onStatus("loading");
  }, [onStatus]);
  return (
    <TileLayer
      url={TILE_URL}
      maxZoom={19}
      attribution='Tiles &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, USGS'
      eventHandlers={{
        tileload: () => {
          if (loaded.current) return;
          loaded.current = true;
          onStatus("ready");
        },
        tileerror: () => {
          failures.current += 1;
          if (!loaded.current && failures.current >= FAILURES_BEFORE_FALLBACK)
            onStatus("unavailable");
        },
      }}
    />
  );
}

// Bundles Leaflet for the single-page console. The inline script in index.html
// waits for the 'leaflet-ready' event before it builds the live map.
import L from "leaflet";
import "leaflet/dist/leaflet.css";

window.L = L;
// Public basemap key, set at build time (VITE_CARTO_KEY). Empty means no tiles.
window.CARTO_KEY = import.meta.env.VITE_CARTO_KEY || "";
window.dispatchEvent(new Event("leaflet-ready"));

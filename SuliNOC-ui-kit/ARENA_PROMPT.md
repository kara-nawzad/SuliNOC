# Apply the SuliNOC UI kit (read ALL of this before touching code)

You are adding a small kit (src/theme.css, src/crew-motion.js, src/charts.js) to the existing app. The designer has NOT seen the repo, so adapters are your job. Do not change the backend. Do not merge to main. Work on the review branch, one commit per step.

## Fix three things the user reported
1. Towers look pale green on the live map (should be solid). Cause to check: marker or halo opacity, or a translucent fill over the light basemap. Use the .tw styles from theme.css: solid fill, white 2 px ring, 12 px on screen at every zoom. Halo only for selected, faulty or flagged towers.
2. Crew movement is jerky. Cause to check: CSS transitions and pixel-rounded positions updated once per backend tick. Replace with CrewMotion: call motion.set(crewId, {route, progress, moving}) on every backend update, and render() positions the marker. Rules: route and progress come from the backend, never from a client timer; moving=false for parked or repairing crews; call setPaused(true) while the simulation is paused. Convert lat/lng with L.CRS.EPSG3857.project() before set() and unproject() inside render(). Move markers with marker.setLatLng(); never remove and re-add markers per update.
3. Analytics text is ugly. Use lineChart() from charts.js: Manrope 12 px axis text (not mono), short times (04:45), a day marker only at midnight, units as the chart subtitle, and the "axis starts at X, not zero" note passed through onNote() to sit under the chart title, never inside the plot. Feed new points with chart.append(); do not rebuild the chart on each update. Keep the 30 min, 24 h, 7 d tabs and live merge from the old app.

## Organize the UI (remove what is not needed)
- Sidebar order: Overview, Live network, Incidents, Analytics, Maintenance, AI, Towers. Settings and About go in the sidebar footer.
- Delete the separate Topology page. Live network has a Map / Schematic toggle and the fibre rings list.
- Delete the "Prediction overlay" checkbox when the AI is off.
- Remove the repeated "simulated" label from every number. Use one .note line under each page title.
- Show the wordmark in the top bar only when the sidebar is hidden.
- Mono font only for IDs, coordinates and times. Body text uses Manrope.
- Keep everything else (Overview dashboard, inspector, builders, hero).

## Mistakes to avoid
- Do not invent field names. Open the real /api/config and /api/delta responses, write a tiny adapter file (src/adapters.js) that maps them to the kit's inputs, and show me the mapping.
- Do not delete existing features without listing them first.
- The map tiles are blocked in your sandbox. Serve a local tile stub so the real map renders, and say so. Do not call the map verified otherwise.
- The user sees two URLs: the Fly app and karanawzad.tech/SuliNOC (which only links to the Fly app). In the user's screenshots the embedded page showed "The simulation run changed. Refreshing." and a different simulation clock than the direct Fly page. Investigate session handling (the 16-session cap and 180 s idle expiry, and storage inside an iframe on iOS). A visitor must keep the same run while using the app.

## Acceptance (measure and report, do not promise)
- Crew run on the Live network: per-frame position change stays small (no jumps), and the frame time stays under 16 ms on average. Report the numbers.
- Towers are the same solid colour on the tile map and the schematic.
- The analytics page labels are readable on a 390 px phone.
- Reduced motion on: crews snap to position, no animation.
- Run `node test/motion.test.mjs`. It must print OK.
- Send screenshots at 1280x800 and 390x844, 6 seconds after load, with the commit hash visible.

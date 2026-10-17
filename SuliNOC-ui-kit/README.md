SuliNOC UI kit
src/theme.css        design tokens, chart text, solid tower markers, van size, switch, legend
src/crew-motion.js   smooth crew motion between backend updates (60 fps, no dependencies)
src/charts.js        SVG line chart with readable labels and live append
test/motion.test.mjs checks the motion math (node test/motion.test.mjs)
ARENA_PROMPT.md      instructions for Arena
These are drop-in modules. They do not know your backend field names, so Arena writes a small adapter.

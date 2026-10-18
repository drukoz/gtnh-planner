# GTNH Line Planner

Plan efficient automation lines for **GregTech: New Horizons 2.9**, fitted into the base you already have.

- Pick any item or fluid from the pack and a rate (or a one-off batch).
- Get the recipe chain that uses the least raw material at your current tier.
- See where the line goes on a map of your world, how it hooks into your power, logistics and storage, and a 3D view of the build.
- Get the full materials list and build steps, shared with your group so everyone can tick things off.

All data comes from **your own** copy of the pack and world: recipes are exported from a copy of your server, textures come from your mod jars, and the world is read locally. None of that is stored in this repository.

**Status:** in development. Design: [docs/superpowers/specs/2026-10-17-gtnh-planner-design.md](docs/superpowers/specs/2026-10-17-gtnh-planner-design.md).

## Using the planner

1. **One-time setup**, on the computer that runs the planner (Node.js 24):
   - `npm install`
   - `npm run export` reads the recipes from a copy of your server.
   - `npm run set-password` asks for the password your group will share. Only a hash of it is kept.
2. **Start it:** `npm run build && npm start`, then open `http://<this-computer>:8765`. Friends use the port you forward to this computer.
3. **First visit:** enter the shared password, then your name. The name is stored in this browser only and shows next to your ticks.
4. **A project** is one line you want to build, with its own link. Pick what to make, then an amount per minute or per hour, or **Make N (batch)**: a fixed number, made on the machines you already own. Set your tier and the planets and dimensions you can reach. The flow diagram shows each machine step: green boxes are machines you already have, blue ones are new. Click a box to swap its recipe, mark "we already make this" or see the overclock math.
5. **Materials & steps** lists what to build once, what the line uses per hour and where each raw material comes from. Tick rows as you go: everyone sees the ticks live, with the name of who ticked them.
6. If the page says "No recipe export yet", run `npm run export`. To change the password, run `npm run set-password` again and restart the planner; `npm run set-password -- --rotate-sessions` also logs everyone out.

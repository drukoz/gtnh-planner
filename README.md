# GTNH Line Planner

Plan efficient automation lines for **GregTech: New Horizons 2.9**, fitted into the base you already have.

- Pick any item or fluid from the pack and a rate (or a one-off batch).
- Get the recipe chain that uses the least raw material at your current tier.
- See where the line goes on a map of your world, how it hooks into your power, logistics and storage, and a 3D view of the build.
- Get the full materials list and build steps, shared with your group so everyone can tick things off.

## Export your pack

You need macOS (the copy uses APFS clones), Node 24, the Java your GTNH 2.9 server runs on (Java 25 works), and the server folder.

1. `npm install`
2. `npm run export -- --server "/path/to/your/GTNH server folder"` — the first time; afterwards just `npm run export`.
   It builds a small exporter mod, makes a copy-on-write clone of the server folder in `.local/export-server` (no world, backups, logs or player files), starts that copy on 127.0.0.1:25566 with a fresh flat world, writes the export, stops the copy and deletes it. Your live server and world are never touched, and the server can keep running; a server folder with symbolic links that lead outside it is refused, because the copy would write through them into your live files. The first run downloads about 2 GB of build tools into `.local/gradle-home`; an export takes a few minutes.
3. `npm run pack:info` shows what was exported; `npm run pack:info -- --find "Iron Dust"` lists the recipes that make something.

Each export lands in `data/export/<pack version>_<date>/` and becomes the active one only after it passes its checks; a failed or interrupted export leaves the previous one active. Run `npm run export` again after a pack update. Exports stay on your machine (`data/` is git-ignored) — never commit them.

All data comes from **your own** copy of the pack and world: recipes are exported from a copy of your server, textures come from your mod jars, and the world is read locally. None of that is stored in this repository.

**Status:** in development. Design: [docs/superpowers/specs/2026-10-17-gtnh-planner-design.md](docs/superpowers/specs/2026-10-17-gtnh-planner-design.md).

## Textures and icons

- The planner draws blocks and items with your own pack's textures. Nothing game-made is in the repository: it is extracted into `data/assets/` (git-ignored) and served only to people logged in to the planner.
- `npm run extract-assets` reads `mods/*.jar` of the server folder in `data/config.json` (or `--server <folder>`), read-only, plus the official Minecraft 1.7.10 client jar. Prism Launcher keeps it at `~/Library/Application Support/PrismLauncher/libraries/com/mojang/minecraft/1.7.10/minecraft-1.7.10-client.jar`, the official launcher at `~/Library/Application Support/minecraft/versions/1.7.10/1.7.10.jar`; otherwise pass `--client-jar <path>` or set `"clientJar"` in `data/config.json`. Its SHA-1 must be `e80d9b3bf5085002218d4be59e668bac718abbc6`.
- `npm run export` also writes `textures.json.gz`, which tells the planner how GregTech draws each machine, casing, cover, material item and fluid. After a pack update, run both again; a running planner picks the new files up on its next request, and a failed extraction keeps the previous textures.
- When two jars ship the same texture: a mod beats vanilla, then a jar that overrides another mod's texture beats that mod's own jar (GTNewHorizonsCoreMod over gregtech), then the jar whose name sorts last. `data/assets/index.json` lists every conflict.
- Optional icons for everything else: in a **copy** of the client instance (never the one you play with), in a creative single-player world, open NEI options → Tools → Data Dumps → Item Panel. With an empty search box and every collapsible group expanded, dump CSV, then PNG, in the same session; then run `npm run import-nei-icons -- --csv <copy>/.minecraft/dumps/itempanel.csv --png <copy>/.minecraft/dumps/itempanel_icons`. Fluid icons are matched by their display name against the active export, so run `npm run export` first. A dump whose rows and images do not line up is refused.
- Anything without a texture is drawn in a plain colour: by machine kind for blocks, by material for GT items, otherwise a fixed colour per item.

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

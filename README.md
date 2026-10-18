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

## World map

The planner reads your world so a line can fit into the base you already have. A scan never touches the live server: it reads the newest *complete* backup in `<server>/backups` (a zip that opens cleanly and is at least two minutes old, so one still being written is skipped), or, when there is none, a snapshot copy of the world folder made into the planner's own data folder. It never reads the live world files directly and never writes anything to the server folder, so the server can keep running.

1. **Point it at the server:** set `serverFolder` in `data/config.json` to your server folder (the one holding `server.properties`).
2. **Scan:** open the **World** page and press **Scan newest backup**, or pick one backup from the list. From the shell, `npm run scan` does the same; `npm run scan -- --backup <file>` reads one backup, and `--json` prints the whole scan instead of the summary. Scans run in the background, one at a time, and can be cancelled.
3. **Friends without the server folder** upload from their browser on the World page: pick the world folder (or a zip of it). The browser reads it on their computer, finds where players are, the spawn, claimed chunks and chunks people have spent time in, and shows the areas and the total size before anything is sent. A radius slider widens or narrows the area around each spot. Only `level.dat` and trimmed region files with just those chunks are sent — player files, claims, quests and everything else never leave their computer. **Advanced: whole dimensions** sends every region file of the dimensions they tick instead.
4. **Use it in a project:** on a project's **Map** tab, choose a finished scan and the base the line is for. The plan then counts the machines and storage already there.

Scans live in `data/scans/<id>/` and uploads in `data/uploads/<id>/` (git-ignored). Old scan folders are safe to delete while the planner is stopped.

**The Map tab** shows the base from above, coloured from your block textures, with switchable layers: machines, power cables coloured by voltage tier, logistics (Project Red routed pipes, EnderIO conduits, GT pipes, AE2), storage (filled where a routed or AE2 network reaches it) and the base outline. Drag to pan, scroll or use **+**/**−** to zoom, and move the **Y level** slider to cut through floors. Beside the map, **Found in world** lists the machines and top tier, power networks, logistics networks, stored items with their totals and how many the line's logistics can reach, the world's dimensions and which ones you have visited, prospected veins nearby and the notes. Click the map to pin a numbered note there; everyone on the project sees it.

Power figures are estimates from what is built: clear weather, rain and a 24-hour average. Solar boilers stop about seven minutes into rain, so battery buffers are judged against a rain outage of about eight minutes. Storage whose contents cannot be read reliably is shown as unknown, never guessed.

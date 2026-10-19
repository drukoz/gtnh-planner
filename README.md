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
- `npm run export` also writes `textures.json.gz`, which tells the planner how GregTech draws each machine, casing, cover, material item and fluid. After a pack update, run both again: a running planner picks up new textures from `extract-assets` on its next request; restart it after `npm run export` (as for the recipes). A failed extraction keeps the previous textures.
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

## World map

The planner reads your world so a line can fit into the base you already have. A scan never touches the live server: it reads the newest *complete* backup in `<server>/backups` (a zip that opens cleanly and is at least two minutes old, so one still being written is skipped), or, when there is none, a snapshot copy of the world folder made into the planner's own data folder. It never reads the live world files directly and never writes anything to the server folder, so the server can keep running.

1. **Point it at the server:** set `serverFolder` in `data/config.json` to your server folder (the one holding `server.properties`).
2. **Scan:** open the **World** page and press **Scan newest backup**, or pick one backup from the list. From the shell, `npm run scan` does the same; `npm run scan -- --backup <file>` reads one backup, and `--json` prints the whole scan instead of the summary. Scans run in the background, one at a time, and can be cancelled. When a scan could not read or work out everything (no recipe export yet, side files it could not read, boilers whose steam output the export does not give, chunks it had to skip), it says so under the scan on the World page and in **Scan notes** at the top of **Found in world**.
3. **Friends without the server folder** upload from their browser on the World page: pick the world folder (or a zip of it). The browser reads it on their computer, finds where players are, the spawn, claimed chunks and chunks people have spent time in, and shows the areas and the total size before anything is sent. A radius slider widens or narrows the area around each spot; the upload button waits until the preview shows the new radius. Only `level.dat` and trimmed region files with just those chunks are sent — player files, claims, quests and everything else never leave their computer. **Advanced: whole dimensions** sends every region file of the dimensions they tick instead.
4. **Use it in a project:** on a project's **Map** tab, choose a finished scan and the base the line is for. The plan then counts the machines and storage already there. A scan that found no base has no map (a scan keeps the map only around bases); a project using it counts the whole world.

Scans live in `data/scans/<id>/` and uploads in `data/uploads/<id>/` (git-ignored). Old scan folders are safe to delete while the planner is stopped.

**The Map tab** shows the base from above, coloured from your block textures, with switchable layers: machines, power cables coloured by voltage tier, logistics (Project Red routed pipes, EnderIO conduits, GT pipes, AE2), storage (filled where a routed or AE2 network reaches it) and the base outline. Drag to pan, scroll or use **+**/**−** to zoom, and move the **Y level** slider to cut through floors. Beside the map, **Found in world** lists the machines and top tier, power networks, logistics networks, stored items with their totals and how many the line's logistics can reach, the world's dimensions and which ones you have visited, prospected veins nearby and the notes. Click the map to pin a numbered note there; everyone on the project sees it.

Power figures are estimates from what is built: clear weather, rain and a 24-hour average. Solar boilers stop about seven minutes into rain, so battery buffers are judged against a rain outage of about eight minutes. Storage whose contents cannot be read reliably is shown as unknown, never guessed.

## Line layout and 3D view

Once a project has a scan and a base, the planner lays the line out block by block: it puts the machines on clear, flat ground next to that base, as close as it can to where it can tap into your power and logistics, and works out every cable, pipe, cover and part needed to hook it up. Those parts join the **Materials & steps** list, grouped into machines, power, and piping & logistics.

- **Logistics**, picked in the project settings:
  - **Machine to machine:** conveyor and pump covers move goods from machine to machine through one shared item pipe (and fluid pipes); every machine's Input Filter is on, and each final product goes into its own output chest through a filtered cover.
  - **Project Red routed:** a routed interface pipe with routing chips on every machine; you order from the request pipe.
  - **AE2:** ME interfaces with their patterns; their idle power draw counts towards the power check.
  - The line is only hooked into networks the scan found. The planner never assumes one you have not built.
- **Configured parts:** every cover, filter, chip, pattern and programmed circuit gets a build step that says exactly how to set it (face, mode, rate, whitelist, circuit number). Pipes, covers, buses and cables are sized to what they carry.
- **Power:** nothing is connected above its tier; transformer banks step the voltage down one tier at a time. The power check says whether the base's spare power covers the line and its batteries carry it through rain, and suggests boilers and turbines when they do not. Generators are never placed for you.
- **On the Map tab** the line is solid and everything still to build to hook it up is dashed. Numbered pins mark the site, the power tap, the logistics tap, machines you can reuse and problems, and a build step that names a pin links to it on the map. **Move line** (then drag it), **Rotate 90°** and **Auto place** change where the line goes, for everyone on the project.
- **The 3D tab** shows the line in your pack's textures: drag to turn, right-drag to pan, scroll to zoom and step through the layers with the slider. Hover a block for its name and settings; click it for its facing and recipe. Blocks already in your base show as faint ghosts. Textures need `npm run extract-assets`; without them blocks are plain colours.
- **Limits:** pipe heat ratings and Project Red crafting chips are not planned, and a GregTech filter cover holds one item, so a machine whose recipes also take another step's item is flagged instead of fixed. Check those in game.

## In-game ghost projector

The **GTNH Planner Projector** is a small mod for your own Minecraft client (GTNH 2.9, Minecraft 1.7.10). It draws the planned line in your game as translucent ghost blocks exactly where the layout puts them: faint where nothing is placed yet, green where the right block stands, red where a block or its front is wrong. When every block of a build step is placed correctly, it ticks that step in the project's checklist, in your name. It is a client-side mod: nothing is installed on the Minecraft server, so only the players who want ghosts need it, and if only you want them, only you install it.

### Install

Get `gtnhplannerprojector-<version>.jar` from the person who runs the planner, or build it yourself with `cd projector-mod && VERSION=0.1.0 ./gradlew assemble`; the jar lands in `projector-mod/build/libs/`. Put it into **your client's** `mods` folder (in Prism Launcher: right-click the instance, choose **Folder**, then open `.minecraft/mods`) and start the game. Never put it into the server's `mods` folder.

### Connect

1. On the project page open **In-game projector**, type who the token is for (for example `Steve`) and press **Create token**.
2. Press **Copy** next to the `/planner load …` line (the button says **Copied**) and paste it into Minecraft chat. If the browser will not copy it, which can happen when the planner is opened over plain `http://`, the line is selected instead and the panel says so under it: press Ctrl+C (Cmd+C on a Mac). The token is shown only now; the mod saves it for that project, so afterwards `/planner load <project>` is enough.
3. The mod looks for the planner at the Minecraft server's address on port 8765: for a server at `mc.example.org` that is `http://mc.example.org:8765` (in single player, `http://127.0.0.1:8765`). If yours is elsewhere, also run the `/planner url …` line the panel shows, once.

### Commands

```
/planner load <project> [token] | clear | layer <y|all> | step <n|all|next> | reload | url <url|auto> | xray [on|off]
```

- `/planner load <project> [token]` fetches the project's line and shows all of it. A token is saved for that project; without one, the saved token is used.
- `/planner layer <y|all>` shows only the blocks at height `y` (0 to 255), or every layer.
- `/planner step <n|all|next>` shows only the blocks of build step `n`, numbered as in the project's **Build steps** list (a step that places nothing, such as gathering or crafting, has none to show), or of every step; `next` is the first build step with blocks that is not ticked yet.
- `/planner reload` fetches the latest layout now. The mod also checks about once a minute, so a line you move or rotate in the planner follows by itself.
- `/planner url <url|auto>` sets where the planner is, for example `/planner url http://mc.example.org:9000`; `auto` goes back to the Minecraft server's address on port 8765.
- `/planner xray [on|off]` shows the ghosts through walls and terrain; without `on` or `off` it switches.
- `/planner clear` hides the ghosts until you load a project again.

### Colours

Faint is a block not placed yet, green is the right block (with the right front), red is a wrong block or a wrong front, and bluish is a block the mod cannot check (its step is never ticked automatically). A GT machine's front is the side GT calls its front, the one a plain wrench sets: the face of a hatch or a multiblock controller, but on a single-block machine such as a Basic Macerator its **output side** (look at one that is turned wrong and the top left says "its output side should face …"). A single-block machine shows its face on another side, which is not checked: placed, it faces you with its output side at the back. Its ghost shows the output overlay on the side the output must face. Blocks in chunks your game has not loaded stay faint, neither right nor wrong. Covers show as their item's icon on the face they go on; covers and settings (the **configure** steps) are ticked by hand. The top left of the screen shows how far the build has got (`Planner: Steel line — 12/40 placed, 1 wrong`) and, when you look at a planned block, what it needs.

### Troubleshooting

- **"Cannot reach the planner …":** is the planner running, and is its port forwarded to you? Set its address with `/planner url <url>`.
- **"The planner refused this token …":** the token was revoked. Create a new one in the project's **In-game projector** panel and run its `/planner load` line.
- **Nothing is drawn:** you may be in another dimension than the line (the top-left line names the line's dimension), a filter may be on (`/planner layer all`, `/planner step all`), or you may be farther from the ghosts than `maxDistance` (96 blocks by default; raise it in `config/gtnhplannerprojector.properties` in your instance's Minecraft folder and restart the game). If the top-left line says the project is not placed in the world yet, pick a world scan and base on its Map tab.
- **The top-left lines show but the ghosts are invisible:** set `useDisplayLists=false` in `config/gtnhplannerprojector.properties` and restart the game.

### Privacy

A token lets whoever holds it read that one project and tick its build steps, nothing else: it cannot open another project, tick materials or change settings. The mod keeps it in your `config/gtnhplannerprojector.properties`, so keep that file private, and revoke tokens you no longer use (**Revoke** in the panel). Tokens travel over plain HTTP unless the planner is behind HTTPS.

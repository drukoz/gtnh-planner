# GTNH Line Planner — design

Date: 2026-10-17 · Status: for approval

## 1. Intent and why

A small group plays GregTech: New Horizons 2.9 together on a server hosted on drukoz's Mac. They already know the recipes ("making MV circuits is not confusing"). What they want help with is **building automation lines in the most efficient way, fitted into the base they already have**:

- pick what to automate (any item or fluid in the pack),
- get the recipe chain that uses the **least raw material at their current tier**,
- see where in the world the new line should go and how it hooks into the existing **power, logistics and storage**, drawn on a map of their world with notes and in a 3D view,
- get the **full list of materials** (down to base materials) and the **build steps**,
- share each build as a project so the group can tick off materials and cross off steps together while playing.

## 2. Users

drukoz and friends on the server (a handful of people). drukoz runs the server and this tool on the same Mac. Friends use it from their own computers in a browser.

## 3. Goals

### 3.1 Recipe data
- All recipes from the **actual 2.9 pack they play** (exported from the pack, not hand-written or taken from another version). At minimum: every GregTech recipe map (singleblocks, multiblocks, GT++ content that lives in GT), crafting table (shaped, shapeless, ore dictionary), furnace. Other mods' recipe types where the export can reach them.
- Every item/fluid has its in-game English name. Ore dictionary names are kept (e.g. any "circuitGood" counts as an MV circuit).
- Easy to re-export when the pack updates (they are on 2.9.0-RC-1 now; 2.9.0 final will follow).

### 3.2 Target, amount and tier
- Search box covering **any item or fluid** in the pack (works like NEI search).
- Two modes:
  - **Rate** (per minute / per hour): plans a dedicated line.
  - **Make N** (a one-off batch, e.g. 64; named so it doesn't clash with GregTech's own multiblock "batch mode"): runs the batch on **machines the group already owns**, adds machines only for steps nothing they own can do, and shows how long it will take. Build cost of any added machines is shown (decided).
- **Current tier** (ULV, LV, MV, HV, EV, IV, …) is **detected from the world** (highest-tier GT machine found at the base) and can be changed by hand. Only recipes the group can actually run at that tier are used.

### 3.3 Planner
- Expands the target into a full production chain down to base materials.
- **Objective: least raw material used per output at the current tier.** Machine count, power and speed are shown but are not what it optimizes. Byproducts that can be fed back count as savings. "Material use" means material consumed while the line runs, not the cost to build the machines.
- **How materials are counted (decided):** every base item counts 1; 144 L of molten metal = 1 ingot; 1,000 L of any other fluid = 1; water, air, cobblestone and lava are free. **Each material's cost can be changed per project** (e.g. mark silver as expensive, or something they mass-produce as cheap).
- Items marked "we already make this" stop the chain there and become inputs, counted at their (editable) cost like any other input (my call).
- GT overclocking rules decide how fast a recipe runs on the tier of machine used, and so how many machines are needed.
- "Base material" by default = ores, ingots, dusts and basic fluids.
- When the group already owns machines that make a part (found in the world), the planner suggests reusing them. The group decides.
- Steps that need a crafting table are listed as hand-crafting steps by default (my call); they can be marked as automated if the group has a block for it.

### 3.3b Where materials come from (planets and dimensions) — added after approval at the user's request
- Base-material decisions depend on **which planets and dimensions the group can reach at their current tier**.
- For every base material the tool knows its sources from the pack itself: ore veins and small ores per dimension (GT, BartWorks, GT++), fluid sources per dimension (underground fluids/oil, gases, pumps), and ore-processing byproducts.
- **Reachable dimensions**: by default, those the group's current tier can reach in GTNH progression (rocket tier per planet) plus those the world shows they have actually been to; editable per project as a checklist of planets/dimensions.
- A base material counts as available only if it can be mined in a reachable dimension (directly, or as a byproduct of a reachable ore) or made at their tier from available materials. Otherwise it is **not** a free leaf: the planner makes it from available materials if it can, else chooses recipes that avoid it, else flags the step with what unlocks it (e.g. "needs the Moon — tier 1 rocket").
- The materials list shows where each base material comes from (dimension), and — where the group's prospecting data has it — where they have already found that ore (my call).

### 3.4 World reading
- Reads the world **straight from the server folder** on this Mac (read-only, preferring the latest 30-minute backup / a snapshot copy so it never reads files mid-write), plus **manual upload** in the browser (whole world zip, or just `level.dat` plus selected region files) for anyone not on this Mac.
- Finds **bases** automatically (clusters of mod machines/blocks), in any dimension.
- Finds and classifies — **all optional**: a base may have none of the logistics or storage below, and every plan must still work:
  - **GregTech machines**: type and voltage tier, singleblock and multiblock.
  - **Power network**: generators (incl. solar boilers + steam turbines), cables (by voltage/amperage), transformers, battery buffers; where a new line can tap in.
  - **Logistics networks**: **Project Red routed pipes** (interface, request, basic pipes and their chips — saved as Forge Multipart parts), GT pipes, EnderIO conduits, and **AE2** (controller, ME cables, channels used/free, interfaces) when present.
  - **Storage**: Storage Drawers **controllers and the drawers they actually reach**, **JABBA barrels** (shown as a storage bank; JABBA has no controller), iron chests and plain chests, GT super/quantum chests and tanks (my call), AE2 drives/cells when present.
- **"Have in storage"** counts everything at the base, broken down by where it sits, and flags what the line's chosen logistics can reach automatically (my call). If a storage type's contents can't be read reliably, it is shown as found-but-unknown rather than guessed.

### 3.5 Power
- Spare power is an **estimate** from what is built (the world file does not record live usage).
- Shows **clear-weather and rain** figures and an average. (Corrected after research: high-pressure solar boilers stay hot through about 95 % of a clear Minecraft day; rain and thunder are what stop them, after roughly 5–7 minutes. Calcification lowers their output over time and is read from the world.) A line "fits" when the average covers it and the battery buffers cover a rain outage (my call for the exact rule).
- When a line doesn't fit: **warn and suggest** how many extra boilers/turbines (or other generators available at their tier) would cover it, as an optional add-on to the build list (decided). Generators are not auto-placed on the map.
- Never plans a connection that would overvolt a machine (GT machines explode) or overload a cable; adds transformers where needed.

### 3.6 Layout ("most efficient spacing") and logistics
- Recommends where the line goes: clear, buildable space close to the base, near the power and logistics tap-in points.
- **Logistics mode is chosen per project when planning (decided):**
  1. **Machine to machine** (default): each machine pushes output straight into the next with GT conveyor/pump covers or short pipes; only raw inputs and final output touch storage — by hand (input/output chests) or hooked into whatever network exists.
  2. **Project Red routed network**: every machine gets an interface pipe and chips; work is ordered from the request pipe (how their drawers work today).
  3. **AE2**: ME interfaces and patterns, once they have an AE2 network.
- Arranges machines compactly with shared cable/pipe runs, respecting which way machines face and which blocks touch; multiblocks use their real in-game sizes; reports the total footprint.

### 3.7 Map view (mockup approved)
- Top-down, block-accurate map around a base, chunk grid, zoom/pan, Y-level control.
- Shows base outline, existing machines, power cables colored by voltage, logistics (routed pipes / conduits / ME cable), storage.
- **The new line drawn in place**: every machine block, cable and pipe runs, arrows for item flow; dashed = things still to build to hook it up.
- **Numbered notes pinned to the map**: automatic ones (build here, tap power here, hook logistics here, reuse these machines) and pins anyone in the group can add.
- Side panel: what was found (machines, top tier, power estimate, logistics, storage), line summary (machines new/reused, footprint W×L×H, peak EU/t, fits or not), notes list.
- (The mockups used AE2 as example data; the real base has Project Red routed pipes instead — the map shows whatever is actually there.)

### 3.8 3D view of the line (approved)
- A 3D block view of **only the new line and its hookups**, like the multiblock structure preview in NEI: rotate, zoom, step through layers, hover a block for its name, click a machine for its recipe and facing.
- Shows machines, power cables, pipes/covers/interfaces for the chosen logistics mode, plus the tap-in points; existing base blocks appear only as faint ghosts where the line connects to them.
- Side list: blocks to place (with counts), hookups, overall size.
- **Real in-game textures**, taken from the pack's own files (mod jars) (decided); plain color by machine kind only as a fallback where a texture can't be resolved. The same layout drives the map, the 3D view and the block list, so they always agree.
- Item/fluid icons in the search, flow diagram and materials lists also come from the game (my call — same source, same fallback rule).

### 3.9 Flow diagram (mockup approved)
- Auto-generated: base materials on the left, target on the right. Each box = one recipe step: machine type, tier, count, EU/t, how busy. Arrows = items/fluids with rates.
- Green boxes = machines already owned (from the world), blue = new.
- Click a box: swap recipe (alternatives sorted by raw material use), mark "we already make this", see the overclock math.

### 3.10 Materials and steps (mockup approved)
- **To build the line (once)**: every machine, hull, cable, pipe/cover/interface part, broken down to base materials (expandable / user chooses where to stop).
- **To run it**: base materials per hour, or per batch in batch mode.
- "Have in storage" counts from the world scan next to each line.
- **Build steps**: ordered, linked to the map pins (incl. chip/pattern setup for networked modes, and hand-crafting steps).
- Every row can be ticked/crossed off; the name of who did it is shown.

### 3.11 Projects and sharing
- Each build is a project with its own link.
- Shared state across the group: ticks, crossed-off steps, notes/pins, recipe choices, material costs, logistics mode, target/tier. Everyone sees the same thing (refresh or live).
- No accounts: each person types their name once. One shared password keeps strangers out.

### 3.12 Public GitHub project
- The code lives in a **public GitHub repository** (account `drukoz`), project folder `~/gtnh-planner`.
- The repo holds only our own code and docs. Everything taken from the game or the server — exported recipes, textures/icons, world scans, project data — and the shared password are **generated locally and never committed** (mod assets carry their own licenses; the world and player data are private). Anyone cloning it points it at their own GTNH 2.9 pack and runs the export themselves.

## 4. Non-goals
- Not a recipe tutorial or NEI replacement.
- Never writes to the world or changes the server.
- No live in-game telemetry; power numbers are estimates from what is built.
- No user accounts or permission levels beyond the shared password.
- Not optimizing for fewest machines.
- Not auto-placing generators (power shortfalls are warnings + suggestions).
- Not built for the public at large — one group, one server (though anyone can run their own copy from GitHub).

## 5. Anti-goals (failure even if it "works")
- Disturbing the live server or world in any way (locks, lag, corruption, crashes) while people play.
- Recipe data that doesn't match their pack.
- Plans the group can't actually build or power at their tier, or that silently assume AE2/storage they don't have.
- Any plan that would blow up machines (overvoltage) or overload a cable.
- Losing shared progress (ticks, notes) — project state must persist.
- Unusable on their real world (≈910 MB, ~54 dimensions) — slow scans must not freeze the app.
- Leaking anything private or not ours into the public repo (world/player data, server address, password, extracted mod assets).

## 6. Constraints and facts

Exact local paths, machine details and what the read-only scan found in the group's world are kept in `docs/local/environment.md` (local only, never committed). Public facts:

- **Pack**: GT New Horizons 2.9.0-RC-1 server pack (218 mods). Relevant versions: gregtech 5.09.54.183, structurelib 1.4.45, appliedenergistics2 rv3-beta-1073-GTNH, ae2fc 1.5.110, StorageDrawers 2.2.31-GTNH, JABBA 1.5.23, BetterQuesting 3.8.87, CraftTweaker 3.4.8 + GTTweaker 2.3.4, endlessids 1.7.4 + chunkapi 0.8.4. Project Red (routed pipes, Forge Multipart) and EnderIO are present.
- **World format**: worlds upgraded to 2.9 are **EndlessIDs**-converted — block/item IDs beyond vanilla limits and a chunk section layout that differs from vanilla 1.7.10 Anvil. ID ↔ name map lives in `level.dat` (FML ItemData). The server keeps 30-minute backup zips in `backups/`.
- **Typical base today** (the group's, from the scan — orientation only, nothing hard-coded): no AE2; Project Red routed pipes on drawer controllers, chests and a few machines with one request pipe; a standalone JABBA barrel wall; EnderIO conduits and GT pipes; steam power from many solar boilers into LV/MV/HV GT turbines with battery buffers.
- **Live server and game client run on the same Mac while people play.** Anything that needs Minecraft running (e.g. a recipe export) must run on a **separate copy** of the server (own folder, own port, fresh throwaway world), never the live one.
- **Host machine**: macOS on Apple Silicon with plenty of RAM/CPU; Java 25 JDK (plus a Java 8 JRE), Node 24, Python 3, git and GitHub CLI available. A GTNH 2.9.0-RC-1 client instance exists in Prism Launcher.
- **Network**: friends reach the tool the way they reach the MC server — one extra forwarded port on the host.
- **Manual upload**: must work from a friend's browser; a full world is ~1 GB, so partial uploads (level.dat + chosen region files / one dimension) must be supported.

## 7. Decisions made

Decided with drukoz:
- Small server on this Mac: serves the app, reads the World folder directly, stores shared projects.
- Manual upload in addition to reading the server folder.
- Recipe data exported from a copy of their 2.9 server.
- Shared projects: one link per build, names typed once, one shared password.
- Optimize for least raw material while running, at current tier; materials counted as items (144 L molten = 1 ingot, 1,000 L other fluid = 1, water/air/cobble/lava free), with editable per-material costs.
- Default base materials = ores/ingots/dusts/basic fluids; any item can be marked "we already make this".
- AE2, storage and a storage room are all optional; detect them when present (incl. drawer controllers + drawers and barrels).
- Logistics mode chosen per project: machine to machine, Project Red routed network, or AE2.
- Power: show day/night estimate; when short, warn and suggest generators.
- Batch mode runs on owned machines, adding only what's missing, with a time estimate.
- Map view, flow diagram, materials/steps and 3D view as in the approved mockups; real textures grabbed from the game files.
- Project folder `~/gtnh-planner`, published as a public GitHub project.
- Base-material availability follows the planets/dimensions reachable at the current tier (added after approval).

My calls (open to change):
- Include GT super/quantum chests and tanks, iron chests and plain chests in the storage scan; "have" counts everything at the base, broken down by location, flagging what the line can reach.
- Auto-detect tier from the highest-tier machine at the base.
- Suggest (not force) reusing machines the group already owns.
- "We already make this" inputs keep their normal cost (not free).
- Crafting-table steps default to hand-crafting.
- Power "fits" rule: the average covers the line and buffers cover a rain outage.
- Item/fluid icons from the game, same as block textures.

## 8. Left to the builder
- Tech stack, libraries, diagram layout engine, map and 3D renderers.
- Export mechanism (custom export mod run on the server copy, existing exporter, or a combination) and the data format; how textures/icons are extracted.
- Solver method (exact optimization vs. heuristics), as long as it meets the objective and handles loops/byproducts.
- How bases are clustered, how layouts are packed, how live updates are pushed.
- Storage format for projects.

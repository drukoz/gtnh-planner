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
   It builds a small exporter mod, makes a copy-on-write clone of the server folder in `.local/export-server` (no world, backups, logs or player files), starts that copy on 127.0.0.1:25566 with a fresh flat world, writes the export, stops the copy and deletes it. Your live server and world are never touched, and the server can keep running. The first run downloads about 2 GB of build tools into `.local/gradle-home`; an export takes a few minutes.
3. `npm run pack:info` shows what was exported; `npm run pack:info -- --find "Iron Dust"` lists the recipes that make something.

Each export lands in `data/export/<pack version>_<date>/` and becomes the active one only after it passes its checks; a failed or interrupted export leaves the previous one active. Run `npm run export` again after a pack update. Exports stay on your machine (`data/` is git-ignored) — never commit them.

All data comes from **your own** copy of the pack and world: recipes are exported from a copy of your server, textures come from your mod jars, and the world is read locally. None of that is stored in this repository.

**Status:** in development. Design: [docs/superpowers/specs/2026-10-17-gtnh-planner-design.md](docs/superpowers/specs/2026-10-17-gtnh-planner-design.md).

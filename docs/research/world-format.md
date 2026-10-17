# World format reference: GTNH 2.9.0-RC-1 save files

Status: research reference for the world reader (Node/TypeScript). Date: 2026-10-17.

This page describes how a GT New Horizons 2.9.0-RC-1 world is stored on disk, in enough detail to decode it without Minecraft. It covers EndlessIDs 1.7.4 and ChunkAPI 0.8.4 chunk storage, `level.dat`, and the tile entities the planner needs. It only describes the format. Numbers that belong to one particular world (coordinates, players, exact counts, numeric IDs) are kept in the local notes file, which is never committed.

## How to read this page

- `$PACK` means the GTNH 2.9.0-RC-1 server pack folder. `$BACKUP` means a world backup zip from `$PACK/backups/`. Every jar named here is in `$PACK/mods/`, except Forge, which is `$PACK/forge-1.7.10-10.13.4.1614-1.7.10-universal.jar`.
- `javap` means the JDK 25 `javap`, run as `javap -cp <jar> -c -p -constants <class>`.
- "Data check" means a read-only Python pass that streamed every region file out of a backup zip (`zipfile`, nothing extracted) and parsed every chunk: 95,006 chunks, 0 parse errors. The scripts live in the session scratch folder, which is listed in the local notes; they are not committed.
- **UNVERIFIED** marks a claim that could not be checked against the jars or the data.
- **Verified by reviewer** and **Corrected by reviewer** mark notes from an independent second pass (2026-10-17). That pass disassembled the same jars again with `javap` and re-parsed a newer backup zip with a separately written read-only Python reader. Its exact world figures are in the local notes, not here.
- All Java NBT methods are SRG-named in the jars. The ones you will see in evidence: `func_74768_a` setInteger, `func_74762_e` getInteger, `func_74772_a` setLong, `func_74763_f` getLong, `func_74774_a` setByte, `func_74771_c` getByte, `func_74777_a` setShort, `func_74765_d` getShort, `func_74757_a` setBoolean, `func_74773_a` setByteArray, `func_74770_j` getByteArray, `func_74783_a` setIntArray, `func_74778_a` setString, `func_74782_a` setTag, `func_74764_b` hasKey, `func_150297_b` hasKey(name, type), `func_77955_b` ItemStack.writeToNBT.

## 1. Files and containers

### 1.1 Backup zip

- ServerUtilities writes backup zips named `YYYY-MM-DD-HH-MM-SS.zip` every 30 minutes. Every entry is deflate (method 8). Paths start with `World/` (plus two `serverutilities/` text files). The whole world folder is copied, including `World/session.lock`.
  - Evidence: `python3 -I -c "import zipfile; z=zipfile.ZipFile('$BACKUP'); ..."` gave `compress types Counter({8: 2168})` and `[('World', 2166), ('serverutilities', 2)]`.
- The reader must use the zip central directory (and support zip64 records) and stream one region entry at a time. Region entries are at most about 12 MB uncompressed. The Node prototype in §8 does this with `zlib.inflateRawSync` and no libraries.
- **UNVERIFIED**: whether ServerUtilities writes a backup to a temporary name and renames it when done. Until this is known, treat a zip as usable only when its end-of-central-directory record parses and the file is at least a couple of minutes old.

### 1.2 Dimension folders

| Path inside `World/` | Meaning |
|---|---|
| `region/r.<rx>.<rz>.mca` | Dimension 0 (Overworld) |
| `DIM<n>/region/r.<rx>.<rz>.mca` | Dimension `n`, which can be negative (`DIM-1` is the Nether) |
| `DIM<n>/` with no `region/` | Registered dimension that was never generated or saved. Most of the ~50 `DIM*` folders are like this; they only hold `data/`, `RedstoneEther/` and similar files. |
| `AE2/` | AE2 meteorite spawn data and compass data. **Not a dimension.** |
| `data/`, `gregtech/`, `playerdata/`, `serverutilities/`, ... | Mod and global data (see §7) |

- Evidence: listing the backup showed region files only under `World/region` and five `World/DIM*/region` folders. The other `DIM*` folders contained only `RedstoneEther`, `data` and loose files, and `World/AE2` contained `spawndata` and `compass`.
- Dimension names are not stored in the world. Forge's `level.dat` → `Forge.DimensionData.DimensionArray` (`IntArray[8]` here) is only the serialized `BitSet` of dimension ids Forge has allocated (`javap … net.minecraftforge.common.DimensionManager.saveDimensionDataMap` reads `dimensionMap: java/util/BitSet`). Map ids to names from pack configs or the export.

### 1.3 Region file (`.mca`): vanilla Anvil layout, unchanged

- Bytes `0..4095` hold 1024 big-endian `u32` location entries. In each entry the high 24 bits are the sector offset (in 4 KiB sectors from the start of the file) and the low 8 bits are the sector count. `0` means the chunk is absent.
- Bytes `4096..8191` hold 1024 big-endian `u32` timestamps: the Unix seconds of each chunk's last save.
- A chunk's index is `(cx & 31) + (cz & 31) * 32`. The file is `r.(cx >> 5).(cz >> 5).mca`, where `cx` and `cz` are chunk coordinates, i.e. block coordinates `>> 4`.
- A chunk payload is a `u32 BE` length (counting the compression byte), then one compression byte (`2` = zlib, `1` = gzip), then the compressed NBT.
- Data check over 95,006 chunks: every chunk is zlib (`comp2: 95006`). No chunk overflows its sectors, none uses sector count 255 or an external `.mcc` file, and `xPos`/`zPos` always match the file and index (there were no `coord_mismatch` or `len_exceeds_sectors` counters).
- Every tile entity's `x >> 4, z >> 4` equals its chunk's `xPos, zPos` (190,539 TEs checked, 0 outside, 0 duplicate positions).

### 1.4 Other files the reader needs

| File | Compression | Content |
|---|---|---|
| `World/level.dat` | gzip | ID maps and pack metadata (§4) |
| `World/playerdata/<uuid>.dat` | gzip | Player position (§7) |
| `World/forcedchunks.dat` | **none** (raw NBT, first byte `0x0a`) | Forge chunk-loading tickets (§7) |
| `World/serverutilities/teams/claimedchunks/<team>.dat` | gzip | ServerUtilities claimed and loaded chunks (§7) |

- Evidence: the first two bytes were `forcedchunks gz? 0a00` and `claimedchunks gz? 1f8b`, and every `playerdata/*.dat` decompressed with gzip.

## 2. NBT rules that matter for a hand-written reader

- Tag ids: 1 Byte, 2 Short, 3 Int, 4 Long, 5 Float, 6 Double, 7 ByteArray, 8 String, 9 List (element type byte + `i32` count), 10 Compound, 11 IntArray, 12 LongArray. Everything is big-endian. Strings use Java "modified UTF-8": a `u16` length, then the bytes. Every registry name and key here is ASCII.
- **Compound key order is not stable** (Java `HashMap` order). Never depend on it.
- Some keys contain literal dots: `GT.ItemCharge`, `GT.ToolStats`, and EnderIO's `priority.DOWN` and `extRM.EAST`. They are single keys, not paths.
- Bytes are signed. A slot index above 127 has to be read as `b & 0xFF`; IronChest does exactly this (§6.8).
- The same field can have different tag types from different writers. GT `Inventory[].Count` is a Byte, or an Int when the stack is larger than 127 (§5). EnderIO `nbtVersion` is a Short, while GT `nbtVersion` is an Int.

## 3. Chunk NBT

### 3.1 Root and `Level` keys

The root is an unnamed compound. It holds `Level` plus world-generation bookkeeping from other mods, which the reader can ignore: `CoFHWorld`, `Forestry`, `Natura.Retrogen`, `NaturaWorld`, `RetrogenData_mrtjp_gen`, `Thaumcraft`, and `gcewing.sg.oresGenerated` (pre-upgrade chunks only).

| `Level` key | Type | Notes |
|---|---|---|
| `V` | Byte | Always 1 |
| `xPos`, `zPos` | Int | Chunk coordinates |
| `LastUpdate` | Long | World tick of the last save |
| `TerrainPopulated`, `LightPopulated` | Byte | |
| `InhabitedTime` | Long | Ticks that players spent near the chunk. A strong base signal (§7). |
| `HeightMap` | IntArray[256] | |
| `Sections` | List<Compound> | §3.3 |
| `Entities` | List<Compound> | Vanilla entities (`id` String, `Pos` …) |
| `TileEntities` | List<Compound> | §6 |
| `TileTicks` | List<Compound>, optional | `{i: Int block id, x, y, z: Int, t: Int delay, p: Int priority}` |
| `Biomes16v2` **or** `Biomes` | ByteArray[512] / ByteArray[256] | §3.4 |
| `POSTEA` | Long | §3.5 |

- Evidence: the data check counted key presence over all chunks: `Entities, HeightMap, InhabitedTime, LastUpdate, LightPopulated, POSTEA, Sections, TerrainPopulated, TileEntities, V, xPos, zPos` in all 95,006 chunks, `Biomes` in 82,121, `Biomes16v2` in 12,885 and `TileTicks` in 3,971. The types came from a typed dump of one region (`('HeightMap','IntArray',256)`, `('Biomes16v2','ByteArray',512)`, `('POSTEA','Long')`, …) and `TileTicks entry schema [('i','Int'),('p','Int'),('t','Int'),('x','Int'),('y','Int'),('z','Int')]`.
- ChunkAPI writes these keys itself (`chunkapi-mc1.7.10-0.8.4.jar`, `com.falsepattern.chunk.internal.mixin.mixins.common.base.AnvilChunkLoaderMixin.writeChunkToNBT`: `ldc "V" … "xPos" … "zPos" … "LastUpdate" … "TerrainPopulated" … "InhabitedTime"`, then `"Sections"`, `"Entities"`, `"TileEntities"`, and tile ticks with `"i" "x" "y" "z" "t"`).

### 3.2 Two chunk generations live side by side

A world that was upgraded to 2.9 holds two kinds of chunk:

| | Post-upgrade chunk (saved by 2.9) | Pre-upgrade chunk (not saved since the upgrade) |
|---|---|---|
| Section keys | EndlessIDs: `Blocks` (+ optional `Add`, `BlocksB2Hi`, `BlocksB3`), `Data` (+ optional `Data1High`, `Data2`) | NotEnoughIDs legacy: `Blocks16`, `Data16` |
| Biomes | `Biomes16v2` | vanilla `Biomes` |
| `POSTEA` | the current pack's code (a non-zero hash) | `0` |
| GT ores | blocks with 16-bit metadata, **no TE** | `gregtech:gt.blockores` blocks **plus one `GT_TileEntity_Ores` TE per ore block** |

- Evidence from the data check: every chunk with `Blocks16` sections also had `Biomes` and `POSTEA = 0`, and every chunk with EndlessIDs sections had `Biomes16v2` and the non-zero code. No chunk mixed the two. All ~28.6 million GT ore TEs were in pre-upgrade chunks (`('DIM0','NEID','Biomes',0) {'ore': 28202878 …}`, `('DIM0','EID','Biomes16v2',…) {'ore': 0 …}`). Pre-upgrade chunk timestamps all came before the upgrade date and post-upgrade ones after it.
- Why: the 2.9.0-RC-1 changelog in `$PACK/changelog from 2.8.4 to 2.9.0-RC-1.md` lists "New Mods: … Chunk API … EndlessIDs" and "Mods Removed: … NotEnoughIds". EndlessIDs reads the old keys through a method literally named `readSubChunkFromNBTNotEnoughIDsDFU` (§3.3).
- The numeric block IDs inside pre-upgrade chunks still resolve through the **current** `level.dat` map. In the data check, all 2.33 billion decoded block positions, old and new format, mapped to a registered block name (`unknown ids []`).
- Decide the format **per section**, by testing for the `Blocks16` key, exactly as EndlessIDs does. Do not decide per chunk or per dimension.
- **Verified by reviewer:** the split holds on a newer backup. No chunk mixes the two section formats. `Blocks16` chunks always carry `Biomes` and `POSTEA = 0`, and EndlessIDs chunks always carry `Biomes16v2` and the current code. The GT ore TE total was unchanged, all of them in pre-upgrade chunks. Every `gregtech:gt.blockores` block in a legacy section has exactly one `GT_TileEntity_Ores` TE and vice versa: the totals are equal and every such TE stands on such a block. No `gregtech:gt.blockores` block remains in EndlessIDs sections; ores there are `gregtech:gt.blockores2…7`. Some dimensions also hold pre-upgrade chunks whose `Sections` list is empty (all air). Those have no section to test, so use `Biomes`/`POSTEA` if you need to tell them apart.

### 3.3 Sections (block IDs and metadata)

Each `Sections` element is one 16×16×16 sub-chunk:

| Key | Type / size | Bits | Written when |
|---|---|---|---|
| `Y` | Byte | section index (0..15) | always (ChunkAPI) |
| `Blocks` | ByteArray[4096] | block id bits 0–7 | always |
| `Add` | ByteArray[2048] (nibbles) | block id bits 8–11 | some id in the section > 255 |
| `BlocksB2Hi` | ByteArray[2048] (nibbles) | block id bits 12–15 | some id > 4095 |
| `BlocksB3` | ByteArray[4096] | block id bits 16–23 | some id > 65535 (none in this world) |
| `Data` | ByteArray[2048] (nibbles) | metadata bits 0–3 | always |
| `Data1High` | ByteArray[2048] (nibbles) | metadata bits 4–7 | some meta > 15 |
| `Data2` | ByteArray[4096] | metadata bits 8–15 | some meta > 255 |
| `BlockLight`, `SkyLight` | ByteArray[2048] (nibbles) | vanilla light | always |
| `Blocks16` (legacy) | ByteArray[8192] | 4096 × **big-endian u16** block ids | pre-upgrade sections only |
| `Data16` (legacy) | ByteArray[8192] | 4096 × **big-endian u16** metadata | pre-upgrade sections only |

- **Index** within a section: `i = (y & 15) << 8 | (z & 15) << 4 | (x & 15)`. The section is `y >> 4`.
- **Nibble arrays** use the vanilla `NibbleArray` order: `byte[i >> 1]`, low nibble when `i` is even and high nibble when `i` is odd.
- **Block id** (EndlessIDs): `id = Blocks[i] | Add·nib(i) << 8 | BlocksB2Hi·nib(i) << 12 | BlocksB3[i] << 16`. The arrays cascade: `BlocksB2Hi` is only read when `Add` exists, and `BlocksB3` only when `BlocksB2Hi` exists.
- **Metadata** (EndlessIDs): `meta = Data·nib(i) | Data1High·nib(i) << 4 | Data2[i] << 8`, cascading the same way. Metadata above 15 is real in this pack: the new GT ore blocks `gregtech:gt.blockores2…7` reach about 31,000, and `gregtech:gt.blockframes` reaches about 300.
- **Legacy**: `id = u16be(Blocks16, 2i)` and `meta = u16be(Data16, 2i)`.
- Section key sets in the data check: `498544 × {BlockLight, Blocks16, Data16, SkyLight, Y}`, `66589 × {Add, BlockLight, Blocks, BlocksB2Hi, Data, Data1High, Data2, SkyLight, Y}`, `3581 × {Add, …, Blocks, Data, …}`, `1241 × {BlockLight, Blocks, Data, SkyLight, Y}`, `27 × {Add, …, Blocks, BlocksB2Hi, Data, …}`. So every optional array really is optional. Sections converted from NotEnoughIDs keep all of `Add`, `BlocksB2Hi`, `Data1High` and `Data2`, because the conversion creates all of them.
- Compared with vanilla 1.7.10: `Blocks` + `Add` + `Data` are the vanilla keys with vanilla meaning. A vanilla reader would get only the low 12 bits of the id and the low 4 bits of meta, which is wrong for any id ≥ 4096. This world's `level.dat` has block ids up to about 11,400.

Evidence (all from `javap … endlessids-mc1.7.10-1.7.4.jar`):

```
com.falsepattern.endlessids.managers.BlockIDManager.writeSubChunkToNBT
  42: ldc "Blocks" ... func_74773_a          // always
  56: ldc "Add"        (if b2Low != null)
  72: ldc "BlocksB2Hi" (if b2High != null)
  88: ldc "BlocksB3"   (if b3 != null)
BlockIDManager.readSubChunkFromNBT
   7: ldc "Blocks16" ; func_74764_b ; ifeq 22    // key absent -> EndlessIDs keys below
  18: invokestatic readSubChunkFromNBTNotEnoughIDsDFU ; return   // key present -> legacy path
  46: ldc "Blocks" ; 54: "Add" (if hasKey) ; 75: "BlocksB2Hi" (if hasKey) ; 96: "BlocksB3" (if hasKey)
readSubChunkFromNBTNotEnoughIDsDFU
  ByteBuffer.wrap(bytes).asShortBuffer()     // big-endian u16
  b1[i] = s & 255 ; b2Low nibble = (s & 3840) >>> 8 ; b2High nibble = (s & 61440) >>> 12
com.falsepattern.endlessids.mixin.mixins.common.blockitem.common.ExtendedBlockStorageMixin.eid$getID(int,int,int)
  index = y << 8 | z << 4 | x ; id = b1[index] & 255
  if (b2Low != null) { id |= b2Low.get(x,y,z) << 8
    if (b2High != null) { id |= b2High.get(x,y,z) << 12
      if (b3 != null) id |= (b3[index] & 255) << 16 } }
ExtendedBlockStorageMixin.func_76665_b (getMetadata)
  m = m1Low.get ; if (m1High != null) { m |= m1High.get << 4 ; if (m2 != null) m |= (m2[index] & 255) << 8 }
BlockMetaManager.writeSubChunkToNBT: "Data" always, "Data1High" if non-null, "Data2" if non-null
BlockMetaManager.readSubChunkFromNBTNotEnoughIDsDFU ("Data16"): m1Low = s & 15, m1High = (s & 240) >>> 4, m2 = (s & 65280) >>> 8
ExtendedBlockStorageMixin.eid$setID: creates Add when id > 255, BlocksB2Hi when id > 4095, BlocksB3 when id > 65535
com.falsepattern.endlessids.constants.ExtendedConstants: bitsPerID = 24, bitsPerMetadata = 16, bitsPerBiome = 16, biomeIDNull = 65535
```

The decode was validated on the whole backup. All decoded ids exist in `level.dat` (`unknown ids []`). The block at every TE's own position is the expected owner block: `GT_TileEntity_Ores → gregtech:gt.blockores`, `BaseMetaTileEntity`/`BaseMetaPipeEntity → gregtech:gt.blockmachines`, `StorageDrawers:tileDrawersStandard → StorageDrawers:fullDrawers4`, `savedMultipart → ForgeMultipart:block`, `TileEntityBarrel → JABBA:barrel`, `IronChest.* → IronChest:BlockIronChest`, `blockConduitBundleTileEntity → EnderIO:blockConduitBundle`. Ids above 4095 also checked out, for example `cropsnh:cropSticksTE → cropsnh:cropSticks`.

**Verified by reviewer:** `eid$getID`, `func_76665_b`, both `readSubChunkFromNBTNotEnoughIDsDFU` methods and both `writeSubChunkToNBT` methods were disassembled again and match the excerpt above. For example, `eid$getID` is `iload_2 bipush 8 ishl iload_3 iconst_4 ishl ior iload_1 ior` (= `y<<8 | z<<4 | x`), then `getfield field_76681_e ; ifnull 101` before the `<< 8` term, `getfield b2High ; ifnull 101` before `<< 12`, and `getfield b3 ; ifnull 101` before `(b3[i] & 255) << 16`. `ByteBuffer.wrap(...).asShortBuffer()` is big-endian by Java's default. A separately written decoder over a newer backup again found 0 unknown ids over ~2.33 billion blocks and no TE standing on air. Every TE had the expected owner block, including blocks with ids above 4095, which need the `BlocksB2Hi` nibble (for example `cropsnh:cropSticksTE → cropsnh:cropSticks`). Two additions:
- `BlocksB3` cannot occur with this pack's config. `config/endlessids.cfg` sets `extraBlockIDBits=3`, and `ExtendedConstants.<clinit>` computes `blockIDCount = 1 << (24 - (12 - extraBlockIDBits))` (`bipush 12 … isub … iconst_1 bipush 24 … isub ishl`), which is 32,768. The largest block id is therefore 32,767.
- Vanilla blocks can carry metadata above 15 too. In the Twilight Forest dimension (`config/TwilightForest.cfg` `dimensionID=7`), `minecraft:dirt`, `minecraft:grass`, `minecraft:stone` and `TwilightForest:tile.TrollSteinn` carry meta 49 in both legacy and EndlessIDs sections. Texture and name lookups need a fallback for metadata they do not know.

How ChunkAPI fits in: ChunkAPI writes `Y` and then calls every registered "data manager". A manager that returns `subChunkPrivilegedAccess() == true` writes its keys **directly** into the section compound. EndlessIDs' block and meta managers both return `true` (`iconst_1`). A non-privileged manager would be nested as `section[<domain>][<id>]` (`DataRegistryImpl.createManagerNBT`: `func_74775_l(domain)` then `func_74775_l(id)`). In this pack no nested manager compounds occur in sections or chunks (data check: no other section keys exist).

### 3.4 Biomes

| Key | Layout | Null value |
|---|---|---|
| `Biomes16v2` (post-upgrade) | 256 × **little-endian** u16, index `(z & 15) << 4 \| (x & 15)` | 65535 (`ExtendedConstants.biomeIDNull`) |
| `Biomes16` (legacy, absent here) | two 256-byte planes (low bytes 0–255, high bytes 256–511) | — |
| `Biomes` (vanilla, pre-upgrade) | 256 × u8 | 255 (vanilla) |

- Evidence: `javap … com.falsepattern.endlessids.managers.BiomeManager` → `writeChunkToNBT: Hooks.shortToByteArray(...) ; ldc "Biomes16v2"`. `readChunkFromNBT` tries `"Biomes16v2"` (`Hooks.byteToShortArray`), then `"Biomes16"` (`byteToShortArrayLegacy`), then `"Biomes"` (`Hooks.scatter`, `& 255`). `Hooks.byteToShortArray` does `s[j/2] = (j % 2 == 0) ? b & 255 : s | (b & 255) << 8`, which is little-endian.
- Data check: decoding one region's `Biomes16v2` as little-endian gave the same biome ids as the vanilla `Biomes` arrays in the neighbouring chunks, and `odd-byte nonzero 0 of 155904`.
- The column index is `z << 4 | x`, the vanilla convention. **Verified by reviewer** (this was UNVERIFIED). `javap … com.falsepattern.endlessids.mixin.mixins.common.biome.vanilla.ChunkMixin`, method `func_76591_a(int,int,WorldChunkManager)`, reads `eid$blockBiomeShortArray[iload_2 << 4 | iload_1]`. For the null value 65535 it calls `func_76935_a((field_76635_g << 4) + iload_1, (field_76647_h << 4) + iload_2)`, that is chunk x + argument 1 and chunk z + argument 2. So argument 1 is the local x and argument 2 the local z.
- Data check by reviewer over a newer backup: every `Biomes16v2` array is 512 bytes, and every odd (high) byte is 0. Read little-endian with `z << 4 | x`, 98% of edge columns agree across borders between a `Biomes16v2` chunk and a vanilla `Biomes` chunk. That is the same rate as between two vanilla chunks; reading with `x << 4 | z` gives 80%.

### 3.5 `POSTEA` (Long)

Postea (`postea-1.2.6.jar`, `com.gtnewhorizons.postea`) migrates old blocks, items and TEs when a chunk is loaded. `POSTEA` is a marker for which pack build last processed the chunk. It is **not** block data.

- On write: `ChunkFixerUtility.onChunkWrite: ldc "POSTEA" ; Postea$getPosteaCode() ; func_74772_a`.
- On read: if `func_150297_b("POSTEA", 4)`, the stored code is compared with `POSTEA_UPDATE_CODE`, which is set from `PosteaUtilities.getModListHash()`, an int hash over `Loader.getActiveModList()` entries `modId + ":" + …`. When the codes differ, Postea runs `adjustTileEntities` and `transformNormalBlocksInSubChunk` on the chunk.
- **Verified by reviewer:**
  - **The hash.** It is `String.hashCode()` of the concatenated, sorted `modId:version` strings: `PosteaUtilities.getModListHash` does `getModId … ldc ":" … getVersion … Collections.sort … String.hashCode`. Any mod version bump changes it, not just adding or removing a mod.
  - **The read hook.** `MixinAnvilChunkLoader.postea$chunkHook` and, with ChunkAPI, `MixinDataRegistryImpl` at `RETURN` of `DataRegistryImpl.readChunkFromNBT` both call `ChunkFixerUtility.onChunkRead`. It returns early only when `hasChunkBeenUpdated(code)`, i.e. `code == POSTEA_UPDATE_CODE`; a missing key counts as -1.
  - **Saving.** `onChunkLoaded` marks an unmigrated chunk modified (`Chunk.func_76630_e`), so the chunk is saved again with the new code.
- What this means for the reader: a chunk whose `POSTEA` differs from the value in freshly saved chunks has not been migrated yet. It can still hold legacy blocks and TEs that the game would convert the next time it loads the chunk. In this pack:
  - `GT_TileEntity_Ores` TEs become `GTBlockOre` blocks (`gregtech.common.ores.GTOreAdapter`: `ldc "GT_TileEntity_Ores" … TileEntityReplacementManager.tileEntityTransformer`).
  - GT frame boxes stored as `BaseMetaPipeEntity` become blocks (`gregtech.loaders.postload.PosteaTransformers.registerFrameboxTransformers`: `ldc "BaseMetaPipeEntity" … tileEntityTransformer`).
  - Some IC2 and BartWorks blocks are replaced (`IC2:blockAlloyGlass`, `bartworks:BW_GlasBlocks`, …).
- The code changes whenever the mod list changes, for example with 2.9.0 final. Never hard-code it. Treat "the most common non-zero `POSTEA` among recently saved chunks" as the current code.

### 3.6 Which chunk managers the world uses (`level.dat`)

`level.dat` → `chunkapicore` = `{version: "0.8.4", managers: {"endlessids:blockid": {version: "1.7.4", uninstallMessage}, "endlessids:metadata": {version: "1.7.4", …}, "endlessids:biome": {version: "endlessids", …}, "archaicfix:lighting": {version: "1.0", …}}}`. Vanilla managers in the `minecraft:` domain are not listed (`DataRegistryImpl.writeLevelDat`: `ldc "managers" … ldc "version" … ldc "0.8.4" … ldc "minecraft:"`). The reader can check these versions at startup and refuse unknown ones.

## 4. `level.dat` and the id → name map

Root keys: `chunkapicore`, `Forge`, `FML`, `Data`. `Data` is vanilla (`LevelName`, `SpawnX/Y/Z`, `Time`, `DayTime`, `GameRules`, `generatorName`, …).

`FML` (Forge Mod Loader 7.10.99.99):

| Key | Type | Content |
|---|---|---|
| `ItemData` | List<Compound{`K`: String, `V`: Int}> | **The numeric id map.** `K` is a prefix character + registry name. `V` is the id. |
| `BlockedItemIds` | IntArray | ids reserved and not to be reused |
| `BlockAliases`, `ItemAliases` | List<Compound{`K`: old name, `V`: new name}> | renames |
| `BlockSubstitutions`, `ItemSubstitutions` | List | empty in this pack |
| `ModList` | List<Compound{`ModId`, `ModVersion`}> | ~294 entries |

- **Prefix byte**: `\u0001` = block, `\u0002` = item. An ItemBlock uses the same number as its block, so a name such as `gregtech:gt.blockmachines` appears with both prefixes and the same `V`.
- Evidence (Forge jar): `cpw.mods.fml.common.FMLContainer.getDataForWriting` writes `ldc "K" … ldc "V" … ldc "ItemData" … "BlockedItemIds" … "BlockAliases" … "BlockSubstitutions" … "ItemAliases" … "ItemSubstitutions"`. `cpw.mods.fml.common.registry.GameData` reads with `key.substring(1)` and `key.charAt(0) == 1` → block.
- Evidence (data): `ItemData entries 15608 prefix chars Counter({"'\\x02'": 11345, "'\\x01'": 4263})`, entry types `{'V': 'Int', 'K': 'String'}`.
- **Verified by reviewer, with a caution:** a name that appears under both prefixes does **not** always have the same `V`. In this pack's `level.dat`, 13 such names are a block plus a separate item that is not an `ItemBlock` and has its own id. Examples: `minecraft:reeds`, `minecraft:wheat`, `minecraft:bed`, `minecraft:cake`, `minecraft:wooden_door`, `minecraft:cauldron`, `minecraft:skull`, `minecraft:flower_pot`. Keep separate block and item maps, as the code below does, and never resolve an item id through the block map. Jar evidence for the prefixes: `GameData.<init>` creates the block registry with `ldc "minecraft:air" sipush 4095 … iconst_1` and the item registry with `sipush 31999 … iconst_2` as the `char` discriminator. `FMLControlledNamespacedRegistry.serializeInto` then puts `discriminator + name → id` into the map that `FMLContainer.getDataForWriting` writes as `ItemData`.
- EndlessIDs does **not** change this format: no extra root key, standard prefixes. Its limits are 24-bit block ids and 16-bit metadata (`ExtendedConstants`). Item stacks above id 31,999 use `idExt` (§5).

To resolve a block:

```ts
// ids differ from world to world: build the map from each world's level.dat, never hard-code numbers
const blockName = new Map<number, string>(), itemName = new Map<number, string>();
for (const e of levelDat.FML.ItemData) {               // e = { K: string, V: number }
  const kind = e.K.charCodeAt(0);
  if (kind === 1) blockName.set(e.V, e.K.slice(1));     // e.g. "gregtech:gt.blockmachines"
  else if (kind === 2) itemName.set(e.V, e.K.slice(1));
}
// block at (x,y,z): decodeSection(section).ids[i] → blockName.get(id); meta from the same index
```

`minecraft:air` is block id 0.

## 5. Item stacks

| Writer | Shape |
|---|---|
| Vanilla / EndlessIDs (`ItemStack.writeToNBT`) | `{id: Short, Count: Byte, Damage: Short, tag?: Compound}`. When the item id is > 31,999, `id` is written as Short 0 and `idExt: Int` holds the real id. |
| Reading rule (EndlessIDs `DataUtil.readIDFromNBT`) | `idExt` (Int) if present, else `id` as Int if it is an Int, else `id` as Short. A negative `Damage` is clamped to 0. |
| GT machine inventories | the vanilla stack plus `IntSlot: Int`. If the stack is larger than 127, `Count` is **overwritten as an Int**. |
| Chests (vanilla, IronChest) | the vanilla stack plus `Slot: Byte` (read as `& 0xFF`) |
| Storage Drawers slot | `{ItemStack: <vanilla stack, Count 1>, Count: Int}`. Legacy `{Item: Short, Meta: Short, Count: Int, Tags}` is still readable. |
| JABBA barrel | `storage.current_item` (vanilla stack with Count 0) plus `storage.amount: Int` |
| Some mods (seen: OpenBlocks grave `Items`) | `id` is a **String registry name** |

- Evidence: `javap … endlessids … ItemStackMixin.func_77955_b` → `DataUtil.writeIDToNBT ; ldc "Count" (func_74774_a, Byte) ; ldc "Damage" (func_74777_a) ; ldc "tag"`. `DataUtil.writeIDToNBT`: `sipush 31999 ; if_icmple … ; ldc "id" iconst_0 … ; ldc "idExt" func_74768_a`. `DataUtil.readIDFromNBT`: `"idExt"` type 3, then `"id"` type 3, then `"id"` type 2.
- GT: `javap … gregtech-5.09.54.183.jar gregtech.api.metatileentity.CommonBaseMetaTileEntity.saveMetaTileNBT` → `ldc "IntSlot" … func_77955_b … field_77994_a bipush 127 if_icmple … ldc "Count" func_74768_a … ldc "Inventory"`.
- Data check over every TE: `(id Short, Count Byte): 76600, (id String, Count Byte): 134` (all of the String ones from `openblocks_grave`). No `idExt` and no negative `Damage` occurred.
- **Verified by reviewer:**
  - **Where the rule comes from.** `ItemStackMixin` is an `@Overwrite` of `ItemStack.func_77955_b` and `func_77963_c` that calls `DataUtil.writeIDToNBT` and `readIDFromNBT` (bytecode as above). It is applied because `config/endlessids.cfg` has `extendBlockItem=true`.
  - **When `idExt` appears.** With `extraItemIDBits=1`, item ids reach 65,535 (`ExtendedConstants.itemIDCount = 1 << (24 - (9 - extraItemIDBits))`). `idExt` therefore appears as soon as an item id above 31,999 is assigned. The reference world's largest item id is well below that, which is why no `idExt` was seen; readers must still handle it.
- Common `tag` contents the planner can use: `GT.ItemCharge` (Long, GT battery charge), `charge` (Double, IC2 electric items), `GT.FluidContent`/`Fluid` (`{FluidName, Amount}`), `chipROM` (Project Red chip settings).

## 6. Tile entities

Every TE has `id` (String) and `x`, `y`, `z` (Int, absolute block coordinates). Its owner block sits at the same position (checked, see §3.3).

### 6.1 GregTech machines: `BaseMetaTileEntity`

| Key | Type | Meaning |
|---|---|---|
| `mID` | **Int** | MetaTileEntity id: which machine this is (§6.3) |
| `mFacing` | Short | front `ForgeDirection` ordinal: 0 down, 1 up, 2 north (−z), 3 south (+z), 4 west (−x), 5 east (+x). For basic machines this is the output face (**UNVERIFIED**, see the evidence below). |
| `mMainFacing` | Int | only on basic machines (`MTEBasicMachine`): the face showing the machine front texture |
| `mStoredEnergy` | Long | EU in the machine's internal buffer |
| `mStoredSteam` | Long | steam buffer of the base TE. Steam machines usually keep steam in `mSteam` (FluidStack) instead. |
| `mColor` | Byte | 0 = not painted, 1..16 = dye 0..15 (`getColorization() = mColor - 1`) |
| `Inventory` | List<Compound> | §5 (`IntSlot` + stack) |
| `gt.covers` | List<Compound>, optional | `{s: Byte side, id: Int, tra: Int, d: <cover data>}`. `id` packs the cover item: `itemId \| damage << 16`. |
| `mRedstoneSided` | ByteArray[6] | redstone output per side |
| `mStrongRedstone` | Byte, optional | |
| `mOwnerName`, `mOwnerUuid` | String | |
| `mActive`, `mWorks`, `mRedstone`, `mInputDisabled`, `mOutputDisabled`, `mMuffler`, `mLockUpgrade`, `mWasShutdown` | Byte (bool) | |
| `mLightValue`, `mOtherUpgrades` | Byte | |
| `shutDownReasonID`, `shutDownReason` | String, Compound | |
| `nbtVersion` | Int | GT version as a number (e.g. 509054183 for 5.09.54.183) |

Keys added by machine family:

| Family (class) | Extra keys |
|---|---|
| Basic machine (`MTEBasicMachine`, e.g. `MTEBasicMachineWithRecipe`) | `mMainFacing` Int, `mEUt`, `mProgresstime`, `mMaxProgresstime` Int, `mFluidTransfer`, `mItemTransfer`, `mAllowInputFromOutputSide`, `mDisableFilter`, `mDisableMultiStack` Byte, `mFluid`/`mOutputFluid`/`mFluidOut`, `mOutputItem<n>` |
| Tank-like (`MTEBasicTank`: hatches, turbines, boilers) | `mFluid` = `{FluidName: String, Amount: Int}` |
| Multiblock controller (`MTEMultiBlockBase`) | maintenance flags `mWrench`, `mScrewdriver`, `mSoftMallet`, `mHardHammer`, `mSolderingTool`, `mCrowbar` (Byte), `mEUt` (Int or Long), `mProgresstime`, `mMaxProgresstime`, `mEfficiency`, `mEfficiencyIncrease`, `mPollution`, `mRuntime`, `mTotalRunTime`, `recipesDone`, `voidingMode`, `batchMode`, `inputSeparation`, `mOutputItemsLength`/`mOutputItem<n>`, `mOutputFluidsLength`/`mOutputFluids<n>`, `checkRecipeResult` … |
| Structure-aligned controller (`MTEEnhancedMultiBlockBase`) | `eRotation` Byte (StructureLib `Rotation` ordinal: 0 NORMAL, 1 CLOCKWISE, 2 UPSIDE_DOWN, 3 COUNTER_CLOCKWISE), `eFlip` Byte (`Flip`: 0 NONE, 1 HORIZONTAL, 2 VERTICAL, 3 BOTH) |
| Hatches | `textureIndex`, `texturePage` Int, plus fluid or filter keys |

Evidence:
- `javap … gregtech.api.metatileentity.BaseMetaTileEntity.func_145841_b` → `"mWasShutdown" … "mID" func_74768_a (Int) … "mStoredSteam" func_74772_a … "mStoredEnergy" func_74772_a … writeCoverNBT … writeCommonNBT … "mLightValue" … "mOtherUpgrades" … "mFacing" ForgeDirection.ordinal func_74777_a (Short) … "mOwnerName" … "mOwnerUuid" … "mLockUpgrade" "mMuffler" "mActive" "mWorks" "mRedstone" "mInputDisabled" "mOutputDisabled" "shutDownReasonID" "shutDownReason" … saveMetaTileNBT`.
- `CommonBaseMetaTileEntity.writeCommonNBT: "mColor" func_74774_a`. `BaseMetaTileEntity.getColorization: getColorRaw() iconst_1 isub`.
- `CoverableTileEntity.writeCoverNBT: buildCoversNbtTag … "gt.covers" … "mStrongRedstone" … "mRedstoneSided" func_74773_a`. `buildCoversNbtTag: "s" func_74774_a ; CoverRegistry.writeCoverToNbt`. `CoverRegistry.writeCoverToNbt: "id" Cover.getCoverID func_74768_a ; Cover.writeToNBT → "tra" func_74768_a, "d" saveDataToNbt`. `buildCoverFromNbt: "id" → GTUtility.intToStack` (`& 65535` item id, `>>> 16` damage). `GTUtility.itemToInt: Item.getIdFromItem | damage << 16`.
- `MTEBasicMachine.saveNBTData: "mFluidTransfer" "mItemTransfer" "mAllowInputFromOutputSide" "mDisableFilter" "mDisableMultiStack" "mEUt" "mMainFacing" func_74768_a (Int) "mProgresstime" "mMaxProgresstime" "mOutputFluid" "mFluidOut"`. `MTEBasicMachine.getTexture` compares the side with `mMainFacing` to pick the front texture. **UNVERIFIED** detail: that output goes to `mFacing` was not traced in `doOutput`.
- `MTEMultiBlockBase.saveNBTData: "mEUt" "mProgresstime" … "mWrench" "mScrewdriver" "mSoftMallet" "mHardHammer" "mSolderingTool" "mCrowbar" "batchMode" "inputSeparation" … "voidingMode"`. `MTEEnhancedMultiBlockBase.saveNBTData: "eRotation" ExtendedFacing.getRotation().getIndex() ; "eFlip" getFlip().getIndex()`. StructureLib `Rotation.getIndex()` returns `ordinal()`, and the declaration order is NORMAL, CLOCKWISE, UPSIDE_DOWN, COUNTER_CLOCKWISE. For `Flip`, the declaration order is NONE, HORIZONTAL, VERTICAL, BOTH. **UNVERIFIED**: that `Flip.getIndex()` is also `ordinal()` (only `Rotation` was disassembled).
- Data check: the union schema of all GT machines in the world matches these tables (for example `.mID {'Int'}`, `.mFacing {'Short'}`, `.mMainFacing {'Int'}` on basic machines only, `.mWrench {'Byte'}` and `.eRotation {'Byte'}` on controllers only). No `gt.covers` occurred in this world, so the cover layout comes from the jar only.
- **Verified by reviewer:**
  - **Machine keys.** Re-checked in `BaseMetaTileEntity.func_145841_b`: `mID` is written with `func_74768_a`, `mStoredSteam` and `mStoredEnergy` with `func_74772_a`, and `mFacing` with `ForgeDirection.ordinal` + `func_74777_a`. The world's machines matched these types again.
  - **Colour.** `BaseMetaTileEntity.setColorization` maps any value outside -1..15 to -1 and stores `value + 1` via `setColorRaw`, so raw 0 means unpainted.
  - **Covers.** The cover `id` is `Cover.coverID`, which the `Cover` constructor sets from `GTUtility.stackToInt(coverItem)`. That is `itemToInt(item, rawDamage)` = `Item.func_150891_b(item) | damage << 16`, and `GTUtility.intToStack` reverses it with `& 65535` and `>>> 16`. `gt.covers` is written only when at least one cover exists: `writeCoverNBT` does `func_74745_c ; ifle`.

### 6.2 GregTech pipes and cables: `BaseMetaPipeEntity`

| Key | Type | Meaning |
|---|---|---|
| `mID` | Int | pipe or cable type (§6.3) |
| `mConnections` | Byte | bit `1 << side` = connected on that `ForgeDirection` side (1 down, 2 up, 4 north, 8 south, 16 west, 32 east; 63 = all) |
| `mColor` | Byte | as for machines |
| `Inventory` | List | usually empty |
| `mFluid` (fluid pipes) | `{FluidName, Amount}` | contents. Multi-fluid pipes use more `mFluid…` keys. |
| `mLastReceivedFrom` | Byte | fluid pipes and item pipes |
| `mDisableInput` | Byte | fluid pipes only |
| `gt.covers`, `mRedstoneSided`, `mWorks`, `nbtVersion` | | as for machines |

- Telling the kind apart from NBT alone: `mDisableInput` present → fluid pipe. `mLastReceivedFrom` without `mDisableInput` → item pipe. Neither → wire or cable. For voltage, amperage and loss, map `mID` through the pack's cable table (§6.3).
- Evidence: `javap … gregtech.api.interfaces.metatileentity.IConnectable`: `CONNECTED_DOWN = 1, CONNECTED_UP = 2, CONNECTED_NORTH = 4, CONNECTED_SOUTH = 8, CONNECTED_WEST = 16, CONNECTED_EAST = 32, CONNECTED_ALL = 63`. `MetaPipeEntity.isConnectedAtSide: mConnections & ForgeDirection.flag`. `BaseMetaPipeEntity.func_145841_b: "mID" func_74768_a … "mConnections" func_74774_a … "mWorks"`. `MTEFluidPipe.saveNBTData: "mFluid…" "mLastReceivedFrom" "mConnections" "mDisableInput"`. `MTEItemPipe.saveNBTData: "mLastReceivedFrom" "mConnections"`. `MTECable.saveNBTData: "mConnections"`. Forge `ForgeDirection.<clinit>`: `DOWN(0,-1,0) UP(0,1,0) NORTH(0,0,-1) SOUTH(0,0,1) WEST(-1,0,0) EAST(1,0,0) UNKNOWN`.
- Data check: no pipe in the world has bit 0x40 or 0x80 set. Every pipe with `mFluid` also has `mDisableInput`.
- **Verified by reviewer:**
  - **Jar.** Forge `ForgeDirection.<init>` sets `flag = 1 << ordinal()` (`iconst_1 … ordinal ishl putfield flag`). `<clinit>` declares `DOWN(0,-1,0) UP(0,1,0) NORTH(0,0,-1) SOUTH(0,0,1) WEST(-1,0,0) EAST(1,0,0) UNKNOWN` in that order.
  - **Geometry.** Over every GT pipe in a newer backup, 99% of set bits have a tile entity on that side with this mapping. Mirroring up/down, north/south and west/east drops that to 77%, and swapping x and z drops it to 48%.
- GT frame boxes are no longer pipe TEs in 2.9. Postea converts them to `gregtech:gt.blockframes` blocks (§3.5).

### 6.3 Telling machines apart by `mID`, and multiblock or not

- `mID` indexes GT's MetaTileEntity table (`GregTechAPI.METATILEENTITIES[mID]`). The enum `gregtech.api.enums.MetaTileEntityIDs` names 2,033 of them (an earlier reviewer's enum dump, `gtclasses/mteids.json` in the session scratch folder, maps id → name). It does **not** say which class an id is, and it does not cover pipes, cables or some other-mod registrations.
- **Static id → class table from the jar.** Disassemble the 82 classes that reference `MetaTileEntityIDs` and pair every `getstatic MetaTileEntityIDs.<NAME>` with the enclosing `new <Class> … invokespecial <Class>."<init>"`. Also pair it with `MTEBasicMachineWithRecipeBuilder.builder(ID)`, which builds `MTEBasicMachineWithRecipe`. This resolves 1,792 of 2,033 enum names. The rest are registered by other jars (CropsNH, VendingMachine, …) or by loops.
  - Evidence: `javap … gregtech.loaders.preload.LoaderMetaTileEntities` shows `new MTEElectricBlastFurnace ; getstatic MetaTileEntityIDs.EBF_CONTROLLER ; getfield ID ; … invokespecial MTEElectricBlastFurnace."<init>":(ILjava/lang/String;Ljava/lang/String;)V`, and `getstatic MetaTileEntityIDs.ALLOY_SMELTER_LV ; getfield ID ; invokestatic MTEBasicMachineWithRecipeBuilder.builder:(I)…`.
- **Multiblock rule:** a controller is a class that extends `gregtech/api/metatileentity/implementations/MTEMultiBlockBase` **or** implements StructureLib `com/gtnewhorizon/structurelib/alignment/constructable/IConstructable`. The second branch catches primitive multis such as `MTEBrickedBlastFurnace`.
  - Evidence: a class-file walk over `gregtech-5.09.54.183.jar` + `structurelib-1.4.45.jar` found 297 resolved ids under `MTEMultiBlockBase`, plus `(140, 'BRICKED_BLAST_FURNACE_CONTROLLER', 'MTEBrickedBlastFurnace')` as constructable but not `MTEMultiBlockBase`. Two `MTEMultiBlockBase` classes are not constructable: `MTECharcoalPit` and `MTELESU`.
- **NBT fallback, needs no table:** `MTEMultiBlockBase` always writes `mWrench … mCrowbar` (§6.1), so those keys mark a controller. This misses the primitive multis that do not extend it (the bricked blast furnace has only `mProgresstime` and `mMaxProgresstime`). Data check: every controller TE whose id the static table resolves to an `MTEMultiBlockBase` subclass had the maintenance keys. So did the VendingMachine mod's controller, which is registered outside the gregtech jar. The bricked blast furnaces had none.
- **Tier**: basic machines get it from `…Builder.setTier(int)` in the same bytecode (`iconst_1 … TierStep.setTier`). Enum names also end in the tier (`_LV`, `_MV`, …). **Recommended:** have the recipe export on the server copy also dump, for every non-null `METATILEENTITIES[i]`: class, `getMetaName()`, tier, `isMultiblock`, and for cables voltage, amperage and loss. That covers every id including other mods' ones and replaces the static scan.
- **Cables, statically:** `gregtech.loaders.preload.LoaderMetaPipeEntities.registerWiresAndCables` calls `WireCableBuilder.material(M).startId(N).lossCable(a).lossWire(b).amperage(c).voltage(TierEU.X).build()`. `build()` registers wires 1×, 2×, 4×, 8×, 12×, 16× at `startId + 0..5` and cables 1×…16× at `startId + 6..11`, unless `disableCable()`. The amperage is `amperage × size`. 58 builder calls give 546 ids. GT++ wires are registered separately (`gtPlusPlus.xmod.gregtech.registration.gregtech.GregtechConduits.wireFactory`, 30xxx ids). **UNVERIFIED**: the GT++ table, and GT fluid and item pipe id tables (`FluidPipeBuilder` and `ItemPipeBuilder` were not parsed).
  - Evidence: `WireCableBuilder.build`: `startId iconst_0 iadd … "gt.oreprefix.1x_material_wire" … startId iconst_5 iadd … "16x_material_wire" … generateCable … startId bipush 6 iadd … "1x_material_cable" … bipush 11 … "16x_material_cable"`, with `MTECable.<init>(I,String,String,F,Materials,J loss,J amps,J voltage,Z,Z)`.

### 6.4 GT battery buffers (`MTEBasicBatteryBuffer`, enum `BATTERY_BUFFER_<n>_BY_<n>_<tier>`)

- The batteries are ordinary `Inventory` entries (`IntSlot` 0..n²−1). GT battery items (`gregtech:gt.metaitem.01` and others, `MetaBaseItem`) keep their charge in `tag["GT.ItemCharge"]` (Long). IC2-API batteries keep it in `tag.charge` (Double). Some GT batteries switch `Damage` between charged and empty variants (`MetaBaseItem.setCharge` calls `getChargedMetaData` / `getEmptyMetaData`).
- The buffer's internal EU is `mStoredEnergy`. The game shows stored EU as `mStoredEnergy + Σ battery charge` and capacity as `V[tier]·64·slots + Σ battery max charge`. Battery max charge comes from the item's electric stats (`MetaBaseItem.getElectricStats(stack)[0]`) and is **not** in the world, so get it from the export.
- I/O: input voltage `V[tier]` at up to `2 × chargeableCount` amps, output voltage `V[tier]` at `batteryCount` amps.
- Evidence: `javap … gregtech.api.items.MetaBaseItem` → `ldc "GT.ItemCharge" … ItemStackNBT.getLong` / `setLong` / `removeTag`. `MTEBasicBatteryBuffer.maxEUStore: V[mTier] * 64 * mInventory.length`, `maxEUInput/maxEUOutput: V[mTier]`, `maxAmperesIn: mChargeableCount * 2`, `maxAmperesOut: mBatteryCount`. `getStoredEnergy` sums `MetaBaseItem.getRealCharge` for GT items and `ElectricItem.manager.getCharge` for `ic2/api/item/IElectricItem`. IC2: `javap … industrialcraft-2-2.2.828-experimental.jar ic2.core.item.ElectricItemManager` → `ldc "charge" ; func_74769_h` (getDouble) and `func_74780_a` (setDouble).
- Data check: every battery found in a buffer had `tag {'GT.ItemCharge': ('Long', …)}`.
- **Verified by reviewer:**
  - **Formulas.** Re-checked: `maxEUStore` is `getstatic GTValues.V ; getfield mTier ; laload ; ldc2_w 64 ; lmul ; mInventory.length ; lmul`.
  - **Counts.** Both are recomputed every tick in `onPostTick`. `mChargeableCount` is the number of slots holding an electric item usable at the buffer's tier (`GTModHandler.isElectricItem(stack, mTier)`). `mBatteryCount` is how many of those can also give energy (`GTModHandler.isChargerItem`).
  - **Where charge is stored.** gtnhlib's `ItemStackNBT.getLong` is `stack.func_77978_p().func_74763_f(key)`, i.e. `tag.getLong`. IC2 reads `"charge"` from `StackUtil.getOrCreateNbtData(stack)`. Both values therefore sit directly in the stack's `tag`.

### 6.5 GT super and quantum chests and tanks (`MTEDigitalChestBase`, `MTEDigitalTankBase`)

None exist in this world. This is from the jar:

- Chest (`QUANTUM_CHEST_LV…IV` = mID 125–129, `SUPER_CHEST_LV…IV` = 135–139 in `MetaTileEntityIDs`): `mItemCount` Int, `mItemStack` (vanilla stack, the stored item), `mVoidOverflow`, `mDisableFilter` Byte. **Total stored = `mItemCount` + the stack sizes in `Inventory` slots 0 and 1** (`MTEDigitalChestBase.getProgresstime: getItemCount() + mInventory[0].stackSize + mInventory[1].stackSize`).
- Tank (`QUANTUM_TANK_LV…IV` = mID 120–124, `SUPER_TANK_LV…IV` = 130–134): `mFluid` `{FluidName, Amount: Int}` (from `MTEBasicTank`), `mOutputFluid`, `mVoidOverflow`, `mVoidFluidFull`, `mLockFluid`, `mAllowInputFromOutputSide`, `mDisableFilter` Byte, `lockedFluidName` String (optional).
- Evidence: `javap … gregtech.common.tileentities.storage.MTEDigitalChestBase.saveNBTData: "mItemCount" func_74768_a ; "mItemStack" func_77955_b func_74782_a ; "mVoidOverflow" ; "mDisableFilter"`. `MTEDigitalTankBase.saveNBTData: "mOutputFluid" "mVoidOverflow" "mVoidFluidFull" "mLockFluid" "lockedFluidName" "mAllowInputFromOutputSide" "mDisableFilter"`. `MTEBasicTank.saveNBTData: "mFluid"`.

### 6.6 Storage Drawers (2.2.31-GTNH)

TE ids are `StorageDrawers:tileDrawersStandard`, `StorageDrawers:tileDrawersComp` (compacting drawers, disabled in this pack's config), `StorageDrawers:tileController`, `StorageDrawers:tileControllerSlave`, `StorageDrawers:trim` and `StorageDrawers:framingTable`. Evidence: `javap … com.jaquadro.minecraft.storagedrawers.core.ModBlocks` → `ldc "tileDrawersComp" … getQualifiedName` (which prepends `"StorageDrawers:"`) `… registerTileEntityWithAlternatives`, `"tileController"`, `"tileControllerSlave"`, `"framingTable"`, `"trim" … registerTileEntity`; the standard drawer id is the one seen in the data. Block names are `StorageDrawers:fullDrawers{1,2,4}`, `halfDrawers{2,4}`, `fullCustom*`, `halfCustom*`, `controller`, `controllerSlave`, `trim` and `trimCustom`, plus pack variants `StorageDrawersBop:*`, `StorageDrawersForestry:*`, `StorageDrawersMisc:*` and `StorageDrawersNatura:*`.

Drawer (`TileEntityDrawers`):

| Key | Type | Meaning |
|---|---|---|
| `Slots` | List<Compound> | one per drawer face slot. Empty slot = `{}`. Filled = `{ItemStack: <stack>, Count: Int}`. |
| `Cap` | Int | base capacity in **stacks** per slot, = `baseStorage` of the block type in `config/StorageDrawers.cfg` |
| `Upgrades` | List<Compound>, optional | `{Slot: Byte} + stack`. Storage upgrades are `StorageDrawers:upgrade` with damage = level. Other upgrade items that change capacity: `StorageDrawers:upgradeDowngrade` and `StorageDrawers:upgradeCreative` (see slot capacity below). |
| `Dir`, `Rot` | Byte | facing |
| `Lock` Byte bitfield, `Shr`, `Qua`, `HideUp` bool, `Own` UUID string, `Sec` String, `Tape`, `CustomName`, `Down`, `MatS`/`MatF`/`MatT` (framed materials) | | optional |
| compacting only: `Count` Int (pooled count in the smallest unit), `Conv0..2` Byte | | |

- **Slot capacity** (in items) for a slot holding an item:
  - `2147483647` (`Integer.MAX_VALUE`, unlimited) if a `StorageDrawers:upgradeCreative` is installed and `config/StorageDrawers.cfg` has `enableCreativeUpgrades=true`, which it does in this pack. Damage 0 is the storage variant and damage 1 the vending variant; both give this.
  - Otherwise `maxStackSize(item) × M × B`:
    - `B` is `Cap`, or **1** if a `StorageDrawers:upgradeDowngrade` is installed.
    - `M` is the sum of `levelNMult` over the installed `StorageDrawers:upgrade` items (`config/StorageDrawers.cfg` `upgrades { level2Mult=2 … level8Mult=128 }`; an upgrade whose damage is outside 2..8 adds 1). If that sum is 0, `M` is 1.
  - An empty slot has capacity 0.
- **Corrected by reviewer:** the earlier formula `maxStackSize × Cap × M` left out the downgrade and creative/vending cases. Evidence (`javap … StorageDrawers-2.2.31-GTNH.jar`):
  - `TileEntityDrawersStandard$StandardStorageProvider.getSlotStackCapacity(int)`: `invokevirtual getEffectiveStorageMultiplier ; aload_0 iload_1 invokevirtual isDowngraded(I)Z ; ifeq 23 ; iconst_1 ; goto 30 ; 23: invokevirtual getDrawerCapacity ; 30: imul`.
  - `TileEntityDrawers.getDrawerCapacity`: `invokevirtual isDowngraded ; ifeq 11 ; iconst_1 ; goto 15 ; 11: getfield drawerCapacity`.
  - `TileEntityDrawers.checkDowngraded`: `getstatic ModItems.upgradeDowngrade … if_acmpne … putfield downgraded`.
  - `storage.DrawerData.getMaxCapacity(ItemStack)`: no item gives `iconst_0`. `isStorageUnlimited(slot)` or `isVendingUnlimited(slot)` gives `ldc 2147483647`. Otherwise `Item.getItemStackLimit(stack) * storageProvider.getSlotStackCapacity(slot)`.
  - `TileEntityDrawers.isUnlimited` and `isVending`: `getfield ConfigCache.enableCreativeUpgrades ; ifne …` plus an upgrade stack `== ModItems.upgradeCreative`; `isVending` also checks `func_77960_j` (damage) `== 1`.
  - `ConfigManager.getStorageUpgradeMultiplier(int)`: `tableswitch 2..8 → level2Mult…level8Mult, default iconst_1`.
  - Registry names come from `ModItems` (`"upgrade"`, `"upgradeDowngrade"`, `"upgradeCreative"`) and appear in `level.dat` as `\u0002StorageDrawers:upgrade`, `\u0002StorageDrawers:upgradeDowngrade` and `\u0002StorageDrawers:upgradeCreative`.
- Evidence: `javap … StorageDrawers-2.2.31-GTNH.jar com.jaquadro.minecraft.storagedrawers.block.tile.TileEntityDrawers.writeToPortableNBT: "Cap" drawerCapacity func_74768_a ; "Slot" … "Upgrades" ; "Lock" ; "Shr" ; "Qua" ; "Own" ; "Sec" ; "HideUp" ; IDrawer.writeToNBT … "Slots" ; "MatS" "MatF" "MatT"`. `writeToFixedNBT: "Dir" "Rot" "Tape" "CustomName" "Down"`. `storage.DrawerData.writeToNBT → util.ItemStackConversion.writeToNBT: "ItemStack" func_77955_b ; "Count" func_74768_a`. `ItemStackConversion.readFromLegacyNBT: "Item" "Meta" "Tags"`. `TileEntityDrawersStandard$StandardStorageProvider.getSlotStackCapacity: getEffectiveStorageMultiplier() * (isDowngraded(slot) ? 1 : getDrawerCapacity())` (corrected by reviewer; see above). `TileEntityDrawers.getEffectiveStorageMultiplier: Σ config.getStorageUpgradeMultiplier(upgrade.damage)`, else `getStorageUpgradeMultiplier(1)`, and `ConfigManager.getStorageUpgradeMultiplier` returns `level2Mult…level8Mult`, default 1.
- **Verified by reviewer (slot layout):**
  - **Jar.** `util.ItemStackConversion.writeToNBT` is `ldc "ItemStack" … func_77955_b … func_74782_a ; ldc "Count" … func_74768_a`, and `TileEntityDrawers.writeToPortableNBT` is `ldc "Cap" ; getfield drawerCapacity ; func_74768_a`.
  - **Data.** In a newer backup every drawer slot was either `{}` or `{ItemStack: Compound, Count: Int}`. Every `Cap` was an Int equal to its block type's `baseStorage` (`fulldrawers4 { I:baseStorage=16 }` → `Cap` 16).

Controller (`TileEntityController`): saves only `Dir` (always), `Rot` (only when non-zero) and `CustomName` (only when named). **Which drawers it reaches is not stored. Compute it:**

1. Breadth-first search from the controller position over the 6 face neighbours.
2. A position is visited only if its Chebyshev distance from the controller, `max(|dx|,|dy|,|dz|)`, is at most `range` (`config/StorageDrawers.cfg` `controller { range }`).
3. A position is visited only if its block implements `INetworked`: any drawers block, controller, controller slave or trim, including the pack variants and the custom/framed ones.
4. Every drawers block counts toward `maxDrawers` (`controller { maxDrawers }`). The search **stops completely** when the count would pass `maxDrawers`, so the drawers found first in breadth-first order win.
5. Non-networked blocks break the chain. Distance is measured from the controller, not from the previous block.

- Evidence: `TileEntityController.populateNodes(int,int,int)`: `Queue.remove … Math.max(Math.max(abs(x-cx), abs(y-cy)), abs(z-cz)) … getfield range … if_icmple … World.getBlock … instanceof INetworked ifne … instanceof BlockDrawers … drawersCount++ … getfield maxDrawers if_icmple 283 … goto 568 (return)`, then 6 neighbours `x±1, z±1, y±1`. The constructor does `range = config.getControllerRange()` and `maxDrawers = config.getControllerMaxDrawers()`. The `INetworked` implementers (class-file walk) are `BlockDrawers`, `BlockDrawersCustom`, `BlockCompDrawers`, `BlockController`, `BlockSlave`, `BlockTrim`, `BlockTrimCustom`, `pack/BlockDrawersPack`, `pack/BlockTrimPack` and the sorting variants. This pack's config sets `range=4` and `maxDrawers=50`.
- **Verified by reviewer:**
  - **Breadth-first order.** The search really is breadth-first: the constructor sets `searchQueue = new LinkedList()`, a FIFO queue. The overflowing drawer is not recorded, because `drawersCount++ … getfield maxDrawers ; if_icmple 283 ; goto 568` returns before `updateRecordInfo`.
  - **What counts toward `maxDrawers`.** `BlockDrawersCustom`, `BlockCompDrawers` and `pack/BlockDrawersPack` all extend `BlockDrawers`, so they count. `BlockTrim`/`BlockTrimPack`, `BlockController` and `BlockSlave` are `INetworked` but do not count.
  - **Controller NBT.** `TileEntityController.func_145841_b` writes `"Dir"`, then `"Rot"` only after `getfield rotation ; ifeq`, then `"CustomName"` only after `func_145818_k_ ; ifeq`.
  - **Config.** `config/StorageDrawers.cfg`, `blocks { controller { I:maxDrawers=50 I:range=4 } }`.
  - **Data.** Every controller in a newer backup held only `Dir` besides `id/x/y/z`.
- Controller slave (`TileEntitySlave`): `{Controller: {x, y, z}}`, the controller it attached to (`func_145841_b: "x" "y" "z" "Controller"`).

### 6.7 JABBA barrels: `TileEntityBarrel` (JABBA 1.5.23)

| Key | Type | Meaning |
|---|---|---|
| `storage` | Compound | `{amount: Int (items stored), maxstacks: Int, upgCapacity: Int, current_item?: <stack, Count 0>, keepLastItem?, deleteExcess?, alwaysProvide?}` |
| `rotation`, `orientation` | Int | facing |
| `coreUpgrades`, `sideUpgrades`, `sideMeta` | IntArray | upgrades |
| `nStorageUpg`, `structural`, `version`, `bspaceid` | Int | |
| `creative`, `ender`, `linked`, `hopper`, `redstone`, `void`, `ticking`, `nticks` | Byte | |

- Capacity is `maxstacks × itemMaxStackSize`. With `deleteExcess` the reported maximum is one stack larger; that the overflow is voided is inferred from the name. JABBA has no controller. A barrel with `ender`/`linked` set shares its storage through BSpace (`World/JABBA/*.dat`, not decoded here).
- Evidence: `javap … JABBA-1.5.23.jar mcp.mobius.betterbarrels.common.blocks.StorageLocal.writeTagCompound: "amount" "maxstacks" "upgCapacity" func_74768_a ; func_77955_b "current_item" ; "keepLastItem" "deleteExcess" "alwaysProvide"`. `getMaxStoredCount: totalCapacity (+ stackAmount if deleteExcess)`, where `totalCapacity = maxstacks * stackAmount`. Data check: the merged barrel schema matches this table.

### 6.8 Chests: vanilla `Chest`, IronChest `IronChest.<TYPE>`

- Vanilla `Chest` (used for **both** `minecraft:chest` and `minecraft:trapped_chest`): `Items: List<{Slot: Byte} + stack>`, 27 slots. A double chest is two TEs (vanilla behaviour).
- IronChest 6.1.13: TE id `IronChest.` + type name, with `Items` (`Slot` Byte, read as `& 255`) and `facing` (Byte). Types and slot counts: `IRON 54, GOLD 81, DIAMOND 108, COPPER 45, STEEL 72, CRYSTAL 108, OBSIDIAN 108, DIRTCHEST9000, NETHERITE 135, DARKSTEEL 135, SILVER 72, WOOD`. The block is `IronChest:BlockIronChest` for all of them.
- Evidence: `javap … IronChest-6.1.13.jar cpw.mods.ironchest.TileEntityIronChest.func_145841_b: "Slot" func_74774_a ; func_77955_b ; "Items" ; "facing"`. `func_145839_a: "Slot" func_74771_c sipush 255 iand`. `IronChestType.<clinit>: "IRON" bipush 54 … "GOLD" bipush 81 … "DIAMOND" bipush 108 … "NETHERITE" sipush 135 …`. `IronChest` registers each TE with `"IronChest." + type.name()` (`StringBuilder.append … IronChestType.name … registerTileEntityWithAlternatives`). Data check: `Chest` TEs sit on both `minecraft:chest` and `minecraft:trapped_chest`. **UNVERIFIED**: slot counts for `DIRTCHEST9000` and `WOOD` (not printed by the excerpt).

### 6.9 Forge Multipart and Project Red pipes: `savedMultipart`

- TE id is `savedMultipart`, on block `ForgeMultipart:block`. `parts: List<Compound>`, where each part is `{id: String part type, …part data}`. Many unrelated parts use this too (for example `mc_torch`), so filter by part `id`.
  - Evidence: `javap … ForgeMultipart-1.7.15.jar codechicken.multipart.MultipartHelper$` → `ldc "id" … ldc "savedMultipart"`, and `TileMultipart` → `ldc "parts"`.
- Project Red 4.12.44-GTNH part ids (`mrtjp.projectred.transportation.PipeDefs$`). `meta` (Byte) = the def's position in this list:

| meta | part `id` | pipe |
|---|---|---|
| 0 | `pr_pipe` | basic item pipe |
| 1 | `pr_rbasic` | routed junction |
| 2 | `pr_rinterface` | routed interface (holds chips) |
| 3 | `pr_rcrafting` | routed crafting |
| 4 | `pr_rrequest` | routed request |
| 5 | `pr_rextension` | routed extension |
| 6 | `pr_rfire` | routed firewall |
| 7 | `pr_pt` | pressure tube |
| 8 | `pr_rpt` | resistance tube |
| 9 | `pr_netvalve` | network valve |
| 10 | `pr_netlatency` | network latency |

- Keys:

| Key | Type | Meaning |
|---|---|---|
| `connMap` | Int | bits 0–5 = connected straight out on side s (`1 << s`); bits 6–11 = connected internally on side s (`1 << (s+6)`); bits 12–17 = side s open (`0x1000 << s`). "Connects" on side s = `connMap & (0x41 << s)`. |
| `meta` | Byte | def index (table above) |
| `itemFlow` | List | items in transit |
| `signal` | Byte | redstone signal |
| `mat` | Byte (bool) | redstone-conductive material |
| `io` (inventory-facing pipes) | Byte | side of the attached inventory, 0–5; 6 = none |
| `rid` (routed pipes) | String | router UUID |
| `sent`, `rec`, `relay` (routed) | Int | statistics |
| `colour` (colour-filter pipes) | Byte | |
| `chipsitems`, `chipsitemsCount` (interface pipes) | List<{index: Int} + stack>, Int | installed routing chips and slot count (4) |

- **Chip type** = the chip item's `Damage`, indexing `RoutingChipDefs`: 0 `responder` (item responder), 1 `dyn_responder`, 2 `overflow`, 3 `terminator`, 4 `extractor`, 5 `broadcaster`, 6 `stock_keeper`, 7 `crafting`, 8 `extension`. The chip item is `ProjRed|Transportation:projectred.transportation.routingchip`. Its settings are in `tag.chipROM` (`mode`, `pref`, `filteritems`/`filteritemsCount`, `orient`, …).
- Evidence: `javap … ProjRed-4.12.44-GTNH.jar 'mrtjp.projectred.transportation.PipeDefs$'` → `"pr_pipe" … BASIC ; "pr_rbasic" … ROUTEDJUNCTION ; "pr_rinterface" … ROUTEDINTERFACE ; "pr_rcrafting" ; "pr_rrequest" ; "pr_rextension" ; "pr_rfire" ; "pr_pt" ; "pr_rpt" ; "pr_netvalve" ; "pr_netlatency"`.
  - `SubcorePipePart.save: "connMap" func_74768_a ; "meta" func_74774_a`. `PayloadPipePart.save: "itemFlow"`. `TInventoryPipe$class.save: "io" inOutSide()`. `TNetworkPipe$class.save: "rid" UUID.toString ; "sent" ; "rec" ; "relay"`. `TRedstonePipe$class.save: "mat" (bool) ; "signal"`. `TColourFilterPipe$class.save: "colour"`. `RoutedInterfacePipePart.save → SimpleInventory.saveInv`, which gives `chipsitems` and `chipsitemsCount` in the data.
  - `mrtjp.projectred.core.TCenterConnectable$class.maskConnectsOut: connMap & 1 << s`, `maskConnectsIn: connMap & 1 << (s + 6)`, `maskConnects: connMap & 65 << s`, `maskOpen: connMap & 4096 << s`.
  - `RoutingChipDefs$.<clinit>: "responder" "dyn_responder" "overflow" "terminator" "extractor" "broadcaster" "stock_keeper" "crafting" "extension"`, and `RoutingChipDefs$.getForStack: values().apply(stack.getItemDamage())`.
- Data check: `meta` was 1 on `pr_rbasic`, 2 on `pr_rinterface` and 4 on `pr_rrequest`. `io = 6` on every junction. `chipsitemsCount = 4` on interfaces.
- Inferred from the code structure and not traced further: a routed network is the set of routed pipes connected through pipe-to-pipe connections, `rid` identifies each router, and the network graph itself is not stored. The request pipe's `io` side is the inventory it delivers to, and `mat` (from the `TRedstonePipe` trait) marks the redstone-conductive variant.

### 6.10 EnderIO conduits: `blockConduitBundleTileEntity` (EnderIO 2.10.46)

| Key | Type | Meaning |
|---|---|---|
| `conduits` | List<{`conduitType`: String class name, `conduit`: Compound}> | one entry per conduit in the bundle |
| `facadeId` | String | registry name, or the literal `"null"` |
| `facadeMeta` | Int | |
| `facadeType` | String, optional | |
| `nbtVersion` | Short | |

`conduit` (from `AbstractConduit`):

- `connections`: IntArray of `ForgeDirection` ordinals, the conduit-to-conduit links.
- `externalConnections`: IntArray of ordinals, links to machines or inventories.
- `conModes`: ByteArray[6], `ConnectionMode` per side: 0 IN_OUT, 1 INPUT, 2 OUTPUT, 3 DISABLED, 4 NOT_SET.
- `signalActive`: Byte.

Per-type extras:

- Item conduit: dotted per-side keys `inFilts.<DIR>`, `outFilts.<DIR>`, `speedUpgrades.<DIR>`, `functionUpgrades.<DIR>`, `inputFilterUpgrades.<DIR>`, `outputFilterUpgrades.<DIR>`, `extRM.<DIR>`, `extSC.<DIR>`, `selfFeed.<DIR>`, `roundRobin.<DIR>`, `priority.<DIR>`, `inSC.<DIR>`, `outSC.<DIR>`, where `<DIR>` is `DOWN`/`UP`/`NORTH`/`SOUTH`/`WEST`/`EAST`.
- Power conduit: `subtype` (tier), `energyStoredRF`, `pRsMode.*`, `pRsCol.*`.
- Liquid conduits: `tank`, `fluidLocked`.
- ME conduit: `isDense`, `playerID`.
- Insulated redstone conduit: `forcedConnections`, `signalColors`, `signalStrengths`.

Conduit classes (`conduitType` values): `crazypants.enderio.conduit.item.ItemConduit`, `.liquid.LiquidConduit`, `.liquid.AdvancedLiquidConduit`, `.liquid.EnderLiquidConduit` (+ `Crystalline…`, `Melodic…`, `Stellar…` variants), `.power.PowerConduit`, `.power.endergy.PowerConduitEndergy`, `.redstone.RedstoneConduit`, `.redstone.InsulatedRedstoneConduit`, `.me.MEConduit`, `.gas.GasConduit`, `.oc.OCConduit`.

- Evidence: `javap … EnderIO-2.10.46.jar crazypants.enderio.conduit.TileConduitBundle` → `"conduits" ; "facadeId" ; "facadeType" ; "facadeId" "null" ; "facadeMeta" ; "nbtVersion" func_74777_a`. `ConduitUtil.writeToNBT: "conduitType" Class.getCanonicalName ; "conduit"`. `AbstractConduit.writeToNBT: "connections" func_74783_a ; "externalConnections" func_74783_a ; "signalActive" ; "conModes" func_74773_a`. `ConnectionMode.<clinit>: IN_OUT INPUT OUTPUT DISABLED NOT_SET`. `ItemConduit.writeToNBT: "inFilts." "speedUpgrades." … "outSC."`. `PowerConduit: "subtype" "energyStoredRF"`. `AbstractTankConduit: "tank" "fluidLocked"`. `MEConduit: "isDense" "playerID"`. The class list comes from a class-file walk for implementers of `crazypants/enderio/conduit/IConduit`.

### 6.11 Applied Energistics 2 (rv3-beta-1073-GTNH): the format to expect

There is no AE2 network in this world. Only sky-stone chests exist, with TE id `BlockSkyChest`. The rest of this section comes from the jar.

- **TE ids are the block class simple name**: `BlockCableBus` (registered explicitly), `BlockController`, `BlockDrive`, `BlockChest`, `BlockInterface`, `BlockSkyChest`, … The block names are `appliedenergistics2:tile.<Name>`.
  - Evidence: `appeng.core.features.AETileBlockFeatureHandler: GameRegistry.registerTileEntity(block.getTileEntityClass(), block.toString())`. `AEBaseTileBlock.toString` returns `featureFullName`, which `FeatureNameExtractor.get` sets from `Class.getSimpleName`. `appeng.block.networking.BlockCableBus: ldc "BlockCableBus" … registerTileEntity`.
- **Common AE tile keys**: `orientation_forward` and `orientation_up` (`ForgeDirection` names as strings), `customName`, and `proxy`, the grid node `{p: Int player id, k: Long security key, g: Long grid storage id}` (`appeng.tile.AEBaseTile`, `AENetworkTile: "proxy"`, `appeng.me.GridNode.saveToNBT: "p" "k" "g"`). **The world does not store channels used or free**; compute them from the cable graph. **UNVERIFIED**: channel capacities (8 per normal cable, 32 per dense cable or controller face) come from general AE2 knowledge and were not checked in this jar.
- **Inventories** (`AEBaseInvTile`, for example drive and ME chest): `inv` compound with one `#<slot>` key per filled slot (`AppEngInternalInventory.writeToNBT: "#" + slot`).
- **Cable bus** (`TileCableBus` / `CableBusContainer.writeToNBT`): `hasRedstone`, and for each side `0..6` (6 = UNKNOWN = the centre cable) `def:<side>` (the part's item stack, `appliedenergistics2:item.ItemMultiPart`) and `extra:<side>` (the part's own NBT).
  - Part type = stack `Damage` minus the type's base (`appeng.items.parts.PartType`). Bases: `CableGlass 0`, `CableCovered 20`, `CableSmart 40`, `CableDense 60`, `CableDenseCovered 520`, `ToggleBus 80`, `InvertedToggleBus 100`, `CableAnchor 120`, `QuartzFiber 140`, `Monitor 160`, `SemiDarkMonitor 180`, `DarkMonitor 200`, `StorageBus 220`, `ImportBus 240`, `ExportBus 260`, `LevelEmitter 280`, `AdvancedLevelEmitter 281`, `AnnihilationPlane 300`, `IdentityAnnihilationPlane 301`, `FormationPlane 320`, `PatternTerminal 340`, `CraftingTerminal 360`, `CraftingDiagnosticTerminal 370`, `Terminal 380`, `StorageMonitor 400`, `ThroughputMonitor 410`, `ConversionMonitor 420`, `Interface 440`, `P2PTunnelME 460`, `P2PTunnelRedstone 461`, `P2PTunnelItems 462`, `P2PTunnelLiquids 463`, `P2PTunnelEU 465`, `P2PTunnelRF 466`, `P2PTunnelLight 467`, `P2PTunnelOpenComputers 468`, `P2PTunnelPressure 469`, `P2PTunnelGT 470`, `P2PTunnelInterface 471`, `P2PTunnelSound 472`, `PatternRepeater 473`, `InterfaceTerminal 480`, `PatternTerminalEx 500`, `PartCreativeEnergy 690`.
  - **UNVERIFIED**: the cable colour offset rule (`base + colour`, 0..16 with 16 = fluix/transparent). It is standard AE2 behaviour but was not disassembled here.
  - Evidence: `CableBusContainer.writeToNBT: "hasRedstone" … "def:" … "extra:"`, and `PartType.<clinit>` constants (parsed from `javap`).
- **Controller** (`TileController`): `paintedColor`, `controllerAnimation`, plus the common keys.
- **Drive** (`TileDrive`): `priority`, `paintedColor`, and `inv` holding the cells as item stacks.
- **Storage cell contents** live in the cell stack's own `tag`:
  - Item cells: `it` Short (stored types), `ic` Long (stored item count), `#<n>` (AE stack: `id` Short, `Count` Byte, `Cnt` Long, `Req` Long, `Craft` Bool, `Damage` Short, `tag`), and `@<n>` Long (count of entry n).
  - Fluid cells use `ft`/`fc` in place of `it`/`ic`.
  - Evidence: `appeng.me.storage.CellInventory: STACK_SLOT = "#", STACK_SLOT_COUNT = "@"`. `saveChanges` writes `"#" + i` → `IAEStack.writeToNBT`, `"@" + i` → `func_74772_a(getStackSize)`, then `getStackTypeTag()` (Short) and `getStackCountTag()` (Long). `ItemCellInventory: "it" / "ic"`, `FluidCellInventory: "ft" / "fc"`. `appeng.util.item.AEItemStack.writeToNBT: "id" "Count" "Cnt" "Req" "Craft" "Damage" "tag"`.

### 6.12 Other storage-like TEs seen

These are not decoded here. Their ids, for the "found-but-unknown" bucket: `Hopper`, `Dropper`, `Trap` (dispenser) and `Furnace` (vanilla `Items`); Railcraft tanks (`RCIronTankWallTile`, `RCIronTankValveTile`, `RCSteelTankValveTile`, `RCWaterTankTile`); `com.indemnity83.irontank.block.TileIronTank`; `net.minecraft.src.buildcraft.factory.TileTank`; `TileEntityTrashCan`; `openblocks_vacuumhopper`; `RCVoidChestTile`.

## 7. Hints for finding bases

| Source | Shape | Use |
|---|---|---|
| Chunk `Level.InhabitedTime` | Long ticks | Time players spent near the chunk. Base chunks stand far above everything else. |
| Region header timestamps | u32 seconds per chunk | Recently saved = recently loaded. Costs nothing to read (8 KiB per file). |
| `playerdata/<uuid>.dat` | `Pos: List<Double>[3]`, `Dimension: Int`, `Rotation`, `SpawnX/SpawnY/SpawnZ: Int` (bed spawn, optional), `UUIDMost/UUIDLeast: Long` | Where each player is or sleeps. The file name is the player UUID. |
| `serverutilities/teams/claimedchunks/<team>.dat` | `ClaimedChunks: {"<dim>": List<{x: Int, z: Int (chunk coords), preDecay: Byte, loaded?: Byte}>}` | Claimed (and chunk-loaded) area per team |
| `forcedchunks.dat` | `TicketList: List<{Owner: modid, Tickets: List<{Type, ModData, ChunkListDepth, …}>}>` | Who force-loads chunks. **Mod tickets hold no coordinates here**; the mod re-forces them from its own data (ServerUtilities keeps them in the claimed-chunks file). |
| `level.dat` → `Data.SpawnX/Y/Z` | Int | World spawn |

Evidence: typed parse of the backup's `playerdata` (`{'Dimension': 'Int', 'Pos': 'List', 'Rotation': 'List', 'UUIDMost': 'Long', …}`), `claimedchunks/<team>.dat` (`{"ClaimedChunks": {"0": [{"preDecay": 0, "z": …, "x": …}, {…, "loaded": 1}, …]}}`) and `forcedchunks.dat` (`{"TicketList": [{"Tickets": [{"Type": 0, "ModData": {"Team": …}, "ChunkListDepth": 64}, …], "Owner": "serverutilities"}]}`). The highest-`InhabitedTime` chunks (~400 h each) lie in and right next to the team's claimed-chunk area around the main base (local notes).

## 8. Performance facts and scan strategy

Figures from the reference world: a ~0.75 GB backup zip holding ~0.9 GB of region files in 6 dimensions with region files, ~95k chunks. Exact per-dimension figures are in the local notes.

- **Decompressed NBT is ~15× the region size.** About 13.7 GB of chunk NBT in total, of which pre-upgrade chunks are ~89% (12.2 GB) and post-upgrade chunks 1.47 GB. A NotEnoughIDs section takes 16 KiB for `Blocks16` + `Data16` alone, and pre-upgrade chunks carry the ore TEs.
- **GT ore TEs are almost all TEs.** ~28.6 million `GT_TileEntity_Ores`, out of ~28.75 million TEs (~99.6%), all in pre-upgrade chunks. Each is a 61-byte compound `{m: Short material/meta, n: Byte natural, id, x, y, z}`, ~1.75 GB in total.
  - Evidence: `javap … gregtech.common.blocks.TileEntityOres.func_145841_b: "m" func_74777_a ; "n" func_74757_a`. A byte search for the encoded tag `08 0002 'id' 0012 'GT_TileEntity_Ores'` measured `distance histogram [(61, 397486), …]` between consecutive occurrences.
- **Node 24 prototype**, single thread, `nice 19`, streaming region entries out of the zip:

| Pass | Time | Notes |
|---|---|---|
| Central directory + inflate all 203 region entries + read 8 KiB headers | 1.5 s | headers only: 95,006 chunks inventoried |
| + inflate and skip-parse only chunks saved after the upgrade (12,885 chunks, 1.47 GB) | 2.4 s total (0.8 s inflate, 0.05 s TE scan) | all non-ore TEs of the bases |
| + inflate all chunks (13.7 GB) | 7.5 s total (6.0 s chunk inflate) | |
| + skip-parse every chunk for TE ids, skipping ore TEs | 9.7 s total (2.4 s TE scan of 28.75 M TEs) | RSS ~0.3 GB |

  Evidence: `scanbench.mjs` output, for example `{"mode":"tescan","cutoff":0,"headerChunks":95006,"chunksDecoded":95006,"decompressedMB":13687.8,"ms":{"total":9674,"zipInflate":1520,"chunkInflate":5731,"nbtScan":2401},"teTotal":28750013,"oreTEsSkipped":28637625,…}`. For comparison, a full typed parse plus full block decode in Python took 270 CPU-seconds (34 s on 8 processes).

**Suggested scan strategy for the planner:**

1. **Source.** Use the newest backup zip whose central directory parses and which is not still being written (or a snapshot copy of `World/`). Never read the live region files.
2. **Pass 0 (ms).** Read `level.dat`: the id maps, `chunkapicore.managers` versions, and `FML.ModList`. Read `playerdata`, the ServerUtilities claimed chunks and the `level.dat` spawn as seed areas.
3. **Pass 1 (~1.5 s).** Read every region header: chunk existence, sector sizes and save timestamps. This is also the change detector for incremental rescans: cache results per `(dimension, chunk, timestamp)`.
4. **Pass 2 (seconds, in a `worker_thread`).** Inflate each chunk and skip-parse it. Read `InhabitedTime`, plus the `id` of each TileEntities element; parse a TE fully **only if its id is on the whitelist** (§6). Skip `Sections` byte arrays by length, and never build objects for `GT_TileEntity_Ores`. Do chunks saved after the upgrade first: they are ~14% of chunks and hold every built base. Then the rest at low priority, or only on request.
5. **Cluster** whitelisted TEs with `InhabitedTime` into bases, per dimension.
6. **Pass 3 (area-limited).** Decode `Sections` into block ids only for chunks inside base bounding boxes plus a margin (the map, the 3D ghosts and free-space search). One section decode is 4096 lookups; a 20×20-chunk base area at 16 sections is ~6,400 sections.
7. **Never assume one format per dimension.** Check `Blocks16` per section and `Biomes16v2` vs `Biomes` per chunk.

## 9. Reference decode helpers (TypeScript)

```ts
// --- region iteration (§1.3) ---
function* regionChunks(buf: Buffer) {
  for (let i = 0; i < 1024; i++) {
    const loc = buf.readUInt32BE(i * 4);
    if (loc === 0) continue;
    const start = (loc >>> 8) * 4096;                    // sector offset
    const length = buf.readUInt32BE(start);               // includes compression byte
    const compression = buf[start + 4];                   // 2 = zlib, 1 = gzip
    yield {
      localX: i & 31, localZ: i >> 5,
      timestamp: buf.readUInt32BE(4096 + i * 4),
      compression,
      data: buf.subarray(start + 5, start + 4 + length),
    };
  }
}

// --- section decode (§3.3): returns 4096 ids and metas, index = y<<8 | z<<4 | x ---
const nib = (a: Uint8Array, i: number) => (i & 1 ? a[i >> 1] >> 4 : a[i >> 1]) & 15;
function decodeSection(s: Record<string, Uint8Array>) {
  const ids = new Uint32Array(4096), meta = new Uint16Array(4096);
  if (s.Blocks16) {                                       // NotEnoughIDs legacy, big-endian u16
    const b = s.Blocks16, d = s.Data16;
    for (let i = 0; i < 4096; i++) {
      ids[i] = (b[2 * i] << 8) | b[2 * i + 1];
      meta[i] = d ? (d[2 * i] << 8) | d[2 * i + 1] : 0;
    }
    return { ids, meta };
  }
  const { Blocks: B, Add: A, BlocksB2Hi: H, BlocksB3: B3, Data: D, Data1High: D1, Data2: D2 } = s;
  for (let i = 0; i < 4096; i++) {
    let id = B[i];
    if (A) { id |= nib(A, i) << 8; if (H) { id |= nib(H, i) << 12; if (B3) id |= B3[i] << 16; } }
    let m = D ? nib(D, i) : 0;
    if (D1) { m |= nib(D1, i) << 4; if (D2) m |= D2[i] << 8; }
    ids[i] = id; meta[i] = m;
  }
  return { ids, meta };
}

// --- biome (§3.4) ---
function biomeAt(level: { Biomes16v2?: Uint8Array; Biomes?: Uint8Array }, x: number, z: number) {
  const k = ((z & 15) << 4) | (x & 15);
  if (level.Biomes16v2) { const v = level.Biomes16v2[2 * k] | (level.Biomes16v2[2 * k + 1] << 8); return v === 0xffff ? -1 : v; }
  if (level.Biomes) { const v = level.Biomes[k]; return v === 0xff ? -1 : v; }
  return -1;
}

// --- item stack (§5) ---
function readStack(t: any, itemName: Map<number, string>) {
  const raw = t.idExt ?? t.id;                            // idExt (Int) wins, as in EndlessIDs
  const name = typeof raw === 'string' ? raw : itemName.get(raw);
  return { name, count: t.Count, damage: Math.max(0, t.Damage ?? 0), tag: t.tag };
}
```

The skip-parser used for Pass 2 needs about 60 lines: walk the root compound to `Level`, call `skip(tag)` on every key except `TileEntities` and `InhabitedTime`, and for each TileEntities element read only an `id` String tag and skip the rest. See `scanbench.mjs` (local notes) for the version that was benchmarked.

## 10. Open points

- **UNVERIFIED**: how the ServerUtilities backup is written (atomic or not), see §1.1.
- **UNVERIFIED**: `Flip.getIndex()` is `ordinal()`, see §6.1.
- **UNVERIFIED**: the AE2 cable channel capacities and colour offsets, see §6.11.
- **UNVERIFIED**: the GT++ wire table and the GT fluid and item pipe id tables, see §6.3. Get these from the runtime export.
- **UNVERIFIED**: the slot counts of IronChest `DIRTCHEST9000` and `WOOD`.
- Not stored in the world at all: battery max charge, AE2 channels, Storage Drawers controller reach, and routed-pipe network membership. Compute or export these.

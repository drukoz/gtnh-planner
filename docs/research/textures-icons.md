# Textures and icons from the pack's own jars

Reference for the GTNH Line Planner build plan: how to get real block textures (3D view, map) and item/fluid icons (search, flow diagram, materials lists) out of the GT New Horizons 2.9.0-RC-1 pack **without rendering the game on the server side**, plus the one-time client-side alternatives.

- Date: 2026-10-17. Status: research reference.
- Checked against: `gregtech-5.09.54.183.jar` (merged GT5u + GT++ + BartWorks + TecTech + GoodGenerator + KekzTech + KubaTech + GTNH-Lanthanides + GGFab + GTNH-Intergalactic), `NotEnoughItems-2.8.145-GTNH`, `StorageDrawers-2.2.31-GTNH`, `JABBA-1.5.23`, `IronChest-6.1.13`, `ProjRed-4.12.44-GTNH`, `EnderIO-2.10.46`, `appliedenergistics2-rv3-beta-1073-GTNH`, `hodgepodge-2.7.211`, `angelica-2.2.19` (client only), Forge `10.13.4.1614`, Minecraft 1.7.10.
- Public document: it contains no world data, player data, coordinates or server address. World-specific samples (what the group's base actually contains, local paths, the client's resource packs) are in `docs/local/research-textures-icons.md`, which is gitignored.
- Related: `docs/research/prior-art.md` (client-side exporters that also render icons: NESQL forks, `gtnh-calc-oracle`), `docs/research/world-format.md` (NBT layout).

---

## 0. Summary

| Question | Answer |
|---|---|
| Where are the PNGs? | Inside every mod jar in the server pack's `mods/` folder (universal jars): 50,205 texture PNGs and 3,047 `.mcmeta` files in 200 resource domains (§2.2). The vanilla **server** jar has no textures; vanilla block/item textures come from the official 1.7.10 **client** jar (§2.2, §5.7). |
| Icon name → file | `domain:path` → `assets/<lower-case domain>/textures/blocks/<path>.png` (block atlas) or `…/textures/items/<path>.png` (item atlas); no domain means `minecraft` (§2.1, verified in `TextureMap` and `ResourceLocation` bytecode). |
| Can a dedicated server tell which texture a block face / item uses? | Only partly. `Block.getIcon(side, meta)`, `registerBlockIcons`, `Item.registerIcons`, `getIconString` do not exist on a dedicated server (§2.3). What survives: the plain fields `Block.textureName` (`field_149768_d`) and `Item.iconString` (`field_111218_cA`), set by only a minority of classes (364 / 384 classes call the setters vs 1,370 / 1,276 classes that override the client-only registration). **GregTech is the big exception**: its texture objects (`IIconContainer`, `ITexture`, `GTFluid`, `Materials.mIconSet`/`mRGBa`) are created on both sides and hold `ResourceLocation`s in plain fields, so a server-side exporter can reconstruct every GT machine face, cable, pipe, casing, cover, material item and GT fluid (§3, §4, §6). |
| GT casings per tier | `assets/gregtech/textures/blocks/iconsets/MACHINE_<TIER>_{SIDE,TOP,BOTTOM}.png`, tier index 0..14 = ULV, LV, MV, HV, EV, IV, LuV, ZPM, UV, UHV, UEV, UIV, UMV, UXV, MAX (§3.2). |
| GT machine overlays | Basic machines: `assets/gregtech/textures/blocks/basicmachines/<overlay>/OVERLAY_{FRONT,SIDE,TOP,BOTTOM}[_ACTIVE][_GLOW].png` (all optional). Everything else: `iconsets/<FIELD>.png` where `<FIELD>` is a `Textures.BlockIcons` field name (1,954 of 1,957 fields; 12 names differ, listed in §3.4). `Textures.BlockIcons` is a final class with static fields in this version, not an enum. |
| MTE id → textures | Exporter (recommended): build a `BaseMetaTileEntity` per id and walk `getTexture(Block, side)` (§3.5 A). Build script fallback: 479 "builder" basic machines map statically from `LoaderMetaTileEntities` bytecode (§3.5 B); hatches, generators, steam machines and multiblocks need the exporter. |
| Item icons | GT material items: compose from jar PNGs (texture-set folder with `NONE` fallback) × material RGB, overlay untinted (§6.1). Everything else: one-time NEI 2.8.145 item-panel dump to PNG, joined to registry names through the CSV/JSON dump of the same list (§6.5), or a client-side exporter (prior-art.md). |
| Fluids | GT fluids: `assets/gregtech/textures/blocks/fluids/fluid.<name>.png` (+ `.mcmeta`), tinted by `getColor()`; the exporter reads `GTFluid.stillIconResourceLocation`. Non-GT fluids: colour is server-side (`Fluid.getColor()`), the icon is client-side only (NEI dump) (§6.3). |
| Animation | 1.7.10 `.png.mcmeta` keys: `frametime`, `frames` (`index`, `time`), `width`, `height`; frames stacked vertically. GT also uses `interpolate` (248 files), which only the client-only Angelica mod implements (§2.4). |
| Licences | Mixed; several asset sets are NC-SA (AE2 textures, JABBA), GT contains third-party art, and Mojang forbids redistributing game content. Extract locally into a gitignored folder; never commit PNGs, atlases or dumps (§7). |

**Recommended pipeline** (details in §8):

1. Build step `extract-assets` (no game): index and copy all `assets/*/textures/**` PNG + `.mcmeta` from `mods/*.jar` and the 1.7.10 client jar into a gitignored cache.
2. The export mod on the separate server copy writes a `textures.json`: GT materials (RGB, per-icon-type resource paths), meta-item prefix tables, per-MTE face layers, casing-ID table, cover textures, fluids, and `textureName`/`iconString` where present.
3. Curated mapping tables in our code for the non-GT blocks the 3D view draws (Storage Drawers, JABBA, Iron Chests, Project Red pipes, EnderIO conduits, AE2, vanilla) using the names in §5.
4. Optional one-time client step on a **copy** of the client instance: NEI item-panel dump (PNG + JSON) for icons of everything else; optionally Hodgepodge `/dumptextureatlas` to cross-check sprite names.
5. Anything unresolved falls back to the plain colour by machine kind (design §3.8).

---

## 1. Conventions used for evidence

All commands are read-only. Placeholders:

```
PACK  = the server pack folder            MODS = $PACK/mods
GT    = $MODS/gregtech-5.09.54.183.jar    NEI  = $MODS/NotEnoughItems-2.8.145-GTNH.jar
SJAR  = $PACK/minecraft_server.1.7.10.jar
CJAR  = the official 1.7.10 client jar (Prism keeps it at <Prism data>/libraries/com/mojang/minecraft/1.7.10/minecraft-1.7.10-client.jar)
FORGE = $PACK/forge-1.7.10-10.13.4.1614-1.7.10-universal.jar
J     = javap from a JDK (JDK 25 was used)
X     = a scratch folder holding classes unpacked with: unzip -o -q $GT 'gregtech/...' (same for other jars)
```

Notes on reading the GT jar:

- It is a multi-release jar (`Multi-Release: true`, `JvmDowngrader-Downgrade-Target: 52` in `META-INF/MANIFEST.MF`) with alternate classes under `META-INF/versions/17` and `/21`. The base classes were disassembled; logic was not compared with the versioned copies.
- JvmDowngrader turns string concatenation into synthetic methods named `jvmdowngrader$concat$<method>$<n>`. Path prefixes such as `"iconsets/"` live there.
- Obfuscated vanilla names were resolved with Forge's own deobfuscation table: `python3 -I -c "import zipfile,lzma; print(lzma.decompress(zipfile.ZipFile('$FORGE').read('deobfuscation_data-1.7.10.lzma'), format=lzma.FORMAT_ALONE).decode())"` (gives lines like `CL: aji net/minecraft/block/Block`).
- Small parsers over `javap -c -constants` output (enum initialisers, the `Textures.BlockIcons` initialiser, builder chains in `LoaderMetaTileEntities`, `OrePrefixes` builder chains, casing `getIcon` table switches) produced the tables below. They are about 40 lines each and live in the research scratch folder, not in the repo; the build plan should re-implement whatever it needs.

---

## 2. Ground rules that apply to every mod

### 2.1 Icon name → PNG path

Minecraft 1.7.10 registers every block/item icon by a name string through `IIconRegister.registerIcon(String)`. The stitcher turns the name into a file path:

- `TextureMap` (obf `bpz`) builds `String.format("%s/%s%s", basePath, location.getResourcePath(), ".png")`, and the two atlases use base paths `textures/blocks` and `textures/items`.
  ```
  $ J -p -c -constants -cp "$CJAR" bpz | grep -B12 -A26 'String %s/%s%s'
    private bqx a(bqx, int);
    ... ldc #2 // String %s/%s%s ... getfield #97 // Field i:Ljava/lang/String; ... ldc #4 // String .png
    ... ldc #3 // String %s/mipmaps/%s.%d%s
  $ J -p -c -constants -cp "$CJAR" bao | grep 'String textures'
    1044: ldc #232 // String textures/blocks     1107: ldc #236 // String textures/items
  (Forge table: CL: bpz net/minecraft/client/renderer/texture/TextureMap, CL: bao net/minecraft/client/Minecraft, CL: bqx net/minecraft/util/ResourceLocation)
  ```
- `ResourceLocation(String)` (obf `bqx`) splits at `:` (char 58); the domain defaults to `minecraft` and is lower-cased; the path is kept as is.
  ```
  $ J -p -c -constants -cp "$CJAR" bqx | sed -n '/public bqx(java.lang.String);/,/return/p'
     4: ldc #2 // String minecraft  ... 10: bipush 58 ... 12: invokevirtual String.indexOf ...
    51: invokevirtual java/lang/String.toLowerCase:()Ljava/lang/String;  54: putfield #8 // Field a  (domain)
    58: aload_3  59: putfield #9 // Field b  (path, unchanged)
  ```

So `StorageDrawers:drawers_oak_front_1` on the block atlas is `assets/storagedrawers/textures/blocks/drawers_oak_front_1.png`. Paths inside jars are case-sensitive; only the domain is lower-cased.

Default registration, for blocks and items that do not override it (client jar only):

```
$ J -p -c -constants -cp "$CJAR" aji | sed -n '/public void a(rg);/,/return$/p'
   3: invokevirtual #583 // Method N:()Ljava/lang/String;      (getTextureName, func_149641_N)
   6: invokeinterface #896 // InterfaceMethod rg.a:(Ljava/lang/String;)Lrf;   (registerIcon)
$ J -p -c -constants -cp "$CJAR" adb | sed -n '/public void a(rg);/,/return$/p'
   3: invokevirtual #729 // Method w:()Ljava/lang/String;      (getIconString, func_111208_A)
```

`getTextureName()` returns `textureName`, or `MISSING_ICON_BLOCK_<id>_<name>` when unset (`MISSING_ICON_BLOCK_` is a string constant in client `aji.class`).

### 2.2 Where the PNGs are, and which copy wins

- **Mod jars carry their assets on the server too.** A survey of `$MODS/*.jar`: 50,205 PNGs and 3,047 `.mcmeta` under `assets/<domain>/textures/`, in 200 domains; the GT jar alone has 12,226 `.png` entries (11,647 under `textures/`) and 2,061 `.png.mcmeta`.
  ```
  $ python3 -I -c "<walk every jar in \$MODS, count assets/*/textures/*.png and *.mcmeta>"
    total texture PNGs in mods: 50205 mcmeta: 3047 domains: 200
    top jars by png: gregtech-5.09.54.183.jar 11647, TConstruct 4234, chisel 3612, binnie-mods 2705, ...
  $ unzip -l $GT | awk '{print $4}' | grep -c '\.png$'        → 12226
  $ unzip -l $GT | awk '{print $4}' | grep -c '\.png\.mcmeta$' → 2061
  ```
- **The vanilla server jar has no textures**: `unzip -l $SJAR | awk '{print $4}' | grep '^assets/'` → only `assets/`, `assets/minecraft/`, `assets/minecraft/lang/`, `assets/minecraft/lang/en_US.lang`.
- **Vanilla textures**: the official client jar has 349 block and 214 item PNGs, plus 13 `.mcmeta` files (`unzip -l $CJAR | awk '{print $4}' | grep -c '^assets/minecraft/textures/blocks/.*\.png$'` → 349; `…/items/…` → 214; `…\.mcmeta$` → 13). It can be downloaded from Mojang and checked by hash: the version manifest `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` → `1.7.10.json` → `downloads.client = {sha1: e80d9b3bf5085002218d4be59e668bac718abbc6, size: 5256245, url: https://launcher.mojang.com/v1/objects/e80d9b3b.../client.jar}`; the jar in a Prism install matched that sha1.
- **Mods barely touch vanilla textures**: comparing mod jars with the client jar, only `VillageNames` replaces one vanilla block texture (`blocks/sponge.png`) and GT replaces 6 font pages; `etfuturum` adds 880 new `minecraft`-domain textures without overriding any.
- **Duplicates between jars**: 43 texture paths exist in more than one jar; 37 differ in content (23 in `gregtech`, e.g. `blocks/iconsets/OVERLAY_ACCELERATOR*.png` and `items/gt.metaitem.01/606.png` also ship in `GTNewHorizonsCoreMod`; 10 in `minecraft`; 4 in `cofh`). In game the last-added resource pack wins: `FallbackResourceManager.getResource` (obf `bqq`) walks its pack list from `size()-1` down (`iinc 4, -1`), and FML appends one pack per mod (`FMLClientHandler.addModAsResource` → `resourcePackList.add`). User resource packs come after mods. The exact order between two mods follows FML's mod order (**UNVERIFIED** for each conflicting pair); the extractor should log conflicts and prefer the copy from a client-side cross-check (§6.5.2) if it matters.
  ```
  $ J -p -c -cp "$CJAR" bqq | sed -n '/public .* a(bqx)/,/areturn/p' | grep -E 'size|isub|iinc'
    11: invokeinterface List.size  16: iconst_1  17: isub ... 109: iinc 4, -1
  $ J -p -c -constants -cp X cpw.mods.fml.client.FMLClientHandler | sed -n '/public void addModAsResource/,/return$/p'
    51: getfield #140 // Field resourcePackList:Ljava/util/List;   55: invokeinterface List.add
  ```

### 2.3 What a dedicated server knows (and what it does not)

1. **Client-only members are absent on a dedicated server.** Vanilla's server jar was built without them, and FML strips `@SideOnly(Side.CLIENT)` members from mod classes (`SideTransformer`, message `Attempted to load class %s for invalid side %s`).
   ```
   $ J -p -cp $SJAR aji | grep -c 'java.lang.String N()'   → 0   (client jar: 1)  getTextureName
   $ J -p -cp $SJAR adb | grep -c 'java.lang.String w()'   → 0   (client jar: 1)  getIconString
   $ J -p -cp $SJAR aji | grep -c 'a(rg)'                  → 0   (client jar: 1)  registerBlockIcons
   $ J -p -cp $SJAR adb | grep -c 'a(rg)'                  → 0   (client jar: 1)  Item.registerIcons
   $ J -p -cp $SJAR adb | grep -c 'rf '                    → 0   (client jar: 4)  Item methods returning IIcon (getIconFromDamage, …)
   $ J -p -cp $SJAR aji | grep -E '\(int, int\)'           → (nothing: no getIcon(side, meta) on the server)
   $ J -p -cp $SJAR rf                                      → public interface rf { }   (IIcon is an empty stub)
   $ unzip -l $FORGE | grep SideTransformer                 → cpw/mods/fml/common/asm/transformers/SideTransformer.class
   ```
2. **What survives: the texture-name fields.** The server's `Block` keeps `protected String d` with setter `d(String)`, and `Item` keeps `protected String l` with setter `f(String)`; Forge's table names them:
   ```
   $ J -p -c -cp $SJAR aji | grep -A6 'protected aji d(java.lang.String)'   → putfield #511 // Field d:Ljava/lang/String;
   $ J -p -c -cp $SJAR adb | grep -A6 'protected adb f(java.lang.String)'   → putfield #520 // Field l:Ljava/lang/String;
   deobf table: FD: aji/d net/minecraft/block/Block/field_149768_d          (MCP name: textureName)
                FD: adb/l net/minecraft/item/Item/field_111218_cA           (MCP name: iconString)
                MD: aji/d (Ljava/lang/String;)Laji; .../Block/func_149658_d (setBlockTextureName)
                MD: adb/f (Ljava/lang/String;)Ladb; .../Item/func_111206_d  (setTextureName)
   ```
   The MCP names come from the MCP mappings, not from a local file. In the runtime (SRG) environment read them with `ReflectionHelper`/`ObfuscationReflectionHelper` using `field_149768_d` / `field_111218_cA`; the getters do not exist server-side, so read the fields.
3. **Most mods do not use those fields.** A class-file scan of every class in `$MODS` (declared methods and referenced method names, SRG names):
   ```
   $ python3 -I classscan.py $MODS
     item_registerIcons_override 1276        (declares func_94581_a(IIconRegister))
     item_getIconFromDamage_override 605     (declares func_77617_a)
     block_registerBlockIcons_override 1370  (declares func_149651_a(IIconRegister))
     block_getIcon_side_meta_override 1079   (declares func_149691_a)
     calls_Item_setTextureName 384           (references func_111206_d)
     calls_Block_setBlockTextureName 364     (references func_149658_d)
   ```
   So `textureName`/`iconString` is a hint for simple blocks and items only; meta- and state-dependent icons are decided in client-only code. For those, use a curated table (§5), GT's own objects (§3–§6), or a client-side dump (§6.5).
4. **GregTech's texture objects are not client-only.** `Textures$BlockIcons`, `TextureFactory`, `GTRenderedTexture`, `GTCopiedBlockTextureRender`, `GTFluid`, `Materials` and the `GT*IconContainer` classes carry no `SideOnly` annotation (`J -p -v ... | grep -c SideOnly` → 0 for each), and MTE constructors build them during pre-init on both sides (example: `MTEBasicMachineWithRecipe.<init>` calls `Textures$BlockIcons.customOptional` and `TextureFactory.of`, §3.3). Only the `IIconContainer` *methods* that return client types are `SideOnly` (`getIcon`, `getOverlayIcon`, `getTextureFile`, `getIconColor`, …), so a server-side exporter must read the **fields** (`iconResource`, `mIconName`, …) by reflection instead of calling those methods:
   ```
   $ J -p -v -cp X gregtech.api.interfaces.IIconContainer | grep -E '^  public|SideOnly|value='
     public abstract net.minecraft.util.IIcon getIcon();  cpw.mods.fml.relauncher.SideOnly( value=...CLIENT
     public abstract net.minecraft.util.ResourceLocation getTextureFile();  SideOnly( value=...CLIENT
   $ J -p -cp X gregtech.client.iconContainers.blocks.GTBlockIconContainer
     final java.lang.String mIconName;  final net.minecraft.util.ResourceLocation iconResource;
   ```

### 2.4 Animated textures (`.png.mcmeta`)

- 1.7.10's `AnimationMetadataSectionSerializer` (obf `bsb`) knows `animation`, `frametime`, `frames`, `index`, `time`, `width`, `height` and nothing else:
  ```
  $ J -p -c -constants -cp "$CJAR" bsb | grep 'String ' | awk -F'// String ' '{print $2}' | sort -u
    animation | frames | frametime | height | index | time | width | Invalid frame index | ...
  ```
- Frames are stacked vertically in one PNG, frame size = width × width unless `width`/`height` are given (standard 1.7.10 behaviour; the examples below are 16 px wide and a multiple of 16 high). `frametime` is in game ticks (1 tick = 50 ms); `frames` is an optional list of frame indices or `{index, time}` objects.
  ```
  $ python3 -I -c "<read PNG header + .mcmeta from $GT>"
    blocks/basicmachines/centrifuge/OVERLAY_FRONT_ACTIVE.png (16, 64) {"animation": {"frametime": 1}}
    blocks/fluids/fluid.autogenerated.png (16, 512) {"animation": {"frametime": 2}}
    blocks/iconsets/MACHINE_LV_SIDE.png (16, 16)
    animation keys used in GT jar: {'interpolate': 248, 'frametime': 1911, 'frames': 203, 'frames_with_objects': 103}
  ```
- `interpolate` (248 GT files) is not vanilla 1.7.10. The GTNH client gets it from Angelica 2.2.19 (client-only jar), which contains `jss/notfine/render/InterpolatedIcon.class` and the mixin `com/gtnewhorizons/angelica/mixins/early/notfine/interpolatedtexturemap/MixinTextureMap.class`. The blending formula was not read (**UNVERIFIED**; the usual meaning is a linear blend from frame *i* to *i*+1 across the frame time).
- For static icons use frame 0 (or frame `frames[0]`). For the 3D view, play the animation with a vertical sprite-sheet offset.

### 2.5 GT tint and glow conventions (used by several sections below)

- **Tint = multiply RGB, alpha forced to 1.** Items: `GTRenderUtil.colorGTItem` and `GeneratedMaterialRenderer.renderRegularItem` call `GL11.glColor3f(r/255, g/255, b/255)` / `glColor4f(..., 1.0f)` from the item's `getRGBa`. The 4th component of GT's `short[] mRGBa` is ignored for drawing.
  ```
  $ J -p -c -constants -cp X gregtech.common.render.GTRenderUtil | sed -n 1,60p
    19: invokeinterface IGT_ItemWithMaterialRenderer.getRGBa ... 29: ldc float 255.0f ... fdiv ... 46: fconst_1
    47: invokestatic org/lwjgl/opengl/GL11.glColor4f:(FFFF)V
  ```
- **Glow layers** (`*_GLOW.png`, built with `TextureFactory.builder().addIcon(...).glow()`) are drawn full-bright: `GTRenderedTexture` checks its `glow` field and passes brightness `15728880` (`0xF000F0`).
  ```
  $ J -p -c -constants -cp X gregtech.common.render.GTRenderedTexture | grep -n 'glow\|15728880'
    123: getfield #71 // Field glow:Z  ...  141: ldc #188 // int 15728880
  ```
- **Face order** in GT's sided textures is `ForgeDirection` order DOWN 0, UP 1, NORTH 2, SOUTH 3, WEST 4, EAST 5: `TextureFactory.of(bottom, top, side, rgba)` builds `GTSidedTextureRender(bottom, top, side, side, side, side, rgba)`, and its `renderXPos/XNeg/YPos/YNeg/ZPos/ZNeg` read indices 5/4/1/0/3/2.
  ```
  $ J -p -c -constants -cp X gregtech.api.render.TextureFactory | sed -n '/of(...IIconContainer, ...IIconContainer, ...IIconContainer, short\[\]);/,/areturn/p'
     4: aload_0  5: aload_1  6: aload_2  7: aload_2  8: aload_2  9: aload_2  10: aload_3  11: invokespecial GTSidedTextureRender."<init>"
  ```

---

## 3. GregTech machines

### 3.1 Folders in `gregtech-5.09.54.183.jar`

```
$ unzip -l $GT | awk '{print $4}' | grep '^assets/' | cut -d/ -f1-4 | sort | uniq -c | sort -rn | head
  7011 assets/gregtech/textures/items      3942 assets/gregtech/textures/blocks
   747 assets/gregtech/mcpatcher/ctm        546 assets/miscutils/textures/blocks   (GT++)
   516 assets/gregtech/textures/gui         400 assets/miscutils/textures/items
   265 assets/gtneioreplugin/textures/blocks  201 assets/gtnhintergalactic/textures/blocks ...
$ grep '^assets/gregtech/textures/blocks/' | cut -d/ -f5 | sort | uniq -c   (entries incl. folders and .mcmeta)
  2268 iconsets   768 materialicons   518 fluids   331 basicmachines   56 icons
```

- `blocks/iconsets/` — 1,924 PNGs: tier casings, multiblock casings, every `OVERLAY_*`, hatch signs, pipe overlays, insulation, solar panels, boiler fronts … (one PNG per `Textures.BlockIcons` field, §3.4).
- `blocks/basicmachines/<overlay>/` — 257 PNGs in 52 folders: per-machine overlays of the basic (single-block) electric machines.
- `blocks/materialicons/<SET>/` and `items/materialicons/<SET>/` — material templates for blocks (wire, pipes, frames, ore, storage blocks) and items (dusts, ingots, plates, …) (§4, §6.1).
- `blocks/fluids/` — fluid textures (§6.3). `blocks/icons/` — a few special ones (turbine rotor faces `icons/turbines/TURBINE_NN.png`, Neutron Activator, …).
- `assets/gregtech/mcpatcher/ctm/` — connected-texture data for MCPatcher-style CTM (rendered by Angelica in the client). The planner can ignore it and draw the plain casing texture.

### 3.2 Casings per voltage tier

Files: `assets/gregtech/textures/blocks/iconsets/MACHINE_<TIER>_SIDE.png`, `…_TOP.png`, `…_BOTTOM.png` for ULV, LV, MV, HV, EV, IV, LuV, ZPM, UV, UHV, UEV, UIV, UMV, UXV, MAX (16×16 each), plus `MACHINE_BRONZE_*`, `MACHINE_BRONZEBRICKS_*`, `MACHINE_STEEL_*`, `MACHINE_STEELBRICKS_*` for steam-age hulls. (`MACHINE_OPV_*` PNGs exist but no `BlockIcons` field uses them.)

The arrays `Textures.BlockIcons.MACHINECASINGS_SIDE/TOP/BOTTOM` hold them in tier order, so **tier index = array index**:

```
(parsed from the static initialiser of Textures$BlockIcons)
MACHINECASINGS_SIDE = [MACHINE_ULV_SIDE, MACHINE_LV_SIDE, MACHINE_MV_SIDE, MACHINE_HV_SIDE, MACHINE_EV_SIDE, MACHINE_IV_SIDE,
                       MACHINE_LuV_SIDE, MACHINE_ZPM_SIDE, MACHINE_UV_SIDE, MACHINE_UHV_SIDE, MACHINE_UEV_SIDE, MACHINE_UIV_SIDE,
                       MACHINE_UMV_SIDE, MACHINE_UXV_SIDE, MACHINE_MAX_SIDE]          (TOP and BOTTOM likewise)
```

The machine-hull texture with colour is `Textures.BlockIcons.MACHINE_CASINGS[tier][colorIndex + 1]`, an `ITexture[15][17]` filled as:

```
$ J -p -c -constants -cp X 'gregtech.api.enums.Textures$BlockIcons' | sed -n '<after putstatic MACHINE_CASINGS>'
  23757: getstatic MACHINE_CASINGS ... getstatic MACHINECASINGS_BOTTOM, MACHINECASINGS_TOP, MACHINECASINGS_SIDE
  23778: getstatic gregtech/api/enums/Dyes.MACHINE_METAL ... invokevirtual Dyes.getRGBA ... invokestatic TextureFactory.of(IIconContainer,IIconContainer,IIconContainer,short[])
  23814: getfield Dyes.mIndex ... iconst_1 iadd ... (same, with each dye's getRGBA)
```

- Index 0 (unpainted) is tinted with `Dyes.MACHINE_METAL`, whose RGB comes from the **client** config `colorModulation.machineMetal` (default 255, 255, 255, i.e. no tint). Cables use `Dyes.CABLE_INSULATION`, config `colorModulation.cableInsulation` (default 64, 64, 64).
  ```
  $ J -p -v -cp X 'gregtech.common.config.Client$ColorModulation$MachineMetal' | grep -A1 'DefaultInt('   → value=255 (red, green, blue)
  $ J -p -v -cp X 'gregtech.common.config.Client$ColorModulation$CableInsulation' | grep -A1 'DefaultInt(' → value=64 ×3
  $ J -p -c -constants -cp X gregtech.api.enums.Dyes | grep -n 'ColorModulation'
    80: getstatic Client.colorModulation ... getfield ColorModulation.cableInsulation ... CableInsulation.red/green/blue
   114: getstatic Client.colorModulation ... getfield ColorModulation.machineMetal ... MachineMetal.red/green/...
  ```
- Painted machines: the world NBT key `mColor` (byte) is stored by `CommonBaseMetaTileEntity`; `getColorization()` returns `mColor - 1`, so unpainted `mColor = 0` → index −1 → `MACHINE_CASINGS[tier][0]`, and dye *k* → `MACHINE_CASINGS[tier][k+1]` tinted by that dye.
  ```
  $ J -p -c -constants -cp X gregtech.api.metatileentity.CommonBaseMetaTileEntity | grep -A3 'String mColor'
    ldc #177 // String mColor ... NBTTagCompound.func_74774_a (setByte) / func_74771_c (getByte)
  $ ... BaseMetaTileEntity: public byte getColorization(); → invokevirtual getColorRaw ... iconst_1 isub i2b
  ```
- Dye RGB (constructor argument of each `Dyes` constant): black 0x202020, red 0xFF0000, green 0x00FF00, brown 0x604000, blue 0x0020FF, purple 0x800080, cyan 0x00FFFF, lightGray 0xC0C0C0, gray 0x808080, pink 0xFFC0C0, lime 0x80FF00, yellow 0xFFFF00, lightBlue 0x6080FF, magenta 0xFF00FF, orange 0xFF8000, white 0xFFFFFF.
  ```
  (parsed Dyes static init) dyeBlack 0 "2105376" ... dyeRed "16711680" ... dyeBlue 8447 ... dyeWhite "16777215"
  ```

### 3.3 Per-machine overlays (basic machines)

**Paths.** `MTEBasicMachineWithRecipe` turns its `overlays` string into 16 optional textures:

```
$ J -p -c -constants -cp X gregtech.api.metatileentity.implementations.MTEBasicMachineWithRecipe | grep -A10 'jvmdowngrader$concat$$init$$'
  String basicmachines/ ... String /OVERLAY_SIDE_ACTIVE          ($$init$$1)
  String basicmachines/ ... String /OVERLAY_SIDE_ACTIVE_GLOW     ($$init$$2)
  ... /OVERLAY_SIDE, /OVERLAY_SIDE_GLOW, /OVERLAY_FRONT_ACTIVE, /OVERLAY_FRONT_ACTIVE_GLOW, /OVERLAY_FRONT, /OVERLAY_FRONT_GLOW,
      /OVERLAY_TOP_ACTIVE, /OVERLAY_TOP_ACTIVE_GLOW, /OVERLAY_TOP, /OVERLAY_TOP_GLOW, /OVERLAY_BOTTOM_ACTIVE, /OVERLAY_BOTTOM_ACTIVE_GLOW, ...
  constructor: aload 14 (overlays) ... String.toLowerCase(Locale.ENGLISH) ... Textures$BlockIcons.customOptional(domain, path)
               ... TextureFactory.builder().addIcon(...).glow().build()
```

So the files are `assets/gregtech/textures/blocks/basicmachines/<overlays lower-case>/OVERLAY_<FACE>[_ACTIVE][_GLOW].png`, `<FACE>` ∈ FRONT, SIDE, TOP, BOTTOM. `customOptional` means a missing file is simply not drawn (`GTCustomOptionalBlockIconContainer` checks `ResourceUtils.resourceExists`). In the jar, 49 folders have `OVERLAY_FRONT`, 25 `OVERLAY_TOP`, 21 `OVERLAY_SIDE`, 4 `OVERLAY_BOTTOM`; glow layers are rarer (`OVERLAY_FRONT_ACTIVE_GLOW` ×23). A few special machine classes use their own names (`boxinator/OVERLAY_FRONT_BOXINATOR*.png`, `potionbrewer/…POTIONBREWER*`, `replicator/…REPLICATOR*`).

**Layer stack per face** (`MTEBasicMachine.getTextureSet`, indices of `mTextures[i][colorIndex+1]`):

| i | getter | content |
|---|---|---|
| 0 / 1 | `getSideFacingActive` / `…Inactive` | casing + `OVERLAY_SIDE[_ACTIVE]` (+ glow) |
| 2 / 3 | `getFrontFacingActive` / `…Inactive` | casing + `OVERLAY_FRONT[_ACTIVE]` (+ glow) |
| 4 / 5 | `getTopFacingActive` / `…Inactive` | casing + `OVERLAY_TOP[_ACTIVE]` |
| 6 / 7 | `getBottomFacingActive` / `…Inactive` | casing + `OVERLAY_BOTTOM[_ACTIVE]` |
| 8 / 9 | `getBottomFacingPipeActive` / `…Inactive` | casing + `OVERLAY_PIPE_OUT` |
| 10 / 11 | `getTopFacingPipeActive` / `…Inactive` | casing + `OVERLAY_PIPE_OUT` |
| 12 / 13 | `getSideFacingPipeActive` / `…Inactive` | casing + `OVERLAY_PIPE_OUT` |

```
$ J -p -c -constants -cp X gregtech.api.metatileentity.implementations.MTEBasicMachine | sed -n '/getTextureSet(gregtech.api.interfaces.ITexture\[\]);/,...'
  bipush 14 bipush 17 multianewarray ... invokevirtual getSideFacingActive (index 0) ... getSideFacingInactive (1) ... getFrontFacingActive (2) ...
  getBottomFacingInactive (7) ... bipush 8 getBottomFacingPipeActive ... bipush 13 getSideFacingPipeInactive
$ ... getSideFacingPipeActive(byte): getstatic Textures$BlockIcons.MACHINE_CASINGS ... mTier ... iload_1 iconst_1 iadd ... getstatic Textures$BlockIcons.OVERLAY_PIPE_OUT ... TextureFactory.of
```

The base classes are built with `mTier`, so the casing under every overlay is `MACHINE_CASINGS[mTier][colour]` (the builder's `setTier(n)`, §3.5 B).

**Which face gets what** (`MTEBasicMachine.getTexture(base, side, facing, colorIndex, active, redstone)`): two directions matter, `mMainFacing` (the machine front, saved in MTE NBT as `mMainFacing`) and `facing` (the base tile's `mFacing`, used as the output side).

- `side == mMainFacing` → front (2/3).
- else if `showPipeFacing()` and `side == facing` → pipe-out variant chosen by whether that side is bottom, top or a horizontal side (8–13).
- else bottom → 6/7, top → 4/5, any horizontal side → 0/1.
- Special case: when `mMainFacing` is UP or DOWN, the front overlay is drawn on `facing` instead.

```
$ J -p -c -constants -cp X gregtech.api.metatileentity.implementations.MTEBasicMachine | sed -n '/public gregtech.api.interfaces.ITexture\[\] getTexture(/,+80p'
   1: getfield mMainFacing ... flag ... UP.flag | DOWN.flag ... iand ... ifeq 123
  24: aload_2 aload_3 if_acmpne 44 (side == facing) → 2/3 ...
 123: aload_2 getfield mMainFacing if_acmpne 146 → 2/3
 146: invokevirtual showPipeFacing ... aload_2 aload_3 if_acmpne 239 → pipe variants
 312: getfield mTextures:[[[Lgregtech/api/interfaces/ITexture; ... aaload ... iadd aaload areturn
```

**Worked example.** Id 301 `MACERATOR_LV` ("Basic Macerator", tier 1, overlays `MACERATOR`; from the builder table, §3.5 B). `basicmachines/macerator/` holds `OVERLAY_FRONT`, `OVERLAY_FRONT_ACTIVE`, `OVERLAY_TOP`, `OVERLAY_TOP_ACTIVE` (+ `.mcmeta`), `OVERLAY_TOP_ACTIVE_GLOW` (+ `.mcmeta`). Idle: front = `MACHINE_LV_SIDE` + `OVERLAY_FRONT`; top = `MACHINE_LV_TOP` + `OVERLAY_TOP`; bottom = `MACHINE_LV_BOTTOM`; other sides = `MACHINE_LV_SIDE`; output side = casing + `OVERLAY_PIPE_OUT`. Running: `OVERLAY_FRONT_ACTIVE`, animated `OVERLAY_TOP_ACTIVE` plus the full-bright animated `OVERLAY_TOP_ACTIVE_GLOW`. Id 303 `MACERATOR_HV` uses `basicmachines/pulverizer/` on `MACHINE_HV_*`.

```
$ unzip -l $GT | awk '{print $4}' | grep '/basicmachines/macerator/' | sed 's#.*/macerator/##'
  OVERLAY_FRONT.png OVERLAY_FRONT_ACTIVE.png OVERLAY_TOP.png OVERLAY_TOP_ACTIVE.png OVERLAY_TOP_ACTIVE.png.mcmeta OVERLAY_TOP_ACTIVE_GLOW.png OVERLAY_TOP_ACTIVE_GLOW.png.mcmeta
$ (builder table) {'enum': 'MACERATOR_LV', 'english': 'Basic Macerator', 'tier': 1, 'overlays': 'MACERATOR', 'id': 301}
                  {'enum': 'MACERATOR_HV', 'english': 'Universal Macerator', 'tier': 3, 'overlays': 'PULVERIZER', 'id': 303}
```

### 3.4 `Textures.BlockIcons` field → file

In this version `Textures.BlockIcons` is `public final class gregtech.api.enums.Textures$BlockIcons` with 1,957 static `IIconContainer` fields (plus `ITexture`/array fields), not an enum.

- 889 fields are `create("<NAME>")` → `GTBlockIconContainer` → `"iconsets/" + NAME` on the block atlas → `assets/gregtech/textures/blocks/iconsets/<NAME>.png`. All 889 files exist.
- 1,065 fields are `createOptional("<NAME>")` → `GTOptionalBlockIconContainer` (same path, drawn only if the file exists). 247 of those names have no file (mostly `*_GLOW` variants), which is expected.
- 3 fields are aliases (`VOID`, `RENDERING_ERROR` → `Textures$GlobalIcons`, …).
- For 12 fields the file name differs from the field name: `OVERLAY_FRONT_STEAM_WASHER_GLOW → OVERLAY_FRONT_STEAM_WASHERR_GLOW`, `OVERLAY_FRONT_STEAM_WASHER_ACTIVE_GLOW → OVERLAY_FRONT_STEAM_WASHER_ACTIVER_GLOW`, `MULTI_USE_CASING → MULTI-USE_CASING`, `Casing_Coil_QFT → MACHINE_CASING_QFT_COIL`, `Casing_Resonance_1..4 → ResonanceChamber_I..IV`, `Casing_Modulator_1..4 → Modulator_1..4`.
- 217 `iconsets` PNGs are not referenced by any `BlockIcons` field; other classes register them directly (TecTech `EM_*`, `GODFORGE_*`, `TM_TESLA_*`, `OVERLAY_ENERGY_IN_LASER_*`, …) through `Textures.BlockIcons.custom("iconsets/…")` or their own containers. The exporter (§3.5 A) sees those too.

```
$ J -p -cp X 'gregtech.api.enums.Textures$BlockIcons' | head -3   → public final class gregtech.api.enums.Textures$BlockIcons {
$ J -p -c -constants -cp X gregtech.client.iconContainers.blocks.GTBlockIconContainer | grep -A6 'jvmdowngrader'
    7: ldc #150 // String iconsets/ ... StringBuilder.append ...
  constructor: Mods.GregTech.resourceDomain ... ResourceUtils.getIconRegisterName ... ResourceUtils.getCompleteBlockTextureResourceLocation
$ J -p -c -constants -cp X gregtech.api.util.client.ResourceUtils | grep -E 'String |public'
    getCompleteBlockTextureResourceLocation: String textures/blocks/ ... String .png     getIconRegisterName: ... String : ...
(static-initialiser parse) 1957 fields; kinds: createOptional 1065, create 889, alias 3
(file check against unzip -l)  create 889 missing 0;  createOptional 1065 missing 247
```

### 3.5 Mapping a MetaTileEntity id to its face textures

GT machines in the world are `gregtech:gt.blockmachines` blocks whose tile entity NBT carries `mID` (MetaTileEntity id), `mFacing`, `mColor`, `mActive`, and per-class data such as `mMainFacing` (basic machines) or `texturePage`/`textureIndex` (hatches, §3.6). The id ↔ enum name table is `gregtech.api.enums.MetaTileEntityIDs` (`ID` field per constant). GT also has an NEI "MetaTileEntity" dumper (`gregtech.nei.dumper.MetaTileEntityDumper`: columns `id`, `stackName`, `className`), but it is client-side.

#### A. Exporter on the server copy (recommended; covers every MTE)

Everything below exists server-side (signatures from `javap -p`):

```
gregtech.api.GregTechAPI:              public static final IMetaTileEntity[] METATILEENTITIES;  public static Block sBlockMachines;
gregtech.api.metatileentity.BaseMetaTileEntity:
    public BaseMetaTileEntity();
    public void setInitialValuesAsNBT(NBTTagCompound, short);   // calls createNewMetatileEntity(id), then reads mFacing etc. from the NBT
    public void setFrontFacing(ForgeDirection);  public void setActive(boolean);
    public ITexture[] getTexture(Block, ForgeDirection);        // = cover texture + mMetaTileEntity.getTexture(this, side, mFacing, getColorization(), mActive, redstone)
gregtech.api.interfaces.metatileentity.IMetaTileEntity:
    ITexture[] getTexture(IGregTechTileEntity, ForgeDirection side, ForgeDirection facing, int colorIndex, boolean active, boolean redstone);
gregtech.api.metatileentity.implementations.MTETieredMachineBlock:  public final byte mTier;  public final ITexture[][][] mTextures;
```

```
$ J -p -v -cp X gregtech.api.metatileentity.BaseMetaTileEntity | grep -A12 'getTexture(net.minecraft.block.Block, ...ForgeDirection);' | grep SideOnly  → (none)
$ J -p -c -constants -cp X gregtech.api.metatileentity.BaseMetaTileEntity | sed -n '/getTexture(net.minecraft.block.Block/,/areturn/p'
   2: invokevirtual getCoverTexture ... 14: getfield mMetaTileEntity ... 20: getfield mFacing ... 24: getColorization ... 28: getfield mActive
  44: invokevirtual MetaTileEntity.getTexture:(IGregTechTileEntity;ForgeDirection;ForgeDirection;IZZ) ... 50: getstatic ERROR_RENDERING
```

Sketch (Java, in the export mod):

```java
for (short id = 1; id < GregTechAPI.METATILEENTITIES.length; id++) {
    if (GregTechAPI.METATILEENTITIES[id] == null) continue;
    BaseMetaTileEntity te = new BaseMetaTileEntity();
    te.setInitialValuesAsNBT(nbtOrNull, id);      // nbtOrNull: e.g. {mFacing: 2, mMainFacing: 3} or a real NBT from the world scan
    te.setFrontFacing(ForgeDirection.NORTH);
    for (boolean active : new boolean[] {false, true}) {
        te.setActive(active);
        for (ForgeDirection side : ForgeDirection.VALID_DIRECTIONS)
            emit(id, active, side, flatten(te.getTexture(GregTechAPI.sBlockMachines, side)));
    }
}
```

`flatten` walks the `ITexture` tree (field names from `javap -p`; read them with `setAccessible(true)`):

| class | fields | meaning |
|---|---|---|
| `gregtech.common.render.GTMultiTextureRender` | `protected final ITexture[] mTextures` | layers, draw in order |
| `gregtech.common.render.GTSidedTextureRender` | `protected final ITexture[] mTextures` (6, `ForgeDirection` order), `private final short[] mRGBa` | per-face |
| `gregtech.common.render.GTRenderedTexture` | `protected final IIconContainer mIconContainer`, `private final short[] mRGBa`, `private final boolean glow`, `private final boolean useExtFacing` | one icon, tint, glow |
| `gregtech.common.render.GTCopiedBlockTextureRender`, `GTCopiedCTMBlockTexture` | `private final Block mBlock`, `private final byte mSide`, `private final int mMeta` | "look like block X:meta" (casings) → resolve with §3.7 |
| `GTBlockIconContainer`, `GTOptionalBlockIconContainer` | `mIconName`, `iconResource` (`ResourceLocation`) | `gregtech:textures/blocks/iconsets/NAME.png` |
| `GTCustomBlockIconContainer` (+ `…Optional…`, `…Alpha…`) | `iconResource`, `overlayResource`, `mIconName`, `mOverlayName` | arbitrary path, optional `_OVERLAY` |
| `GTCustomAlphaFallbackBlockIconContainer` | `iconResource`, `overlayResource`, `fallback` (`IIconContainer`) | use `fallback` when neither file exists |
| `GTTextureSetBlockIconContainer` / `…ItemIconContainer` | `iconResource`, `iconFallbackResource`, `iconOverlayResource`, `iconOverlayFallbackResource` | material template with `NONE` fallback (§6.1) |
| `Textures$GlobalIcons.VOID` / `RENDERING_ERROR`, `Textures$InvisibleIcon.INVISIBLE_ICON` | — | draw nothing / error |

The result per MTE id: 6 faces × {inactive, active} × layers `{resource path, rgba, glow}`. The 3D view rotates by the world's `mFacing`/`mMainFacing`. Exporting with real NBT from the world scan reproduces the exact state (facing, front, covers); exporting with defaults gives a canonical orientation.

**UNVERIFIED:** that `setInitialValuesAsNBT(null, id)` and `getTexture` work without a world for every MTE class (some may touch `worldObj`); wrap each id in `try/catch`, log failures, and fall back to B or to plain colour.

#### B. Static table for a build script (no game; basic machines only)

All 479 single-block electric machines built with `MTEBasicMachineWithRecipeBuilder` can be mapped from bytecode: each builder chain in `gregtech.loaders.preload.LoaderMetaTileEntities` contains `MetaTileEntityIDs.<ENUM>` → `.setName(unlocalized, english)` → `.setTier(n)` → `.setOverlays("<OVERLAYS>")` → `.build()`:

```
$ J -p -c -constants -cp X gregtech.loaders.preload.LoaderMetaTileEntities | sed -n '/private void registerMacerator();/,+30p'
   3: getstatic MetaTileEntityIDs.MACERATOR_LV ... MTEBasicMachineWithRecipeBuilder.builder:(I)
  12: ldc String basicmachine.macerator.tier.01   15: ldc String Basic Macerator   ... setName ... 23: iconst_1 ... setTier
  40: getstatic RecipeMaps.maceratorRecipes ... 63: ldc String MACERATOR ... setOverlays ... setSpecialEffect(TOP_SMOKE) ... build
$ python3 -I builder_table.py LoaderMTE.javap mteids.json
  479 rows; 479 with overlays
  {'enum': 'UNPACKAGER_LV', 'english': 'Basic Unpackager', 'tier': 1, 'overlays': 'UNBOXINATOR', 'id': 411} ...
```

The 42 distinct overlay strings (folder = lower-case) and how many machines use each: ALLOY_SMELTER 12, AMPLIFAB 12, ARC_FURNACE 12, ASSEMBLER 12, AUTOCLAVE 12, BENDER 12, CANNER 12, CENTRIFUGE 12, CHEMICAL_BATH 12, CHEMICAL_REACTOR 12, CIRCUITASSEMBLER 14, COMPRESSOR 12, CUTTER 12, DISTILLERY 12, ELECTRIC_FURNACE 12, ELECTRIC_OVEN 5, ELECTROLYZER 12, ELECTROMAGNETIC_SEPARATOR 12, EXTRACTOR 12, EXTRUDER 12, FERMENTER 12, FLUID_CANNER 12, FLUID_EXTRACTOR 12, FLUID_HEATER 12, FLUID_SOLIDIFIER 12, HAMMER 12, LASER_ENGRAVER 12, LATHE 12, MACERATOR 2 (LV, MV), MICROWAVE 12, MIXER 12, ORE_WASHER 12, PLASMA_ARC_FURNACE 12, POLARIZER 12, PRESS 12, PRINTER 8, PULVERIZER 10 (macerators HV and up), RECYCLER 12, SIFTER 12, THERMAL_CENTRIFUGE 12, UNBOXINATOR 8, WIREMILL 12. Every one has a matching folder in the jar (check: 0 missing). The folders `boxinator, cable_coater, cold_trap, dehydrator, miner, potionbrewer, pump, reactor_processing_unit, replicator, simple_washer` belong to other machine classes.

Everything that is not a builder machine (hatches, buses, transformers, battery buffers, hulls, generators, boilers, steam machines, GT++ and BartWorks machines, every multiblock controller) has its textures in class code; method A is the general answer, and §3.6–§3.8 list the common pieces. A static table alone will miss most of a typical steam/early-electric base (see the local notes for a sample count).

### 3.6 Hatches and buses

`MTEHatch` saves the casing it mimics in its own NBT and draws casing + overlay only on its front:

```
$ J -p -c -constants -cp X gregtech.api.metatileentity.implementations.MTEHatch
  private int texturePage;  private int textureIndex;
  saveNBTData: ldc String texturePage ... setInteger ... ldc String textureIndex ... setInteger
  loadNBTData: ... texturePage << 7 | textureIndex ... invokevirtual updateTexture:(I)V
  getCasingTexture: if (texturePage > 0 || textureIndex > 0) return Textures$BlockIcons.casingTexturePages[texturePage][textureIndex]; else return null
  getTexture(base, side, facing, colorIndex, active, redstone):
      casing = getCasingTexture() ?: MACHINE_CASINGS[mTier][colorIndex + 1]
      side != facing → { casing }        side == facing → active ? getTexturesActive(casing) : getTexturesInactive(casing)
```

- Casing id = `texturePage << 7 | textureIndex`; `casingTexturePages` is an array of 128 pages, each an `ITexture[128]` once created (`Textures$BlockIcons` creates pages 0, 1, 2, 8, 16, 17 through `GTUtility.addTexturePage`; `getCasingTextureForId(id)` reads `casingTexturePages[(id >> 7) & 127][id & 127]`). Id 225 is the error texture (`setCasingTextureForId(225, ERROR_RENDERING[0])`). A hatch that never joined a multiblock keeps 0/0 and looks like a plain tier hull.
  ```
  $ J -p -c -constants -cp X gregtech.api.util.GTUtility | sed -n '/addTexturePage(byte)/,/ireturn/p'  → getstatic casingTexturePages ... sipush 128 ... anewarray ITexture
  $ J ... 'gregtech.api.enums.Textures$BlockIcons' getCasingTextureForId(int): getstatic casingTexturePages ... bipush 7 ishr bipush 127 iand ...
  $ J ... static init: sipush 128 anewarray [ITexture → putstatic casingTexturePages ... iconst_1/2, bipush 8/16/17 → GTUtility.addTexturePage ... sipush 225 getstatic ERROR_RENDERING ... setCasingTextureForId
  ```
- Front overlays by class (`BlockIcons` fields referenced in each class):

| class | overlays |
|---|---|
| `MTEHatchInput` (fluid in) | `OVERLAY_PIPE_IN`, `FLUID_IN_SIGN`, `OVERLAY_PIPE_COLORS` (colour channel) |
| `MTEHatchOutput` (fluid out) | `OVERLAY_PIPE_OUT`, `FLUID_OUT_SIGN` |
| `MTEHatchInputBus` | `OVERLAY_PIPE_IN`, `ITEM_IN_SIGN`, `OVERLAY_PIPE_COLORS` |
| `MTEHatchOutputBus` | `OVERLAY_PIPE_OUT`, `ITEM_OUT_SIGN` |
| `MTEHatchMultiInput` | `OVERLAY_INPUT_HATCH_2x2`, `OVERLAY_INPUT_HATCH_2x2_COLORS` |
| `MTEHatchEnergy` / `MTEHatchDynamo` | `OVERLAYS_ENERGY_IN_MULTI_2A[tier]` / `OVERLAYS_ENERGY_OUT_MULTI_2A[tier]` |
| `MTEHatchMaintenance` | `OVERLAY_MAINTENANCE`, `OVERLAY_DUCTTAPE`, `OVERLAY_AUTOMAINTENANCE[_IDLE][_GLOW]` |
| `MTEHatchMuffler` | `OVERLAY_MUFFLER` |
| `MTETransformer` | `MACHINE_CASINGS`, `OVERLAYS_ENERGY_IN[tier]`, `OVERLAYS_ENERGY_OUT[tier]`, `…_MULTI_4A` |
| `MTEBasicBatteryBuffer` | `MACHINE_CASINGS`, `OVERLAYS_ENERGY_OUT[tier]`, `…_MULTI_4A`, `…_MULTI_16A` |
| `MTEBasicHull` | `MACHINE_CASINGS`, `OVERLAYS_ENERGY_OUT[tier]` |

```
$ for c in MTEHatchInput MTEHatchOutput ...; do J -p -c -constants -cp X gregtech.api.metatileentity.implementations.$c | grep -o 'BlockIcons\.[A-Za-z0-9_]*' | sort -u; done
  MTEHatchInput: FLUID_IN_SIGN OVERLAY_PIPE_COLORS OVERLAY_PIPE_IN      MTEHatchOutputBus: ITEM_OUT_SIGN OVERLAY_PIPE_OUT
  MTEHatchEnergy: OVERLAYS_ENERGY_IN_MULTI_2A   MTEHatchDynamo: OVERLAYS_ENERGY_OUT_MULTI_2A   MTEHatchMuffler: OVERLAY_MUFFLER ...
```

`OVERLAYS_ENERGY_IN` is a 17-entry array `[OVERLAY_ENERGY_IN, OVERLAY_ENERGY_IN_ULV, …_LV, …, …_MAX, …_MAXP]`; `OVERLAY_PIPE_COLORS` is `[OVERLAY_PIPE_COLOR_NONE, _BLACK, _RED, _GREEN, _BROWN, _BLUE, _PURPLE, _CYAN, _LIGHTGRAY, _GRAY, _PINK, _LIME, _YELLOW, _LIGHTBLUE, _MAGENTA, _ORANGE, _WHITE]` (static-initialiser parse). Steam-age hatches (GT++ `Hatch_Input_Steam` etc.) and other mods' hatches have their own classes; use method A.

### 3.7 Multiblock casing blocks (`gregtech:gt.blockcasings*`)

- Every `BlockCasingsAbstract` subclass registers its 16 metas as casing textures: `setCasingTextureForId(getTextureIndex(meta), TextureFactory.of(this, meta))` (a `GTCopiedBlockTextureRender`). `getTextureIndex` is per class, e.g. `BlockCasings2`: `meta == 6 ? 224 : meta + 16`.
  ```
  $ J -p -c -constants -cp X gregtech.common.blocks.BlockCasingsAbstract | grep -E 'getTextureIndex|TextureFactory|setCasingTexture'
    20: invokevirtual getTextureIndex:(I)I  26: invokestatic TextureFactory.of:(Lnet/minecraft/block/Block;I)  29: invokestatic Textures$BlockIcons.setCasingTextureForId
  $ J -p -c -constants -cp X gregtech.common.blocks.BlockCasings2 | sed -n '/public int getTextureIndex(int);/,/ireturn/p'
     0: iload_1  1: bipush 6  3: if_icmpne 12  6: sipush 224  9: goto 16  12: iload_1  13: bipush 16  15: iadd  16: ireturn
  ```
- The face texture of a casing block is chosen in `getIcon(side, meta)` (`func_149691_a`), which is client-only. Two ways:
  1. Exporter: `casingTexturePages[page][idx]` gives `(mBlock registry name, mMeta)`; resolve the block face with option 2, or with a client-side dump.
  2. Build script: parse the `tableswitch` in `func_149691_a` of each `gregtech/common/blocks/BlockCasings*.class` (meta → `Textures$BlockIcons` field → `iconsets/<NAME>.png`). Example result for `BlockCasings2` (`gt.blockcasings2`):
     ```
     $ python3 -I casing_icons.py BlockCasings2.javap
       0 (default) MACHINE_CASING_SOLID_STEEL   1 MACHINE_CASING_FROST_PROOF   2..5 MACHINE_CASING_GEARBOX_{BRONZE,STEEL,TITANIUM,TUNGSTENSTEEL}
       6 MACHINE_CASING_PROCESSOR  7 MACHINE_CASING_DATA_DRIVE  8 MACHINE_CASING_CONTAINMENT_FIELD  9 MACHINE_CASING_ASSEMBLER
      10 MACHINE_CASING_PUMP  11 MACHINE_CASING_MOTOR  12..15 MACHINE_CASING_PIPE_{BRONZE,STEEL,TITANIUM,TUNGSTENSTEEL}
     ```
     Some metas depend on the side (e.g. `BlockCasings4` firebox top `MACHINE_CASING_FIREBOX_TITANIUM_TOP`; `BlockCasings1` returns `MACHINECASINGS_BOTTOM/TOP/SIDE[meta]` by side). A table-switch parser handles the common case; side-dependent metas need a hand check. GT++/BartWorks/TecTech casing blocks live in other classes and texture folders (`assets/miscutils`, `assets/bartworks`, `assets/tectech`).
- Multiblock controllers draw `casing texture + front overlay` (e.g. `OVERLAY_FRONT_ELECTRIC_BLAST_FURNACE[_ACTIVE][_GLOW]`, `OVERLAY_FRONT_LARGE_BOILER…`, `OVERLAY_FRONT_STEAM_MACERATOR…`); method A returns these per controller id.

### 3.8 Covers (needed for the "machine to machine" logistics mode)

Cover items map to textures through `gregtech.api.covers.CoverRegistry`:

```
$ J -p -cp X gregtech.api.covers.CoverRegistry
  private static final java.util.Map<gregtech.api.objects.GTItemStack, gregtech.api.covers.CoverRegistration> covers;
  public static gregtech.api.interfaces.ITexture getCoverTexture(net.minecraft.item.ItemStack);
$ J -p -cp X gregtech.api.covers.CoverRegistration   → private final gregtech.api.interfaces.ITexture coverTexture; public ITexture getCoverTexture();
```

The exporter walks `getCoverTexture(stack)` like any `ITexture`. Overlay icons such as `OVERLAY_CONVEYOR`, `OVERLAY_PUMP`, `OVERLAY_SHUTTER`, `OVERLAY_VALVE`, `OVERLAY_ARM` are `BlockIcons` fields (`iconsets/<NAME>.png`). `BaseMetaTileEntity.getTexture(Block, side)` already layers the cover of that side on top of the machine face (§3.5 A).

---

## 4. GT cables, wires, pipes and frames

These are `MetaPipeEntity` tiles (`BaseMetaPipeEntity` in the world). Their textures are material templates tinted with the material colour.

**Cables and wires** (`gregtech.api.metatileentity.implementations.MTECable`; fields `public final float mThickNess; public final Materials mMaterial; public final boolean mInsulated; public final long mAmperage, mVoltage`):

- Bare wire: `mMaterial.mIconSet.mTextures[IconType.WIRE]` tinted `Dyes.getModulation(colorIndex, mMaterial.mRGBa)` → `assets/gregtech/textures/blocks/materialicons/<SET>/wire.png` (falls back to `NONE/wire.png`; no standard set overrides it).
- Insulated cable, side not connected: `INSULATION_FULL` tinted with the insulation colour (`Dyes.CABLE_INSULATION`, default 64, 64, 64, or the paint colour).
- Insulated cable, connected side: wire texture (material colour) + an insulation ring chosen by thickness:

| `getThickness()` | layers |
|---|---|
| < 0.124 | `INSULATION_FULL` only |
| < 0.374 | wire + `INSULATION_TINY` |
| < 0.499 | wire + `INSULATION_SMALL` |
| < 0.624 | wire + `INSULATION_MEDIUM` |
| < 0.749 | wire + `INSULATION_MEDIUM_PLUS` |
| < 0.874 | wire + `INSULATION_LARGE` |
| otherwise | wire + `INSULATION_HUGE` |

```
$ J -p -c -constants -cp X gregtech.api.metatileentity.implementations.MTECable | sed -n '/public ...ITexture\[\] getTexture(/,+240p' | grep -o 'float [0-9.]*f\|INSULATION_[A-Z_]*'
  float 0.124f INSULATION_FULL float 0.374f INSULATION_TINY float 0.499f INSULATION_SMALL float 0.624f INSULATION_MEDIUM
  float 0.749f INSULATION_MEDIUM_PLUS float 0.874f INSULATION_LARGE INSULATION_HUGE INSULATION_FULL
  (first branch: getfield mInsulated ... ifne 47 ... IconType.WIRE ... Materials.mRGBa ... Dyes.getModulation ... TextureFactory.of)
$ J ... gregtech.api.enums.Dyes | sed -n '/getModulation(int, short\[\])/,/areturn/p'  → isDyeIndex(i) ? VALUES[i].mRGBa : default
```

Note the signature differs from MTEs: `getTexture(IGregTechTileEntity, ForgeDirection side, int connections, int colorIndex, boolean connected, boolean redstone)`.

**Item and fluid pipes** (`MTEItemPipe`, `MTEFluidPipe`): `mMaterial.mIconSet.mTextures[OrePrefixes.pipe<Size>.getTextureIndex()]` tinted with the material colour; the size comes from the pipe's thickness (thresholds 0.124 / 0.374 / 0.499 / 0.749 seen in `MTEItemPipe`). Restrictive item pipes add `PIPE_RESTRICTOR`. Fluid pipes also handle multi-pipes (`mPipeAmount`, quadruple/nonuple) and input-disable borders (`MTEFluidPipe$Border`).

| prefix | texture index | file under `blocks/materialicons/<SET>/` |
|---|---|---|
| `pipe` (side of every pipe) | 77 | `pipeSide.png` |
| `pipeTiny` / `pipeSmall` / `pipeMedium` / `pipeLarge` / `pipeHuge` | 78 / 79 / 80 / 81 / 82 | `pipeTiny.png` … `pipeHuge.png` |
| `pipeQuadruple` / `pipeNonuple` | 84 / 85 | `pipeQuadruple.png` / `pipeNonuple.png` |
| `frameGt` (frame boxes) | 83 | `frameGt.png` |
| `block` (storage blocks) | 71–76 | `block1.png` … `block6.png` |

```
$ J -p -c -constants -cp X gregtech.api.metatileentity.implementations.MTEItemPipe | sed -n '/getTexture(/,+60p'
  getfield mIsRestrictive ... getThickness ... ldc float 0.124f ... OrePrefixes.pipe ... getTextureIndex ... Dyes.getModulation ... BlockIcons.PIPE_RESTRICTOR
$ (OrePrefixes builder parse) pipe 77 PIPE_SIDE /pipeSide, pipeTiny 78, pipeSmall 79, pipeMedium 80, pipeLarge 81, pipeHuge 82, pipeQuadruple 84, pipeNonuple 85, frameGt 83, block 71
$ unzip -l $GT | grep 'blocks/materialicons/NONE/'
  block1..6.png blockCasing.png blockCasingAdvanced.png foil.png frameGt.png ore.png oreSmall.png pipeHuge.png pipeLarge.png pipeMedium.png
  pipeNonuple.png pipeQuadruple.png pipeSide.png pipeSmall.png pipeTiny.png sheetmetal.png wire.png
$ unzip -l $GT | grep 'blocks/materialicons/METALLIC/'   → ore.png oreSmall.png oreSmall_OVERLAY.png ore_OVERLAY.png sheetmetal.png
```

So in practice cables, pipes and frames almost always draw the `NONE` templates tinted with the material colour; the per-set block folders mostly differ in ore textures.

---

## 5. Other blocks the map and 3D view need

These mods choose icons in client-only code, so the planner needs a small curated table per mod. The names below are taken from their `registerBlockIcons`/`getIcon` bytecode.

### 5.1 Storage Drawers (`StorageDrawers-2.2.31-GTNH`)

- Blocks (registry names from `core/ModBlocks`): `StorageDrawers:fullDrawers1`, `fullDrawers2`, `fullDrawers4`, `halfDrawers2`, `halfDrawers4`, `compDrawers`, `controller`, `controllerSlave`, `trim`, `framingTable`, and the framed variants `fullCustom1/2/4`, `halfCustom2/4`, `trimCustom`. Tile entities: `StorageDrawers:tileDrawersStandard`, `tileDrawersComp`, `tileController`, `tileControllerSlave`.
- Wood drawers: block **metadata** = wood index into `BlockWood.field_150096_a` = `oak, spruce, birch, jungle, acacia, big_oak` (vanilla server jar `aom.a`). Textures `StorageDrawers:drawers_<wood>_{front_1, front_2, front_4, side, side_h, side_v, trim, sort}` → `assets/storagedrawers/textures/blocks/drawers_<wood>_….png`. `front_1/2/4` by the block's drawer count; half-depth blocks use `side_h`/`side_v` on the shortened faces; the front face is the tile entity's direction (`TileEntityDrawers.getDirection()`).
- Upgrade overlays: `overlay_<material>{,_h,_v,_trim}.png` for `diamond, emerald, gold, iron, obsidian, ruby, tanzanite`; status icons under `indicator/`, framed-drawer layers under `base/` and `overlay/`.
- Compacting drawer: `drawers_comp_front_<0..2>[_ind[1..6]]`, `drawers_comp_side`, `drawers_comp_side_2`, `drawers_comp_trim`, `drawers_comp_sort`.
- Controller: front `drawers_controller_front`, sides `drawers_comp_side` (and `drawers_comp_side_2` "etched"), trim `drawers_comp_trim`. Controller slave: `drawers_comp_side`, `drawers_comp_side_2`.
- `block_config.mcmeta` (not an animation; drawer geometry): `trimWidth 0.0625`, `trimDepth 0.0625`, indicator positions per block.

```
$ J -p -c -constants -cp X com.jaquadro.minecraft.storagedrawers.block.BlockDrawers | sed -n '/func_149651_a(...IIconRegister)/,...'
  getstatic BlockWood.field_150096_a ... ldc String StorageDrawers:drawers_ ... ldc String _front_1 ... IIconRegister.func_94245_a ...
$ J ... block.BlockController   → StorageDrawers:drawers_controller_front, StorageDrawers:drawers_comp_side, ..._comp_side_2, ..._comp_trim
$ J ... block.BlockSlave        → StorageDrawers:drawers_comp_side, StorageDrawers:drawers_comp_side_2
$ J ... block.BlockDrawers  func_149673_e(IBlockAccess,...) → func_72805_g (getBlockMetadata) ... iconSide ... TileEntityDrawers.getDirection ... drawerCount ... iconFront1/2/4 ... halfDepth ... iconSideH/iconSideV ... iconOverlay/H/V
$ J -p -c -constants -cp $SJAR aom | sed -n '/static {};/,$p' | grep String  → oak spruce birch jungle acacia big_oak
$ J -p -c -constants -cp X com.jaquadro.minecraft.storagedrawers.core.ModBlocks | grep -B2 registerBlock
  ldc String fullDrawers1 ... GameRegistry.registerBlock ... String controller ... String controller ... registerBlock ... String controllerSlave ... registerBlock
  ... String tileDrawersStandard ... registerTileEntityWithAlternatives ... String tileController ... String tileControllerSlave ...
$ unzip -p $MODS/StorageDrawers-2.2.31-GTNH.jar assets/storagedrawers/textures/blocks/block_config.mcmeta → {"fullDrawers1": {"trimWidth": 0.0625, ...
```

The jar also ships the same layout for the add-on domains `storagedrawersbop`, `storagedrawersforestry`, `storagedrawersmisc`, `storagedrawersnatura`, `storagedrawerserebus` (other wood types).

### 5.2 JABBA barrels (`JABBA-1.5.23`)

- Level-0 (wooden) barrel: `JABBA:barrel_side_0`, `barrel_top_0`, `barrel_label_0`, `barrel_labeltop_0` → `assets/jabba/textures/blocks/barrel_*_0.png` (32 px; 16 px copies under `blocks/16px/`). Overlays: `JABBA:overlay_locked`, `overlay_linked`, `overlay_lockedlinked`; side upgrades `JABBA:facade_hopper`, `facade_redstone`.
- Higher structural levels are **generated at runtime**; no PNG exists. `StructuralLevelClientData` reads `JABBA:barrel_{label,top,side}_border`, `…_background`, `barrel_top_label`, `capaupg_base`, `capaupg_color` and builds `AccessibleTextureAtlasSprite`s. The jar's own notes give the algorithm: average colour of the tier's material (non-transparent pixels), "Grain Merge" it onto the grey `*_border` texture, then overlay the non-transparent pixels of `*_background`; text colour by YIQ `(R*299 + G*587 + B*114)/1000 >= 128 ? black : white`. Tier materials: `Ore.plankWood`, `Ore.ingotIron`, `Ore.ingotGold`, `Ore.gemDiamond`, `Ore.obsidian`, `Ore.whiteStone`, `Ore.gemEmerald`, … (`StructuralLevel` strings).
  ```
  $ unzip -p $MODS/JABBA-1.5.23.jar 'assets/jabba/textures/notes for texture pack artists.txt'
    "JABBA dynamically creates textures for the barrels and items during runtime ... The textures that are colored by code are the
     border pieces(eg: barrel_side_border.png) ... 1) find the material used for each tier ... and get it's average color
     2) "Grain Merge" that color onto the base texture ... 4) Overlay the other pieces ..."
  $ J -p -c -constants -cp X mcp.mobius.betterbarrels.client.StructuralLevelClientData | grep 'String JABBA'
    JABBA:barrel_label_border  JABBA:barrel_label_background  JABBA:barrel_top_border ... JABBA:barrel_side_ (+ level)
  ```
  The "grain merge" formula is not in the notes; GIMP's grain merge is `base + overlay − 128` per channel, clamped (**UNVERIFIED** as JABBA's exact code). Which NBT key holds the level is a world-format question (a scan sample shows `structural` and `coreUpgrades` keys; see `world-format.md`).
- JABBA has no block per tier: one block registered as `barrel` (`JABBA:barrel`; unlocalized name `blockbarrel`), all state in the tile entity `TileEntityBarrel` (`BetterBarrels`: `ldc String barrel` → `GameRegistry.registerBlock`; `ldc String TileEntityBarrel` → `GameRegistry.registerTileEntity`).

### 5.3 Iron Chests (`IronChest-6.1.13`, Alkalus fork)

- In-world chests are drawn by a tile-entity renderer with a chest **model texture**: `ironchest:textures/model/<file>` (`TileEntityIronChestRenderer` builds `"textures/model/"` + the type's model file). The block icons `ironchest:<type>_{front,side,top}` (`assets/ironchest/textures/blocks/…`, registered in `IronChestType.makeIcons`) exist too (inventory/particles); the STEEL type reuses `silver_{front,side,top}`.
- Block metadata = `IronChestType.VALUES[meta]` (`BlockIronChest.getIcon` indexes `IronChestType.VALUES` with the meta). Tile entity ids are `"IronChest." + type.name()` (`IronChest` class: `ldc String IronChest.` … `IronChestType.name()` … `GameRegistry.registerTileEntityWithAlternatives`), so the world's tile entity id alone also gives the type.

| meta | type | model texture |
|---|---|---|
| 0 | IRON | `ironchest.png` |
| 1 | GOLD | `goldchest.png` |
| 2 | DIAMOND | `diamondchest.png` |
| 3 | COPPER | `copperchest.png` |
| 4 | STEEL | `silverchest.png` |
| 5 | CRYSTAL | `crystalchest.png` |
| 6 | OBSIDIAN | `obsidianchest.png` |
| 7 | DIRTCHEST9000 | `dirtchest.png` |
| 8 | NETHERITE | `netheritechest.png` |
| 9 | DARKSTEEL | `darksteelchest.png` |
| 10 | SILVER | `silverchest.png` |
| — | WOOD (upgrade source only) | — |

```
$ (IronChestType static-init parse) {"args": ["IRON", 0, 54, 9, 2, "Iron Chest", "ironchest.png", ...]} {"args": ["GOLD", 1, 81, 9, 4, "Gold Chest", "goldchest.png", ...]} ...
$ J -p -c -constants -cp X cpw.mods.ironchest.IronChestType | sed -n '/public void makeIcons/,/return$/p'
  name() ... ldc String steel ... equalsIgnoreCase ... ldc String ironchest:silver_%s ... (else) ldc String ironchest:%s_%s ... String top / front / side
$ J -p -c -constants -cp X cpw.mods.ironchest.client.TileEntityIronChestRenderer | grep -E 'String |getModelTexture|ResourceLocation'
  40: ldc_w String ironchest   50: ldc_w String textures/model/   58: IronChestType.getModelTexture   67: ResourceLocation."<init>"(String, String)
$ J ... BlockIronChest func_149691_a(int,int): getstatic IronChestType.VALUES ... aaload ... IronChestType.getIcon(I)
```

The model geometry is the vanilla chest model (lid + base); its UV layout follows vanilla's 64×64 chest texture (**UNVERIFIED** that every GTNH iron-chest PNG uses the same layout).

### 5.4 Project Red routed pipes (`ProjRed-4.12.44-GTNH`, Forge Multipart parts)

Pipes are multipart parts inside `savedMultipart` tile entities; each part has an `id`. `mrtjp.projectred.transportation.PipeDefs$` maps part ids to texture names, and `PipeVal.registerIcon` prefixes them with `projectred:mechanical/pipes/` → `assets/projectred/textures/blocks/mechanical/pipes/<name>.png`:

| part id | textures |
|---|---|
| `pr_pipe` (basic, unrouted) | `basic`, `rs` |
| `pr_rbasic` (routed junction) | `routedjunc`, `routed`, `unrouted`, `routedconn`, `unroutedconn` |
| `pr_rinterface` | `routedint` |
| `pr_rcrafting` | `routedcrafting` |
| `pr_rrequest` | `routedrequest` |
| `pr_rextension` | `routedextension` |
| `pr_rfire` (firewall) | `routedfire` |
| `pr_pt` (pressure tube) | `pressuretube`, `colour/colour_0..15` |
| `pr_rpt` (resistance tube) | `resistancetube` |
| `pr_netvalve` | `netvalve_blocked`, `netvalve_in`, `netvalve_out`, `netvalve_inout` |
| `pr_netlatency` | `netlatency` |

```
$ J -p -c -constants -cp X 'mrtjp.projectred.transportation.PipeDefs$' | grep -E 'String |putfield'
  String pr_pipe ... String basic ... String rs ... putfield BASIC ... String pr_rbasic ... String routedjunc ... routed ... unrouted ... routedconn ... unroutedconn
  ... String pr_rinterface ... String routedint ... String pr_rrequest ... String routedrequest ... String pr_pt ... String pressuretube ... RichInt.to (colour 0..15) ...
$ J -p -c -constants -cp X 'mrtjp.projectred.transportation.PipeDefs$PipeVal$$anonfun$registerIcon$1' | grep String → projectred:mechanical/pipes/
```

Geometry: the pipe core is a cube from 0.25 to 0.75 on every axis (`PipeBoxes$`: `new Cuboid6(0.5-0.25, 0.5-0.25, 0.5-0.25, 0.5+0.25, 0.5+0.25, 0.5+0.25)`), with arms toward connected sides (`oBounds[0..5]`). The pipe model itself is drawn in code (`RenderPipe$`).

### 5.5 EnderIO conduits (`EnderIO-2.10.46`)

Conduits live in `blockConduitBundleTileEntity` tile entities; each conduit is stored with its class name (a scan sample shows `conduits[].conduitType = "crazypants.enderio.conduit.item.ItemConduit"`). Texture keys are constants in each conduit class (`enderio:` domain, block atlas → `assets/enderio/textures/blocks/<name>.png`):

| class | keys |
|---|---|
| `crazypants.enderio.conduit.item.ItemConduit` | `ICON_KEY = enderio:itemConduit`, `ICON_KEY_CORE = enderio:itemConduitCore` (animated), `ICON_KEY_CORE_ADV = enderio:itemConduitCoreAdvanced`, `ICON_KEY_INPUT = enderio:itemConduitInput`, `ICON_KEY_OUTPUT = enderio:itemConduitOutput`, `ICON_KEY_IN_OUT_OUT/_IN = enderio:itemConduitInOut_Out/_In`, `ICON_KEY_IN_OUT_BG = enderio:itemConduitIoConnector` |
| `…conduit.power.PowerConduit` | `enderio:powerConduit` + postfix, `enderio:powerConduitCore` + postfix, `enderio:powerConduitInput`/`Output` (+ postfix); `POSTFIX = {"", "Enhanced", "Ender"}` |
| `…conduit.power.endergy.PowerConduitEndergy` | the remaining `powerConduit[Core]<Tier>` files in the jar (`Crude`, `Iron`, `Aluminum`, `Gold`, `Copper`, `Silver`, `Electrum`, `EnergeticSilver`, `Crystalline`, `CrystallinePinkSlime`, `Melodic`, `Stellar`); the class contains at least `Crude` and `Stellar` (per-tier mapping **UNVERIFIED**) |
| `…conduit.liquid.*` | `enderio:liquidConduit*` (Advanced, Ender, CrystallineEnder, Melodic, Stellar, …) |
| redstone, ME, gas, OC conduits | `redstoneConduit*`, `redstoneInsulatedConduit*`, `meConduit*`, `gasConduit*`, `ocConduit*` |
| bundle | `conduitConnector`, `conduitConnectorExternal`, `conduitFacade` |

```
$ J -p -constants -cp X crazypants.enderio.conduit.item.ItemConduit | grep 'static final java.lang.String'
  ICON_KEY = "enderio:itemConduit"; ICON_KEY_CORE = "enderio:itemConduitCore"; ... ICON_KEY_IN_OUT_BG = "enderio:itemConduitIoConnector";
$ J -p -c -constants -cp X crazypants.enderio.conduit.power.PowerConduit | sed -n '/static {};/,$p' | grep String → (empty) | Enhanced | Ender  (POSTFIX)
$ python3 -I jargrep.py $MODS/EnderIO-2.10.46.jar Crude Stellar | grep conduit → ...power/endergy/PowerConduitEndergy.class ['Crude', 'Stellar']
```

Facades (`facadeId`, `facadeMeta` in the bundle NBT) make the bundle look like another block.

### 5.6 Applied Energistics 2 (`appliedenergistics2-rv3-beta-1073-GTNH`)

- Cable-bus part textures are the enum `appeng.client.texture.CableBusTextures`; each constant registers `"appliedenergistics2:" + name` → `assets/appliedenergistics2/textures/blocks/<name>.png`. Families: `MECable_<Colour>` (glass cable), `MECovered_<Colour>`, `MESmart_<Colour>`, `MEDense_<Colour>`, `MEDenseCovered_<Colour>` (16 colours each, AE names: `Black, Blue, Brown, Cyan, Gray→Grey, Green, LightBlue, LightGray→LightGrey, Lime, Magenta, Orange, Pink, Purple, Red, White, Yellow`), smart-cable channel lights `MECableSmart00..04, 10..14`, part sides/backs `PartMonitorSides`, `PartStorageSides`, `PartExportSides`, `PartImportSides`, `PartTunnelSides`, terminal screens `Part*Term_{Bright,Colored,Dark}`.
- Item-style part textures `ItemPart.<Part>.png` (e.g. `ItemPart.CableGlass`, `ItemPart.Interface`, `ItemPart.StorageBus`, `ItemPart.ExportBus`). Uncoloured (fluix) cables probably use these (**UNVERIFIED**).
- Blocks: `BlockInterface.png` (+ `BlockInterfaceAlternate*.png`), `BlockController*.png` (+ `controller/BlockControllerColumnPowered_<Colour>.png`, animated `*Lights.png.mcmeta`), `BlockDrive{,Front,Side,Bottom}.png`.

```
$ (CableBusTextures static-init parse) MECable 16 ['MECable_Green', 'MECable_Grey', 'MECable_LightBlue', ...] MEDense 16 ... MESmart 16 ... MECovered 16 ...
$ J -p -c -constants -cp X appeng.client.texture.CableBusTextures | grep -A10 'public void registerIcon' → String appliedenergistics2: ... Field name
```

### 5.7 Vanilla blocks

- From the 1.7.10 client jar, `assets/minecraft/textures/blocks/<name>.png` with vanilla names (`stone`, `cobblestone`, `planks_<wood>`, `log_<wood>`, `log_<wood>_top`, `glass`, `wool_colored_<colour>`, …). Mods do not override them except `sponge.png` (§2.2).
- The vanilla chest is a tile-entity model: `textures/entity/chest/normal.png`, `normal_double.png`, `trapped*.png`, `christmas*.png` (strings in `TileEntityChestRenderer`, obf `bmm`), `ender.png` for ender chests.
  ```
  $ J -p -c -constants -cp "$CJAR" bmm | grep 'String textures' → textures/entity/chest/trapped_double.png ... normal_double.png ... normal.png
  ```
- Block id/meta → texture for vanilla is a fixed table; write it by hand for the blocks the map and ghosts need, or take it from a client-side dump (§6.5).

---

## 6. Item and fluid icons

### 6.1 GT material items (`gregtech:gt.metaitem.01/02/03`)

**Decomposition.** These items extend `MetaGeneratedItemX32` (offset 32000, 766 extra items). For `meta < 32000`: prefix = `mGeneratedPrefixList[meta / 1000]`, material = `GregTechAPI.sGeneratedMaterials[meta % 1000]` (index = `Materials.mMetaItemSubID`). Icon = `material.mIconSet.mTextures[prefix.getTextureIndex()]`; colour = `material.mRGBa`.

```
$ J -p -c -constants -cp X gregtech.api.items.MetaGeneratedItemX32
  public MetaGeneratedItemX32(String, OrePrefixes...): ... sipush 32000 ... sipush 766 ... MetaGeneratedItem."<init>" ... bipush 32 Arrays.copyOf ... putfield mGeneratedPrefixList
  getIconContainer(int, Materials): getOrePrefix(meta) ... OrePrefixes.getTextureIndex ... Materials.mIconSet ... TextureSet.mTextures ... aaload
  getRGBa(ItemStack): ... Materials.isMaterialItem ... GregTechAPI.sGeneratedMaterials ... sipush 1000 irem ... Materials.mRGBa
```

Prefix lists (index = `meta / 1000`; parsed from each constructor, `null`/placeholder slots omitted), with the icon suffix each prefix uses:

```
gt.metaitem.01: 0 dustTiny, 1 dustSmall, 2 dust, 3 dustImpure, 4 dustPure, 5 crushed, 6 crushedPurified, 7 crushedCentrifuged, 8 gem,
                9 nugget, 11 ingot, 12 ingotHot, 17 plate, 18 plateDouble, 19 plateTriple, 20 plateQuadruple, 21 plateQuintuple,
                22 plateDense, 23 stick, 24 lens, 25 round, 26 bolt, 27 screw, 28 ring, 29 foil, 30 cell, 31 cellPlasma
gt.metaitem.02: 5 toolHeadHammer, 6 toolHeadFile, 7 toolHeadSaw, 8 toolHeadDrill, 9 toolHeadChainsaw, 10 toolHeadWrench, 15 toolHeadBuzzSaw,
                16 turbineBlade, 18 itemCasing (→ /casingSmall), 19 wireFine, 20 gearGtSmall, 21 rotor, 22 stickLong, 23 springSmall,
                24 spring, 27 gemChipped, 28 gemFlawed, 29 gemFlawless, 30 gemExquisite, 31 gearGt
gt.metaitem.03: 4 nanite (→ /nanites), 5 rawOre (→ /oreRaw), 6 plateSuperdense
(other suffixes equal the prefix name; cellMolten and cellPlasma both use index 31 /cellPlasma)
$ J -p -c -constants -cp X gregtech.common.items.MetaGeneratedItem01 | sed -n '/MetaGeneratedItem01();/,/invokespecial .*MetaGeneratedItemX32/p'
   1: ldc String metaitem.01 ... 9: iconst_0 10: getstatic OrePrefixes.dustTiny ... 73: bipush 10 75: aconst_null ... 78: bipush 11 80: getstatic OrePrefixes.ingot ...
```

Example check: iron ingot is `gt.metaitem.01` meta 11032 (= 11·1000 + iron's id 32), i.e. prefix `ingot`.

**Icon types and files.** `MaterialIconRegistry$IconType` (ordinal = texture index) gives a suffix and an atlas (ITEM, BLOCK, BLOCK_WITH_ALPHA); `/void` slots are empty. Non-void entries:

```
0 /dustTiny 1 /dustSmall 2 /dust 3 /dustImpure 4 /dustPure 5 /crushed 6 /crushedPurified 7 /crushedCentrifuged 8 /gem 9 /nugget 10 /casingSmall
11 /ingot 12 /ingotHot 17 /plate 18 /plateDouble 19 /plateTriple 20 /plateQuadruple 21 /plateQuintuple 22 /plateDense 23 /stick 24 /lens
25 /round 26 /bolt 27 /screw 28 /ring 29 /foil 30 /cell 31 /cellPlasma 37 /toolHeadHammer 38 /toolHeadFile 39 /toolHeadSaw 40 /toolHeadDrill
41 /toolHeadChainsaw 42 /toolHeadWrench 47 /toolHeadScrewdriver 48 /toolHeadBuzzSaw 49 /toolHeadSoldering 50 /nanites 51 /wireFine
52 /gearGtSmall 53 /rotor 54 /stickLong 55 /springSmall 56 /spring 57 /arrowGtWood 58 /arrowGtPlastic 59 /gemChipped 60 /gemFlawed
61 /gemFlawless 62 /gemExquisite 63 /gearGt 64 /oreRaw | BLOCK_WITH_ALPHA: 67 /oreSmall 68 /ore | BLOCK: 69 /wire 70 /foil 71-76 /block1-6
77 /pipeSide 78 /pipeTiny 79 /pipeSmall 80 /pipeMedium 81 /pipeLarge 82 /pipeHuge 83 /frameGt 84 /pipeQuadruple 85 /pipeNonuple 86 /sheetmetal
| ITEM: 96 /crateGtDust 97 /crateGtIngot 98 /crateGtGem 99 /crateGtPlate 100 /turbineBlade 125 /plateSuperdense 126 /handleMallet ... 157 /toolProspectorElectricUHV
$ (IconType static-init parse) 0 DUST_TINY /dustTiny ITEM; ... 67 ORE_SMALL /oreSmall BLOCK_WITH_ALPHA; 68 ORE /ore BLOCK_WITH_ALPHA; 69 WIRE /wire BLOCK; ...
```

`TextureSet(name)` creates, per non-void type, `Textures.ItemIcons.textureSet(domain, set, suffix)` (ITEM), `Textures.BlockIcons.textureSet(...)` (BLOCK) or `Textures.BlockIcons.customAlpha(domain, "materialicons/" + set + suffix)` (BLOCK_WITH_ALPHA). The icon-name builder is `"materialicons/" + set + suffix`, and the overlay adds `"_OVERLAY"`:

```
$ J -p -c -constants -cp X gregtech.api.enums.TextureSet | sed -n '/public gregtech.api.enums.TextureSet(java.lang.String);/,/return$/p'
  ldc String /void ... Textures$GlobalIcons.VOID ... tableswitch { 1: 120, 2: 148, 3: 179 }
  120: ... Textures$BlockIcons.textureSet   148: ... jvmdowngrader$concat$$init$$1 ("materialicons/" + set + suffix) ... Textures$BlockIcons.customAlpha   179: ... Textures$ItemIcons.textureSet
$ J -p -c -constants -cp X 'gregtech.api.enums.TextureSet$1'   → TextureType.BLOCK → 1, BLOCK_WITH_ALPHA → 2, ITEM → 3
$ J -p -c -constants -cp X gregtech.client.iconContainers.items.GTTextureSetItemIconContainer | grep -A12 'jvmdowngrader'
  $$init$$1: ... String _OVERLAY        createIconName$1: String materialicons/ ... append(set) append(suffix)
  constructor: createIconName(set, suffix) ... ldc String NONE ... createIconName("NONE", suffix) ... getCompleteItemTextureResourceLocation
```

So the files are `assets/gregtech/textures/items/materialicons/<SET>/<suffix>.png` and `<suffix>_OVERLAY.png` (blocks: `…/textures/blocks/materialicons/…`).

**Fallback rule** (`registerResourceOrFallback` and `run(IIconRegister)`, client-side; the build script must replicate it with an "exists in the extracted index" check):

1. base = `<SET>/<suffix>` if it exists (OVERRIDE), else `NONE/<suffix>` if it exists (FALLBACK), else invisible.
2. overlay = `<SET>/<suffix>_OVERLAY` (OVERRIDE), else `NONE/<suffix>_OVERLAY` (FALLBACK), else invisible.
3. base OVERRIDE + overlay FALLBACK → overlay is dropped; base FALLBACK + overlay OVERRIDE → base is dropped; both invisible → GT's `RENDERING_ERROR` overlay.

```
$ J -p -c -constants -cp X gregtech.client.iconContainers.items.GTTextureSetItemIconContainer | sed -n '/registerResourceOrFallback/,/areturn/p'
   1: invokestatic ResourceUtils.resourceExists ... TextureSetIconType.OVERRIDE ... 23: resourceExists ... TextureSetIconType.FALLBACK ... INVISIBLE_ICON, TextureSetIconType.INVISIBLE
$ ... private void run(IIconRegister): ... OVERRIDE if_acmpne ... FALLBACK ... putfield mOverlay = INVISIBLE_ICON ... FALLBACK ... OVERRIDE ... putfield mIcon = INVISIBLE_ICON ... GlobalIcons.RENDERING_ERROR
```

Most sets contain only a few files and lean on `NONE` (item files per set: NONE 144, METALLIC 22, SHINY 31, DULL 11, …). Example: a METALLIC ingot draws `METALLIC/ingot.png` with no overlay; a METALLIC gear draws `NONE/gearGt.png`.

**Sets.** 30 standard sets use the folder `materialicons/<NAME>/`: NONE, DULL, RUBY, OPAL, LEAF, WOOD, SAND, FINE, FIERY, FLUID, ROUGH, PAPER, GLASS, FLINT, LAPIS, SHINY, SHARDS, POWDER, QUARTZ, EMERALD, DIAMOND, LIGNITE, MAGNETIC, METALLIC, NETHERSTAR, GEM_VERTICAL, GEM_HORIZONTAL, REFINED, GEM_A, NUCLEAR. 54 custom sets use `materialicons/CUSTOM/<name>/` (`TextureSet(String, boolean)` prefixes `"CUSTOM/"`): darksteel, energetic, vibrant, …, infinity, spacetime, universium, eternity, magmatter, … . `TextureSet.withCustomTextures(name, IconType...)` (used in `MaterialsInit` for a few materials, e.g. their ORE/ORE_SMALL/ORE_RAW icons) makes a derived set whose listed types come from `CUSTOM/<name>/` and the rest from the parent; so read the per-type containers, not just `mSetName`.

```
$ (TextureSet static-init parse) plain sets 30 ['NONE', 'DULL', ...] custom sets 54 ['darksteel', ...]
$ J -p -c -constants -cp X gregtech.api.enums.TextureSet | grep -A8 'jvmdowngrader$concat$$init$$1(java.lang.String);'  → String CUSTOM/
$ python3 -I jargrep.py $GT withCustomTextures → gregtech/loaders/materials/MaterialsInit.class
```

**Drawing** (`GeneratedMaterialRenderer.renderItem`): base icon tinted by `getRGBa` **unless the item contains a fluid**; then, for fluid cells, the fluid's still icon tinted by `Fluid.getColor(stack)` drawn with `glDepthFunc(GL_EQUAL)` (clipped to the base's opaque pixels); then the overlay untinted (`glColor3f(1,1,1)`).

```
$ J -p -c -constants -cp X gregtech.common.render.items.GeneratedMaterialRenderer | sed -n '...renderItem...'
   94: invokestatic GTUtility.getFluidForFilledItem ... 130: aload 10 132: ifnonnull 139 135: iconst_1 ... 139: iconst_0 ... 143: renderRegularItem(type, stack, icon, shouldColor, pass, ...)
  203: fconst_1 204: fconst_1 205: fconst_1 206: glColor3f ... 223: renderItemOverlay
  renderContainedFluid: Fluid.getColor(FluidStack) ... /255 ... glColor3f ... sipush 514 glDepthFunc ... ItemRenderUtil.renderItem ... sipush 515 glDepthFunc
```

Materials with `Materials.renderer != null` (Infinity, Universium, Cosmic Neutronium, Spacetime, rainbow/glitch effects; classes in `gregtech.common.render.items`) are animated or shader-drawn in game; the static composite is an approximation.

**Server-side export of colours and sets.** `Materials` has no `SideOnly` members: `public final short[] mRGBa`, `public TextureSet mIconSet`, `public String mName`, `public int mMetaItemSubID`, `public String mDefaultLocalName`, `public GeneratedMaterialRenderer renderer`. `TextureSet`: `public final IIconContainer[] mTextures`, `public final String mSetName`. `MaterialIconRegistry$IconType`: `public final String suffix`, `public final TextureType texture`, `VALUES`. For each material and type, export the container's four `ResourceLocation` fields (§3.5 A table) and the RGB.

Other GT-family material items:

- **GT++** `gtPlusPlus.core.item.base.BaseItemComponent` registers `Textures.ItemIcons.textureSetWithRegister(GregTech domain, <material set name or METALLIC>, "/" + oreDictPrefix, …)` → same `materialicons` templates; colour from `gtPlusPlus.core.material.Material.getRGBA()`, set from `getTextureSet()`.
- **BartWorks** `bartworks.system.material.BWMetaGeneratedItems` (`gt.bwMetaGenerated<prefix>`, meta = Werkstoff id): colour `Werkstoff.getRGBA()`, set `Werkstoff.getTexSet()`, but the icon goes through `getIconContainerBartWorks`, which on the client first checks `bartworks.client.textures.PrefixTextureLinker.texMap` for BartWorks' own prefix textures. Using the GT template for BartWorks items is therefore an approximation (**UNVERIFIED** which prefixes BartWorks overrides).

### 6.2 GT non-material meta items (circuits, components, …)

For `meta >= 32000` the icon is `gregtech:<unlocalizedName>/<meta − 32000>` (plus `/<k>` sub-icons for charge levels of electric items) → `assets/gregtech/textures/items/gt.metaitem.01/<n>.png` and `…/<n>/<k>.png`. No tint.

```
$ J -p -c -constants -cp X gregtech.api.items.MetaGeneratedItem | sed -n '/public final void func_94581_a/,/return$/p'
  ... GTConfig.troll ... ldc String troll ... func_77658_a (getUnlocalizedName) ... jvmdowngrader$concat$registerIcons$1:(String, short, byte) ... Mods.getResourcePath ... registerIcon
  concat helpers: unlocalizedName + "/" + index [+ "/" + k]
$ unzip -l $GT | grep 'items/gt.metaitem.01/' | head → 0.png 1.png 10.png 100.png ... 145/1.png ... 145/8.png
```

Some of these paths also exist in `GTNewHorizonsCoreMod-2.9.76.jar` with different content (§2.2).

### 6.3 Fluids

- **GT fluids** are `gregtech.common.fluid.GTFluid extends net.minecraftforge.fluids.Fluid`, with plain fields `private final ResourceLocation stillIconResourceLocation, flowingIconResourceLocation`, `private final short[] colorRGBA`, `private final Fluid iconsFrom` and `public int getColor()`. `GTFluidBuilder.withTextureName(name)` sets both locations to `new ResourceLocation("gregtech", "fluids/fluid." + name)`; `run()` (client) registers them on the **block** atlas. So the file is `assets/gregtech/textures/blocks/fluids/fluid.<name>.png` (+ `.mcmeta`, usually animated). Material fluids use generic grey templates tinted with the fluid colour: `fluid.autogenerated` (liquids, 16×512, frametime 2), `fluid.molten.autogenerated`, `fluid.plasma.autogenerated` (string constants in `GTProxy`, `LoaderGTBlockFluid`, BartWorks `WerkstoffLoader`). When `iconsFrom` is set, the fluid borrows another fluid's icons.
  ```
  $ J -p -cp X gregtech.common.fluid.GTFluid
    public class gregtech.common.fluid.GTFluid extends net.minecraftforge.fluids.Fluid ...
    private final net.minecraft.util.ResourceLocation stillIconResourceLocation; ... private final short[] colorRGBA; ... public int getColor();
  $ J -p -c -constants -cp X gregtech.common.fluid.GTFluidBuilder | sed -n '/withTextureName/,/areturn/p'
    getstatic Mods.GregTech ... getfield Mods.ID ... jvmdowngrader$concat$withTextureName$1 (String fluids/fluid.) ... ResourceLocation."<init>"(String,String) ... putfield stillIconResourceLocation ... putfield flowingIconResourceLocation
  $ J -p -v -cp X gregtech.common.fluid.GTFluid | grep -c SideOnly → 0
  ```
- **Other fluids**: `Fluid.getColor()` is common code; the still/flowing icons are assigned client-side (texture-stitch events), so their names are not available on a dedicated server. Use the NEI dump (its item panel shows fluids through NEI's own display item, below) or draw a colour swatch.

### 6.4 Non-GT items and blocks on the server

- If `Item.iconString` (`field_111218_cA`) or `Block.textureName` (`field_149768_d`) is set, map it with §2.1 (`items` atlas for items, `blocks` atlas for blocks and `ItemBlock`s). This is right for simple items/blocks only (§2.3: 748 classes in the pack call the two setters, while 2,646 classes override the client-only icon registration).
- Everything meta- or state-dependent needs a curated table, the NEI dump, or a client-side exporter (prior-art.md §1.2: the NESQL forks and `gtnh-calc-oracle` render icons in a client).

### 6.5 One-time client-side dumps (alternative / complement)

All of this runs in a GTNH **client**. Do it in a **copy** of the client instance (Prism: copy instance), in an offline single-player creative world, never in the live client while people play. Disable extra resource packs in the copy unless the planner should show them.

#### 6.5.1 NEI item-panel dump (NEI `2.8.145-GTNH`; same jar in the server pack and the client)

- **Where:** NEI options → Tools → Data Dumps → "Item Panel". The mode button cycles CSV / NBT / Json / PNG; in PNG mode a second button sets the resolution; "Dump" writes the files.
  ```
  $ unzip -p $NEI assets/nei/lang/en_US.lang | grep itempanel
    nei.options.tools.dump.itempanel=Item Panel   ...mode.0=CSV  ...mode.1=NBT  ...mode.2=Json  ...mode.3=PNG
    nei.options.tools.dump.itempanel.icon.dumped=Item Panel icons were dumped to %s
    nei.options.tools.dump.itempanel.icon.warning.1=§cWARNING§r: You are about to dump %s items at %sx%s resolution
    nei.options.tools.dump.itempanel.icon.warning.2=Hold %s while clicking this button to proceed
  $ J -p -constants -cp X codechicken.nei.config.ItemPanelDumper → public static final int CSV = 0; NBT = 1; JSON = 2; PNG = 3;
  ```
- **Output:** `<instance>/.minecraft/dumps/itempanel.csv` / `.nbt` / `.json` and `<instance>/.minecraft/dumps/itempanel_icons/*.png`. The PNG folder is emptied first (`File.exists → listFiles → isFile → delete → mkdirs`).
  ```
  $ J -p -c -constants -cp X codechicken.nei.config.DataDumper | sed -n '/public void dumpFile();/,/return$/p'
    CommonUtils.getMinecraftDir ... ldc String dumps/ ... getfield name ... replaceFirst(".+\\.", "") ... getFileName ... (ItemPanelDumper: tools.dump.itempanel → itempanel + .csv/.nbt/.json)
  $ J -p -c -constants -cp X codechicken.nei.config.GuiItemIconDumper → ldc String dumps/itempanel_icons
  ```
- **Resolution:** `16 << n` px, reset to 16 if not smaller than the smaller screen dimension. When `items × res × res > 16,777,216` the button shows the warning and the dump only starts with **Shift** held.
  ```
  $ J -p -c -constants -cp X codechicken.nei.config.ItemPanelDumper | sed -n '/private boolean showItemSizeWarning();/,/ireturn/p'
    getRes ... ldc int 16777216 ... ItemPanel.getItems ... size ... iload_1 imul iload_1 imul ... if_icmple
  ... acknowledgedItemSizeWarning: showItemSizeWarning ... NEIClientUtils.shiftKey
  ... getRes: bipush 16 iload_1 ishl ... getSmallerScreenAxisSize if_icmpge ... setIntValue(0) bipush 16
  ```
- **Image content:** the items are drawn with `GuiContainerManager.drawItem` (the real item renderers, so GT tints, overlays, fluid cells and isometric machine blocks look as in NEI) on a `glClearColor(0,0,0,0)` background and read back as `GL_BGRA`/`GL_UNSIGNED_INT_8_8_8_8_REV` into a `TYPE_INT_ARGB` `BufferedImage`, so backgrounds are transparent.
- **File names:** `cleanFileName(stripFormatting(itemDisplayNameShort(stack))) + ".png"`; illegal characters `" < > |`, control characters 0–31, `: * ? \ /` become `_`; a name already taken gets `_2`, `_3`, … in list order.
  ```
  $ J -p -c -constants -cp X codechicken.nei.config.GuiItemIconDumper | sed -n '/private void exportImage/,/return$/p'
    GuiContainerManager.itemDisplayNameShort ... EnumChatFormatting.func_110646_a ... cleanFileName ... String .png ... File.exists ... bipush 95 ('_') ... iload 6 (counter from 2) ... ImageIO.write png
  ```
- **Mapping PNGs back to items:** both the PNG dump and the CSV/JSON dumps iterate the same list, `ItemPanels.itemPanel.getItems()`. The CSV columns are `Item Name` (registry name), `Item ID` (numeric, world-specific, ignore), `Item meta` (`InventoryUtils.actualDamage`), `Has NBT`, `Display Name` — and `Display Name` is the same `stripFormatting(itemDisplayNameShort(stack))` string the PNG names come from. So: dump CSV (or JSON for full NBT) and PNG in the same session without touching the search box, then walk the rows in order and replay the `_2`, `_3` collision rule to get each row's file. JSON mode writes one `ItemStack.writeToNBT` compound per line (minus `Count`), in the same order.
  ```
  $ J -p -c -constants -cp X codechicken.nei.config.ItemPanelDumper | sed -n '/dump(int)/,+60p'
    ItemPanels.itemPanel ... ItemPanel.getItems ... Item.field_150901_e (itemRegistry).func_148750_c (getNameForObject) ... Item.func_150891_b (getIdFromItem)
    ... InventoryUtils.actualDamage ... String false / String true ... GuiContainerManager.itemDisplayNameShort ... EnumChatFormatting.func_110646_a
    dumpJson: ... ItemStack.func_77955_b (writeToNBT) ... ldc String Count ... func_82580_o (removeTag) ... PrintWriter.println
  ```
- **Collapsed groups are skipped.** `ItemsPanelGrid.refresh` puts only the first item of a collapsed group into `realItems` (what `getItems()` returns); the rest go to `groupItems`. Expand all groups first (the item panel's "G" button, `nei.itempanel.collapsed.button.tip=Collapse/Expand All Collapsible Items`) and use an empty search.
  ```
  $ J -p -c -constants -cp X codechicken.nei.ItemsPanelGrid | sed -n '/public void refresh/,...'
    CollapsibleItems.getGroupIndex ... realItems.add ... CollapsibleItems.isExpanded ... groupItems.computeIfAbsent ... List.add
  ```
- **Fluids:** NEI registers its own display item `NotEnoughItems:neiFluidDisplay` (`GameRegistry.registerItem(item, "neiFluidDisplay")` in `codechicken.nei.ServerHandler`; unlocalized name `nei.fluidDisplay`, NBT carries the fluid), drawn by `codechicken.nei.item.FluidDisplayRenderer` (renderer registered in `codechicken.nei.api.ItemInfo` via `MinecraftForgeClient.registerItemRenderer`).
  ```
  $ J -p -c -constants -cp X codechicken.nei.ServerHandler | grep -E 'neiFluidDisplay|registerItem'
     7: ldc #93 // String neiFluidDisplay   9: invokestatic GameRegistry.registerItem:(Lnet/minecraft/item/Item;Ljava/lang/String;)V
  ```

  Whether the item panel lists fluids by default in this config is **UNVERIFIED** (NEI has a "Fluids" subset, `nei.subsets.Items.Fluids`); check by searching a fluid name before dumping.
- **Caveats:** display names are not unique (NBT variants, same names across mods), so always join by row order, never by name alone; animated and shader items are captured at one frame; the NESQL README warns that BugTorch makes enchanted items render blank, and BugTorch is in this pack (`bugtorch-1.3.1.jar`) — whether that also hits NEI's dump is **UNVERIFIED**; GTNH's large item list makes a full PNG dump take a while (not measured).

#### 6.5.2 Hodgepodge `/dumptextureatlas` (sprite list check)

`hodgepodge-2.7.211` (present in client and server packs) registers a client command `dumptextureatlas` unconditionally (`ClientCommandHandler.instance.registerCommand(new DumpTextureAtlasCommand())` in `HodgepodgeClient`). It copies the block and item atlases to `.minecraft/debug/<basePath>/atlas.png` and writes `allEntries.txt`, `emptyEntries.txt`, `erroredEntries.txt` with one line per registered sprite: `<resource location>: x=<originX>,y=<originY>,w=<width>,h=<height>` (resource location built with `%s/%s%s` + `.png`, i.e. the same path rule as §2.1).

```
$ J -p -c -constants -cp X com.mitchej123.hodgepodge.commands.DumpTextureAtlasCommand | grep -E 'String '
  String dumptextureatlas ... Copied both atlases to your /.minecraft/debug folder. ... field_94254_c / basePath ... field_110574_e / mapRegisteredSprites
  ... String debug ... String atlas.png ... allEntries.txt ... emptyEntries.txt ... erroredEntries.txt ... String %s/%s%s ... String .png
  formatLine: ResourceLocation.toString ... String : ... x= ... ,y= ... ,w= ... ,h=
$ J -p -c -constants -cp X com.mitchej123.hodgepodge.client.HodgepodgeClient | grep -B2 'DumpTextureAtlasCommand."<init>"'
  135: getstatic ClientCommandHandler.instance ... 156: invokespecial DumpTextureAtlasCommand."<init>" ... 159: ClientCommandHandler.func_71560_a (registerCommand)
```

Use: a one-time list of every sprite the client actually registered, including runtime-generated ones (JABBA structural barrels) and the resolved winner of duplicate paths after resource packs. It does not say which block/item uses which sprite.

---

## 7. Licensing — why we extract locally and never commit

| Assets | Licence (source) | Consequence |
|---|---|---|
| GregTech 5 Unofficial jar (incl. GT++, BartWorks, TecTech, …) | Repo licence LGPL-3.0 (`gh api repos/GTNewHorizons/GT5-Unofficial/license` → `LGPL-3.0`; README: "GT5-Unofficial is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License … version 3"). README "Attribution": "Some textures/ideas have been taken from future versions of GT and texture pack authors for GTNH. Credit goes to Jimbno for the UU-Tex texture pack …" and "Credit to EtVitki for the Spacetime material textures, adapted from their original work." | Contains third-party art whose own terms are not stated; do not redistribute. |
| Storage Drawers (GTNH fork) | LGPL-3.0 (`gh api repos/GTNewHorizons/StorageDrawers/license`) | Copyleft; keep out of our MIT repo. |
| JABBA | CC BY-NC-SA 4.0: jar `LICENSE.txt` "The current material is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International Public License … For any commercial usage, please contact me"; repo `LICENSE.txt` "License per https://www.curseforge.com/minecraft/mc-mods/jabba" | NC + ShareAlike: incompatible with committing into an MIT repo. |
| Iron Chests (GTNH fork) | GPL-3.0 (`LICENSE.txt`: "Copyright (c) 2016-2021 - Alkalus … GNU GENERAL PUBLIC LICENSE Version 3") | Copyleft. |
| Project Red (GTNH fork) | MIT (`LICENSE.md`: "MIT License Copyright (c) 2023 MrTJP, ChickenBones, covers1624") | Permissive, but still not ours to bundle without notice; no need to commit. |
| EnderIO (GTNH fork) | `LICENSE.txt`: "GTNH Modifications: LGPL v3.0 or later … Original License: This is free and unencumbered software released into the public domain." | Mixed. |
| AE2 (GTNH fork) | README: API MIT, code LGPLv3, "Textures and Models — (c) 2013 - 2015 AlgorithmX2 et al — CC BY-NC-SA 3.0" | NC + ShareAlike for textures. |
| NEI | LGPL-3.0 (`mcmod.info` `"license": "LGPL-3.0"`; GitHub API) | A PNG dump is a render of other mods' assets, so it carries their licences. |
| Forge Multipart | "licensed under the GNU LGPL v2.1 or later" (`LICENSE.txt`) | — |
| Minecraft vanilla textures | Minecraft EULA (`https://www.minecraft.net/en-us/eula`): "you must not distribute anything we've made unless we specifically agree to it. By "distribute anything we've made" what we mean is: give copies of our game software or content to anyone else; make commercial use of anything we've made; try to make money from anything we've made; …" | Never ship vanilla PNGs; read them from the user's own client jar or download from Mojang on the user's machine. |
| Client resource packs (UU-Tex, Modernity, …) | Their own licences | Same rule if a dump captures them. |

Policy for the repo (design §3.12 already says this; this is the texture-specific version):

1. The repo holds code, mapping tables of **names** (e.g. `drawers_<wood>_front_1`, `basicmachines/<x>/OVERLAY_FRONT`), and schemas — no PNG, no atlas, no NEI/Hodgepodge dump, no base64 copies.
2. `extract-assets` writes into a gitignored folder (for example `data/assets/`) on the machine that has the pack; the app serves it only to the group behind the shared password. Add the folder to `.gitignore` before the first extraction and add a CI/pre-commit check that rejects `*.png` under data paths.
3. Users who clone the repo run the extraction against their own pack and their own client jar.

(Not legal advice; NC terms suggest also keeping the hosted app non-commercial and private, which matches the design.)

---

## 8. Recommended pipeline for the planner

1. **`extract-assets` (build step, Node or Python, no game).**
   - Inputs: `mods/*.jar` from the server pack, the 1.7.10 client jar (path given by the user, or downloaded from Mojang and checked against sha1 `e80d9b3bf5085002218d4be59e668bac718abbc6`).
   - For every `assets/<domain>/textures/(blocks|items)/**.png` (+ `.png.mcmeta`): record `{domain, atlas, path, jar, width, height, frames, mcmeta}` in `textures-index.json` and copy the bytes into the gitignored cache. Order: vanilla first, then mod jars; log the 37 conflicting paths and keep all copies until a preferred source is chosen.
   - Read only through `zipfile`/`unzip -p`; never write into the pack.
2. **Export mod on the server copy** (same run as the recipe export) writes `textures.json`:
   - `materials`: id, name, `mRGBa`, set name, and for each icon type the four resource paths of its container.
   - `metaItems`: for each `MetaGeneratedItemX32` item, its `mGeneratedPrefixList` with texture indices; for `≥ 32000` metas, the item's unlocalized name.
   - `mte`: per id, the face layers from §3.5 A (inactive and active), plus class name and `mTier`.
   - `casings`: `casingTexturePages` entries (`page`, `idx`, block registry name, meta).
   - `covers`: cover item → layers.
   - `fluids`: name, `getColor()`, and for `GTFluid` the still/flowing resource paths.
   - `simpleNames`: registry name → `textureName` / `iconString` where non-null.
3. **Resolver in the app** (shared by map, 3D view, block list, icons):
   - name → path (§2.1) → cache file; GT texture-set fallback (§6.1); tint = RGB multiply, glow layers unlit, overlays untinted; animated textures from `.mcmeta`.
   - curated tables for §5 blocks; vanilla table for the blocks the map needs.
   - 2D icons: GT material/meta items composed from templates; others from the NEI dump if present; else a block's isometric preview from its faces; else plain colour by kind.
4. **Optional one-time client step** (manual, on a client copy): NEI CSV + JSON + PNG dumps (expand groups, empty search, resource packs off), then a join script → `icons/<registry>@<meta>[#nbt-hash].png` in the cache. Optionally `/dumptextureatlas` to verify the resolver's sprite names.
5. **Fallbacks and reporting:** every unresolved face/icon is logged in an export report with its reason, and drawn in the plain colour of its machine kind.

---

## 9. Open items and UNVERIFIED points

- **Exporter calls without a world** (§3.5 A): `new BaseMetaTileEntity()` + `setInitialValuesAsNBT(null, id)` + `getTexture(Block, side)` is assembled from signatures and bytecode, not run. Some MTE classes may need `worldObj`; test on the server copy and log failures.
- **Reflection on icon containers** server-side: fields exist and the classes have no `SideOnly`, but reading them on a dedicated server was not executed.
- **Mod resource-pack order** for the 37 conflicting texture paths (§2.2) was not determined per pair.
- **NEI**: whether fluids appear in the item panel by default; whether BugTorch affects the PNG dump; time and disk size of a full dump.
- **JABBA** grain-merge formula; **AE2** uncoloured-cable texture; **Iron Chests** model UV layout; **BartWorks** prefix textures (`PrefixTextureLinker`); **Angelica** interpolation formula.
- **Storage Drawers** tile entity `Dir` value → face mapping (a world-format question).
- **Side-dependent casing metas** (§3.7 B) need a hand check if the static parser is used.
- The versioned classes under `META-INF/versions/17|21` of the GT jar were not compared with the base classes that were disassembled.

package io.github.drukoz.gtnhplanner.export.textures;

import static org.junit.jupiter.api.Assertions.*;
import com.google.gson.stream.JsonWriter;
import java.io.StringWriter;
import java.util.Arrays;
import java.util.Collections;
import org.junit.jupiter.api.Test;

class TextureFlattenerTest {
    // Stand-ins: same simple names and field names as GT's classes.
    static final class FakeLocation { final String d, p; FakeLocation(String d, String p) { this.d = d; this.p = p; } }
    static final class FakeBlock { final String name; FakeBlock(String n) { name = n; } }
    static class GTBlockIconContainer { final String mIconName = "x"; final Object iconResource; GTBlockIconContainer(String path) { iconResource = path == null ? null : new FakeLocation("gregtech", path); } }
    static final class GTOptionalBlockIconContainer extends GTBlockIconContainer { GTOptionalBlockIconContainer(String p) { super(p); } }
    static final class GTCustomBlockIconContainer { final Object iconResource, overlayResource; GTCustomBlockIconContainer(Object i, Object o) { iconResource = i; overlayResource = o; } }
    static final class GTCustomAlphaFallbackBlockIconContainer { final Object iconResource, overlayResource, fallback; GTCustomAlphaFallbackBlockIconContainer(Object i, Object o, Object f) { iconResource = i; overlayResource = o; fallback = f; } }
    static final class GTTextureSetItemIconContainer { final Object iconResource, iconFallbackResource, iconOverlayResource, iconOverlayFallbackResource;
        GTTextureSetItemIconContainer(String set, String suffix) { iconResource = loc(set, suffix); iconFallbackResource = loc("NONE", suffix); iconOverlayResource = loc(set, suffix + "_OVERLAY"); iconOverlayFallbackResource = loc("NONE", suffix + "_OVERLAY"); }
        static FakeLocation loc(String set, String s) { return new FakeLocation("gregtech", "textures/items/materialicons/" + set + "/" + s + ".png"); } }
    static final class InvisibleIcon {}
    static final class CustomIcon { final String mIconName, mModID; CustomIcon(String n, String m) { mIconName = n; mModID = m; } }
    static final class GTRenderedTexture { final Object mIconContainer; final short[] mRGBa; final boolean glow; GTRenderedTexture(Object c, short[] rgba, boolean g) { mIconContainer = c; mRGBa = rgba; glow = g; } }
    static final class GTMultiTextureRender { final Object[] mTextures; GTMultiTextureRender(Object... t) { mTextures = t; } }
    static final class GTSidedTextureRender { final Object[] mTextures; final short[] mRGBa = { 255, 255, 255, 0 }; GTSidedTextureRender(Object... t) { mTextures = t; } }
    static final class GTCopiedBlockTextureRender { final Object mBlock; final byte mSide; final int mMeta; GTCopiedBlockTextureRender(Object b, int s, int m) { mBlock = b; mSide = (byte) s; mMeta = m; } }

    static final TextureEnv ENV = new TextureEnv() {
        public String[] resource(Object o) { return o instanceof FakeLocation ? new String[] { ((FakeLocation) o).d, ((FakeLocation) o).p } : null; }
        public String blockName(Object b) { return b instanceof FakeBlock ? ((FakeBlock) b).name : null; }
    };
    static final String SIDE = "textures/blocks/iconsets/MACHINE_LV_SIDE.png", FRONT = "textures/blocks/basicmachines/macerator/OVERLAY_FRONT.png";
    static final short[] WHITE = { 255, 255, 255, 0 };
    static LayerRec p(String path, int[] rgb, boolean glow) { return LayerRec.paths(Collections.singletonList("gregtech/" + path), rgb, glow); }
    static GTRenderedTexture tex(String path) { return new GTRenderedTexture(new GTBlockIconContainer(path), WHITE, false); }

    @Test void renderedAndMultiTextures() {
        TextureFlattener f = new TextureFlattener(ENV);
        assertEquals(Collections.singletonList(p(SIDE, null, false)), f.flatten(tex(SIDE), 2));
        Object multi = new GTMultiTextureRender(tex(SIDE), new GTRenderedTexture(new GTOptionalBlockIconContainer(FRONT), new short[] { 200, 100, 50, 0 }, true));
        assertEquals(Arrays.asList(p(SIDE, null, false), p(FRONT, new int[] { 200, 100, 50 }, true)), f.flatten(multi, 2));
        assertEquals(Collections.singletonList(p(SIDE, null, false)), f.flatten(new Object[] { null, tex(SIDE) }, 0));
    }

    @Test void sidedAndCopiedTextures() {
        TextureFlattener f = new TextureFlattener(ENV);
        Object sided = new GTSidedTextureRender(tex("textures/blocks/iconsets/B.png"), tex("textures/blocks/iconsets/T.png"), tex(SIDE), tex(SIDE), tex(SIDE), tex(SIDE));
        assertEquals(Collections.singletonList(p("textures/blocks/iconsets/T.png", null, false)), f.flatten(sided, 1));
        FakeBlock casings2 = new FakeBlock("gregtech:gt.blockcasings2");
        assertEquals(Collections.singletonList(LayerRec.copy("gregtech:gt.blockcasings2", 0, 4)), f.flatten(new GTCopiedBlockTextureRender(casings2, 6, 0), 4));
        assertEquals(Collections.singletonList(LayerRec.copy("gregtech:gt.blockcasings2", 0, 1)), f.flatten(new GTCopiedBlockTextureRender(casings2, 1, 0), 4));
    }

    @Test void iconContainers() {
        TextureFlattener f = new TextureFlattener(ENV);
        String m = "gregtech/textures/items/materialicons/";
        assertEquals(Collections.singletonList(LayerRec.textureSet(m + "METALLIC/ingot.png", m + "NONE/ingot.png", m + "METALLIC/ingot_OVERLAY.png", m + "NONE/ingot_OVERLAY.png", new int[] { 200, 200, 200 })),
            f.container(new GTTextureSetItemIconContainer("METALLIC", "ingot"), new int[] { 200, 200, 200 }, false));
        FakeLocation a = new FakeLocation("gregtech", "textures/blocks/a.png"), b = new FakeLocation("gregtech", "textures/blocks/b.png");
        assertEquals(Arrays.asList(LayerRec.paths(Collections.singletonList("gregtech/textures/blocks/a.png"), null, false), LayerRec.paths(Collections.singletonList("gregtech/textures/blocks/b.png"), null, false)),
            f.container(new GTCustomBlockIconContainer(a, b), null, false));
        assertEquals(Collections.singletonList(LayerRec.paths(Arrays.asList("gregtech/textures/blocks/a.png", "gregtech/" + SIDE), null, false)),
            f.container(new GTCustomAlphaFallbackBlockIconContainer(a, null, new GTBlockIconContainer(SIDE)), null, false));
        assertEquals(Collections.singletonList(LayerRec.paths(Collections.singletonList("miscutils/textures/blocks/TileEntities/MACHINE_CASING_X.png"), null, false)),
            f.container(new CustomIcon("TileEntities/MACHINE_CASING_X", "miscutils"), null, false));
        assertEquals(Collections.emptyList(), f.container(new InvisibleIcon(), null, false));
        assertEquals(Collections.emptyList(), f.container(new GTBlockIconContainer("textures/blocks/iconsets/VOID.png"), null, false));
    }

    @Test void unknownClassesBecomeErrors() {
        TextureFlattener f = new TextureFlattener(ENV);
        assertEquals(Collections.singletonList(LayerRec.error("java.lang.Object")), f.flatten(new Object(), 0));
        assertEquals(Collections.singletonMap("java.lang.Object", 1), f.unknownClasses());
    }

    @Test void writesTheWireFormat() throws Exception {
        assertEquals("{\"p\":[\"a.png\",\"b.png\"],\"rgb\":[1,2,3],\"glow\":1}", json(LayerRec.paths(Arrays.asList("a.png", "b.png"), new int[] { 1, 2, 3 }, true)));
        assertEquals("{\"ts\":[\"a\",\"b\",\"\",\"\"]}", json(LayerRec.textureSet("a", "b", null, null, null)));
        assertEquals("{\"copy\":[\"gregtech:gt.blockcasings2\",0,4]}", json(LayerRec.copy("gregtech:gt.blockcasings2", 0, 4)));
        assertEquals("{\"err\":\"x.Y\"}", json(LayerRec.error("x.Y")));
    }
    static String json(LayerRec r) throws Exception { StringWriter s = new StringWriter(); JsonWriter w = new JsonWriter(s); r.write(w); w.flush(); return s.toString(); }

    // Beyond the plan's cases: GT's VOID / RENDERING_ERROR are Textures$GlobalIcons constants, and broken trees never throw.
    enum GlobalIcons { RENDERING_ERROR, VOID }
    static final class Broken { static final class GTRenderedTexture {}
        static final class GTCustomAlphaFallbackBlockIconContainer { final Object iconResource = new FakeLocation("gregtech", "textures/blocks/a.png"); } }

    @Test void globalIconsDrawNothing() {
        TextureFlattener f = new TextureFlattener(ENV);
        assertEquals(Collections.emptyList(), f.container(GlobalIcons.VOID, null, false));
        assertEquals(Collections.emptyList(), f.flatten(new GTRenderedTexture(GlobalIcons.RENDERING_ERROR, WHITE, false), 0));
        assertEquals(Collections.emptyMap(), f.unknownClasses());
    }

    @Test void unreadableTreesBecomeErrorsWithoutThrowing() {
        TextureFlattener f = new TextureFlattener(ENV);
        assertEquals(Collections.emptyList(), f.flatten(null, 0));
        String broken = Broken.GTRenderedTexture.class.getName(), multi = GTMultiTextureRender.class.getName();
        assertEquals(Collections.singletonList(LayerRec.error(broken)), f.flatten(new Broken.GTRenderedTexture(), 0));
        Object[] loop = new Object[1];
        loop[0] = new GTMultiTextureRender(loop);
        assertEquals(Collections.singletonList(LayerRec.error(multi)), f.flatten(loop[0], 0));
        TextureEnv throwing = new TextureEnv() {
            public String[] resource(Object o) { throw new IllegalStateException("boom"); }
            public String blockName(Object b) { throw new IllegalStateException("boom"); }
        };
        TextureFlattener t = new TextureFlattener(throwing);
        assertEquals(Collections.singletonList(LayerRec.error(GTBlockIconContainer.class.getName())), t.flatten(tex(SIDE), 0));
        assertEquals(Collections.singletonList(LayerRec.error(GTCopiedBlockTextureRender.class.getName())), t.flatten(new GTCopiedBlockTextureRender(new FakeBlock("b"), 6, 0), 0));
        assertEquals(Collections.singletonList(LayerRec.copy(null, 0, 2)), f.flatten(new GTCopiedBlockTextureRender(new Object(), 6, 0), 2));
        assertEquals(Collections.singletonList(LayerRec.paths(Collections.singletonList("gregtech/" + SIDE), null, false)), f.flatten(new GTSidedTextureRender(new GTBlockIconContainer(SIDE)), 0));
        assertEquals(Collections.singletonList(LayerRec.error(GTSidedTextureRender.class.getName())), f.flatten(new GTSidedTextureRender(tex(SIDE)), 3));
        assertEquals(Collections.singletonList(LayerRec.paths(Collections.singletonList("gregtech/textures/blocks/a.png"), null, false)), f.container(new Broken.GTCustomAlphaFallbackBlockIconContainer(), null, false));
        assertEquals(3, f.unknownClasses().size());
    }
}

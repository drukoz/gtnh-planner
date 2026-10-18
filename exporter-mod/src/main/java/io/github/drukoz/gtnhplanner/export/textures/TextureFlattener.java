package io.github.drukoz.gtnhplanner.export.textures;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Turns a GT {@code ITexture} tree (or one icon container) into the flat layer list of the texture dump (research
 * §3.5 A). GT's classes are recognised by simple class name and read by reflection, so this class needs neither GT nor
 * Minecraft, and stand-ins with the same simple and field names test it.
 *
 * <p>
 * The first simple name on the object's class chain that a rule knows decides: {@code GTMultiTextureRender} (each of
 * {@code mTextures}), {@code GTSidedTextureRender} ({@code mTextures[side]}), {@code GTRenderedTexture} (its
 * {@code mIconContainer}, tint and glow), {@code GTCopiedBlockTextureRender} / {@code GTCopiedCTMBlockTexture} (a copy
 * of another block's face), {@code GTTextureSet*} (a texture set), {@code GTCustomAlphaFallbackBlockIconContainer},
 * {@code GTCustom*}, and {@code InvisibleIcon} / {@code GlobalIcons} (GT's VOID and RENDERING_ERROR: nothing). Other
 * objects are read by field: {@code iconResource}, else a {@code String mIconName} (GT++ {@code CustomIcon}). An
 * object no rule can read, or one that is missing a field its rule needs, becomes an error layer and is counted in
 * {@link #unknownClasses()}.
 */
public final class TextureFlattener {

    private static final String ATLAS = "blocks", DEFAULT_MOD = "gregtech";
    /** GT draws its render side when a copied texture's {@code mSide} is 6. */
    private static final int RENDER_SIDE = 6;
    /** {@link #container} has no render side. */
    private static final int NO_SIDE = -1;
    /** Deeper than any real GT tree; stops a texture that contains itself. */
    private static final int MAX_DEPTH = 16;
    /** A field that is absent or could not be read. */
    private static final Object MISSING = new Object();

    private enum Kind {
        MULTI,
        SIDED,
        RENDERED,
        COPIED,
        TEXTURE_SET,
        ALPHA_FALLBACK,
        CUSTOM,
        NOTHING,
        /** No name rule: read by field. */
        OTHER
    }

    private final TextureEnv env;
    private final Map<Class<?>, Kind> kinds = new HashMap<>();
    /** Per class: field name → the accessible field, or null when it has none. */
    private final Map<Class<?>, Map<String, Field>> fields = new HashMap<>();
    private final Map<String, Integer> unknown = new HashMap<>();

    public TextureFlattener(TextureEnv env) {
        this.env = env;
    }

    /** The layers of an {@code ITexture}, an {@code ITexture[]} or null, drawn on side 0..5. Never throws. */
    public List<LayerRec> flatten(Object texture, int side) {
        List<LayerRec> out = new ArrayList<>();
        add(texture, side, null, false, out, 0);
        return out;
    }

    /** The layers of one icon container with tint {@code rgb} (null = untinted) and glow. Never throws. */
    public List<LayerRec> container(Object iconContainer, int[] rgb, boolean glow) {
        List<LayerRec> out = new ArrayList<>();
        add(iconContainer, NO_SIDE, rgb, glow, out, 0);
        return out;
    }

    /** Class name → how many error layers it gave so far, sorted by name. */
    public Map<String, Integer> unknownClasses() {
        return Collections.unmodifiableMap(new TreeMap<>(unknown));
    }

    /** Appends the layers of {@code o}; an object either adds all its layers or one error layer. */
    private void add(Object o, int side, int[] rgb, boolean glow, List<LayerRec> out, int depth) {
        if (o == null) return;
        if (depth > MAX_DEPTH) {
            error(o, out);
            return;
        }
        int start = out.size();
        try {
            if (!read(o, side, rgb, glow, out, depth)) error(o, out);
        } catch (RuntimeException | LinkageError e) {
            out.subList(start, out.size())
                .clear();
            error(o, out);
        }
    }

    /** False when no rule can read {@code o} or a field its rule needs is missing. */
    private boolean read(Object o, int side, int[] rgb, boolean glow, List<LayerRec> out, int depth) {
        if (o instanceof Object[]) {
            for (Object e : (Object[]) o) add(e, side, rgb, glow, out, depth + 1);
            return true;
        }
        switch (kind(o.getClass())) {
            case MULTI: {
                Object textures = field(o, "mTextures");
                if (!(textures instanceof Object[])) return false;
                for (Object t : (Object[]) textures) add(t, side, null, false, out, depth + 1);
                return true;
            }
            case SIDED: {
                Object textures = field(o, "mTextures");
                if (!(textures instanceof Object[]) || side < 0 || side >= ((Object[]) textures).length) return false;
                Object t = ((Object[]) textures)[side];
                if (isTexture(t)) add(t, side, null, false, out, depth + 1);
                else add(t, side, rgb(field(o, "mRGBa")), false, out, depth + 1);
                return true;
            }
            case RENDERED: {
                Object icon = field(o, "mIconContainer");
                if (icon == MISSING) return false;
                add(icon, side, rgb(field(o, "mRGBa")), Boolean.TRUE.equals(field(o, "glow")), out, depth + 1);
                return true;
            }
            case COPIED: {
                Object block = field(o, "mBlock"), meta = field(o, "mMeta"), copySide = field(o, "mSide");
                if (block == MISSING || !(meta instanceof Number) || !(copySide instanceof Number)) return false;
                int s = ((Number) copySide).intValue() == RENDER_SIDE ? side : ((Number) copySide).intValue();
                if (s < 0 || s >= RENDER_SIDE) return false;
                out.add(LayerRec.copy(env.blockName(block), ((Number) meta).intValue(), s));
                return true;
            }
            case TEXTURE_SET: {
                Object base = field(o, "iconResource");
                if (base == MISSING) return false;
                String[] ts = { path(base), path(field(o, "iconFallbackResource")),
                    path(field(o, "iconOverlayResource")), path(field(o, "iconOverlayFallbackResource")) };
                if (ts[0] != null || ts[1] != null || ts[2] != null || ts[3] != null)
                    out.add(LayerRec.textureSet(ts[0], ts[1], ts[2], ts[3], rgb));
                return true;
            }
            case ALPHA_FALLBACK: {
                Object base = field(o, "iconResource");
                if (base == MISSING) return false;
                List<String> candidates = new ArrayList<>();
                addPath(candidates, path(base));
                Object fallbackContainer = field(o, "fallback");
                List<LayerRec> fallback = new ArrayList<>();
                if (fallbackContainer != MISSING) add(fallbackContainer, side, null, false, fallback, depth + 1);
                if (!fallback.isEmpty()) {
                    LayerRec fallbackBase = fallback.get(0);
                    candidates.addAll(fallbackBase.baseCandidates());
                }
                pathsLayer(candidates, rgb, glow, out);
                pathsLayer(Collections.singletonList(path(field(o, "overlayResource"))), null, glow, out);
                return true;
            }
            case CUSTOM: {
                Object base = field(o, "iconResource");
                if (base == MISSING) return false;
                pathsLayer(Collections.singletonList(path(base)), rgb, glow, out);
                pathsLayer(Collections.singletonList(path(field(o, "overlayResource"))), null, glow, out);
                return true;
            }
            case NOTHING:
                return true;
            default:
                return readByField(o, rgb, glow, out);
        }
    }

    /** Objects without a name rule: {@code iconResource}, else a {@code String mIconName} (+ {@code mModID}). */
    private boolean readByField(Object o, int[] rgb, boolean glow, List<LayerRec> out) {
        Object resource = field(o, "iconResource");
        if (resource != MISSING) {
            pathsLayer(Collections.singletonList(path(resource)), rgb, glow, out);
            return true;
        }
        Field iconName = field(o.getClass(), "mIconName");
        Object name = iconName == null || iconName.getType() != String.class ? MISSING : field(o, "mIconName");
        if (name == MISSING) return false;
        if (name != null) {
            Object mod = field(o, "mModID");
            String modId = mod instanceof String ? (String) mod : DEFAULT_MOD;
            String path = dropped(TexturePaths.fromIconName(modId + ":" + name, ATLAS));
            pathsLayer(Collections.singletonList(path), rgb, glow, out);
        }
        return true;
    }

    private void error(Object o, List<LayerRec> out) {
        String className = o.getClass()
            .getName();
        out.add(LayerRec.error(className));
        Integer seen = unknown.get(className);
        unknown.put(className, seen == null ? 1 : seen + 1);
    }

    /** A paths layer from the non-null candidates; nothing when none is left. */
    private static void pathsLayer(List<String> candidates, int[] rgb, boolean glow, List<LayerRec> out) {
        List<String> kept = new ArrayList<>();
        for (String c : candidates) addPath(kept, c);
        if (!kept.isEmpty()) out.add(LayerRec.paths(kept, rgb, glow));
    }

    private static void addPath(List<String> paths, String path) {
        if (path != null) paths.add(path);
    }

    /** A ResourceLocation → data/assets-relative path; null when it is not one, or it is VOID / RENDERING_ERROR. */
    private String path(Object resource) {
        if (resource == null || resource == MISSING) return null;
        String[] r = env.resource(resource);
        if (r == null || r.length < 2) return null;
        return dropped(TexturePaths.fromResource(r[0], r[1], ATLAS));
    }

    /** Null for null and for GT's "draw nothing" / "error mark" images. */
    private static String dropped(String path) {
        return path == null || path.endsWith("/VOID.png") || path.endsWith("/RENDERING_ERROR.png") ? null : path;
    }

    /** GT's {@code short[] mRGBa} → {r, g, b}; null (untinted) when absent or white (GT ignores alpha). */
    private static int[] rgb(Object rgba) {
        if (!(rgba instanceof short[])) return null;
        short[] a = (short[]) rgba;
        if (a.length < 3 || (a[0] == 255 && a[1] == 255 && a[2] == 255)) return null;
        return new int[] { a[0], a[1], a[2] };
    }

    private boolean isTexture(Object o) {
        if (o == null || o instanceof Object[]) return true;
        Kind k = kind(o.getClass());
        return k == Kind.MULTI || k == Kind.SIDED || k == Kind.RENDERED || k == Kind.COPIED;
    }

    private Kind kind(Class<?> c) {
        Kind k = kinds.get(c);
        if (k == null) {
            k = Kind.OTHER;
            for (Class<?> s = c; s != null && k == Kind.OTHER; s = s.getSuperclass()) k = kindOf(s.getSimpleName());
            kinds.put(c, k);
        }
        return k;
    }

    private static Kind kindOf(String simpleName) {
        switch (simpleName) {
            case "GTMultiTextureRender":
                return Kind.MULTI;
            case "GTSidedTextureRender":
                return Kind.SIDED;
            case "GTRenderedTexture":
                return Kind.RENDERED;
            case "GTCopiedBlockTextureRender":
            case "GTCopiedCTMBlockTexture":
                return Kind.COPIED;
            case "GTCustomAlphaFallbackBlockIconContainer":
                return Kind.ALPHA_FALLBACK;
            case "InvisibleIcon":
            case "GlobalIcons":
                return Kind.NOTHING;
            default:
                if (simpleName.startsWith("GTTextureSet")) return Kind.TEXTURE_SET;
                if (simpleName.startsWith("GTCustom")) return Kind.CUSTOM;
                return Kind.OTHER;
        }
    }

    /** The value of field {@code name} of {@code o}, or {@link #MISSING} when it has none or reading it failed. */
    private Object field(Object o, String name) {
        Field f = field(o.getClass(), name);
        if (f == null) return MISSING;
        try {
            return f.get(o);
        } catch (IllegalAccessException | RuntimeException e) {
            return MISSING;
        }
    }

    /** Field {@code name} declared on {@code c} or a superclass, made accessible once; null when there is none. */
    private Field field(Class<?> c, String name) {
        Map<String, Field> byName = fields.get(c);
        if (byName == null) {
            byName = new HashMap<>();
            fields.put(c, byName);
        }
        if (byName.containsKey(name)) return byName.get(name);
        Field found = null;
        for (Class<?> s = c; s != null && found == null; s = s.getSuperclass()) {
            try {
                found = s.getDeclaredField(name);
                found.setAccessible(true);
            } catch (NoSuchFieldException e) {
                // not declared here: look in the superclass
            } catch (RuntimeException | LinkageError e) {
                found = null; // cannot be made accessible (or its class cannot be read): counts as missing
                break;
            }
        }
        byName.put(name, found);
        return found;
    }
}

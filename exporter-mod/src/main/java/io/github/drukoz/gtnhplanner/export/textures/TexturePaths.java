package io.github.drukoz.gtnhplanner.export.textures;

import java.util.Locale;

/**
 * Where a texture lives under {@code data/assets/}: the jar entry {@code assets/<domain>/<path>} without its
 * {@code assets/} prefix, with the domain lower-cased as the game does before it looks a file up (research §2.1).
 * Paths stay case-sensitive. Plain strings only, so this is unit-tested without Minecraft.
 */
public final class TexturePaths {

    private static final String DEFAULT_DOMAIN = "minecraft";
    private static final String TEXTURES = "textures/";
    private static final String PNG = ".png";

    private TexturePaths() {}

    /**
     * ResourceLocation parts → data/assets-relative path; a path under "textures/" is a file (".png" added if
     * missing), anything else is an icon name on {@code atlas}. Null path → null. A null or empty domain is
     * {@code minecraft}, as in {@code new ResourceLocation(domain, path)}.
     */
    public static String fromResource(String domain, String path, String atlas) {
        if (path == null) return null;
        String d = domain(domain);
        if (path.startsWith(TEXTURES)) return d + "/" + (path.endsWith(PNG) ? path : path + PNG);
        return iconFile(d, path, atlas);
    }

    /**
     * "domain:name" → "&lt;lower-case domain&gt;/textures/&lt;atlas&gt;/&lt;name&gt;.png"; no or empty domain →
     * "minecraft" (research §2.1). The domain ends at the first {@code ':'}. Null name → null.
     */
    public static String fromIconName(String iconName, String atlas) {
        if (iconName == null) return null;
        int colon = iconName.indexOf(':');
        if (colon < 0) return iconFile(DEFAULT_DOMAIN, iconName, atlas);
        return iconFile(domain(iconName.substring(0, colon)), iconName.substring(colon + 1), atlas);
    }

    private static String domain(String domain) {
        return domain == null || domain.isEmpty() ? DEFAULT_DOMAIN : domain.toLowerCase(Locale.ROOT);
    }

    /** {@code TextureMap}'s {@code "%s/%s%s"} with base path {@code textures/<atlas>} and suffix {@code .png}. */
    private static String iconFile(String domain, String name, String atlas) {
        return domain + "/" + TEXTURES + atlas + "/" + name + PNG;
    }
}

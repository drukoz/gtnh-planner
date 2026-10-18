package io.github.drukoz.gtnhplanner.export.textures;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;

import net.minecraft.block.Block;
import net.minecraft.util.ResourceLocation;

import cpw.mods.fml.common.registry.GameData;

/**
 * {@link TextureEnv} over the real game: Minecraft's {@link ResourceLocation} and the block registry. Its members
 * are called directly, so reobfuscation renames them.
 */
final class McTextureEnv implements TextureEnv {

    private static final int BUFFER = 1 << 13;

    @Override
    public String[] resource(Object o) {
        if (!(o instanceof ResourceLocation)) return null;
        ResourceLocation r = (ResourceLocation) o;
        return new String[] { r.getResourceDomain(), r.getResourcePath() };
    }

    @Override
    public String blockName(Object block) {
        if (!(block instanceof Block)) return null;
        return GameData.getBlockRegistry()
            .getNameForObject(block);
    }

    /**
     * The raw class file of {@code c}, read through its class loader as {@code <internal name>.class}. On a dedicated
     * server these bytes still hold the client-only {@code getIcon} that FML strips from the loaded class. Null when
     * there is no class file (a bootstrap class, or a class generated at run time); a class file that cannot be read
     * throws {@link UncheckedIOException}.
     */
    static byte[] classBytes(Class<?> c) {
        ClassLoader loader = c.getClassLoader();
        if (loader == null) return null;
        String file = c.getName()
            .replace('.', '/') + ".class";
        try (InputStream in = loader.getResourceAsStream(file)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[BUFFER];
            for (int n; (n = in.read(buffer)) != -1;) out.write(buffer, 0, n);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read " + file, e);
        }
    }
}

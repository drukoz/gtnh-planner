package io.github.drukoz.gtnhplanner.export.textures;

/**
 * The two Minecraft types {@link TextureFlattener} has to read. The exporter implements it with the real
 * {@code ResourceLocation} and block registry (Task 6); tests use stand-ins, so the flattener itself needs no
 * Minecraft classes.
 */
public interface TextureEnv {

    /** {@code {domain, path}} when {@code o} is a {@code ResourceLocation}, else null. */
    String[] resource(Object o);

    /** The registry name (e.g. {@code gregtech:gt.blockcasings2}) when {@code block} is a {@code Block}, else null. */
    String blockName(Object block);
}

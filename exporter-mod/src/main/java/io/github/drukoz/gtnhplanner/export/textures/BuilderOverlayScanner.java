package io.github.drukoz.gtnhplanner.export.textures;

import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

/**
 * The overlay folder of every basic machine GT registers through {@code MTEBasicMachineWithRecipeBuilder}, read from
 * the class file that registers it (research §3.5 B). A dedicated server cannot tell it otherwise: the builder's
 * {@code MTEBasicMachineWithRecipe} constructor turns the folder name into textures, and {@code MTETieredMachineBlock}
 * keeps them only when {@code GT.isClientSide()}.
 *
 * <p>
 * In each method a chain reads {@code GETSTATIC MetaTileEntityIDs.<NAME>} … {@code builder(I)} …
 * {@code LDC "<OVERLAYS>"} {@code setOverlays(String)}; the overlays go to the last id read before them. When the int
 * passed to {@code builder(I)} is one of the method's parameters ({@code ILOAD} right before it), the method is a
 * helper: each call to it from the same class gives its overlays to the last id read before the call. Overlays that
 * are not a string constant, and chains without an id constant, are left out.
 */
public final class BuilderOverlayScanner {

    public static final String IDS = "gregtech/api/enums/MetaTileEntityIDs";
    public static final String BUILDER_OWNER = "gregtech/common/tileentities/machines/basic/MTEBasicMachineWithRecipeBuilder";
    /** Only class files holding this name can register a builder machine (a cheap test before parsing). */
    public static final String MARKER = "setOverlays";

    private static final String BUILDER = "builder", BUILDER_ARGS = "(I)", OVERLAYS_ARGS = "(Ljava/lang/String;)";

    private BuilderOverlayScanner() {}

    /** {@code MetaTileEntityIDs} constant name → overlays; empty for null bytes or a class without chains. */
    public static Map<String, String> scan(byte[] classBytes) {
        if (classBytes == null) return Collections.emptyMap();
        ClassNode node = new ClassNode();
        new ClassReader(classBytes).accept(node, ClassReader.SKIP_FRAMES | ClassReader.SKIP_DEBUG);
        Map<String, String> helpers = new HashMap<>();
        for (MethodNode m : node.methods) {
            String overlays = helperOverlays(m);
            if (overlays != null) helpers.put(m.name + m.desc, overlays);
        }
        Map<String, String> out = new LinkedHashMap<>();
        for (MethodNode m : node.methods) pair(m, node.name, helpers, out);
        return out;
    }

    /** The overlays of a chain whose id is a parameter of {@code m}; null when {@code m} has none. */
    private static String helperOverlays(MethodNode m) {
        boolean fromParameter = false;
        for (AbstractInsnNode insn = m.instructions.getFirst(); insn != null; insn = insn.getNext()) {
            if (isBuilder(insn)) fromParameter = isParameterLoad(previous(insn), m);
            else if (fromParameter && isSetOverlays(insn)) {
                String overlays = constant(previous(insn));
                if (overlays != null) return overlays;
            }
        }
        return null;
    }

    /** Walks {@code m}: direct chains and calls to helpers of class {@code owner} give overlays to the last id read. */
    private static void pair(MethodNode m, String owner, Map<String, String> helpers, Map<String, String> out) {
        String lastId = null;
        boolean fromParameter = false;
        for (AbstractInsnNode insn = m.instructions.getFirst(); insn != null; insn = insn.getNext()) {
            String overlays = null;
            if (insn.getOpcode() == Opcodes.GETSTATIC) {
                FieldInsnNode f = (FieldInsnNode) insn;
                if (f.owner.equals(IDS) && f.desc.equals("L" + IDS + ";")) lastId = f.name;
            } else if (isBuilder(insn)) {
                fromParameter = isParameterLoad(previous(insn), m);
            } else if (isSetOverlays(insn)) {
                if (!fromParameter) overlays = constant(previous(insn));
            } else if (insn.getOpcode() == Opcodes.INVOKESTATIC) {
                MethodInsnNode call = (MethodInsnNode) insn;
                if (call.owner.equals(owner)) overlays = helpers.get(call.name + call.desc);
            }
            if (overlays != null && lastId != null) {
                if (!out.containsKey(lastId)) out.put(lastId, overlays);
                lastId = null;
            }
        }
    }

    private static boolean isBuilder(AbstractInsnNode insn) {
        if (insn.getOpcode() != Opcodes.INVOKESTATIC) return false;
        MethodInsnNode call = (MethodInsnNode) insn;
        return call.owner.equals(BUILDER_OWNER) && call.name.equals(BUILDER) && call.desc.startsWith(BUILDER_ARGS);
    }

    private static boolean isSetOverlays(AbstractInsnNode insn) {
        if (!(insn instanceof MethodInsnNode)) return false;
        MethodInsnNode call = (MethodInsnNode) insn;
        return call.owner.startsWith(BUILDER_OWNER) && call.name.equals(MARKER) && call.desc.startsWith(OVERLAYS_ARGS);
    }

    /** {@code ILOAD} of one of {@code m}'s parameters (not of a local it stored itself). */
    private static boolean isParameterLoad(AbstractInsnNode insn, MethodNode m) {
        if (insn == null || insn.getOpcode() != Opcodes.ILOAD) return false;
        int slots = (Type.getArgumentsAndReturnSizes(m.desc) >> 2) - ((m.access & Opcodes.ACC_STATIC) != 0 ? 1 : 0);
        return ((VarInsnNode) insn).var < slots;
    }

    /** The string an {@code LDC} pushes; null for any other instruction. */
    private static String constant(AbstractInsnNode insn) {
        if (!(insn instanceof LdcInsnNode)) return null;
        Object cst = ((LdcInsnNode) insn).cst;
        return cst instanceof String ? (String) cst : null;
    }

    /** The instruction before {@code insn}, skipping labels, line numbers and frames. */
    private static AbstractInsnNode previous(AbstractInsnNode insn) {
        AbstractInsnNode p = insn.getPrevious();
        while (p != null && p.getOpcode() < 0) p = p.getPrevious();
        return p;
    }
}

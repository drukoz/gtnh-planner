package io.github.drukoz.gtnhplanner.export.textures;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.objectweb.asm.Opcodes.ACC_PUBLIC;
import static org.objectweb.asm.Opcodes.ACC_STATIC;
import static org.objectweb.asm.Opcodes.ALOAD;
import static org.objectweb.asm.Opcodes.GETFIELD;
import static org.objectweb.asm.Opcodes.GETSTATIC;
import static org.objectweb.asm.Opcodes.ILOAD;
import static org.objectweb.asm.Opcodes.INVOKEINTERFACE;
import static org.objectweb.asm.Opcodes.INVOKESTATIC;
import static org.objectweb.asm.Opcodes.ISTORE;
import static org.objectweb.asm.Opcodes.POP;
import static org.objectweb.asm.Opcodes.RETURN;
import static org.objectweb.asm.Opcodes.V1_8;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;

class BuilderOverlayScannerTest {

    static final String IDS = BuilderOverlayScanner.IDS;
    static final String BUILDER = BuilderOverlayScanner.BUILDER_OWNER;
    static final String STEP = BUILDER + "$NameStep";
    static final String OVERLAYS_STEP = BUILDER + "$OverlaysStep";
    static final String OPTIONAL_STEP = BUILDER + "$OptionalStep";
    static final String OWNER = "test/Loader";

    /** A class {@code test/Loader} with one static method per entry (name → descriptor and body). */
    static byte[] loader(Map<String, Object[]> methods) {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        cw.visit(V1_8, ACC_PUBLIC, OWNER, null, "java/lang/Object", null);
        for (Map.Entry<String, Object[]> m : methods.entrySet()) {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, m.getKey(), (String) m.getValue()[0], null, null);
            mv.visitCode();
            @SuppressWarnings("unchecked")
            Consumer<MethodVisitor> body = (Consumer<MethodVisitor>) m.getValue()[1];
            body.accept(mv);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }
        cw.visitEnd();
        return cw.toByteArray();
    }

    static Object[] method(String desc, Consumer<MethodVisitor> body) {
        return new Object[] { desc, body };
    }

    /** {@code MetaTileEntityIDs.<name>.ID} on the stack. */
    static void id(MethodVisitor mv, String name) {
        mv.visitFieldInsn(GETSTATIC, IDS, name, "L" + IDS + ";");
        mv.visitFieldInsn(GETFIELD, IDS, "ID", "I");
    }

    /** {@code builder(<int on the stack>)}, then {@code .setOverlays(<overlays>)} (null: a non-constant name). */
    static void chain(MethodVisitor mv, String overlays) {
        mv.visitMethodInsn(INVOKESTATIC, BUILDER, "builder", "(I)L" + STEP + ";", false);
        mv.visitInsn(POP);
        mv.visitInsn(org.objectweb.asm.Opcodes.ACONST_NULL); // the OverlaysStep, as far as the scanner cares
        if (overlays == null) mv.visitVarInsn(ALOAD, 0);
        else mv.visitLdcInsn(overlays);
        mv.visitMethodInsn(INVOKEINTERFACE, OVERLAYS_STEP, "setOverlays", "(Ljava/lang/String;)L" + OPTIONAL_STEP + ";", true);
        mv.visitInsn(POP);
    }

    @Test
    void pairsEachChainWithTheIdReadBeforeIt() {
        Map<String, Object[]> methods = new LinkedHashMap<>();
        methods.put("registerMacerator", method("()V", mv -> {
            id(mv, "MACERATOR_LV");
            chain(mv, "MACERATOR");
            id(mv, "MACERATOR_HV");
            chain(mv, "PULVERIZER");
        }));
        methods.put("registerOther", method("()V", mv -> {
            id(mv, "CENTRIFUGE_LV");
            chain(mv, "CENTRIFUGE");
        }));
        Map<String, String> expected = new LinkedHashMap<>();
        expected.put("MACERATOR_LV", "MACERATOR");
        expected.put("MACERATOR_HV", "PULVERIZER");
        expected.put("CENTRIFUGE_LV", "CENTRIFUGE");
        assertEquals(expected, BuilderOverlayScanner.scan(loader(methods)));
    }

    @Test
    void followsAHelperThatTakesTheIdAsAParameter() {
        Map<String, Object[]> methods = new LinkedHashMap<>();
        methods.put("run", method("()V", mv -> {
            id(mv, "SimpleDustWasher_LV");
            mv.visitLdcInsn("simplewasher.01.tier.06");
            mv.visitMethodInsn(INVOKESTATIC, OWNER, "registerWasher", "(ILjava/lang/String;)V", false);
            id(mv, "SimpleDustWasher_MV");
            mv.visitLdcInsn("simplewasher.01.tier.02");
            mv.visitMethodInsn(INVOKESTATIC, OWNER, "registerWasher", "(ILjava/lang/String;)V", false);
        }));
        methods.put("registerWasher", method("(ILjava/lang/String;)V", mv -> {
            mv.visitVarInsn(ILOAD, 0);
            chain(mv, "SIMPLE_WASHER");
        }));
        Map<String, String> expected = new LinkedHashMap<>();
        expected.put("SimpleDustWasher_LV", "SIMPLE_WASHER");
        expected.put("SimpleDustWasher_MV", "SIMPLE_WASHER");
        assertEquals(expected, BuilderOverlayScanner.scan(loader(methods)));
    }

    @Test
    void skipsWhatItCannotPairWithAConstant() {
        Map<String, Object[]> methods = new LinkedHashMap<>();
        methods.put("computedName", method("(Ljava/lang/String;)V", mv -> {
            id(mv, "A");
            chain(mv, null);                                     // overlays not a constant
        }));
        methods.put("noId", method("()V", mv -> {
            mv.visitInsn(org.objectweb.asm.Opcodes.ICONST_5);
            chain(mv, "B");                                      // id from no MetaTileEntityIDs constant
        }));
        methods.put("idInALocal", method("()V", mv -> {
            id(mv, "C");
            mv.visitVarInsn(ISTORE, 0);
            mv.visitVarInsn(ILOAD, 0);                           // a local, not a parameter: still the id read above
            chain(mv, "CCC");
        }));
        Map<String, String> expected = Collections.singletonMap("C", "CCC");
        assertEquals(expected, BuilderOverlayScanner.scan(loader(methods)));
        assertEquals(Collections.emptyMap(), BuilderOverlayScanner.scan(loader(Collections.emptyMap())));
        assertEquals(Collections.emptyMap(), BuilderOverlayScanner.scan(null));
    }
}

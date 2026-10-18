package io.github.drukoz.gtnhplanner.export.textures;

import static org.junit.jupiter.api.Assertions.*;
import static org.objectweb.asm.Opcodes.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;

class CasingIconParserTest {
    static final String BI = "gregtech/api/enums/Textures$BlockIcons";
    static final String IC = "gregtech/api/interfaces/IIconContainer";

    static byte[] casing(String method, Consumer<MethodVisitor> body) {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        cw.visit(V1_8, ACC_PUBLIC, "test/Casing", null, "java/lang/Object", null);
        if (method != null) {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, method, CasingIconParser.DESC, null, null);
            mv.visitCode(); body.accept(mv); mv.visitMaxs(0, 0); mv.visitEnd();
        }
        cw.visitEnd();
        return cw.toByteArray();
    }
    static void ret(MethodVisitor mv, String field) {
        mv.visitFieldInsn(GETSTATIC, BI, field, "L" + IC + ";");
        mv.visitMethodInsn(INVOKEINTERFACE, IC, "getIcon", "()Lnet/minecraft/util/IIcon;", true);
        mv.visitInsn(ARETURN);
    }
    static void retArr(MethodVisitor mv, String array) {
        mv.visitFieldInsn(GETSTATIC, BI, array, "[L" + IC + ";");
        mv.visitVarInsn(ILOAD, 2); mv.visitInsn(AALOAD);
        mv.visitMethodInsn(INVOKEINTERFACE, IC, "getIcon", "()Lnet/minecraft/util/IIcon;", true);
        mv.visitInsn(ARETURN);
    }
    static IconRef ref(String f, int i) { return new IconRef(BI, f, i); }

    static Consumer<MethodVisitor> tableSwitch() {
        return mv -> {
            Label l0 = new Label(), l1 = new Label(), l2 = new Label(), dflt = new Label();
            mv.visitVarInsn(ILOAD, 2); mv.visitTableSwitchInsn(0, 2, dflt, l0, l1, l2);
            mv.visitLabel(l0); ret(mv, "MACHINE_CASING_SOLID_STEEL");
            mv.visitLabel(l1); ret(mv, "MACHINE_CASING_FROST_PROOF");
            mv.visitLabel(l2); ret(mv, "MACHINE_CASING_GEARBOX_BRONZE");
            mv.visitLabel(dflt); ret(mv, "MACHINE_CASING_SOLID_STEEL");
        };
    }

    @Test void metaTableSwitch() {
        IconRef[][] r = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, tableSwitch()));
        assertEquals(16, r.length);
        for (int side = 0; side < 6; side++) assertEquals(ref("MACHINE_CASING_SOLID_STEEL", -1), r[0][side]);
        assertEquals(ref("MACHINE_CASING_FROST_PROOF", -1), r[1][3]);
        assertEquals(ref("MACHINE_CASING_GEARBOX_BRONZE", -1), r[2][0]);
        assertEquals(ref("MACHINE_CASING_SOLID_STEEL", -1), r[9][5]);
        assertEquals(ref("MACHINE_CASING_FROST_PROOF", -1), CasingIconParser.parse(casing(CasingIconParser.DEV_NAME, tableSwitch()))[1][0]);
    }

    @Test void sideDependentArrays() {
        IconRef[][] r = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, mv -> {
            Label notBottom = new Label(), notTop = new Label();
            mv.visitVarInsn(ILOAD, 1); mv.visitJumpInsn(IFNE, notBottom); retArr(mv, "MACHINECASINGS_BOTTOM");
            mv.visitLabel(notBottom); mv.visitVarInsn(ILOAD, 1); mv.visitInsn(ICONST_1); mv.visitJumpInsn(IF_ICMPNE, notTop); retArr(mv, "MACHINECASINGS_TOP");
            mv.visitLabel(notTop); retArr(mv, "MACHINECASINGS_SIDE");
        }));
        assertEquals(ref("MACHINECASINGS_BOTTOM", 3), r[3][0]);
        assertEquals(ref("MACHINECASINGS_TOP", 3), r[3][1]);
        assertEquals(ref("MACHINECASINGS_SIDE", 3), r[3][4]);
    }

    @Test void lookupSwitchOnALocal() {
        IconRef[][] r = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, mv -> {
            Label a = new Label(), c = new Label(), dflt = new Label();
            mv.visitVarInsn(ILOAD, 2); mv.visitInsn(ICONST_4); mv.visitInsn(IREM); mv.visitVarInsn(ISTORE, 3);
            mv.visitVarInsn(ILOAD, 3); mv.visitLookupSwitchInsn(dflt, new int[] { 1, 3 }, new Label[] { a, c });
            mv.visitLabel(a); ret(mv, "A"); mv.visitLabel(c); ret(mv, "C"); mv.visitLabel(dflt); ret(mv, "D");
        }));
        assertEquals(ref("A", -1), r[5][2]);
        assertEquals(ref("C", -1), r[7][2]);
        assertEquals(ref("D", -1), r[0][2]);
    }

    @Test void containerKeptInALocal() { // BlockCasings5 (heating coils): the switch picks a container, astore_3, aload_3, getIcon()
        IconRef[][] r = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, mv -> {
            Label a = new Label(), b = new Label(), dflt = new Label(), end = new Label();
            mv.visitVarInsn(ILOAD, 2); mv.visitIntInsn(BIPUSH, 16); mv.visitInsn(IREM); mv.visitTableSwitchInsn(1, 2, dflt, a, b);
            mv.visitLabel(a); mv.visitFieldInsn(GETSTATIC, BI, "MACHINE_COIL_KANTHAL_BACKGROUND", "L" + IC + ";"); mv.visitJumpInsn(GOTO, end);
            mv.visitLabel(b); mv.visitFieldInsn(GETSTATIC, BI, "MACHINE_COIL_NICHROME_BACKGROUND", "L" + IC + ";"); mv.visitJumpInsn(GOTO, end);
            mv.visitLabel(dflt); mv.visitFieldInsn(GETSTATIC, BI, "MACHINE_COIL_CUPRONICKEL_BACKGROUND", "L" + IC + ";");
            mv.visitLabel(end); mv.visitVarInsn(ASTORE, 3); mv.visitVarInsn(ALOAD, 3);
            mv.visitMethodInsn(INVOKEINTERFACE, IC, "getIcon", "()Lnet/minecraft/util/IIcon;", true);
            mv.visitInsn(ARETURN);
        }));
        assertEquals(ref("MACHINE_COIL_KANTHAL_BACKGROUND", -1), r[1][0]);
        assertEquals(ref("MACHINE_COIL_NICHROME_BACKGROUND", -1), r[2][5]);
        assertEquals(ref("MACHINE_COIL_CUPRONICKEL_BACKGROUND", -1), r[0][3]);
        assertEquals(ref("MACHINE_COIL_CUPRONICKEL_BACKGROUND", -1), r[15][1]);
    }

    @Test void givesUpOnWhatItCannotFollow() {
        IconRef[][] fieldRead = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, mv -> {
            mv.visitVarInsn(ALOAD, 0); mv.visitFieldInsn(GETFIELD, "test/Casing", "icons", "[Lnet/minecraft/util/IIcon;");
            mv.visitVarInsn(ILOAD, 2); mv.visitInsn(AALOAD); mv.visitInsn(ARETURN);
        }));
        assertNull(fieldRead[0][0]);
        assertNull(fieldRead[15][5]);
        IconRef[][] loop = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, mv -> {
            Label top = new Label(); mv.visitLabel(top); mv.visitJumpInsn(GOTO, top);
        }));
        assertNull(loop[4][2]);
        assertNull(CasingIconParser.parse(casing(null, null)));
    }
}

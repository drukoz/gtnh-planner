package io.github.drukoz.gtnhplanner.export.sections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.objectweb.asm.Opcodes.ACC_PRIVATE;
import static org.objectweb.asm.Opcodes.ACC_PUBLIC;
import static org.objectweb.asm.Opcodes.ACC_SUPER;
import static org.objectweb.asm.Opcodes.ALOAD;
import static org.objectweb.asm.Opcodes.INVOKESPECIAL;
import static org.objectweb.asm.Opcodes.RETURN;
import static org.objectweb.asm.Opcodes.V1_8;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;

class HatchListsTest {

    // The search: which fields of a machine count.

    static class Base {

        protected final List<Object> fromBase = new ArrayList<>();
    }

    static class Fake extends Base {

        private final List<List<Object>> byLayer = new ArrayList<>();
        final Map<String, Object> byName = new HashMap<>();
        Object loose;
        int count;
        static final List<Object> REGISTRY = new ArrayList<>();
    }

    private static final Set<String> NONE = Collections.emptySet();

    /** The probe hatch and its base tile entity. */
    private final Object p = new Object(), q = new Object();

    @Test
    void anEmptyMachineHoldsNoProbe() {
        assertFalse(HatchLists.holds(new Fake(), p, q, NONE));
    }

    @Test
    void aListASuperclassDeclaresCounts() {
        Fake fake = new Fake();
        fake.fromBase.add(p);
        assertTrue(HatchLists.holds(fake, p, q, NONE));
    }

    @Test
    void aListInsideAListCounts() {
        Fake fake = new Fake();
        fake.byLayer.add(new ArrayList<>());
        fake.byLayer.add(new ArrayList<>(Collections.singletonList(p)));
        assertTrue(HatchLists.holds(fake, p, q, NONE));
    }

    @Test
    void theBaseTileEntityCountsAsTheProbe() {
        Fake fake = new Fake();
        fake.byName.put("x", q);
        assertTrue(HatchLists.holds(fake, p, q, NONE));
    }

    @Test
    void aListInsideAMapCounts() {
        Fake fake = new Fake();
        fake.byName.put("y", Arrays.asList(p));
        assertTrue(HatchLists.holds(fake, p, q, NONE));
    }

    @Test
    void aFieldOfNoCollectionTypeDoesNotCount() {
        Fake fake = new Fake();
        fake.loose = p;
        assertFalse(HatchLists.holds(fake, p, q, NONE));
        fake.loose = new ArrayList<>(Collections.singletonList(p)); // the field's type decides, not its value's
        assertFalse(HatchLists.holds(fake, p, q, NONE));
    }

    @Test
    void aStaticFieldDoesNotCount() {
        try {
            Fake.REGISTRY.add(p);
            assertFalse(HatchLists.holds(new Fake(), p, q, NONE));
        } finally {
            Fake.REGISTRY.clear();
        }
    }

    @Test
    void theProbeIsFoundByIdentityNotByEquality() {
        Fake fake = new Fake();
        fake.fromBase.add(new String("x"));
        assertFalse(HatchLists.holds(fake, "x", q, NONE));
    }

    @Test
    void theFieldsOfPlainClassesCanBeRead() {
        assertNull(HatchLists.unreadableClass(new Fake()));
    }

    @Test
    void aMachineWithAClassWhoseFieldsCannotBeReadIsNamedAndNeverSearched() throws Exception {
        ClassLoader loader = new GeneratedClasses();
        Object leaf = loader.loadClass("test.hatchlists.Leaf")
            .getConstructor()
            .newInstance();
        Object unreadable = loader.loadClass("test.hatchlists.Unreadable")
            .getConstructor()
            .newInstance();
        assertEquals("Unreadable", HatchLists.unreadableClass(leaf)); // the first such class of the hierarchy
        assertEquals("Unreadable", HatchLists.unreadableClass(unreadable));
        assertThrows(IllegalStateException.class, () -> HatchLists.holds(leaf, p, q, NONE)); // no partial answer
    }

    /**
     * Two generated classes, {@code Leaf extends Unreadable}. {@code Unreadable} declares a field whose type exists
     * nowhere, so its {@code getDeclaredFields()} throws, as TecTech's {@code MTEBECStorage} does on a dedicated server
     * (its sound loops are of a client-only class); {@code Leaf}'s own field can be read.
     */
    private static final class GeneratedClasses extends ClassLoader {

        GeneratedClasses() {
            super(HatchListsTest.class.getClassLoader());
        }

        @Override
        protected Class<?> findClass(String name) throws ClassNotFoundException {
            byte[] b;
            if (name.equals("test.hatchlists.Unreadable")) {
                b = generated("test/hatchlists/Unreadable", "java/lang/Object", "Ltest/hatchlists/ClientOnlySound;");
            } else if (name.equals("test.hatchlists.Leaf")) {
                b = generated("test/hatchlists/Leaf", "test/hatchlists/Unreadable", "Ljava/util/List;");
            } else {
                throw new ClassNotFoundException(name);
            }
            return defineClass(name, b, 0, b.length);
        }
    }

    /** A public class with one private field of type {@code fieldType} and a public constructor without arguments. */
    private static byte[] generated(String name, String superName, String fieldType) {
        ClassWriter w = new ClassWriter(0);
        w.visit(V1_8, ACC_PUBLIC | ACC_SUPER, name, null, superName, null);
        w.visitField(ACC_PRIVATE, "field", fieldType, null, null)
            .visitEnd();
        MethodVisitor init = w.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
        init.visitCode();
        init.visitVarInsn(ALOAD, 0);
        init.visitMethodInsn(INVOKESPECIAL, superName, "<init>", "()V", false);
        init.visitInsn(RETURN);
        init.visitMaxs(1, 1);
        init.visitEnd();
        w.visitEnd();
        return w.toByteArray();
    }

    // The verdict, on fakes named like GT's classes.

    static class MTEMultiBlockBase {

        private final ArrayList<Object> mSmartInputHatches = new ArrayList<>();
        final ArrayList<Object> mInputHatches = new ArrayList<>();
        final List<Object> structureErrors = new ArrayList<>();
    }

    static final class PositionedStructureError {

        private final int x, y, z;

        PositionedStructureError(int x, int y, int z) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }

    /** Has the cell's coordinates, but is no PositionedStructureError. */
    static final class OtherError {

        private final int x = X, y = Y, z = Z;
    }

    /** A PositionedStructureError whose cell cannot be read: GT changed the class, and no verdict may guess. */
    static final class Changed {

        static final class PositionedStructureError {

            private final long x = X, y = Y, z = Z;
        }
    }

    static final class FakeInputHatch {}

    /** Files a hatch as GT's {@code addLeftHatchToMachineList} does: in mSmartInputHatches before its type is checked. */
    static class FakeCracker extends MTEMultiBlockBase {

        boolean addSideHatch(Object h) {
            super.mSmartInputHatches.add(h);
            if (h instanceof FakeInputHatch) {
                mInputHatches.add(h);
                return true;
            }
            return false;
        }
    }

    /** The probe cell. */
    private static final int X = 8192, Y = 65, Z = 8193;

    @Test
    void aProbeTheAdderFiledAndThenRejectedIsNotTaken() {
        FakeCracker cracker = new FakeCracker();
        Object outputHatch = new Object(), base = new Object();
        assertFalse(cracker.addSideHatch(outputHatch));
        cracker.structureErrors.add(new PositionedStructureError(X, Y, Z));
        assertFalse(
            HatchLists.taken(cracker, outputHatch, base, HatchLists.EXCLUDED, cracker.structureErrors, X, Y, Z));
    }

    @Test
    void mSmartInputHatchesAloneNeverMakesAProbeTaken() {
        FakeCracker cracker = new FakeCracker();
        Object outputHatch = new Object(), base = new Object();
        assertFalse(cracker.addSideHatch(outputHatch)); // and a check that records no error
        assertFalse(
            HatchLists.taken(cracker, outputHatch, base, HatchLists.EXCLUDED, cracker.structureErrors, X, Y, Z));
        assertTrue(HatchLists.holds(cracker, outputHatch, base, Collections.emptySet())); // the exclusion drops it
    }

    @Test
    void aProbeTheAdderTookIsTakenWhileTheErrorsAreOnOtherCells() {
        FakeCracker cracker = new FakeCracker();
        Object inputHatch = new FakeInputHatch(), base = new Object();
        assertTrue(cracker.addSideHatch(inputHatch));
        cracker.structureErrors.add(new PositionedStructureError(X, Y + 1, Z));
        assertTrue(HatchLists.taken(cracker, inputHatch, base, HatchLists.EXCLUDED, cracker.structureErrors, X, Y, Z));
    }

    @Test
    void aProbeTheAdderTookIsNotTakenWithAnErrorOnItsCell() {
        FakeCracker cracker = new FakeCracker();
        Object inputHatch = new FakeInputHatch(), base = new Object();
        assertTrue(cracker.addSideHatch(inputHatch));
        cracker.structureErrors.add(new PositionedStructureError(X, Y, Z));
        assertFalse(
            HatchLists.taken(cracker, inputHatch, base, HatchLists.EXCLUDED, cracker.structureErrors, X, Y, Z));
    }

    @Test
    void onlyAPositionedStructureErrorOnTheProbeCellRejectsIt() {
        List<Object> elsewhere = Arrays.asList(
            new Object(),
            "PositionedStructureError",
            new OtherError(),
            new PositionedStructureError(X + 1, Y, Z),
            new PositionedStructureError(X, Y - 1, Z),
            new PositionedStructureError(X, Y, Z + 1));
        assertFalse(HatchLists.rejectedAt(elsewhere, X, Y, Z));
        assertTrue(HatchLists.rejectedAt(Arrays.asList(new Object(), new PositionedStructureError(X, Y, Z)), X, Y, Z));
    }

    @Test
    void aPositionedStructureErrorWithoutIntCoordinatesFailsTheVerdict() {
        List<Object> errors = Collections.singletonList(new Changed.PositionedStructureError());
        assertThrows(IllegalStateException.class, () -> HatchLists.rejectedAt(errors, X, Y, Z));
    }
}

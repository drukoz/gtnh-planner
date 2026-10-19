package io.github.drukoz.gtnhplanner.export.textures;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.lang.reflect.Field;

import org.junit.jupiter.api.Test;

class IconRefTest {

    interface Constants {

        String SHARED = "from the interface";
    }

    static class Base {

        private static String inherited = "from the superclass";
        static String both = "from the superclass";
    }

    static class Block extends Base implements Constants {

        static String own = "declared";
        static String both = "declared too";
    }

    static class Leaf extends Block {}

    static IconRef ref(Class<?> owner, String field) {
        return new IconRef(owner.getName()
            .replace('.', '/'), field, -1);
    }

    static Object value(Class<?> owner, String field) throws ReflectiveOperationException {
        Field f = ref(owner, field).resolve(IconRefTest.class.getClassLoader());
        return f.get(null);
    }

    @Test
    void resolvesLikeGetstatic() throws ReflectiveOperationException {
        assertEquals("declared", value(Block.class, "own"));
        assertEquals("declared too", value(Leaf.class, "both"));               // the nearest declaration wins
        assertEquals("from the superclass", value(Leaf.class, "inherited")); // private, read by reflection
        assertEquals("from the interface", value(Leaf.class, "SHARED"));
    }

    @Test
    void reportsWhatIsMissing() {
        ClassLoader loader = IconRefTest.class.getClassLoader();
        assertThrows(NoSuchFieldException.class, () -> ref(Leaf.class, "stripped").resolve(loader));
        assertThrows(ClassNotFoundException.class, () -> new IconRef("no/such/Owner", "x", -1).resolve(loader));
    }
}

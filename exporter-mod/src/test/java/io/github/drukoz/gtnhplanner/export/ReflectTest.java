package io.github.drukoz.gtnhplanner.export;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.invoke.MethodHandle;
import java.lang.reflect.Modifier;
import java.util.Collections;
import java.util.LinkedList;
import java.util.List;

import org.junit.jupiter.api.Test;

import io.github.drukoz.gtnhplanner.export.fixtures.FakeCropCard;
import io.github.drukoz.gtnhplanner.export.fixtures.FakeCropRegistry;
import io.github.drukoz.gtnhplanner.export.fixtures.FakeSeedStats;

class ReflectTest {

    /** The fixtures as a dedicated server loads a mod: without the client class that some of their members name. */
    private final ClassLoader server = new ClientlessLoader();

    private Class<?> serverClass(Class<?> fixture) throws ClassNotFoundException {
        return Class.forName(fixture.getName(), false, server);
    }

    /** The registry's cards, found as {@code CropsSection} finds CropsNH's. */
    private List<?> cards() throws ClassNotFoundException {
        Class<?> registry = serverClass(FakeCropRegistry.class);
        Object instance = Reflect.invoke(Reflect.staticGetter(registry, "instance", registry));
        MethodHandle allInRegistrationOrder = Reflect.method(registry, "getAllInRegistrationOrder", LinkedList.class);
        return (List<?>) Reflect.invoke(allInRegistrationOrder, instance);
    }

    @Test
    void aClassWithAMemberThatNamesAClientClassCannotListItsMethods() throws Exception {
        // the control: getMethods() and getMethod(name) build every public method, so they also load the parameter
        // type of registerIcons and registerSprites, as on CropsNH's CropRegistry and ICropCard on a dedicated server
        Class<?> registry = serverClass(FakeCropRegistry.class);
        assertThrows(NoClassDefFoundError.class, registry::getMethods);
        assertThrows(NoClassDefFoundError.class, () -> registry.getMethod("getAllInRegistrationOrder"));
        Class<?> card = serverClass(FakeCropCard.class);
        assertThrows(NoClassDefFoundError.class, card::getMethods);
    }

    @Test
    void findsTheRegistryAndItsCardsThoughAMemberNamesAClientClass() throws Exception {
        Class<?> registry = serverClass(FakeCropRegistry.class);
        Object instance = Reflect.invoke(Reflect.staticGetter(registry, "instance", registry));
        assertSame(registry, instance.getClass());
        MethodHandle allInRegistrationOrder = Reflect.method(registry, "getAllInRegistrationOrder", LinkedList.class);
        assertEquals(2, ((List<?>) Reflect.invoke(allInRegistrationOrder, instance)).size());
    }

    @Test
    void callsAnInterfaceMethodOnACardWhoseClassIsNotPublic() throws Exception {
        List<?> cards = cards();
        assertFalse(Modifier.isPublic(cards.get(0).getClass().getModifiers()));
        MethodHandle getId = Reflect.method(serverClass(FakeCropCard.class), "getId", String.class);
        assertEquals("fakecrops:stickyCane", Reflect.invoke(getId, cards.get(0)));
        assertEquals("fakecrops:testBonsai", Reflect.invoke(getId, cards.get(1)));
    }

    @Test
    void returnsAPrimitiveResultBoxed() throws Exception {
        Class<?> card = serverClass(FakeCropCard.class);
        Object stickyCane = cards().get(0);
        assertEquals(Integer.valueOf(4), Reflect.invoke(Reflect.method(card, "getTier", int.class), stickyCane));
        assertEquals(
            Float.valueOf(0.81450625f),
            Reflect.invoke(Reflect.method(card, "getDropChance", float.class), stickyCane));
    }

    @Test
    void passesAPrimitiveArgumentBoxedAndANullArgument() throws Exception {
        Class<?> card = serverClass(FakeCropCard.class);
        Object stickyCane = cards().get(0);
        MethodHandle soils = Reflect.method(card, "getSoilsForNEI", List.class, boolean.class);
        assertEquals(Collections.singletonList("minecraft:sand"), Reflect.invoke(soils, stickyCane, true));
        assertEquals(Collections.emptyList(), Reflect.invoke(soils, stickyCane, false));
        MethodHandle seed = Reflect.method(card, "getSeedItem", String.class, serverClass(FakeSeedStats.class));
        assertEquals("fakecrops:stickyCane seed", Reflect.invoke(seed, stickyCane, null));
    }

    @Test
    void readsAStaticField() {
        assertEquals(
            Integer.valueOf(2147483647),
            Reflect.invoke(Reflect.staticGetter(Integer.class, "MAX_VALUE", int.class)));
    }

    @Test
    void refusesAnInstanceFieldAsAStaticOne() throws Exception {
        Class<?> registry = serverClass(FakeCropRegistry.class);
        IllegalArgumentException e = assertThrows(
            IllegalArgumentException.class,
            () -> Reflect.staticGetter(registry, "cropIdCounter", int.class));
        assertNames(e, FakeCropRegistry.class.getName() + ".cropIdCounter");
    }

    @Test
    void namesTheClassAndTheMemberItCannotFind() throws Exception {
        Class<?> registry = serverClass(FakeCropRegistry.class);
        IllegalArgumentException missing = assertThrows(
            IllegalArgumentException.class,
            () -> Reflect.method(registry, "getAllInOrder", LinkedList.class));
        assertNames(missing, FakeCropRegistry.class.getName() + ".getAllInOrder");
        // the type is part of the member: the method returns a LinkedList, not a List
        IllegalArgumentException otherType = assertThrows(
            IllegalArgumentException.class,
            () -> Reflect.method(registry, "getAllInRegistrationOrder", List.class));
        assertNames(otherType, FakeCropRegistry.class.getName() + ".getAllInRegistrationOrder");
    }

    @Test
    void callsAStaticMethodAndRethrowsWhatItThrows() {
        MethodHandle parseInt = Reflect.staticMethod(Integer.class, "parseInt", int.class, String.class);
        assertEquals(Integer.valueOf(42), Reflect.invoke(parseInt, "42"));
        assertThrows(NumberFormatException.class, () -> Reflect.invoke(parseInt, "forty-two"));
    }

    @Test
    void knowsWhetherItsLoaderHasAClass() {
        assertTrue(Reflect.hasClass(FakeCropRegistry.class.getName()));
        assertSame(FakeCropRegistry.class, Reflect.load(FakeCropRegistry.class.getName()));
        assertFalse(Reflect.hasClass("com.gtnewhorizon.cropsnh.NoSuchClass"));
        IllegalStateException e = assertThrows(
            IllegalStateException.class,
            () -> Reflect.load("com.gtnewhorizon.cropsnh.NoSuchClass"));
        assertNames(e, "com.gtnewhorizon.cropsnh.NoSuchClass");
    }

    private static void assertNames(Exception e, String member) {
        assertTrue(e.getMessage().contains(member), () -> "\"" + e.getMessage() + "\" does not name " + member);
    }
}

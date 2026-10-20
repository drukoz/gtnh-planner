package io.github.drukoz.gtnhplanner.export;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

/**
 * Calls into mods that are not on the compile classpath: Galacticraft ({@code micdoodle8.*}) and CropsNH
 * ({@code com.gtnewhorizon.cropsnh.*}). Such classes are named in strings, never as class references, so a pack
 * without them still loads every exporter class; the calls then fail at run time and the caller's catch turns that
 * into a warning.
 *
 * <p>
 * Each member is found by its name and its exact type, as {@code javap -p -s} shows them, on the public class or
 * interface that declares it, and is then called through its {@link MethodHandle}: the JVM resolves that one member,
 * as it does for a call in bytecode. Nothing here asks a class for its members ({@code getMethods()},
 * {@code getMethod(name, types)}, {@code getFields()}, {@code getField(name)}, {@code getDeclared*()}). Those build a
 * reflective object for every (public) member and so load every type that any of them names, and on a dedicated server
 * a public member that names a client class without being {@code @SideOnly(CLIENT)} (Forge strips only those) then
 * throws {@link NoClassDefFoundError}, as CropsNH's {@code CropRegistry.registerIcons(IIconRegister)} does.
 *
 * <p>
 * Only the mod's own members may be called this way. Minecraft and Forge members are called directly, because
 * reobfuscation renames them and a name passed here would stay the MCP name. A Minecraft class may be part of a
 * member's type ({@code ItemStack.class}): reobfuscation keeps class names.
 */
public final class Reflect {

    private static final MethodHandles.Lookup PUBLIC = MethodHandles.publicLookup();

    private Reflect() {}

    /**
     * Class {@code className}, loaded by this mod's loader and not initialized. Throws {@link IllegalStateException}
     * when the mod that has it is not installed.
     */
    public static Class<?> load(String className) {
        try {
            return Class.forName(className, false, Reflect.class.getClassLoader());
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("class not found: " + className, e);
        }
    }

    /**
     * The public instance method {@code name} of the public class or interface {@code owner} (declared there or
     * inherited) that returns {@code returns} and takes {@code params}, exactly. Its handle takes the receiver first,
     * an instance of any class that extends or implements {@code owner}, public or not.
     */
    public static MethodHandle method(Class<?> owner, String name, Class<?> returns, Class<?>... params) {
        try {
            return PUBLIC.findVirtual(owner, name, MethodType.methodType(returns, params));
        } catch (ReflectiveOperationException e) {
            throw missing("method", owner, name, signature(returns, params), e);
        }
    }

    /**
     * The public static method {@code name} of the public class {@code owner} that returns {@code returns} and takes
     * {@code params}, exactly. The first call initializes {@code owner}.
     */
    public static MethodHandle staticMethod(Class<?> owner, String name, Class<?> returns, Class<?>... params) {
        try {
            return PUBLIC.findStatic(owner, name, MethodType.methodType(returns, params));
        } catch (ReflectiveOperationException e) {
            throw missing("static method", owner, name, signature(returns, params), e);
        }
    }

    /**
     * A handle without parameters that reads the public static field {@code name} of type {@code type} of the public
     * class {@code owner}. The first call initializes {@code owner}.
     */
    public static MethodHandle staticGetter(Class<?> owner, String name, Class<?> type) {
        try {
            return PUBLIC.findStaticGetter(owner, name, type);
        } catch (ReflectiveOperationException e) {
            throw missing("static field", owner, name, ": " + type.getTypeName(), e);
        }
    }

    /**
     * Calls {@code member} with {@code args} (an instance method's receiver first) and returns its result (boxed for
     * primitives, {@code null} for void). An exception thrown by the member is rethrown as it is (wrapped in
     * {@link IllegalStateException} when checked).
     */
    public static Object invoke(MethodHandle member, Object... args) {
        try {
            return member.invokeWithArguments(args);
        } catch (RuntimeException | Error e) {
            throw e;
        } catch (Throwable t) {
            throw new IllegalStateException(t);
        }
    }

    /**
     * Whether this mod's loader finds class {@code className}, that is whether the mod that has it is installed. The
     * class is not initialized.
     */
    public static boolean hasClass(String className) {
        try {
            Class.forName(className, false, Reflect.class.getClassLoader());
            return true;
        } catch (ClassNotFoundException e) {
            return false;
        }
    }

    /**
     * Whether {@code o}'s class is {@code className} or extends or implements it. Compares names along the class
     * hierarchy, so nothing is loaded and a missing class simply answers {@code false}.
     */
    public static boolean isInstance(Object o, String className) {
        return o != null && isSubtype(o.getClass(), className);
    }

    private static boolean isSubtype(Class<?> cls, String className) {
        for (Class<?> c = cls; c != null; c = c.getSuperclass()) {
            if (c.getName().equals(className)) return true;
            for (Class<?> i : c.getInterfaces()) {
                if (isSubtype(i, className)) return true;
            }
        }
        return false;
    }

    /** {@code (p1, p2): r}, for an error message. */
    private static String signature(Class<?> returns, Class<?>[] params) {
        StringBuilder s = new StringBuilder("(");
        for (int i = 0; i < params.length; i++) {
            if (i > 0) s.append(", ");
            s.append(params[i].getTypeName());
        }
        return s.append("): ")
            .append(returns.getTypeName())
            .toString();
    }

    private static IllegalArgumentException missing(String kind, Class<?> owner, String name, String type,
        ReflectiveOperationException e) {
        return new IllegalArgumentException("no public " + kind + " " + owner.getName() + "." + name + type, e);
    }
}

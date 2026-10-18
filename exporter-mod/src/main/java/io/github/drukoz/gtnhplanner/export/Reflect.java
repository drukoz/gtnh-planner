package io.github.drukoz.gtnhplanner.export;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

/**
 * Calls into mods that are not on the compile classpath: Galacticraft ({@code micdoodle8.*}) only. Such classes are
 * named in strings, never as class references, so a pack without them still loads every exporter class; the calls
 * then fail at run time and the caller's catch turns that into a warning.
 *
 * <p>
 * Only the mod's own members may be called this way. Minecraft and Forge members are called directly, because
 * reobfuscation renames them and a name passed here would stay the MCP name.
 */
public final class Reflect {

    private Reflect() {}

    /**
     * Calls the public method {@code method} of {@code target}'s class that accepts {@code args} and returns its
     * result (boxed for primitives, {@code null} for void). An exception thrown by the method is rethrown as it is
     * (wrapped in {@link IllegalStateException} when checked).
     */
    public static Object call(Object target, String method, Object... args) {
        if (target == null) throw new NullPointerException("cannot call " + method + " on null");
        return invoke(find(target.getClass(), method, false, args), target, args);
    }

    /** Calls the public static method {@code method} of class {@code className}, loaded by this mod's loader. */
    public static Object callStatic(String className, String method, Object... args) {
        Class<?> cls;
        try {
            cls = Class.forName(className, true, Reflect.class.getClassLoader());
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("class not found: " + className, e);
        }
        return invoke(find(cls, method, true, args), null, args);
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

    private static Method find(Class<?> cls, String method, boolean isStatic, Object[] args) {
        for (Method m : cls.getMethods()) {
            if (m.getName().equals(method) && Modifier.isStatic(m.getModifiers()) == isStatic
                && accepts(m.getParameterTypes(), args)) return m;
        }
        String kind = isStatic ? "static method " : "method ";
        throw new IllegalArgumentException(
            "no public " + kind + cls.getName() + "." + method + " for " + args.length + " argument(s)");
    }

    private static boolean accepts(Class<?>[] params, Object[] args) {
        if (params.length != args.length) return false;
        for (int i = 0; i < params.length; i++) {
            if (args[i] == null) {
                if (params[i].isPrimitive()) return false;
            } else if (!box(params[i]).isInstance(args[i])) {
                return false;
            }
        }
        return true;
    }

    private static Class<?> box(Class<?> c) {
        if (!c.isPrimitive()) return c;
        if (c == int.class) return Integer.class;
        if (c == long.class) return Long.class;
        if (c == boolean.class) return Boolean.class;
        if (c == double.class) return Double.class;
        if (c == float.class) return Float.class;
        if (c == short.class) return Short.class;
        if (c == byte.class) return Byte.class;
        if (c == char.class) return Character.class;
        return Void.class;
    }

    private static Object invoke(Method m, Object target, Object[] args) {
        try {
            if (!Modifier.isPublic(m.getDeclaringClass().getModifiers())) {
                // a public method inherited from a non-public class: reachable only with access checks off
                m.setAccessible(true);
            }
            return m.invoke(target, args);
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw new IllegalStateException(cause);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }
}

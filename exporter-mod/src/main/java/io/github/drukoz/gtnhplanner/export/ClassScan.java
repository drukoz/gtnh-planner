package io.github.drukoz.gtnhplanner.export;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.AbstractMap;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Tells which of a few member names a class's code refers to, by reading the constant pools of its class files (the
 * scan behind gt-mechanics.md §2.4: a call such as {@code new ProcessingLogic().enablePerfectOverclock()} leaves the
 * method name as a {@code CONSTANT_Utf8} entry). A name counts only when an entry holds exactly that name. The class
 * files are read as resources of the class's own loader, so the bytes are those of the mod jar, never instantiated or
 * linked. Only {@code java.*} is used, so the scan also runs outside the game.
 */
public final class ClassScan {

    /**
     * The superclass walk of {@link #referencedNames} stops before this class: every GT machine extends it, so a name
     * found there would mark every machine.
     */
    static final String STOP_CLASS = "gregtech.api.metatileentity.MetaTileEntity";

    private static final int MAGIC = 0xCAFEBABE;

    /** Results of {@link #referencedNames}, by class and name set. */
    private static final Map<Map.Entry<Class<?>, Set<String>>, Set<String>> CACHE = new HashMap<>();

    private ClassScan() {}

    /**
     * The names of {@code names} that occur in the class {@code binaryName} (e.g. {@code a.b.Outer}) or in one of its
     * anonymous inner classes {@code Outer$1}, {@code Outer$2}, … up to the first one that does not exist, as a sorted
     * set. {@code loader} is the one that defined the class (not {@code null}); each name must be ASCII.
     *
     * @throws IOException when the class file of {@code binaryName} does not exist, or one of the class files is not
     *                     a readable class file
     */
    public static Set<String> namesIn(ClassLoader loader, String binaryName, Set<String> names) throws IOException {
        Map<String, byte[]> wanted = encode(names);
        Set<String> found = new TreeSet<>();
        byte[] bytes = classBytes(loader, binaryName);
        if (bytes == null) throw new IOException("class file not found: " + resourceName(binaryName));
        scanConstantPool(bytes, binaryName, wanted, found);
        for (int i = 1;; i++) {
            String inner = binaryName + "$" + i;
            bytes = classBytes(loader, inner);
            if (bytes == null) break;
            scanConstantPool(bytes, inner, wanted, found);
        }
        return Collections.unmodifiableSet(found);
    }

    /**
     * The names of {@code names} that {@code cls} or one of its superclasses refers to ({@link #namesIn} of each),
     * walking {@code getSuperclass()} up to but excluding {@value #STOP_CLASS} and any class of the bootstrap loader
     * (the JDK, e.g. {@code java.lang.Object}). Cached per class, so a shared superclass is read once.
     *
     * @throws IOException as {@link #namesIn}, for {@code cls} or any superclass on the walk; failures are not cached
     */
    public static Set<String> referencedNames(Class<?> cls, Set<String> names) throws IOException {
        if (cls == null || cls.getClassLoader() == null || STOP_CLASS.equals(cls.getName())) {
            return Collections.emptySet();
        }
        Map.Entry<Class<?>, Set<String>> key = new AbstractMap.SimpleImmutableEntry<Class<?>, Set<String>>(
            cls,
            Collections.unmodifiableSet(new HashSet<>(names)));
        synchronized (CACHE) {
            Set<String> cached = CACHE.get(key);
            if (cached != null) return cached;
        }
        Set<String> found = new TreeSet<>(namesIn(cls.getClassLoader(), cls.getName(), names));
        found.addAll(referencedNames(cls.getSuperclass(), names));
        Set<String> result = Collections.unmodifiableSet(found);
        synchronized (CACHE) {
            CACHE.put(key, result);
        }
        return result;
    }

    /** Each name with its bytes; a CONSTANT_Utf8 entry of an ASCII string holds exactly these bytes. */
    private static Map<String, byte[]> encode(Set<String> names) {
        Map<String, byte[]> wanted = new LinkedHashMap<>();
        for (String name : names) {
            for (int i = 0; i < name.length(); i++) {
                char c = name.charAt(i);
                if (c == 0 || c > 0x7F) throw new IllegalArgumentException("not an ASCII name: " + name);
            }
            wanted.put(name, name.getBytes(StandardCharsets.US_ASCII));
        }
        return wanted;
    }

    private static String resourceName(String binaryName) {
        return binaryName.replace('.', '/') + ".class";
    }

    /** The class file's bytes, or {@code null} when the loader has no such resource. */
    private static byte[] classBytes(ClassLoader loader, String binaryName) throws IOException {
        InputStream in = loader.getResourceAsStream(resourceName(binaryName));
        if (in == null) return null;
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream(16384);
            byte[] buffer = new byte[16384];
            for (int n; (n = in.read(buffer)) != -1;) out.write(buffer, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    /**
     * Adds to {@code found} every name whose bytes equal a {@code CONSTANT_Utf8} entry (tag 1, big-endian u2 length,
     * then the bytes) of the class file's constant pool (JVMS §4.4; Long and Double entries take two slots).
     */
    private static void scanConstantPool(byte[] b, String binaryName, Map<String, byte[]> wanted, Set<String> found)
        throws IOException {
        if (b.length < 10 || readInt(b, 0) != MAGIC) throw new IOException(binaryName + ": not a class file");
        int count = readU2(b, 8);
        int pos = 10;
        for (int entry = 1; entry < count; entry++) {
            if (pos >= b.length) throw truncated(binaryName, entry);
            int tag = b[pos++] & 0xFF;
            int size;
            switch (tag) {
                case 1: // Utf8
                    if (pos + 2 > b.length) throw truncated(binaryName, entry);
                    int length = readU2(b, pos);
                    pos += 2;
                    if (pos + length > b.length) throw truncated(binaryName, entry);
                    match(b, pos, length, wanted, found);
                    size = length;
                    break;
                case 7: // Class
                case 8: // String
                case 16: // MethodType
                case 19: // Module
                case 20: // Package
                    size = 2;
                    break;
                case 15: // MethodHandle
                    size = 3;
                    break;
                case 3: // Integer
                case 4: // Float
                case 9: // Fieldref
                case 10: // Methodref
                case 11: // InterfaceMethodref
                case 12: // NameAndType
                case 17: // Dynamic
                case 18: // InvokeDynamic
                    size = 4;
                    break;
                case 5: // Long
                case 6: // Double
                    size = 8;
                    entry++;
                    break;
                default:
                    throw new IOException(binaryName + ": unknown constant pool tag " + tag + " at entry " + entry);
            }
            pos += size;
            if (pos > b.length) throw truncated(binaryName, entry);
        }
    }

    private static void match(byte[] b, int start, int length, Map<String, byte[]> wanted, Set<String> found) {
        for (Map.Entry<String, byte[]> e : wanted.entrySet()) {
            byte[] name = e.getValue();
            if (name.length != length) continue;
            boolean equal = true;
            for (int i = 0; i < length && equal; i++) equal = b[start + i] == name[i];
            if (equal) found.add(e.getKey());
        }
    }

    private static IOException truncated(String binaryName, int entry) {
        return new IOException(binaryName + ": class file ends inside constant pool entry " + entry);
    }

    private static int readU2(byte[] b, int pos) {
        return ((b[pos] & 0xFF) << 8) | (b[pos + 1] & 0xFF);
    }

    private static int readInt(byte[] b, int pos) {
        return (readU2(b, pos) << 16) | readU2(b, pos + 2);
    }
}

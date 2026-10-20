package io.github.drukoz.gtnhplanner.export;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

import io.github.drukoz.gtnhplanner.export.fixtures.FakeClientOnly;

/**
 * Loads the classes of the {@code fixtures} package itself, from the test classes, as a dedicated server's loader loads
 * a mod, and has no {@link FakeClientOnly}, as a dedicated server has no client classes. Every other class comes from
 * the test's own loader.
 */
final class ClientlessLoader extends ClassLoader {

    private static final String FIXTURES = FakeClientOnly.class.getPackage().getName() + ".";
    private static final String CLIENT_ONLY = FakeClientOnly.class.getName();

    ClientlessLoader() {
        super(ClientlessLoader.class.getClassLoader());
    }

    @Override
    protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        if (name.equals(CLIENT_ONLY)) throw new ClassNotFoundException(name + " is a client class");
        if (!name.startsWith(FIXTURES)) return super.loadClass(name, resolve);
        synchronized (getClassLoadingLock(name)) {
            Class<?> c = findLoadedClass(name);
            if (c == null) {
                byte[] bytes = bytesOf(name);
                c = defineClass(name, bytes, 0, bytes.length);
            }
            if (resolve) resolveClass(c);
            return c;
        }
    }

    private byte[] bytesOf(String name) throws ClassNotFoundException {
        try (InputStream in = getParent().getResourceAsStream(name.replace('.', '/') + ".class")) {
            if (in == null) throw new ClassNotFoundException(name);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0;) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    }
}

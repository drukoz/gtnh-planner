package io.github.drukoz.gtnhplanner.projector.net;

import java.util.ArrayDeque;

/**
 * Work handed to the game thread: any thread may {@link #post}, the game thread {@link #drain}s once per tick, so
 * callbacks run where touching the game is safe.
 */
public final class MainThreadQueue {

    private final ArrayDeque<Runnable> queue = new ArrayDeque<>();

    /** Queues {@code r} for the next {@link #drain}; safe from any thread. */
    public void post(Runnable r) {
        if (r == null) throw new NullPointerException("r");
        synchronized (queue) {
            queue.add(r);
        }
    }

    /**
     * Runs, in posting order, the tasks queued when it starts; tasks posted meanwhile, also by those tasks, wait for
     * the next drain. A task that throws a {@link RuntimeException} is printed with {@code printStackTrace()} and the
     * rest still run. Call it from the game thread only.
     *
     * @return how many tasks it ran
     */
    public int drain() {
        int count;
        synchronized (queue) {
            count = queue.size();
        }
        for (int i = 0; i < count; i++) {
            Runnable r;
            synchronized (queue) {
                r = queue.poll();
            }
            if (r == null) return i; // only when another thread drained as well
            try {
                r.run();
            } catch (RuntimeException e) {
                e.printStackTrace();
            }
        }
        return count;
    }
}

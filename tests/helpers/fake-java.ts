// A stand-in for the export JVM in the export orchestrator's tests (architecture §10, §11.7): a /bin/sh script that
// behaves like the GTNH server with the exporter mod (export-mod.md §5.6) in one of five ways, chosen by FAKE_JAVA_MODE,
// and reports what it was started with, so no test ever boots a real server.

import { chmod, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Environment: FAKE_JAVA_MODE (`ok` | `fail` | `crash` | `hang` | `linger`), FAKE_JAVA_PIDS (pid file, appended),
 * FAKE_JAVA_ARGS (start record, overwritten), FAKE_EXPORT_SRC (an export folder `ok` copies into the export dir).
 * Markers carry the same text as the exporter mod's (`OK <ms>ms`, `FAILED <ms>ms` + stack trace).
 */
const SCRIPT = `#!/bin/sh
set -e

dir=
for arg in "$@"; do
  case $arg in
    -Dgtnhplanner.exportDir=*) dir=\${arg#-Dgtnhplanner.exportDir=} ;;
  esac
done

echo 'fake server starting'
if [ -n "\${FAKE_JAVA_PIDS:-}" ]; then echo "$$" >> "$FAKE_JAVA_PIDS"; fi
if [ -n "\${FAKE_JAVA_ARGS:-}" ]; then
  {
    printf '%s\\n' "$PWD"
    printf 'nice=%s\\n' "$(ps -o nice= -p $$ | tr -d ' ')"
    for arg in "$@"; do printf '%s\\n' "$arg"; done
  } > "$FAKE_JAVA_ARGS"
fi

export_dir() {
  if [ -z "$dir" ]; then echo 'fake-java: no -Dgtnhplanner.exportDir argument' >&2; exit 2; fi
  mkdir -p "$dir"
}

# Starts a long sleep, records its pid and waits for it, so the run only ends when someone kills this process group.
sleep_until_killed() {
  sleep 600 &
  if [ -n "\${FAKE_JAVA_PIDS:-}" ]; then echo "$!" >> "$FAKE_JAVA_PIDS"; fi
  wait
}

case "\${FAKE_JAVA_MODE:-}" in
  ok)
    export_dir
    if [ -n "\${FAKE_EXPORT_SRC:-}" ]; then cp -R "$FAKE_EXPORT_SRC"/. "$dir"/; fi
    printf 'OK 0ms\\n' > "$dir/EXPORT_OK"
    exit 0
    ;;
  fail)
    export_dir
    printf 'FAILED 0ms\\njava.lang.RuntimeException: boom\\n' > "$dir/EXPORT_FAILED"
    exit 0
    ;;
  crash)
    echo 'Exception in thread "main"' >&2
    exit 1
    ;;
  hang)
    sleep_until_killed
    ;;
  linger)
    export_dir
    printf 'OK 0ms\\n' > "$dir/EXPORT_OK"
    sleep_until_killed
    ;;
  *)
    echo "fake-java: unknown FAKE_JAVA_MODE '\${FAKE_JAVA_MODE:-}'" >&2
    exit 2
    ;;
esac
`;

/** Writes the executable script `fake-java` into `dir` (which must exist) and returns its absolute path. */
export async function makeFakeJava(dir: string): Promise<string> {
  const file = join(resolve(dir), 'fake-java');
  await writeFile(file, SCRIPT);
  await chmod(file, 0o755);
  return file;
}

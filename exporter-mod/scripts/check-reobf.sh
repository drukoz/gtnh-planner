#!/usr/bin/env bash
# Checks a built exporter jar before it is installed on a server:
#  1. every field/method reference into net/minecraft/** uses its SRG name (func_<n>_<x> / field_<n>_<x>), so the
#     jar was reobfuscated (the -dev jar keeps MCP names such as ItemStack.getDisplayName and fails here);
#     constructors, static initializers and the Object/Enum methods vanilla never renames are allowed;
#  2. every class file is Java 8 bytecode (magic cafebabe, version 0000 0034).
# Usage: scripts/check-reobf.sh <jar>      Exit 0: "reobf OK: <n> classes"; exit 1: the offending names.
set -euo pipefail

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: $0 <jar>" >&2
  exit 2
fi
jar=$1

work=$(mktemp -d "${TMPDIR:-/tmp}/check-reobf.XXXXXX")
trap 'rm -rf "$work"' EXIT

# unzip exits 11 when the jar has no class files; the count below reports that case.
unzip -q "$jar" '*.class' -d "$work" || [ $? -eq 11 ]

classes=()
while IFS= read -r -d '' f; do classes+=("$f"); done < <(find "$work" -type f -name '*.class' -print0 | sort -z)
if [ ${#classes[@]} -eq 0 ]; then
  echo "reobf FAILED: no class files in $jar" >&2
  exit 1
fi

status=0

wrong_version=()
for f in "${classes[@]}"; do
  magic=$(od -An -tx1 -N8 "$f" | tr -d ' \n')
  [ "$magic" = cafebabe00000034 ] || wrong_version+=("${f#"$work"/} ($magic)")
done
if [ ${#wrong_version[@]} -gt 0 ]; then
  echo "reobf FAILED: class files that are not Java 8 bytecode (expected cafebabe00000034):" >&2
  printf '  %s\n' "${wrong_version[@]}" >&2
  status=1
fi

# javap prints each constant-pool reference as "// Method owner.name:desc", "// InterfaceMethod …" or "// Field …";
# owners may be quoted (array types) and so may names ("<init>").
unmapped=$(
  javap -c -p "${classes[@]}" \
    | { grep -oE '// (InterfaceMethod|Method|Field) [^ ]+' || true; } \
    | awk '{
        ref = $3
        sub(/:.*/, "", ref)
        gsub(/"/, "", ref)
        if (!match(ref, /\.[^.]*$/)) next
        owner = substr(ref, 1, RSTART - 1)
        name = substr(ref, RSTART + 1)
        if (owner !~ /^net\/minecraft\//) next
        if (name ~ /^(func|field)_[0-9]+_[A-Za-z]+$/) next
        if (name ~ /^(<init>|<clinit>|toString|hashCode|equals|values|valueOf|ordinal|name)$/) next
        print owner "." name
      }' \
    | sort -u
)
if [ -n "$unmapped" ]; then
  echo "reobf FAILED: net/minecraft members referenced by MCP name (install the reobfuscated jar, not -dev):" >&2
  printf '%s\n' "$unmapped" | sed 's/^/  /' >&2
  status=1
fi

[ "$status" -eq 0 ] || exit 1
echo "reobf OK: ${#classes[@]} classes"

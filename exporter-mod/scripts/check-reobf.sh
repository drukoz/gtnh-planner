#!/usr/bin/env bash
# Checks a built exporter jar before it is installed on a server:
#  1. every field/method reference into net/minecraft/** uses its SRG name (func_<n>_<x> / field_<n>_<x>), so the
#     jar was reobfuscated (the -dev jar keeps MCP names such as ItemStack.getDisplayName and fails here);
#     constructors, static initializers and the Object/Enum methods vanilla never renames are allowed;
#     SRG suffixes can end in '_' (func_70302_i_ = IInventory.getSizeInventory, func_70071_h_ = Entity.onUpdate),
#     so <x> is [A-Za-z_]+;
#  2. every class file is Java 8 bytecode (magic cafebabe, version 0000 0034).
# The references come from each class's constant pool (javap -v), not from the disassembled code (javap -c): the
# pool also holds the member a method reference (Foo::bar, a bootstrap MethodHandle argument) points at, which
# javap -c never prints.
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

# javap -v lists each member reference in the constant pool as
#   "#12 = Methodref          #45.#48        // net/minecraft/item/ItemStack.func_77973_b:()Lnet/minecraft/item/Item;"
# (also InterfaceMethodref and Fieldref); owners may be quoted (array types) and so may names ("<init>").
unmapped=$(
  javap -v -p "${classes[@]}" \
    | awk '
      $1 ~ /^#[0-9]+$/ && $2 == "=" && ($3 == "Methodref" || $3 == "InterfaceMethodref" || $3 == "Fieldref") {
        i = index($0, "// ")
        if (i == 0) next
        ref = substr($0, i + 3)
        sub(/:.*/, "", ref)
        gsub(/"/, "", ref)
        if (!match(ref, /\.[^.]*$/)) next
        owner = substr(ref, 1, RSTART - 1)
        name = substr(ref, RSTART + 1)
        if (owner !~ /^net\/minecraft\//) next
        if (name ~ /^(func|field)_[0-9]+_[A-Za-z_]+$/) next
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

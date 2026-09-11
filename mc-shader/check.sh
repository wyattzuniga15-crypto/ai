#!/usr/bin/env bash
# check.sh - validate every GLSL stage in the shaderpack with glslangValidator.
#
# Iris resolves "#include" itself before handing source to the driver, and
# glslangValidator refuses #include unless GL_GOOGLE_include_directive is
# requested (which Iris would choke on). So we flatten includes the same way
# Iris does, then validate the flattened source.
#
# Include semantics implemented here (matching Iris/OptiFine):
#   #include "/lib/foo.glsl"  -> relative to the shaders/ root
#   #include "foo.glsl"       -> relative to the including file's directory
#
# Usage:  ./check.sh [-v] [pack_dir]
#   pack_dir defaults to ./Custom  (the folder containing shaders/)

set -uo pipefail

VERBOSE=0
if [[ "${1:-}" == "-v" ]]; then VERBOSE=1; shift; fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="${1:-$SCRIPT_DIR/Custom}"
SHADER_DIR="$PACK_DIR/shaders"

if [[ ! -d "$SHADER_DIR" ]]; then
  echo "FATAL: no shaders/ directory at $SHADER_DIR" >&2
  exit 2
fi

# --- ensure glslangValidator ------------------------------------------------
if ! command -v glslangValidator >/dev/null 2>&1; then
  echo ">> glslangValidator not found, installing glslang-tools..."
  if command -v apt-get >/dev/null 2>&1; then
    (sudo apt-get update -qq || apt-get update -qq) >/dev/null 2>&1
    (sudo apt-get install -y glslang-tools || apt-get install -y glslang-tools) >/dev/null 2>&1
  elif command -v brew >/dev/null 2>&1; then
    brew install glslang >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    (sudo dnf install -y glslang || dnf install -y glslang) >/dev/null 2>&1
  elif command -v pacman >/dev/null 2>&1; then
    (sudo pacman -S --noconfirm glslang || pacman -S --noconfirm glslang) >/dev/null 2>&1
  fi
  if ! command -v glslangValidator >/dev/null 2>&1; then
    echo "FATAL: could not install glslangValidator. Install glslang-tools manually." >&2
    exit 2
  fi
  echo ">> installed: $(glslangValidator --version 2>&1 | head -1)"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- include flattener ------------------------------------------------------
cat > "$WORK/flatten.py" <<'PYEOF'
import sys, os, re

shader_root = sys.argv[1]
entry       = sys.argv[2]
out_path    = sys.argv[3]
map_path    = sys.argv[4]

INC = re.compile(r'^\s*#\s*include\s+[<"]([^>"]+)[>"]\s*$')
out = []
# linemap[i] = (source file, line number) for output line i+1, so glslang's
# line numbers can be translated back to the file the author actually edits.
linemap = []
stack = []

def emit(path, depth):
    real = os.path.realpath(path)
    if real in stack:
        sys.stderr.write("FATAL: circular #include: %s\n" % path)
        sys.exit(3)
    if depth > 32:
        sys.stderr.write("FATAL: #include nested too deep at %s\n" % path)
        sys.exit(3)
    if not os.path.isfile(real):
        sys.stderr.write("FATAL: missing include target: %s\n" % path)
        sys.exit(3)
    stack.append(real)
    rel = os.path.relpath(real, shader_root)
    with open(real, 'r', errors='replace') as fh:
        for lineno, line in enumerate(fh, 1):
            m = INC.match(line)
            if m:
                target = m.group(1)
                if target.startswith('/'):
                    nxt = os.path.join(shader_root, target.lstrip('/'))
                else:
                    nxt = os.path.join(os.path.dirname(real), target)
                out.append('// >>> include %s\n' % target)
                linemap.append((rel, lineno))
                emit(nxt, depth + 1)
                out.append('// <<< end %s\n' % target)
                linemap.append((rel, lineno))
            else:
                out.append(line)
                linemap.append((rel, lineno))
    stack.pop()

emit(entry, 0)
with open(out_path, 'w') as fh:
    fh.write(''.join(out))
with open(map_path, 'w') as fh:
    for rel, lineno in linemap:
        fh.write('%s\t%d\n' % (rel, lineno))
PYEOF

# Rewrites "ERROR: 0:<flatline>:" into "<real file>:<real line>:".
cat > "$WORK/remap.py" <<'PYEOF'
import sys, re
map_path = sys.argv[1]
entry_rel = sys.argv[2]
with open(map_path) as fh:
    linemap = [tuple(l.rstrip('\n').split('\t')) for l in fh]

PAT = re.compile(r'^(\s*)(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$')
for raw in sys.stdin:
    line = raw.rstrip('\n')
    m = PAT.match(line)
    if m:
        indent, sev, num, msg = m.groups()
        idx = int(num) - 1
        if 0 <= idx < len(linemap):
            src, srcline = linemap[idx]
            print('%s%s: %s:%s: %s' % (indent, sev, src, srcline, msg))
            continue
    # glslang echoes the temp filename on its own line; show the real one.
    if line.strip().endswith('.frag') or line.strip().endswith('.vert') \
       or line.strip().endswith('.geom') or line.strip().endswith('.comp') \
       or line.strip().endswith('.tesc') or line.strip().endswith('.tese'):
        continue
    print(line)
PYEOF

stage_for() {
  case "$1" in
    *.vsh) echo vert ;;
    *.fsh) echo frag ;;
    *.gsh) echo geom ;;
    *.csh) echo comp ;;
    *.tcs) echo tesc ;;
    *.tes) echo tese ;;
    *)     echo "" ;;
  esac
}

FAILED=0
PASSED=0
FAIL_LIST=()

# Only validate top-level programs. Files under lib/ are fragments meant to be
# included, not standalone translation units.
mapfile -t FILES < <(find "$SHADER_DIR" -type f \
  \( -name '*.vsh' -o -name '*.fsh' -o -name '*.gsh' -o -name '*.csh' -o -name '*.tcs' -o -name '*.tes' \) \
  | sort)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "FATAL: no shader stages found under $SHADER_DIR" >&2
  exit 2
fi

echo "=== glslangValidator: $(glslangValidator --version 2>&1 | grep -i 'Glslang Version' | head -1) ==="
echo "=== pack: $PACK_DIR (${#FILES[@]} stages) ==="

for f in "${FILES[@]}"; do
  rel="${f#$SHADER_DIR/}"
  stage="$(stage_for "$f")"
  if [[ -z "$stage" ]]; then continue; fi

  base="$WORK/$(echo "$rel" | tr '/' '_')"
  # glslangValidator picks the stage from the extension, so give it one it knows.
  case "$stage" in
    vert) ext=vert ;; frag) ext=frag ;; geom) ext=geom ;;
    comp) ext=comp ;; tesc) ext=tesc ;; tese) ext=tese ;;
  esac
  flat="$base.$ext"

  if ! python3 "$WORK/flatten.py" "$SHADER_DIR" "$f" "$flat" "$base.map" 2>"$base.err"; then
    echo "--------------------------------------------------------------"
    echo "FAIL (include)  $rel"
    sed 's/^/    /' "$base.err"
    FAILED=$((FAILED+1)); FAIL_LIST+=("$rel"); continue
  fi

  if out="$(glslangValidator -S "$stage" "$flat" 2>&1)"; then
    PASSED=$((PASSED+1))
    [[ $VERBOSE -eq 1 ]] && echo "  ok   $rel"
  else
    echo "--------------------------------------------------------------"
    echo "FAIL  $rel  (stage: $stage)"
    # Translate glslang's flattened-source line numbers back to real file:line.
    echo "$out" | python3 "$WORK/remap.py" "$base.map" "$rel" \
      | grep -v '^[[:space:]]*$' | sed 's/^/    /'
    cp "$flat" "/tmp/checkfail_$(basename "$base").$ext" 2>/dev/null
    echo "    (flattened source: /tmp/checkfail_$(basename "$base").$ext)"
    FAILED=$((FAILED+1)); FAIL_LIST+=("$rel")
  fi
done

echo "=============================================================="
if [[ $FAILED -gt 0 ]]; then
  echo "RESULT: $FAILED FAILED, $PASSED passed"
  echo "failing stages:"
  for x in "${FAIL_LIST[@]}"; do echo "  - $x"; done
  exit 1
fi
echo "RESULT: all $PASSED stages compiled clean"
exit 0

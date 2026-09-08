#!/usr/bin/env python3
"""Check every Minecraft symbol this mod uses against the Yarn mappings.

Usage: verify_against_yarn.py <index.json> [<src-root>]

Checks three things:
  1. every `import net.minecraft.*` resolves to a mapped class;
  2. every mixin's @Mixin target, injected method name and (where given)
     descriptor exists on that target;
  3. every @Shadow field and @Accessor field exists, and each injection handler's
     staticness matches its target's.

Run it after bumping the Minecraft version: a rename shows up here as a named
symbol rather than as a mixin failure at game launch.
"""
import json, os, re, sys

IMPLEMENTS = {
    # Yarn names an interface method on the interface, but the implementing
    # class physically carries the override that Mixin will target.
    "net/minecraft/client/texture/SpriteContents$AnimatorImpl": [
        "net/minecraft/client/texture/Animator",
    ],
}


def resolve_class(fq, index):
    internal = fq.replace(".", "/")
    if internal in index:
        return internal
    parts = internal.split("/")
    for i in range(len(parts) - 1, 0, -1):
        candidate = "/".join(parts[:i]) + "$" + "$".join(parts[i:])
        if candidate in index:
            return candidate
    return None


def check_imports(index, src_root):
    problems, checked = [], 0
    for dirpath, _, filenames in os.walk(src_root):
        for filename in filenames:
            if not filename.endswith(".java"):
                continue
            path = os.path.join(dirpath, filename)
            for lineno, line in enumerate(open(path), 1):
                match = re.match(r"\s*import\s+(net\.minecraft\.[\w.]+)\s*;", line)
                if not match:
                    continue
                checked += 1
                if resolve_class(match.group(1), index) is None:
                    problems.append("%s:%d unresolved import %s"
                                    % (os.path.relpath(path, src_root), lineno, match.group(1)))
    return problems, checked


def check_mixins(index, mixin_dir):
    problems, checked = [], 0
    for filename in sorted(os.listdir(mixin_dir)):
        if not filename.endswith(".java"):
            continue
        source = open(os.path.join(mixin_dir, filename)).read()

        imports = {}
        for match in re.finditer(r"import\s+(net\.minecraft\.[\w.]+)\s*;", source):
            resolved = resolve_class(match.group(1), index)
            if resolved:
                imports[match.group(1).split(".")[-1]] = resolved

        targets_match = re.search(r'@Mixin\(\s*targets\s*=\s*"([^"]+)"', source)
        if targets_match:
            target = targets_match.group(1).replace(".", "/")
        else:
            class_match = re.search(r"@Mixin\(([\w.]+)\.class\)", source)
            if not class_match:
                problems.append("%s: no @Mixin target" % filename)
                continue
            target = imports.get(class_match.group(1).split(".")[-1])

        if target is None or target not in index:
            problems.append("%s: @Mixin target not in mappings: %s" % (filename, target))
            continue
        checked += 1

        entry = index[target]
        by_name = {}
        for method in entry["methods"]:
            by_name.setdefault(method["name"], []).append(method)
        for extra in IMPLEMENTS.get(target, []):
            for method in index[extra]["methods"]:
                by_name.setdefault(method["name"], []).append(method)

        for match in re.finditer(
                r"@Shadow[^;]*?\n\s*(?:public|private|protected)?\s*(?:final\s+)?[\w.<>,\[\] $]+\s+(\w+)\s*;", source):
            checked += 1
            if not any(f["name"] == match.group(1) for f in entry["fields"]):
                problems.append("%s: @Shadow field '%s' missing on %s" % (filename, match.group(1), target))

        for match in re.finditer(r'@Accessor\("(\w+)"\)', source):
            checked += 1
            if not any(f["name"] == match.group(1) for f in entry["fields"]):
                problems.append("%s: @Accessor field '%s' missing on %s" % (filename, match.group(1), target))

        for match in re.finditer(r'method\s*=\s*"([^"]+)"', source):
            checked += 1
            spec = match.group(1)
            name = spec.split("(")[0]
            candidates = by_name.get(name)
            if not candidates:
                problems.append("%s: target method '%s' missing on %s" % (filename, name, target))
                continue
            if "(" in spec:
                wanted = ("(" + spec.split("(", 1)[1]).replace(".", "/")
                have = [c["desc"] for c in candidates]
                if wanted not in have:
                    problems.append("%s: descriptor mismatch for %s\n    given %s\n    have  %s"
                                    % (filename, name, wanted, have))

            target_static = candidates[0]["static"]
            following = source[match.end():match.end() + 700]
            handler = re.search(r"private\s+(static\s+)?\w", following)
            handler_static = bool(handler and handler.group(1))
            if target_static is not None and handler_static != target_static:
                problems.append("%s: '%s' is %s but the handler is %s"
                                % (filename, name,
                                   "static" if target_static else "an instance method",
                                   "static" if handler_static else "an instance method"))
    return problems, checked


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    index = json.load(open(sys.argv[1]))
    root = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "src", "main", "java")
    root = os.path.normpath(root)

    import_problems, import_count = check_imports(index, root)
    mixin_problems, mixin_count = check_mixins(index, os.path.join(root, "dev", "potatoclient", "mixin"))

    print("imports checked: %d" % import_count)
    print("mixin checks:    %d" % mixin_count)
    problems = import_problems + mixin_problems
    if problems:
        print("\n%d problem(s):" % len(problems))
        for problem in problems:
            print("  - " + problem)
        sys.exit(1)
    print("\nall Minecraft symbols resolve against these mappings")

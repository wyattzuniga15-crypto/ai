#!/usr/bin/env python3
"""Build a symbol index from a Yarn mappings checkout.

Usage: index_yarn.py <path-to-yarn-repo> <output.json>

The index records, for every mapped class, its methods and fields with
descriptors remapped from intermediary names to Yarn names. Method staticness is
recovered from the ARG indices: Enigma numbers a static method's first parameter
0 and an instance method's 1, so the minimum ARG index tells them apart.
"""
import collections, json, os, re, sys


def build(mappings_root):
    classes, obf2named = {}, {}
    files = [os.path.join(dp, fn) for dp, _, fns in os.walk(mappings_root)
             for fn in fns if fn.endswith(".mapping")]
    files.sort()

    for path in files:
        stack, current = [], None
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.rstrip("\n")
                if not line.strip():
                    continue
                indent = len(line) - len(line.lstrip("\t"))
                parts = line.strip().split()
                kind = parts[0]
                if kind == "COMMENT":
                    continue
                if kind == "ARG":
                    if current and len(parts) >= 2:
                        try:
                            current["args"].add(int(parts[1]))
                        except ValueError:
                            pass
                    continue
                while stack and stack[-1][0] >= indent:
                    stack.pop()
                if kind == "CLASS":
                    current = None
                    obf = parts[1]
                    named = parts[2] if len(parts) > 2 else obf
                    if stack:
                        parent_obf, parent_named = stack[-1][1], stack[-1][2]
                        obf_full = obf if "/" in obf else parent_obf + "$" + obf
                        named_full = parent_named + "$" + named.split("/")[-1]
                    else:
                        obf_full, named_full = obf, named
                    stack.append((indent, obf_full, named_full))
                    obf2named[obf_full] = named_full
                    classes.setdefault(named_full, {"obf": obf_full, "methods": {}, "fields": {}})
                elif kind in ("METHOD", "FIELD"):
                    if not stack:
                        continue
                    if len(parts) >= 4:
                        name, desc = parts[2], parts[3]
                    elif len(parts) == 3:
                        name, desc = parts[1], parts[2]
                    else:
                        continue
                    entry = classes.setdefault(stack[-1][2], {"obf": "?", "methods": {}, "fields": {}})
                    bucket = "methods" if kind == "METHOD" else "fields"
                    member = entry[bucket].setdefault((name, desc), {"args": set()})
                    current = member if kind == "METHOD" else None

    type_pattern = re.compile(r"L([^;]+);")

    def remap(desc):
        return type_pattern.sub(lambda m: "L" + obf2named.get(m.group(1), m.group(1)) + ";", desc)

    def param_count(desc):
        inner, count, i = desc[1:desc.index(")")], 0, 0
        while i < len(inner):
            while inner[i] == "[":
                i += 1
            i = inner.index(";", i) + 1 if inner[i] == "L" else i + 1
            count += 1
        return count

    out = {}
    for named, data in classes.items():
        entry = {"obf": data["obf"], "methods": [], "fields": []}
        for (name, desc), meta in sorted(data["methods"].items()):
            args = meta["args"]
            entry["methods"].append({
                "name": name,
                "desc": remap(desc),
                "static": (min(args) == 0) if args else None,
                "nargs": param_count(desc),
            })
        for (name, desc), _ in sorted(data["fields"].items()):
            entry["fields"].append({"name": name, "desc": remap(desc)})
        out[named] = entry
    return out


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    index = build(os.path.join(sys.argv[1], "mappings"))
    with open(sys.argv[2], "w") as handle:
        json.dump(index, handle)
    print("indexed %d classes" % len(index))

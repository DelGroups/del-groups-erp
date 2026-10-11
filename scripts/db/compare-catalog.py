#!/usr/bin/env python3
"""Compare two catalog snapshots made by supabase/baseline/catalog.sql.

    python3 scripts/db/compare-catalog.py supabase/baseline/live-catalog.json fresh.json

Prints every table, column, constraint, index, view, function, trigger, policy,
grant, bucket and publication entry that differs, and exits 1 if anything does.
--ignore-maintain drops the Postgres 17 MAINTAIN privilege, for checks on Postgres 16.
"""
import difflib
import json
import re
import sys

# Key that identifies an object inside each section.
KEYS = {
    "enums": lambda o: o["n"],
    "domains": lambda o: o["n"],
    "composites": lambda o: o["n"],
    "sequences": lambda o: o["n"],
    "tables": lambda o: o["n"],
    "constraints": lambda o: f"{o['t']}.{o['n']}",
    "indexes": lambda o: f"{o['t']}.{o['n']}",
    "views": lambda o: o["n"],
    "triggers": lambda o: f"{o['s']}.{o['t']}.{o['n']}",
    "policies": lambda o: f"{o['s']}.{o['t']}.{o['n']}",
    "functions": lambda o: f"{o['n']}({o['args']})",
    "buckets": lambda o: o["id"],
    "publication": lambda o: f"{o['pub']}.{o['t']}",
}

# What a NULL acl means for an object owned by postgres.
DEFAULT_ACL = {
    "tables": ["postgres=arwdDxtm"],
    "views": ["postgres=arwdDxtm"],
    "sequences": ["postgres=rwU"],
    "functions": ["=X", "postgres=X"],
}


def load(path):
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, list):
        data = data[0]
    return data.get("catalog", data)


def norm_acl(section, acl, ignore_maintain):
    items = DEFAULT_ACL[section] if acl is None else [a.split("/", 1)[0] for a in acl]
    if ignore_maintain:
        items = [i.replace("m", "") for i in items]
    return sorted(items)


def canon_check(defn):
    """Postgres prints `col::text = ANY (ARRAY[...varchar...])` differently once the
    constraint has been dumped and re-created; both spellings mean the same check."""
    defn = re.sub(r"\(('(?:[^']|'')*'::character varying)\)::text", r"\1", defn)
    return re.sub(r"ANY \(\((ARRAY\[[^\]]*\])\)::text\[\]\)", r"ANY (\1)", defn)


def normalise(cat, ignore_maintain):
    out = {}
    for section, key in KEYS.items():
        objs = {}
        for o in cat.get(section) or []:
            o = dict(o)
            if "acl" in o and section in DEFAULT_ACL:
                o["acl"] = norm_acl(section, o["acl"], ignore_maintain)
            if section == "constraints" and o["type"] == "c":
                o["def"] = canon_check(o["def"])
            if section == "functions":
                o["def"] = o["def"].replace("\r\n", "\n")
            objs[key(o)] = o
        out[section] = objs
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ignore_maintain = "--ignore-maintain" in sys.argv
    if len(args) != 2:
        sys.exit(__doc__)
    a, b = (normalise(load(p), ignore_maintain) for p in args)
    problems = 0
    for section in KEYS:
        left, right = a[section], b[section]
        for k in sorted(left.keys() - right.keys()):
            print(f"[{section}] missing in fresh DB: {k}")
            problems += 1
        for k in sorted(right.keys() - left.keys()):
            print(f"[{section}] only in fresh DB: {k}")
            problems += 1
        for k in sorted(left.keys() & right.keys()):
            if left[k] != right[k]:
                problems += 1
                print(f"[{section}] differs: {k}")
                l = json.dumps(left[k], indent=1, ensure_ascii=False, sort_keys=True).splitlines()
                r = json.dumps(right[k], indent=1, ensure_ascii=False, sort_keys=True).splitlines()
                for line in list(difflib.unified_diff(l, r, "live", "fresh", lineterm="", n=1))[:40]:
                    print("    " + line)
    counts = ", ".join(f"{s} {len(a[s])}" for s in KEYS if a[s])
    if problems:
        print(f"\n{problems} difference(s). Live has: {counts}")
        sys.exit(1)
    print(f"No differences. Compared: {counts}")


if __name__ == "__main__":
    main()

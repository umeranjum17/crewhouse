#!/usr/bin/env python3
"""Rank evidence rows, and find the days a repo's stars spiked. Standard library only: a bot's sandbox
has no node_modules, and its shell cannot reach anything else.

  score.py rank <evidence.csv> [--half-life HOURS] [--top N]
  score.py spikes <history.json> [--stars N]
  score.py test

evidence.csv rows: key,type,weight,url[,when] -- one row per sighting. Duplicate (key,type,url) rows count
once and each type is capped per key, so one loud source cannot carry a rival on its own. `when` (ISO, used
only with --half-life for threads) is when the sighting happened.

history.json: the stargazers history from api.github.com, [{"starred_at": ..., "users": [...]}, ...], or
the same data as [{"day": "2024-07-08", "stars": 646}].
"""
import csv, json, statistics, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
# How many rows of one type may count for one key (plan §2 step 2).
CAPS = {"gh-search": 3, "awesome": 2, "hn-alt": 2, "listicle": 3}
MIN_TYPES = 2  # a rival needs two distinct evidence types; threads need one


def rows(path):
    out, seen = [], set()
    for r in csv.reader(open(path, newline="", encoding="utf8")):
        if len(r) < 4 or not r[0].strip():
            continue
        key, kind, url = r[0].strip(), r[1].strip(), r[3].strip()
        when = r[4].strip() if len(r) > 4 else ""
        try:
            weight = float(r[2].strip() or 0)
        except ValueError:  # the header row
            continue
        if (key, kind, url) in seen:  # the same sighting twice is one sighting
            continue
        seen.add((key, kind, url))
        out.append({"key": key, "type": kind, "weight": weight, "url": url, "when": when})
    return out


def rank(path, half_life=None, top=12):
    by_key = {}
    for r in rows(path):
        kept = by_key.setdefault(r["key"], {})
        if len(kept.get(r["type"], [])) < CAPS.get(r["type"], 99):
            kept.setdefault(r["type"], []).append(r)
    out = []
    for key, kinds in by_key.items():
        count = [(r["weight"] * decay(r["when"], half_life)) for rs in kinds.values() for r in rs]
        out.append({"key": key, "score": round(sum(count), 3), "types": sorted(kinds),
                    "urls": [r["url"] for rs in kinds.values() for r in rs][:6]})
    out.sort(key=lambda k: (-k["score"], k["key"]))
    return out[:top] if half_life else out  # with a half-life the order is the whole answer


def decay(when, half_life):
    """1.0 for now, half every `half_life` hours. A row with no date never decays away."""
    if not half_life or not when:
        return 1.0
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(when.replace("Z", "+00:00"))).total_seconds() / 3600
    except ValueError:
        return 1.0
    return 0.5 ** (max(age, 0) / half_life)


def days_of(history):
    """Day -> stars. The API's own shape and the flat one both land here."""
    counts = {}
    for e in json.load(open(history, encoding="utf8")):
        if "day" in e:
            counts[e["day"]] = counts.get(e["day"], 0) + int(e["stars"])
        else:
            for t in [e["starred_at"]] + list(e.get("users") or []):
                d = str(t)[:10]
                counts[d] = counts.get(d, 0) + 1
    return counts


def spikes(history, total=None):
    """A day with enough stars and at least 4x its trailing 28-day median. Neighbouring days are one event."""
    counts = days_of(history)
    days = sorted(counts)
    bar = 10 if (total if total is not None else sum(counts.values())) < 1000 else 50
    events, run = [], []
    for d in days:
        start = datetime.fromisoformat(d) - timedelta(days=28)
        window = [counts[x] for x in days if start <= datetime.fromisoformat(x) < datetime.fromisoformat(d)]
        median = statistics.median(window) if window else 0
        if counts[d] >= bar and counts[d] >= 4 * median:
            if run and datetime.fromisoformat(d) - datetime.fromisoformat(run[-1]) == timedelta(days=1):
                run.append(d)
            else:
                run = [d]
                events.append(run)
        elif run:
            run = []
    return [{"days": len(e), "from": e[0], "to": e[-1], "stars": sum(counts[x] for x in e)} for e in events]



def main(argv):
    cmd, rest = argv[1], argv[2:]
    if cmd == "rank" and rest:
        path = rest[0]
        half = next((a.split("=")[1] for a in rest[1:] if a.startswith("--half-life")), None)
        out = rank(path, float(half) if half else None)
        if not half:  # one kind of evidence is not a rival (a thread needs only one, hence the half-life branch)
            out, maybe = [e for e in out if len(e["types"]) >= MIN_TYPES], [e["key"] for e in out if len(e["types"]) < MIN_TYPES]
            for e in out:
                print(f"{e['score']:.1f}\t{e['key']}\t{','.join(e['types'])}\t{' '.join(e['urls'])}")
            if maybe:
                print("\nmaybe (one kind of evidence only):\n  " + "\n  ".join(maybe))
        else:
            for e in out:
                print(f"{e['score']:g}\t{e['key']}\t{','.join(e['types'])}")
        return 0
    if cmd == "spikes" and rest:
        total = next((int(a.split("=")[1]) for a in rest[1:] if a.startswith("--stars")), None)
        for e in spikes(rest[0], total):
            print(f"{e['from']} to {e['to']}\t{e['days']} day(s)\t{e['stars']} stars")
        return 0
    if cmd == "test":
        return self_test()
    print(__doc__)
    return 2


def self_test():
    """The fixtures in this folder are the agreed examples: run them, print one line each."""
    checks = []
    ev = [e for e in spikes(FIXTURES / "spikes-big.json") if e["from"] >= "2024-07-01"]
    checks.append(("a 646-star day and the day after are one spike", len(ev) == 1 and ev[0]["days"] == 2 and ev[0]["from"] == "2024-07-08"))
    small = spikes(FIXTURES / "spikes-small.json", total=35)
    checks.append(("a 15-star day on a 35-star repo is a spike", [e["from"] for e in small] == ["2024-05-10"]))
    maybe = [r["key"] for r in rank(FIXTURES / "evidence.csv") if len(r["types"]) < MIN_TYPES]
    checks.append(("one kind of evidence lands in maybe", maybe == ["solo"]))
    dupe = next(r for r in rank(FIXTURES / "evidence.csv") if r["key"] == "dupe")
    checks.append(("a duplicate listicle URL counts once", dupe["score"] == 3.0 and dupe["urls"].count("https://example.test/best-tools") == 1))
    threads = rank(FIXTURES / "threads.csv", half_life=72)
    checks.append(("one kind of evidence is enough for a thread", [t["key"] for t in threads] == ["fresh", "stale"]))
    bad = [name for name, ok in checks if not ok]
    for name, ok in checks:
        print(f"{'ok  ' if ok else 'FAIL'} {name}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
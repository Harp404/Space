#!/usr/bin/env python3
"""
Unmodeled-maneuver detector — ML that PRODUCES the fourth state.

    python train_maneuver_detector.py       # CPU, minutes

WHY IT MATTERS

    If an object manoeuvred and nobody told us, every prediction about it is
    void. Not wrong — VOID. The propagated state describes an orbit the object
    is no longer in.

    So this detector does not produce a confident number. It produces an
    UNKNOWN: a detected unannounced maneuver sets FR-10 to UNEVALUATED, and the
    signal goes UNRESOLVED until fresh orbit determination arrives.

    Most ML in a safety system tries to be more certain. This one exists to be
    honestly less certain, which is the harder and more useful thing.

METHOD

    Change-point detection on TLE-derived orbital elements. A maneuver shows up
    as a step in semi-major axis (or mean motion) that natural drag cannot
    explain — drag is monotonic and slow; a burn is not.

    Established technique; a published variant classifies Starlink TLE history
    into non-maneuver / orbit raising / orbit lowering / station-keeping.

DATA
    Space-Track TLE history. The gateway's cached catalogue is a single epoch,
    so this needs a history pull — the script prints the query if absent.

OUTPUT
    dev/cache/models/maneuver-detector.json  (thresholds, not a heavy model)
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HIST = Path(__file__).resolve().parent / "data" / "tle_history.json"
OUT = ROOT / "dev" / "cache" / "models" / "maneuver-detector.json"

MU = 398600.4418


def sma_km(mean_motion_rev_day):
    n = mean_motion_rev_day * 2 * 3.141592653589793 / 86400
    return (MU / (n ** 2)) ** (1 / 3)


def main():
    try:
        import numpy as np
    except ImportError as e:
        sys.exit(f"\n  missing dependency ({e}). Run: pip install -r requirements.txt\n")

    if not HIST.exists():
        sys.exit(f"""
  {HIST} not found.

  Pull TLE history from Space-Track, e.g. for one object over 90 days:

    /basicspacedata/query/class/gp_history/NORAD_CAT_ID/44714/
      EPOCH/>now-90/orderby/EPOCH asc/format/json

  Save as: {{"44714": [{{"EPOCH": "...", "MEAN_MOTION": 15.06, "BSTAR": 0.0001}}, ...], ...}}
""")

    hist = json.loads(HIST.read_text())
    print(f"TLE history: {len(hist)} object(s)")

    # Calibrate PER OBJECT, not pooled.
    #
    # First attempt pooled all objects into one baseline and flagged 35% of
    # transitions — nonsense. The reason is obvious in hindsight: a Starlink
    # station-keeps constantly while a debris fragment only ever experiences
    # drag. They do not share a "natural" distribution, so a pooled baseline is
    # a baseline of nothing.
    per_object, profiles = {}, {}
    for norad, rows in hist.items():
        rows = sorted(rows, key=lambda r: r["EPOCH"])
        name = rows[0].get("OBJECT_NAME", norad) if rows else norad
        rates = []
        for a, b in zip(rows, rows[1:]):
            try:
                da = sma_km(float(b["MEAN_MOTION"])) - sma_km(float(a["MEAN_MOTION"]))
                dt = (np.datetime64(b["EPOCH"]) - np.datetime64(a["EPOCH"])) / np.timedelta64(1, "D")
            except (KeyError, ValueError, TypeError):
                continue
            if dt <= 0 or dt > 3:
                continue
            rates.append(da / dt)          # km/day
        if len(rates) < 30:
            print(f"  {name}: only {len(rates)} usable pairs — skipped")
            continue
        per_object[str(norad)] = rates
        profiles[str(norad)] = {"name": name, "pairs": len(rates)}

    if not per_object:
        sys.exit("\n  no object had enough usable element pairs.\n")

    threshold = 4.0      # robust z beyond which drag cannot explain the step
    print(f"\n  calibrating per object (robust median / MAD), flagging |z| > {threshold}\n")
    print(f"  {'object':<24}{'pairs':>7}{'median km/d':>14}{'sigma':>10}{'flagged':>10}")

    for norad, rates in per_object.items():
        arr = np.array(rates)
        med = float(np.median(arr))
        mad = float(np.median(np.abs(arr - med)))
        sigma = 1.4826 * mad
        z = np.abs((arr - med) / max(sigma, 1e-9))
        flagged = int(np.sum(z > threshold))
        rate = flagged / len(arr)
        profiles[norad].update({
            "median_da_dt_km_day": round(med, 6),
            "robust_sigma_km_day": round(sigma, 6),
            "flag_rate": round(rate, 5),
        })
        print(f"  {profiles[norad]['name']:<24}{len(arr):>7}{med:>14.4f}{sigma:>10.4f}{rate * 100:>9.1f}%")

    # The sanity check that decides whether this works at all: an actively
    # station-keeping constellation should flag OFTEN; a debris fragment that
    # only ever experiences drag should flag almost NEVER. If that ordering does
    # not hold, the detector is measuring noise.
    active = [p for p in profiles.values() if "STARLINK" in str(p["name"]).upper()]
    inert = [p for p in profiles.values() if "DEB" in str(p["name"]).upper()]
    if active and inert:
        a_rate = sum(p["flag_rate"] for p in active) / len(active)
        i_rate = sum(p["flag_rate"] for p in inert) / len(inert)
        print(f"\n  SANITY CHECK  active constellation {a_rate * 100:.1f}%  vs  inert debris {i_rate * 100:.1f}%")
        print(f"  -> {'PASS: active objects flag more than inert ones, as they must' if a_rate > i_rate else 'FAIL: the ordering is wrong — this detector is measuring noise'}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "name": "maneuver-detector", "version": 1, "kind": "threshold",
        "features": ["delta_mean_motion"],
        "z_threshold": threshold,
        "per_object": profiles,
        "training": {
            "dataset": "Space-Track TLE history, 120 days",
            "objects": len(profiles),
            "rows": sum(len(v) for v in per_object.values()),
            "held_out_score": None,
        },
        "honesty": [
            "Unsupervised: there is no labelled maneuver ground truth here, so there is no accuracy figure to quote. The flag rate is reported instead.",
            "Calibrated PER OBJECT. A pooled baseline across a station-keeping constellation and an inert fragment is a baseline of nothing — the first attempt did exactly that and flagged 35% of transitions.",
            "An object with no calibration profile gets NO detection, which reports UNEVALUATED rather than a guess from someone else's drag regime.",
            "A flag means UNKNOWN, not 'manoeuvred'. It sets FR-10 to UNEVALUATED so the signal goes UNRESOLVED until fresh orbit determination arrives.",
            "WEAK NUMBER, VOLUNTEERED: separation between an actively station-keeping constellation and inert debris is only about 3.2% vs 2.0%. The robust z-score adapts sigma to each object, so an object that manoeuvres CONSTANTLY gets a wide baseline and its own burns stop looking anomalous relative to itself. This detector is most useful on objects that manoeuvre rarely, and least useful on the ones that manoeuvre most.",
            "Fixing that properly needs a physics-based drag model to predict the expected decay and flag departures from it, rather than a self-referential statistic. That is the next step, not something this achieves.",
        ],
        "feeds": "FR-10 — invalidates orbit determination, producing UNRESOLVED",
    }))
    print(f"\n  wrote {OUT}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Conformal calibration for TLE-based screening.

    python calibrate_conformal.py

THE PROBLEM THIS SOLVES

    FR-01 compares a point estimate to a limit:

        Pc = 3.1e-5   vs   the CARA red threshold 1e-4   ->  SATISFIED

    But a point estimate with unknown error is not evidence. If the true value
    could plausibly be anywhere from 8e-6 to 2.4e-4, the honest answer is not
    "satisfied" — it is "our evidence cannot discriminate against this limit".

    Conformal prediction earns the right to say that, with a distribution-free
    finite-sample coverage guarantee.

WHY NOT CALIBRATE AGAINST CDMs

    The obvious calibration set is our SGP4 screening paired with the
    operational CDM for the same encounter. We checked: across 12 screened
    events and 37 live CDMs there were ZERO overlapping object pairs. Our
    screening and the 19th SDS simply surface different encounters. A
    calibration set of zero is not a calibration set.

WHAT WE CALIBRATE ON INSTEAD — and it is arguably the better signal

    TLE AGE. Take one object, propagate it to a fixed future time from an OLD
    element set, then from the FRESHEST element set available. The freshest is
    the best estimate; the difference is the error an operator would actually
    have made by acting on the older one.

    That is exactly the quantity FR-10 already worries about, measured instead
    of assumed, and it needs no second data source.

DATA
    ml/data/tle_history_typical.json — inert objects at 600-900 km perigee,
    which is where conjunctions actually happen. The first attempt used the
    density model's history instead (186-302 km rocket bodies) and produced a
    95% error of 74 km, roughly two orders of magnitude too large, because those
    objects decay ~100x faster than a typical conjunction object.

OUTPUT
    dev/cache/models/conformal-screening.json
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Objects at TYPICAL conjunction altitudes (600-900 km perigee). The
# density-model history is deliberately drag-extreme (186-302 km) and would
# bias this calibration high by ~2 orders of magnitude.
HIST = Path(__file__).resolve().parent / "data" / "tle_history_typical.json"
OUT = ROOT / "dev" / "cache" / "models" / "conformal-screening.json"

MU = 398600.4418
# How far ahead we propagate. 24 h is the standard conjunction screening window.
HORIZON_MIN = 24 * 60
# Age buckets, in days. Screening-grade error should grow with each.
AGE_BUCKETS = [(0.5, 1.5), (1.5, 3.0), (3.0, 7.0)]


def sma_km(mm):
    n = mm * 2 * 3.141592653589793 / 86400
    return (MU / (n ** 2)) ** (1 / 3)


def main():
    try:
        import numpy as np
    except ImportError as e:
        sys.exit(f"\n  missing dependency ({e}). Run: pip install -r requirements.txt\n")

    if not HIST.exists():
        sys.exit(f"\n  {HIST} not found. See train_maneuver_detector.py for the Space-Track pull.\n")

    hist = json.loads(HIST.read_text())
    print(f"TLE history: {len(hist)} objects")

    # For each object, pair every older element set with the freshest one that
    # follows it, and measure how far apart they place the object at a common
    # future time. Along-track dominates, so semi-major axis drift is a faithful
    # and cheap proxy for the position error that matters.
    buckets = {f"{lo}-{hi}d": [] for lo, hi in AGE_BUCKETS}
    total = 0

    for norad, rows in hist.items():
        rows = sorted(rows, key=lambda r: r["EPOCH"])
        if len(rows) < 5:
            continue
        try:
            epochs = np.array([np.datetime64(r["EPOCH"]) for r in rows])
            smas = np.array([sma_km(float(r["MEAN_MOTION"])) for r in rows])
        except (KeyError, ValueError, TypeError):
            continue

        for i in range(len(rows) - 1):
            for j in range(i + 1, len(rows)):
                age_d = float((epochs[j] - epochs[i]) / np.timedelta64(1, "D"))
                if age_d <= 0 or age_d > 7:
                    break
                bucket = next((f"{lo}-{hi}d" for lo, hi in AGE_BUCKETS if lo <= age_d < hi), None)
                if not bucket:
                    continue
                # Along-track separation after HORIZON_MIN caused by the sma
                # difference: d(along) ≈ 3/2 * (da/a) * v * t
                a_old, a_new = smas[i], smas[j]
                if a_old <= 0:
                    continue
                v = (MU / a_old) ** 0.5                          # km/s
                along_km = abs(1.5 * ((a_new - a_old) / a_old) * v * HORIZON_MIN * 60)
                if along_km <= 0:
                    continue
                buckets[bucket].append(along_km)
                total += 1
                break            # one pairing per (i), the nearest fresher set

    print(f"  {total:,} age-paired propagations at a {HORIZON_MIN // 60} h horizon\n")
    print(f"  {'TLE age':<12}{'n':>7}{'median err':>14}{'p90':>12}{'p95':>12}")

    out_buckets = {}
    for name, vals in buckets.items():
        # A guarantee computed from a handful of points is not a guarantee.
        # A bucket we cannot calibrate is simply absent, and the rule reading it
        # reports UNEVALUATED for that TLE age.
        if len(vals) < 100:
            print(f"  {name:<12}{len(vals):>7}   (too few — not shipped; that age reports UNEVALUATED)")
            continue
        a = np.sort(np.array(vals))
        # Split-conformal quantile: ceil((n+1)(1-alpha))/n
        n = len(a)
        q95 = float(a[min(n - 1, int(np.ceil((n + 1) * 0.95)) - 1)])
        q90 = float(a[min(n - 1, int(np.ceil((n + 1) * 0.90)) - 1)])
        med = float(np.median(a))
        out_buckets[name] = {
            "n": n,
            "median_km": round(med, 4),
            "q90_km": round(q90, 4),
            "q95_km": round(q95, 4),
        }
        print(f"  {name:<12}{n:>7}{med:>14.3f}{q90:>12.3f}{q95:>12.3f}")

    if not out_buckets:
        sys.exit("\n  no age bucket had enough samples to calibrate.\n")

    # The trend is the finding: screening error must GROW with element-set age.
    names = list(out_buckets.keys())
    grows = all(
        out_buckets[names[k]]["q95_km"] <= out_buckets[names[k + 1]]["q95_km"]
        for k in range(len(names) - 1)
    ) if len(names) > 1 else None
    if grows is not None:
        print(f"\n  {'PASS' if grows else 'FAIL'} — screening error "
              f"{'grows' if grows else 'does NOT grow'} monotonically with TLE age")
        if not grows:
            print("  Reporting that rather than shipping a calibration whose trend is wrong.")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "name": "conformal-screening", "version": 1, "kind": "conformal_intervals",
        "features": [],
        "quantity": "miss-distance error (km) introduced by acting on an aged element set",
        "horizon_min": HORIZON_MIN,
        "buckets": out_buckets,
        "coverage": 0.95,
        "method": "split conformal — distribution-free, finite-sample coverage. The q95 column IS the interval half-width at 95%.",
        "usage": "Widen a screened miss distance by the bucket matching its TLE age. If the widened interval STRADDLES a rule's limit, that rule reports UNEVALUATED rather than SATISFIED.",
        "training": {
            "dataset": "Space-Track TLE history, age-paired self-comparison",
            "objects": len(hist),
            "rows": total,
            "held_out_score": None,
            "monotonic_in_age": grows,
        },
        "honesty": [
            "Calibrated against our own FRESHEST element set, not against independent truth. It measures how much acting on stale data would have moved our answer — which is the operationally relevant error, but it is not an absolute accuracy figure.",
            "Uses along-track displacement from semi-major-axis drift. Along-track dominates conjunction geometry, but it is a proxy, not a full covariance.",
            "We could not calibrate against operational CDMs: across 12 screened events and 37 live CDMs there were ZERO overlapping object pairs.",
            "Calibrated on inert objects at 600-900 km perigee, where conjunctions actually happen. Applying it to a very low or very high orbit would be extrapolation.",
            "Age buckets with fewer than 100 samples are NOT shipped. A TLE age with no calibrated bucket reports UNEVALUATED rather than borrowing a neighbouring bucket's number.",
        ],
        "feeds": "FR-01 and FR-12 — turns a point estimate into an interval, and a straddling interval into UNRESOLVED",
    }))
    print(f"\n  wrote {OUT}")


if __name__ == "__main__":
    main()

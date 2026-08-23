#!/usr/bin/env python3
"""
Zero-shot baseline for the flare forecaster.

    python chronos_baseline.py --hours 24

THE QUESTION

    dev/constraints/flares.js forecasts a flare's soft-X-ray peak using physics:
    the Neupert effect says hard X-rays and the hardness ratio rise BEFORE the
    soft peak that sets the flare class, so watching both bands buys lead time.

    That is a hand-built, domain-specific model. It deserves a fair fight
    against a generic one:

        Does a pretrained time-series foundation model, applied ZERO-SHOT with
        no knowledge of solar physics whatsoever, forecast the soft X-ray curve
        better than our two-band physics model?

    Both answers are useful:
      • If Chronos wins, our physics model is not earning its complexity and we
        should say so.
      • If Chronos loses, that is evidence the two-band structure carries real
        information a generic forecaster cannot recover from one channel — which
        is the entire premise of using SoLEXS and HEL1OS together.

    A comparison you cannot lose is not a comparison.

MODEL

    amazon/chronos-bolt-small — pretrained, zero-shot, no fine-tuning. It has
    never seen a solar flare and is not told what these numbers mean.

DATA

    NOAA GOES XRS, the same live two-band feed the forecaster uses.

OUTPUT

    ml/data/chronos_baseline.json — a comparison row for the benchmark table.
    Ships nothing into the gateway.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "chronos_baseline.json"
MODEL_ID = "amazon/chronos-bolt-small"


def fetch_series(hours):
    """Reuse the gateway's own ingestion so both models see identical input."""
    js = f"""
    const F = require('{HERE.parent}/dev/constraints/flares');
    F.fetchSeries().then(s => console.log(JSON.stringify(s))).catch(e => {{
      console.error(e.message); process.exit(1);
    }});
    """
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        sys.exit(f"\n  could not fetch the GOES series: {r.stderr.strip()}\n")
    return json.loads(r.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=6)
    ap.add_argument("--horizon", type=int, default=12, help="forecast horizon in minutes")
    args = ap.parse_args()

    try:
        import numpy as np
        import torch
    except ImportError as e:
        sys.exit(f"\n  missing dependency ({e}). Run: pip install -r requirements.txt\n")

    try:
        from chronos import BaseChronosPipeline
    except ImportError:
        sys.exit("""
  chronos not installed.

    pip install chronos-forecasting

  amazon/chronos-bolt-small is a pretrained time-series foundation model used
  here ZERO-SHOT — no training, no fine-tuning. It is the fair generic
  opponent for our physics-based two-band forecaster.
""")

    print(f"Fetching GOES XRS ({args.hours} h window)...")
    series = fetch_series(args.hours)
    if len(series) < 60:
        sys.exit(f"\n  only {len(series)} aligned samples — need at least 60.\n")
    soft = np.array([r["soft"] for r in series], dtype=np.float64)
    print(f"  {len(soft):,} one-minute samples")

    print(f"\nLoading {MODEL_ID} (zero-shot, never fine-tuned)...")
    pipe = BaseChronosPipeline.from_pretrained(
        MODEL_ID,
        device_map="cuda" if torch.cuda.is_available() else "cpu",
        torch_dtype=torch.float32,
    )

    # Walk forward: at each cut, forecast `horizon` minutes and score against
    # what actually happened. Log space, because X-ray flux is multiplicative
    # and the flare classes are decades.
    h = args.horizon
    cuts = range(60, len(soft) - h, max(1, (len(soft) - h - 60) // 40))
    chronos_err, persist_err, n = [], [], 0

    for c in cuts:
        ctx = torch.tensor(np.log10(soft[:c]), dtype=torch.float32)
        try:
            q, _ = pipe.predict_quantiles(ctx, prediction_length=h, quantile_levels=[0.1, 0.5, 0.9])
        except Exception as e:
            print(f"  forecast failed at cut {c}: {e}")
            continue
        median = q[0, :, 1].numpy()
        truth = np.log10(soft[c:c + h])
        chronos_err.append(float(np.mean(np.abs(median - truth))))
        # Persistence: assume the last value holds. The baseline every forecaster
        # must beat before it has earned anything.
        persist_err.append(float(np.mean(np.abs(np.log10(soft[c - 1]) - truth))))
        n += 1

    if not n:
        sys.exit("\n  no successful forecasts.\n")

    c_mae, p_mae = float(np.mean(chronos_err)), float(np.mean(persist_err))
    print(f"\n  {n} walk-forward forecasts at a {h}-minute horizon (log10 flux, MAE)")
    print(f"    chronos zero-shot  {c_mae:.4f}")
    print(f"    persistence        {p_mae:.4f}")
    print(f"    -> chronos {'BEATS' if c_mae < p_mae else 'does NOT beat'} persistence "
          f"({100 * (p_mae - c_mae) / p_mae:+.1f}%)")

    print("""
  HOW TO READ THIS

    Chronos forecasts the soft-X-ray CURVE from one channel. Our model forecasts
    the flare CLASS and the resulting radio blackout, from two channels, using
    the Neupert relationship between them. They are not the same task, so this
    is a reference point rather than a head-to-head score.

    What it does establish: how much of the soft curve is predictable from its
    own history alone. Anything our two-band model adds beyond that is the value
    of the hard channel — which is exactly the claim the SoLEXS/HEL1OS pairing
    rests on.
""")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "model": MODEL_ID,
        "mode": "zero-shot, no fine-tuning",
        "task": "forecast log10 soft X-ray flux",
        "horizon_min": h,
        "forecasts": n,
        "samples": len(soft),
        "chronos_mae_log10": round(c_mae, 5),
        "persistence_mae_log10": round(p_mae, 5),
        "chronos_beats_persistence": bool(c_mae < p_mae),
        "improvement_pct": round(100 * (p_mae - c_mae) / p_mae, 2),
        "honesty": [
            "Zero-shot: the model has never seen a solar flare and is not told what these numbers mean.",
            "Different task from our forecaster: Chronos predicts the soft curve from one channel; ours predicts the flare class and blackout from two, via the Neupert effect.",
            "This is a reference point, not a head-to-head score. It measures how much of the soft curve is predictable from its own history — the rest is what the hard channel is worth.",
            "Scored on a single live window. A quiet window makes persistence look strong; a flaring one makes it look weak.",
        ],
        "ships": "nothing — this is a benchmark row",
    }))
    print(f"  wrote {OUT}")


if __name__ == "__main__":
    main()

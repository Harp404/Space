#!/usr/bin/env python3
"""
Risk-escalation forecaster — ESA Kelvins Collision Avoidance Challenge.

    python train_risk_forecaster.py

WHAT IT PREDICTS

    Given the CDMs available up to 2 days before closest approach, predict the
    FINAL collision risk at TCA.

    Reframed for the constraint gate, that is a CONSTRAINT FORECASTER:

        "This event has a 78% probability of crossing the FR-01 red threshold
         within 14 hours. The constraint work must be closed before then."

    Every other rule in the system evaluates conditions as they are now. This
    one puts a deadline on a rule that currently passes, which is what turns the
    completion signal from a report into a warning.

DATA — free, real, and with a published leaderboard to compare against

    ESA Kelvins Collision Avoidance Challenge
      https://kelvins.esa.int/collision-avoidance-challenge/data/
      (Kaggle mirror: shadmanrohan/collisionavoidancechallenge)

    162,634 CDM rows · 13,154 unique events · 103 features · 2015–2019
    Test: 24,484 rows / 2,167 events

    Place train_data.csv (and optionally test_data.csv) in ml/data/.

WHY GRADIENT BOOSTING AND NOT A TRANSFORMER

    The data is tabular with ~100 columns and 13k events. Gradient boosting is
    the correct tool, trains in seconds on a CPU, and — critically — exports to
    a few hundred numbers that run in plain JavaScript. A transformer here would
    be a worse model AND a runtime dependency.

OUTPUT

    dev/cache/models/risk-forecaster.json
      A self-describing artefact: feature order, trees, training metadata, and
      its own held-out score. Loaded by dev/constraints/models.js.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(__file__).resolve().parent / "data"
OUT = ROOT / "dev" / "cache" / "models" / "risk-forecaster.json"

TRAIN_CSV = DATA / "train_data.csv"

# The event-level target. Kelvins defines it as the risk in the LAST CDM before
# TCA — the value the operator would eventually have had to act on.
TARGET = "risk"

# Features chosen for two reasons: they are the physically meaningful ones, and
# every one of them exists in the CDM the gateway already ingests. A model that
# needs a column we cannot supply at inference time is useless no matter how
# well it scores.
FEATURES = [
    "time_to_tca",
    "miss_distance",
    "relative_speed",
    "relative_position_r",
    "relative_position_t",
    "relative_position_n",
    "t_sigma_r", "t_sigma_t", "t_sigma_n",
    "c_sigma_r", "c_sigma_t", "c_sigma_n",
    "max_risk_estimate",
    "max_risk_scaling",
    "mahalanobis_distance",
    "c_object_type",
]


def need(msg):
    print(f"\n  {msg}\n", file=sys.stderr)
    sys.exit(1)


def main():
    try:
        import numpy as np
        import pandas as pd
        from sklearn.ensemble import HistGradientBoostingRegressor
        from sklearn.model_selection import GroupShuffleSplit
        from sklearn.metrics import mean_absolute_error
    except ImportError as e:
        need(f"missing dependency ({e}). Run: pip install -r requirements.txt")

    if not TRAIN_CSV.exists():
        need(
            f"{TRAIN_CSV} not found.\n"
            "  Download the ESA Kelvins Collision Avoidance Challenge dataset:\n"
            "    https://kelvins.esa.int/collision-avoidance-challenge/data/\n"
            "  and place train_data.csv in ml/data/"
        )

    print("Loading ESA Kelvins CDM dataset...")
    df = pd.read_csv(TRAIN_CSV)
    print(f"  {len(df):,} CDM rows · {df['event_id'].nunique():,} events · {df.shape[1]} columns")

    # Kelvins' framing: use only CDMs issued MORE than 2 days before TCA to
    # predict the final risk. Anything closer would be leakage — and would also
    # be useless operationally, because by then there is no lead time left.
    train_rows = df[df["time_to_tca"] > 2].copy()
    final = (
        df.sort_values("time_to_tca")
        .groupby("event_id")
        .first()[[TARGET]]
        .rename(columns={TARGET: "final_risk"})
    )
    train_rows = train_rows.join(final, on="event_id")
    train_rows = train_rows.dropna(subset=["final_risk"])
    print(f"  {len(train_rows):,} rows usable (issued > 2 days before TCA)")

    feats = [f for f in FEATURES if f in train_rows.columns]
    missing = set(FEATURES) - set(feats)
    if missing:
        print(f"  note: {len(missing)} feature(s) absent from this dump: {sorted(missing)}")

    # Object type is categorical; encode it stably so the same mapping can be
    # applied at inference time in JavaScript.
    type_map = {}
    if "c_object_type" in feats:
        cats = sorted(train_rows["c_object_type"].astype(str).unique())
        type_map = {c: i for i, c in enumerate(cats)}
        train_rows["c_object_type"] = train_rows["c_object_type"].astype(str).map(type_map)

    X = train_rows[feats].astype(float).values
    y = train_rows["final_risk"].astype(float).values
    groups = train_rows["event_id"].values

    # Split BY EVENT, never by row. Rows from the same event are strongly
    # correlated; a random row split would leak and produce a flattering,
    # meaningless score.
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    tr, te = next(splitter.split(X, y, groups))
    print(f"  train {len(tr):,} rows · held-out {len(te):,} rows (split by event, not by row)")

    print("\nTraining gradient-boosted regressor (CPU)...")
    model = HistGradientBoostingRegressor(
        max_iter=300, learning_rate=0.06, max_depth=6,
        l2_regularization=1.0, random_state=42,
    )
    model.fit(X[tr], y[tr])

    pred = model.predict(X[te])
    mae = mean_absolute_error(y[te], pred)

    # The baselines that matter. A model that cannot beat "assume the risk stays
    # where it is" has learned nothing, and saying so is the honest outcome.
    persistence_idx = feats.index("risk") if "risk" in feats else None
    baseline_const = mean_absolute_error(y[te], np.full_like(y[te], np.median(y[tr])))
    baseline_persist = (
        mean_absolute_error(y[te], train_rows.iloc[te]["risk"].values)
        if "risk" in train_rows.columns else None
    )

    print(f"\n  held-out MAE            {mae:.4f}")
    print(f"  baseline (median)       {baseline_const:.4f}")
    if baseline_persist is not None:
        print(f"  baseline (persistence)  {baseline_persist:.4f}")
        verdict = "beats persistence" if mae < baseline_persist else "DOES NOT beat persistence — report this"
        print(f"  verdict: {verdict}")

    # Export. HistGradientBoosting does not serialise to plain arithmetic
    # cleanly, so we ship a decision-tree ensemble instead — same family, and it
    # exports to numbers a JS interpreter can walk.
    from sklearn.ensemble import GradientBoostingRegressor
    print("\nRe-fitting an exportable ensemble...")
    exportable = GradientBoostingRegressor(
        n_estimators=120, learning_rate=0.08, max_depth=4, random_state=42
    )
    exportable.fit(X[tr], y[tr])
    exp_mae = mean_absolute_error(y[te], exportable.predict(X[te]))
    print(f"  exportable held-out MAE {exp_mae:.4f}")

    trees = []
    for est in exportable.estimators_[:, 0]:
        t = est.tree_
        trees.append({
            "feature": t.feature.tolist(),
            "threshold": [round(float(v), 6) for v in t.threshold],
            "left": t.children_left.tolist(),
            "right": t.children_right.tolist(),
            "value": [round(float(v[0][0]), 6) for v in t.value],
        })

    artefact = {
        "name": "risk-forecaster",
        "version": 1,
        "kind": "gradient_boosted_trees",
        "features": feats,
        "categorical_maps": {"c_object_type": type_map} if type_map else {},
        "init": round(float(exportable.init_.constant_[0][0]), 6),
        "learning_rate": exportable.learning_rate,
        "trees": trees,
        "training": {
            "dataset": "ESA Kelvins Collision Avoidance Challenge",
            "url": "https://kelvins.esa.int/collision-avoidance-challenge/data/",
            "rows": int(len(train_rows)),
            "events": int(train_rows["event_id"].nunique()),
            "window": "2015-2019",
            "split": "GroupShuffleSplit by event_id, 20% held out",
            "held_out_mae": round(float(exp_mae), 4),
            "baseline_median_mae": round(float(baseline_const), 4),
            "baseline_persistence_mae": round(float(baseline_persist), 4) if baseline_persist is not None else None,
        },
        "honesty": [
            "Trained on 2015-2019 conjunctions and applied to 2026 traffic — the distribution has shifted and that gap is real.",
            "Predicts the final risk of an event ALREADY BEING TRACKED. It does not predict that a conjunction will occur.",
            "Feeds FR-01 as a predicted deadline. It never supplies a rule verdict directly.",
        ],
        "feeds": "FR-01 — predicted time to cross the CARA red threshold",
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(artefact))
    size_kb = OUT.stat().st_size / 1024
    print(f"\n  wrote {OUT} ({size_kb:.0f} KB, {len(trees)} trees)")
    print("  restart the gateway to pick it up.")


if __name__ == "__main__":
    main()

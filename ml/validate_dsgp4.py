#!/usr/bin/env python3
"""
dSGP4 validation — produces a benchmark number, ships nothing.

    python validate_dsgp4.py

WHY IT SHIPS NOTHING

    dSGP4 is ESA's differentiable SGP4 (Acciarini, Baydin & Izzo, Acta
    Astronautica 2025). Because it is differentiable it yields the STATE
    TRANSITION MATRIX, which is how you propagate a covariance from TLE-derived
    parameters — the thing the README says public TLEs cannot give you.

    Running it live would mean putting PyTorch in the request path. So we run it
    ONCE, offline, to answer one question honestly:

        How far apart are our satellite.js SGP4 propagation and ESA's
        reference implementation?

    The answer is a number for the benchmark table. Nothing is shipped.

WHAT A GOOD RESULT LOOKS LIKE

    Sub-metre agreement. Both implement the same published SGP4, so a large
    disagreement would mean OUR propagation is wrong — which is exactly what a
    validation is for. A validation that cannot fail is not a validation.

    pip install dsgp4
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "dev" / "cache" / "catalogue.3le"
OUT = Path(__file__).resolve().parent / "data" / "dsgp4_validation.json"


def main():
    try:
        import numpy as np
        import torch
        import dsgp4
    except ImportError as e:
        sys.exit(f"""
  missing dependency ({e})

    pip install dsgp4 torch numpy

  dSGP4 is ESA's differentiable SGP4:
    https://github.com/esa/dSGP4
    Acciarini, Baydin & Izzo, Acta Astronautica (2025), arXiv:2402.04830
""")

    if not CAT.exists():
        sys.exit(f"\n  {CAT} not found. Run the gateway once to populate the catalogue.\n")

    lines = CAT.read_text(errors="ignore").splitlines()
    tles, names, norads = [], [], []
    for i in range(0, len(lines) - 2, 3):
        l1, l2 = lines[i + 1], lines[i + 2]
        if l1.startswith("1 ") and l2.startswith("2 "):
            tles.append([l1, l2])
            names.append(lines[i].replace("0 ", "").strip())
            # Key on NORAD, not name. The catalogue has hundreds of objects
            # called "DELTA 1 DEB" and "FENGYUN 1C DEB"; matching by name
            # compares the wrong TLEs and invents a 7,800 km disagreement.
            norads.append(int(l2[2:7]))
        if len(tles) >= 200:
            break

    print(f"Validating against {len(tles)} real catalogue objects...\n")

    results, failures = [], 0
    for name, norad, (l1, l2) in zip(names, norads, tles):
        try:
            tle = dsgp4.tle.TLE([l1, l2])
            dsgp4.initialize_tle(tle)
            for minutes in (0.0, 60.0, 720.0, 1440.0):
                state = dsgp4.propagate(tle, torch.tensor([minutes], dtype=torch.float64))
                pos = state[0][:3].detach().numpy() if hasattr(state[0], "detach") else np.array(state[0][:3])
                results.append({
                    "name": name, "norad": norad, "minutes": minutes,
                    "r_km": [float(v) for v in pos],
                    "r_mag_km": float(np.linalg.norm(pos)),
                })
        except Exception:
            failures += 1
            continue

    if not results:
        sys.exit("\n  no object propagated successfully — check the dsgp4 version.\n")

    print(f"  {len(results):,} propagations across {len(results) // 4} objects ({failures} objects failed to initialise)")
    print("\n  Compare these against dev/constraints reference output with:")
    print("    node ml/compare_dsgp4.js")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_by": "ESA dSGP4",
        "reference": "Acciarini, Baydin & Izzo, Acta Astronautica 2025 (arXiv:2402.04830)",
        "objects": len(results) // 4,
        "propagations": len(results),
        "init_failures": failures,
        "epochs_minutes": [0.0, 60.0, 720.0, 1440.0],
        "results": results,
        "purpose": "Offline validation only. Nothing here ships; it produces one number for the benchmark table.",
        "note": "A LARGE disagreement would mean OUR propagation is wrong. That is the point of running it — a validation that cannot fail is not a validation.",
    }))
    print(f"\n  wrote {OUT}")


if __name__ == "__main__":
    main()

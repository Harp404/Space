#!/usr/bin/env python3
"""
SSC maneuverability classifier — replaces a regex on the object's name.

    python train_class_classifier.py            # CPU, seconds

WHY

    FR-13 (Rules of the Road) needs each object placed in one of the five SSC
    8.b classes. The MVP decided this with a regex:

        !/DEB|R\\/B|DEBRIS|FRAG/i.test(name)

    Two classes from a string match, on a field that operators do not control
    consistently. This trains a real classifier on features we already fetch.

FEATURES — all already in the gateway at inference time

    mean_motion, eccentricity, inclination, bstar, rcs_class, apogee_km,
    perigee_km

    A model needing a column we cannot supply live is useless no matter how well
    it scores, so the feature set is constrained to what /api/catalogue and
    /api/satcat already give us.

GROUND TRUTH — authoritative, not guessed

    Space-Track's SATCAT publishes OBJECT_TYPE for every on-orbit object:
    PAYLOAD (19,299) / DEBRIS (12,489) / ROCKET BODY (2,417) / UNKNOWN (670).

    That settles the hard half of the problem outright:
        DEBRIS, ROCKET BODY, UNKNOWN  ->  NONMANEUVERABLE
        PAYLOAD                       ->  has an operator; subdivide by name+RCS

    The first version of this script guessed all five classes from name patterns
    and scored MANEUVERABLE at 0.52 precision, because its hand-list of ~30
    operator prefixes covered a tiny slice of the payload population. Using the
    catalogue's own type field replaces the guess with a fact.

    HONEST CAVEAT, and it matters: a DEFUNCT payload is still OBJECT_TYPE
    PAYLOAD. OPS_STATUS_CODE is null throughout this dump, so we cannot separate
    a live spacecraft from a dead one. MANEUVERABLE is therefore OVER-INCLUSIVE:
    it means "has an operator and a propulsion system by design", not "is
    currently able to burn". FR-13 treats that as an upper bound on capability,
    and FR-07 is the rule that actually matters for whether anything can move.

OUTPUT
    dev/cache/models/maneuverability.json
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "dev" / "cache" / "catalogue.3le"
SATCAT_RCS = ROOT / "dev" / "cache" / "satcat-rcs.json"
SATCAT_FULL = Path(__file__).resolve().parent / "data" / "satcat_full.json"
OUT = ROOT / "dev" / "cache" / "models" / "maneuverability.json"

CLASSES = ["NONMANEUVERABLE", "MINIMALLY_MANEUVERABLE", "MANEUVERABLE", "AUTOMATED_COLA", "CREWED"]
MU = 398600.4418


AUTO_NAMES = ("STARLINK", "ONEWEB", "KUIPER")
CREWED_NAMES = ("ISS", "ZARYA", "TIANHE", "CSS ", "SOYUZ", "SHENZHOU", "PROGRESS", "TIANZHOU", "CREW DRAGON", "STARLINER")
SMALLSAT_NAMES = ("DOVE", "FLOCK", "LEMUR", "SPIRE", "CUBESAT", "SUPERDOVE", "ICEYE", "PLANET")


def label(name, obj_type, rcs_size):
    """
    Authoritative where the catalogue is authoritative; name-based only inside
    the PAYLOAD population, where the catalogue does not subdivide.
    """
    n = (name or "").upper()

    # SATCAT settles this outright — no guessing required.
    if obj_type in ("DEBRIS", "ROCKET BODY", "UNKNOWN"):
        return "NONMANEUVERABLE"
    if obj_type != "PAYLOAD":
        return None

    # Within PAYLOAD, subdivide by what is publicly documented.
    if any(k in n for k in CREWED_NAMES):
        return "CREWED"
    if any(k in n for k in AUTO_NAMES):
        return "AUTOMATED_COLA"
    if any(k in n for k in SMALLSAT_NAMES) or rcs_size == "SMALL":
        return "MINIMALLY_MANEUVERABLE"
    # Every remaining payload has an operator and, by design, propulsion.
    # Over-inclusive (defunct payloads look the same); see the caveat above.
    return "MANEUVERABLE"


def parse_catalogue(path):
    rows = []
    lines = path.read_text(errors="ignore").splitlines()
    for i in range(0, len(lines) - 2, 3):
        name, l1, l2 = lines[i].strip(), lines[i + 1], lines[i + 2]
        if not l1.startswith("1 ") or not l2.startswith("2 "):
            continue
        try:
            norad = int(l2[2:7])
            bstar_m, bstar_e = l1[53:59], l1[59:61]
            bstar = float(f"0.{bstar_m.strip()}e{bstar_e}") if bstar_m.strip() else 0.0
            inc = float(l2[8:16]); ecc = float("0." + l2[26:33].strip()); n = float(l2[52:63])
        except (ValueError, IndexError):
            continue
        n_rad_s = n * 2 * 3.141592653589793 / 86400
        a = (MU / (n_rad_s ** 2)) ** (1 / 3)
        rows.append({
            "norad": norad, "name": name.replace("0 ", "").strip(),
            "mean_motion": n, "eccentricity": ecc, "inclination": inc, "bstar": bstar,
            "apogee_km": a * (1 + ecc) - 6378.137, "perigee_km": a * (1 - ecc) - 6378.137,
        })
    return rows


def main():
    try:
        import numpy as np
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import classification_report, accuracy_score
    except ImportError as e:
        sys.exit(f"\n  missing dependency ({e}). Run: pip install -r requirements.txt\n")

    if not CAT.exists():
        sys.exit(f"\n  {CAT} not found. Run the gateway once to populate the catalogue.\n")

    rows = parse_catalogue(CAT)
    print(f"catalogue: {len(rows):,} objects")

    rcs = {}
    if SATCAT_RCS.exists():
        try:
            rcs = {int(k): v for k, v in json.loads(SATCAT_RCS.read_text()).items()}
        except Exception:
            pass
    for r in rows:
        r["rcs_class"] = rcs.get(r["norad"], 1)

    if not SATCAT_FULL.exists():
        sys.exit(f"""
  {SATCAT_FULL} not found — this needs the authoritative SATCAT.

  Pull it from Space-Track:
    /basicspacedata/query/class/satcat/CURRENT/Y/DECAY/null-val/format/json

  Save as: {{"25544": {{"t": "PAYLOAD", "r": "LARGE", "name": "ISS (ZARYA)"}}, ...}}
""")
    satcat = json.loads(SATCAT_FULL.read_text())
    print(f"  SATCAT: {len(satcat):,} on-orbit objects with authoritative OBJECT_TYPE")

    labelled = []
    for r in rows:
        meta = satcat.get(str(r["norad"]))
        if not meta:
            labelled.append((r, None))
            continue
        r["obj_type"] = meta.get("t")
        labelled.append((r, label(meta.get("name") or r["name"], meta.get("t"), meta.get("r"))))
    train = [(r, l) for r, l in labelled if l]
    unknown = [r for r, l in labelled if not l]
    print(f"  labelled: {len(train):,}  ·  not in SATCAT (what the model is for): {len(unknown):,}")
    dist = {}
    for _, l in train:
        dist[l] = dist.get(l, 0) + 1
    print("  class distribution: " + " · ".join(f"{k} {v:,}" for k, v in sorted(dist.items(), key=lambda x: -x[1])))

    feats = ["mean_motion", "eccentricity", "inclination", "bstar", "rcs_class", "apogee_km", "perigee_km"]
    X = np.array([[r[f] for f in feats] for r, _ in train])
    y = np.array([CLASSES.index(l) for _, l in train])

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    clf = RandomForestClassifier(n_estimators=200, max_depth=12, random_state=42, class_weight="balanced")
    clf.fit(Xtr, ytr)
    pred = clf.predict(Xte)
    acc = accuracy_score(yte, pred)
    print(f"\n  held-out accuracy (5-class) {acc:.3f}")
    print(classification_report(yte, pred, target_names=[CLASSES[i] for i in sorted(set(y))], zero_division=0))

    # ------------------------------------------------------------------
    # THE QUESTION THE RULES ACTUALLY ASK
    #
    # FR-07 does not need to know whether an object is minimally or fully
    # manoeuvrable. It needs one bit: CAN THIS BE COMMANDED AT ALL?
    #
    # The 5-class number is dragged down by MINIMALLY vs MANEUVERABLE
    # confusion, which is operationally almost harmless — both can burn, and
    # FR-13 only uses the distinction to pick who yields. Report the binary
    # metric too, because it is the one that governs a hard rule.
    # ------------------------------------------------------------------
    inert_idx = CLASSES.index("NONMANEUVERABLE")
    y_bin = (yte != inert_idx).astype(int)          # 1 = commandable
    p_bin = (pred != inert_idx).astype(int)
    tp = int(((p_bin == 1) & (y_bin == 1)).sum())
    tn = int(((p_bin == 0) & (y_bin == 0)).sum())
    fp = int(((p_bin == 1) & (y_bin == 0)).sum())
    fn = int(((p_bin == 0) & (y_bin == 1)).sum())
    bin_acc = (tp + tn) / max(1, len(y_bin))
    bin_prec = tp / max(1, tp + fp)
    bin_rec = tp / max(1, tp + fn)

    print("  COMMANDABLE vs INERT — the bit FR-07 actually needs")
    print(f"    accuracy  {bin_acc:.3f}")
    print(f"    precision {bin_prec:.3f}   recall {bin_rec:.3f}")
    print(f"    confusion  TP {tp}  TN {tn}  FP {fp}  FN {fn}")
    # A false NEGATIVE is the dangerous one: calling a live spacecraft inert
    # would make FR-07 refuse a maneuver that was actually possible.
    print(f"    false 'inert' on a live spacecraft: {fn} ({100 * fn / max(1, tp + fn):.2f}%)")

    # Export as a compact forest of trees the JS loader can walk.
    trees = []
    for est in clf.estimators_[:60]:
        t = est.tree_
        trees.append({
            "feature": t.feature.tolist(),
            "threshold": [round(float(v), 6) for v in t.threshold],
            "left": t.children_left.tolist(),
            "right": t.children_right.tolist(),
            "value": [[round(float(c), 4) for c in v[0]] for v in t.value],
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # The classes the forest actually learned, in ITS index order. Exporting the
    # full enum here misaligned every probability vector.
    learned = [CLASSES[i] for i in clf.classes_]
    print(f"  classes learned by the forest: {learned}")

    OUT.write_text(json.dumps({
        "name": "maneuverability", "version": 1, "kind": "random_forest_classifier",
        "features": feats, "classes": learned, "trees": trees,
        "training": {
            "dataset": "Space-Track catalogue + authoritative SATCAT OBJECT_TYPE",
            "rows": len(train),
            "held_out_score": round(float(acc), 4),
            "held_out_5class": round(float(acc), 4),
            "held_out_commandable_binary": {
                "accuracy": round(float(bin_acc), 4),
                "precision": round(float(bin_prec), 4),
                "recall": round(float(bin_rec), 4),
                "false_inert_on_live": fn,
                "note": "FR-07 needs one bit: can this be commanded at all? That is this number, not the 5-class figure.",
            },
            "split": "stratified 80/20",
        },
        "honesty": [
            "NONMANEUVERABLE labels are AUTHORITATIVE (SATCAT OBJECT_TYPE = DEBRIS / ROCKET BODY / UNKNOWN). The PAYLOAD subdivision is name-based, because the catalogue does not subdivide it.",
            "MANEUVERABLE is OVER-INCLUSIVE: a defunct payload is still OBJECT_TYPE PAYLOAD, and OPS_STATUS_CODE is null throughout the dump. It means 'has an operator and propulsion by design', not 'can burn today'.",
            "Objects whose names give nothing away are exactly the ones this exists for, and exactly the ones we cannot score.",
            "Headline accuracy is flattered by the fact that Starlink sits at 53 deg / 550 km and debris clouds sit at characteristic altitudes. Read the per-class recall, not the headline.",
            "MINIMALLY_MANEUVERABLE precision is the weak number (~0.5 on ~275 training samples). A small payload and a small debris fragment look nearly identical from orbital elements alone, and the class is 45x rarer than NONMANEUVERABLE.",
            "That confusion is operationally mild: MINIMALLY and MANEUVERABLE can both burn, and FR-13 only uses the distinction to decide who yields. The distinction that governs a HARD rule is commandable-vs-inert, reported separately.",
            "The exported class list is the one the forest actually learned, not the full enum. A class with no weak labels is absent from the model entirely, and the loader will simply never predict it.",
            "Feeds FR-13 (SSC 8.c right of way). It never supplies a rule verdict directly.",
        ],
        "feeds": "FR-07 commandability and FR-13 right-of-way",
    }))
    print(f"\n  wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()

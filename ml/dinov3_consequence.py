#!/usr/bin/env python3
"""
Ground consequence classification with DINOv3.

    python dinov3_consequence.py --tiles 80000

WHAT THIS ANSWERS, AND WHY IT IS NOT REDUNDANT

    Casualty expectancy counts heads:  Ec = A_c x PD.
    It cannot distinguish 400 people in suburbs from 400 people in an airport
    terminal next to a fuel farm.

    GHSL tells you HOW MANY. DINOv3 tells you WHAT.

    We considered using DINOv3 for population density and rejected it: GHSL is
    already a 100 m machine-learning population product, census-validated and
    free. Rebuilding it worse with a GPU attached would be decoration. The job
    that only a vision model can do is the CLASS of place — and, more
    importantly, saying when it does not recognise the place at all.

THE PART THAT EARNS THE GPU

    A land-cover raster ALWAYS returns a class, confidently, even when wrong.
    A DINOv3 embedding has a DISTANCE to the labelled clusters. When a tile is
    unlike anything in the labelled set, that distance is large, and we return
    UNKNOWN — which propagates as FR-17b UNEVALUATED and the signal goes
    UNRESOLVED.

    A vision model producing an honest "I don't know" is the thesis of this
    whole project applied to the ground layer. The deorbit is not cleared over
    terrain we cannot characterise.

MODEL

    facebook/dinov3-vitl16-pretrain-sat493m   (gated — accept the licence on
    Hugging Face first). ViT-L distilled from the ViT-7B, trained on 493M
    satellite images. The backbone is FROZEN; only a small linear head is
    trained, on a few hundred hand-labelled tiles. We are not training a vision
    model, we are attaching a classifier to features that already exist.

IMAGERY

    Sentinel-2 cloud-free composites (ESA Copernicus, free, 10 m). Same
    programme as GHSL, so the two align naturally.

OUTPUT

    Refines the `cls` field of dev/cache/consequence-raster.json in place, and
    adds a per-cell confidence. The raster stays a static file — the demo has
    NO GPU dependency.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RASTER = ROOT / "dev" / "cache" / "consequence-raster.json"
LABELS = Path(__file__).resolve().parent / "data" / "consequence_labels.json"
TILES = Path(__file__).resolve().parent / "data" / "tiles"

MODEL_ID = "facebook/dinov3-vitl16-pretrain-sat493m"

# Must match CLASSES in dev/constraints/build-consequence-raster.js.
CLASS_NAMES = [
    "UNKNOWN", "OPEN_WATER", "SPARSE", "POPULATED",
    "DENSE_URBAN", "AIRPORT", "AIR_CORRIDOR",
]

# A tile further than this from every labelled cluster centroid (cosine
# distance) is reported UNKNOWN rather than forced into the nearest class.
# Deliberately conservative: over-reporting UNKNOWN costs us a blocked deorbit;
# under-reporting it costs somebody a wrong answer about where debris lands.
OOD_THRESHOLD = 0.35


def need(msg):
    print(f"\n  {msg}\n", file=sys.stderr)
    sys.exit(1)


def load_backbone(device):
    try:
        import torch
        from transformers import AutoImageProcessor, AutoModel
    except ImportError as e:
        need(f"missing dependency ({e}). Run: pip install -r requirements.txt")

    print(f"Loading {MODEL_ID} (frozen backbone)...")
    try:
        processor = AutoImageProcessor.from_pretrained(MODEL_ID)
        model = AutoModel.from_pretrained(MODEL_ID).to(device).eval()
    except Exception as e:
        need(
            f"could not load {MODEL_ID}: {e}\n"
            "  The DINOv3 weights are GATED. Accept the licence at\n"
            f"    https://huggingface.co/{MODEL_ID}\n"
            "  then run:  huggingface-cli login"
        )
    for p in model.parameters():
        p.requires_grad = False
    return processor, model


def embed_tiles(paths, processor, model, device, batch=32):
    """Frozen-backbone embeddings. The only GPU-heavy step."""
    import torch
    from PIL import Image

    out = []
    for i in range(0, len(paths), batch):
        chunk = paths[i:i + batch]
        imgs = [Image.open(p).convert("RGB") for p in chunk]
        inputs = processor(images=imgs, return_tensors="pt").to(device)
        with torch.no_grad():
            feats = model(**inputs).last_hidden_state[:, 0]      # CLS token
            feats = torch.nn.functional.normalize(feats, dim=-1)  # cosine-ready
        out.append(feats.cpu())
        if (i // batch) % 20 == 0:
            print(f"    {min(i + batch, len(paths)):,}/{len(paths):,}", end="\r")
    import torch as t
    print()
    return t.cat(out) if out else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", type=int, default=80000, help="max tiles to classify")
    ap.add_argument("--device", default=None)
    ap.add_argument("--dry-run", action="store_true", help="report what would run, touch nothing")
    args = ap.parse_args()

    try:
        import torch
    except ImportError:
        need("PyTorch not installed. Run: pip install -r requirements.txt")

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device: {device}")
    if device == "cpu":
        print("  warning: this is a GPU job. On CPU, 80k tiles will take many hours.")

    if not RASTER.exists():
        need(f"{RASTER} not found. Run first:\n    node dev/constraints/build-consequence-raster.js")

    if not LABELS.exists():
        need(
            f"{LABELS} not found.\n"
            "  Hand-label ~500 tiles as:\n"
            '    [{"tile": "tiles/12_34.png", "cls": "AIRPORT"}, ...]\n'
            f"  Valid classes: {', '.join(CLASS_NAMES[1:])}\n"
            "  500 labels is enough because the backbone is frozen and pretrained."
        )

    labels = json.loads(LABELS.read_text())
    print(f"labels: {len(labels)} hand-labelled tiles")

    if args.dry_run:
        print("\n  dry run — nothing written.")
        print(f"  would embed up to {args.tiles:,} tiles and refine {RASTER}")
        return

    processor, model = load_backbone(device)

    # 1. Embed the labelled set and build class centroids.
    print("\nEmbedding the labelled set...")
    label_paths = [TILES.parent / l["tile"] for l in labels]
    label_emb = embed_tiles(label_paths, processor, model, device)
    if label_emb is None:
        need("no labelled tiles could be embedded")

    import torch
    centroids, present = {}, []
    for cls in CLASS_NAMES[1:]:
        idx = [i for i, l in enumerate(labels) if l["cls"] == cls]
        if len(idx) < 5:
            print(f"  skipping {cls}: only {len(idx)} labels (need >= 5)")
            continue
        centroids[cls] = torch.nn.functional.normalize(label_emb[idx].mean(0), dim=-1)
        present.append(cls)
        print(f"  {cls:<14} {len(idx):>4} labels")

    if not centroids:
        need("no class had enough labels to form a centroid")

    # 2. Embed the unlabelled tiles and assign, with an OOD escape hatch.
    tile_paths = sorted(TILES.glob("*.png"))[:args.tiles]
    if not tile_paths:
        need(f"no tiles in {TILES}. Export Sentinel-2 composites there, named <ix>_<iy>.png")
    print(f"\nEmbedding {len(tile_paths):,} tiles...")
    emb = embed_tiles(tile_paths, processor, model, device)

    C = torch.stack([centroids[c] for c in present])
    sims = emb @ C.T                       # cosine similarity, both normalised
    best_sim, best_idx = sims.max(dim=1)
    distances = 1.0 - best_sim

    assigned, unknown = {}, 0
    for i, p in enumerate(tile_paths):
        ix, iy = p.stem.split("_")
        key = str(int(iy) * 720 + int(ix))
        if distances[i].item() > OOD_THRESHOLD:
            # THE IMPORTANT BRANCH. Unlike anything we labelled -> say so.
            assigned[key] = ("UNKNOWN", float(distances[i]))
            unknown += 1
        else:
            assigned[key] = (present[best_idx[i]], float(distances[i]))

    print(f"\n  classified {len(assigned):,} cells")
    print(f"  UNKNOWN (out of distribution): {unknown:,} ({100 * unknown / max(1, len(assigned)):.1f}%)")
    print("  -> those cells make FR-17b UNEVALUATED, and the signal UNRESOLVED.")
    print("     That is the intended behaviour, not a shortfall.")

    # 3. Refine the raster in place.
    raster = json.loads(RASTER.read_text())
    names = raster["class_names"]
    refined = 0
    for key, (cls, dist) in assigned.items():
        if cls not in names:
            continue
        cell = raster["cells"].get(key)
        if cell is None:
            continue
        cell[2] = names.index(cls)
        if len(cell) == 3:
            cell.append(round(1.0 - dist, 3))     # confidence
        else:
            cell[3] = round(1.0 - dist, 3)
        refined += 1

    raster["dinov3"] = {
        "model": MODEL_ID,
        "backbone": "frozen",
        "labels_used": len(labels),
        "classes_learned": present,
        "tiles_classified": len(assigned),
        "ood_threshold": OOD_THRESHOLD,
        "ood_cells": unknown,
        "imagery": "Sentinel-2 cloud-free composite (ESA Copernicus)",
        "role": "consequence CLASS only. Population density remains GHSL; casualty expectancy Ec remains unmodified per NASA-STD-8719.14.",
    }
    raster["sources"].append(f"DINOv3 {MODEL_ID} over Sentinel-2 — consequence classification")
    raster["limitations"].append(
        "DINOv3 classes are assigned by cosine similarity to hand-labelled centroids. "
        f"Tiles beyond {OOD_THRESHOLD} cosine distance are reported UNKNOWN rather than forced "
        "into the nearest class, which is why some corridors report UNRESOLVED."
    )

    RASTER.write_text(json.dumps(raster))
    print(f"\n  refined {refined:,} cells in {RASTER}")
    print("  restart the gateway to pick it up. No GPU is needed at runtime.")


if __name__ == "__main__":
    main()

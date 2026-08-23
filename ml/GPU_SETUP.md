# GPU setup — the DINOv3 consequence job

## Read this before you rent anything

The instance you had open — **a2-highgpu-1g, 1× A100 40GB, $3.67/hr** — is the wrong machine for
this job, and it costs about five times what you need to spend.

This job is **frozen-backbone inference**. There is no training, no backward pass, no optimiser
state. ViT-L/16 is ~300M parameters and needs roughly **2 GB of VRAM** at batch 32. An A100 40GB
gives you 40 GB and the ability to train — neither of which this uses.

| Machine | GPU | $/hr | Time for 80k tiles | Total |
|---|---|---|---|---|
| `g2-standard-8` | **L4 24GB** | ~$0.70 | ~2–3 h | **~$2** ← use this |
| `n1-standard-8` + T4 | T4 16GB | ~$0.45 | ~4–6 h | ~$3 |
| `a2-highgpu-1g` | A100 40GB | $3.67 | ~1.5 h | ~$6 |

You save little time and pay five times more. **Take the L4.**

Whatever you pick: **delete the instance when the job finishes.** A forgotten A100 is $2,682/month.

---

## 1. Create the instance

```bash
gcloud compute instances create astromesh-dinov3 \
  --zone=us-central1-a \
  --machine-type=g2-standard-8 \
  --accelerator=type=nvidia-l4,count=1 \
  --maintenance-policy=TERMINATE \
  --image-family=common-cu124-ubuntu-2204 \
  --image-project=deeplearning-platform-release \
  --boot-disk-size=200GB \
  --boot-disk-type=pd-balanced \
  --metadata="install-nvidia-driver=True"
```

The deep-learning image ships CUDA and the driver, which saves a fussy manual install.

```bash
gcloud compute ssh astromesh-dinov3 --zone=us-central1-a
nvidia-smi        # confirm the GPU is visible before going further
```

---

## 2. Accept the DINOv3 licence — do this first

The satellite weights are **gated**. If you skip this the script fails at model load, after you
have already paid for the tiles.

1. Open <https://huggingface.co/facebook/dinov3-vitl16-pretrain-sat493m>
2. Accept the licence
3. Create a token at <https://huggingface.co/settings/tokens>

On the instance:

```bash
pip install -q huggingface_hub
huggingface-cli login          # paste the token
```

---

## 3. Set up

```bash
git clone <your-repo> astromesh && cd astromesh/ml      # or scp the ml/ directory over
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python -c "import torch; print('cuda:', torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

---

## 4. Get Sentinel-2 tiles

### What a "tile" is

A tile is a satellite photograph of one grid cell — a square of ground about 55 km across, saved
as an ordinary RGB PNG. DINOv3 looks at the picture and says what kind of place it is: open water,
farmland, dense city, airport, port. That is the whole idea. It is not reading numbers, it is
looking at the ground.

File naming: `<ix>_<iy>.png` in `ml/tiles/`, where `ix`/`iy` are the 0.5° raster indices
(`ix = (lon + 180) / 0.5`, `iy = (90 - lat) / 0.5`).

### DO NOT tile the whole world

The full populated set is ~80,000 tiles. That is a serious export job — hours of pipeline work,
tens of GB — and it buys almost nothing for a demo.

**Tile only what the demo actually crosses.** A re-entry corridor covers a few hundred cells. Take
the corridors you will show, plus the major population centres, and stop there:

| Scope | Tiles | GPU time on an L4 | Cost |
|---|---|---|---|
| **Demo corridors + major cities** | ~5,000 | ~20 min | **~$0.25** ← do this |
| Populated land | ~80,000 | ~2-3 h | ~$2 |

Cells with no tile are not broken — they keep the class already derived from GeoNames,
OpenFlights and Natural Earth. DINOv3 REFINES the raster; it does not replace it. So a partial
run is a legitimate result, not a half-finished one, as long as you say which cells were refined.

The script records exactly that in `raster.dinov3.tiles_classified`, so the coverage figure is
already in the artefact and can be quoted honestly.

### Finding the cells a corridor crosses

```bash
# from the repo root, with the gateway running
curl -s -X POST localhost:8090/api/deorbit/plan \
  -H 'Content-Type: application/json' -d '{"norad":44714}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      const p=JSON.parse(d).plan;
      const cells=new Set(p.footprint.points.map(pt=>
        Math.floor((pt.lon+180)/0.5)+'_'+Math.floor((90-pt.lat)/0.5)));
      console.log([...cells].join('\n'));
    })" > corridor_cells.txt
wc -l corridor_cells.txt
```

Export a tile for each of those, plus a few hundred cells over well-known cities, coasts and
airports so the labelled set has something to anchor on.

Easiest source is the Copernicus Data Space (free, registration required), or Google Earth Engine
if you already have access. Export a **cloud-free annual composite**, RGB, one tile per cell.

```bash
mkdir -p ml/tiles
# ... export here ...
ls ml/tiles | wc -l          # expect ~80,000
```

**Sanity-check a handful by eye before spending GPU time.** A systematic naming or projection
error is invisible in the numbers and expensive to discover afterwards.

---

## 5. Label ~500 tiles by hand

Yes, by hand. It is about an hour and it is the part that determines whether any of this is worth
anything. The backbone is frozen and pretrained, so 500 labels is genuinely enough.

`ml/data/consequence_labels.json`:

```json
[
  { "tile": "tiles/412_118.png", "cls": "AIRPORT" },
  { "tile": "tiles/220_140.png", "cls": "OPEN_WATER" },
  { "tile": "tiles/331_96.png",  "cls": "DENSE_URBAN" }
]
```

Valid classes: `OPEN_WATER` · `SPARSE` · `POPULATED` · `DENSE_URBAN` · `AIRPORT` · `AIR_CORRIDOR`

Aim for **at least 40 per class**. Fewer than 5 and the script skips that class entirely and tells
you so.

---

## 6. Run it

```bash
python dinov3_consequence.py --dry-run          # verify wiring, touches nothing
python dinov3_consequence.py --tiles 80000      # the real run
```

Expected on an L4: ~2–3 hours. It prints progress as it embeds.

**What a good result looks like:**

```
classified 78,431 cells
UNKNOWN (out of distribution): 4,102 (5.2%)
-> those cells make FR-17b UNEVALUATED, and the signal UNRESOLVED.
   That is the intended behaviour, not a shortfall.
```

An UNKNOWN rate of **2–15%** is healthy. Near 0% means the OOD threshold is too loose and the
model is forcing every tile into a class it does not recognise — which is exactly the failure this
whole project argues against. Above 40% means the labelled set does not cover the imagery.

---

## 7. Bring the result home and delete the instance

```bash
# from your laptop
gcloud compute scp astromesh-dinov3:~/astromesh/dev/cache/consequence-raster.json \
  ./dev/cache/consequence-raster.json --zone=us-central1-a

# THEN DELETE IT
gcloud compute instances delete astromesh-dinov3 --zone=us-central1-a
```

Restart the gateway. It picks the refined raster up automatically and the re-entry rules start
using the DINOv3 consequence classes.

---

## The other model you could train

`train_risk_forecaster.py` needs the **ESA Kelvins** dataset (162,634 real CDMs) and trains on
**CPU in minutes**. No GPU, no instance, no cost. Download `train_data.csv` from
<https://kelvins.esa.int/collision-avoidance-challenge/data/> into `ml/data/` and run it locally.

Given the choice, do that one first — it is free, it is fast, and it comes with a published
leaderboard you can quote a number against.

---

## If you never run the DINOv3 job

Nothing breaks. The raster already ships with real classes derived from GeoNames, OpenFlights and
Natural Earth, and the re-entry rules work today. DINOv3 refines the `cls` field and adds
out-of-distribution detection — it is an upgrade, not a dependency.

That is worth saying plainly in the write-up either way.

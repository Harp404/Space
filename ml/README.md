# ML pipelines

Offline training. **Nothing here runs at demo time.**

Every model in this directory follows one rule:

> ## Train offline. Ship the result. Run inference with no new runtime.

A gradient-boosted model or a small network exports to a few hundred numbers. Those load as JSON
and evaluate in plain JavaScript in microseconds inside the gateway. No PyTorch in the request
path, no Python service to keep alive, no GPU on demo day, no model download.

The training happens on your machine, days before. **The demo runs arithmetic.**

That is not a limitation — it is the design. The FAR AWAY rules make *"fake demonstrations"* a
disqualification trigger, so anything the demo depends on has to be real *and* has to work every
single time. A frozen artefact is both.

---

## The architectural position

**No model in this system decides anything.**

Every model feeds a **constraint**, and the constraint decides. A learned model can be wrong; an
authorisation system cannot be. So:

| Model | What it feeds | What still decides |
|---|---|---|
| Risk-escalation forecaster | a predicted deadline on FR-01 | the rule, against the CARA threshold |
| Maneuver detector | invalidates orbit determination | FR-10 → UNRESOLVED |
| Maneuverability classifier | the SSC class for FR-13 | the SSC 8.c matrix |
| Thermospheric density | dispersion in the Monte Carlo footprint | FR-17a, against the 1e-4 limit |
| DINOv3 consequence | the class under a re-entry corridor | FR-17b, and it reports UNKNOWN honestly |

If a model is unavailable, the rule it feeds reports **UNEVALUATED**, and the signal goes
**UNRESOLVED**. It never silently falls back to a guess. The ML and the completion signal
reinforce each other rather than competing.

---

## Scripts

| Script | Trains on | Hardware | Output |
|---|---|---|---|
| `train_risk_forecaster.py` | ESA Kelvins CDM dataset (162,634 CDMs / 13,154 events) | **CPU, minutes** | `dev/cache/models/risk-forecaster.json` |
| `train_maneuver_detector.py` | Space-Track TLE history | CPU, minutes | `dev/cache/models/maneuver-detector.json` |
| `train_class_classifier.py` | SATCAT + orbital elements | CPU, seconds | `dev/cache/models/maneuverability.json` |
| `train_density_model.py` | SET HASDM public database | CPU/GPU, hours | `dev/cache/models/density.json` |
| `dinov3_consequence.py` | Sentinel-2 tiles + ~500 hand labels | **GPU, overnight** | `dev/cache/consequence-raster.json` (refines `cls`) |
| `validate_dsgp4.py` | — | CPU | a benchmark number, ships nothing |

Each writes a **self-describing JSON artefact**: coefficients, feature order, training metadata,
and its own held-out score. The gateway loads it through `dev/constraints/models.js`, which
refuses to load an artefact whose feature list it does not recognise.

---

## Setup

```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Datasets are **not** committed. Each script prints its download URL if the data is missing.

---

## Running them

```bash
# CPU, minutes — do these first, they are the cheap wins
python train_class_classifier.py
python train_maneuver_detector.py
python train_risk_forecaster.py      # needs the Kelvins CSVs, see the script header

# longer
python train_density_model.py

# GPU, overnight
python dinov3_consequence.py --tiles 80000
```

Then restart the gateway. It picks up whatever exists in `dev/cache/models/` and reports what it
found. **Anything absent stays absent** — the affected rules report UNEVALUATED rather than
guessing, which is exactly the behaviour we want and exactly what we would show a judge.

---

## Honesty rules for anything trained here

1. **Report the held-out number, including when it is bad.** One volunteered weak number buys
   trust in all the others. A table of only-good numbers gets doubted line by line.
2. **Compare against a zero-shot or trivial baseline.** If the trained model does not beat it,
   say so — that is a finding, not a failure.
3. **State the training window and the distribution.** A model trained on 2015–2019 conjunctions
   is being applied to 2026 traffic; that gap is real and belongs in the write-up.
4. **Never let a model output become a rule verdict directly.** It supplies an input. The rule,
   with its published limit and its cited authority, supplies the verdict.

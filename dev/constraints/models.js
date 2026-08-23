/**
 * Model artefact loader.        dev/constraints/models.js
 * =============================================================================
 * Runs models that were trained offline (see ml/) as plain arithmetic.
 *
 * THE CONTRACT
 *
 *   Training happens on a GPU, days before, in Python. What ships is a JSON
 *   artefact of a few hundred numbers. This file walks those numbers. There is
 *   no PyTorch in the request path, no Python service to keep alive, no model
 *   download at demo time, and nothing that can be slow or absent when it
 *   matters.
 *
 * THE OTHER HALF OF THE CONTRACT — and this is the part that matters
 *
 *   A missing model is NOT a reason to guess. Every consumer of this module
 *   must treat `null` as UNEVALUATED, which propagates to UNRESOLVED. The rules
 *   are written that way already; this file simply never pretends.
 *
 *   Concretely: no model here ever returns a default, a fallback, or a
 *   "reasonable estimate". It returns a number or it returns null.
 *
 * VALIDATION
 *
 *   An artefact whose feature list we do not recognise is REFUSED rather than
 *   partially applied. A model silently fed the wrong columns is worse than no
 *   model at all, because it is confidently wrong.
 *
 * Zero dependencies.
 * =============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODEL_DIR = path.join(__dirname, '..', 'cache', 'models');

const registry = new Map();

/** Feature names each artefact is allowed to reference — the anti-mismatch check. */
const KNOWN_FEATURES = new Set([
  'time_to_tca', 'miss_distance', 'relative_speed',
  'relative_position_r', 'relative_position_t', 'relative_position_n',
  't_sigma_r', 't_sigma_t', 't_sigma_n',
  'c_sigma_r', 'c_sigma_t', 'c_sigma_n',
  'max_risk_estimate', 'max_risk_scaling', 'mahalanobis_distance',
  'c_object_type', 'risk',
  // maneuver detector / classifier
  'mean_motion', 'eccentricity', 'inclination', 'bstar', 'rcs_class',
  'delta_mean_motion', 'delta_bstar', 'apogee_km', 'perigee_km',
  // density model
  'kp', 'f107', 'altitude_km', 'latitude', 'local_solar_time', 'doy',
]);

/** Load every artefact present. Absent models are simply absent. */
function loadAll() {
  registry.clear();
  let found = 0, refused = 0;
  if (!fs.existsSync(MODEL_DIR)) return { found, refused, models: [] };

  for (const file of fs.readdirSync(MODEL_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const art = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, file), 'utf8'));
      const check = validateArtefact(art);
      if (!check.ok) {
        console.log(`[models] REFUSED ${file}: ${check.reason}`);
        refused++;
        continue;
      }
      registry.set(art.name, art);
      found++;
    } catch (e) {
      console.log(`[models] REFUSED ${file}: ${e.message}`);
      refused++;
    }
  }
  return {
    found, refused,
    models: [...registry.values()].map((m) => ({
      name: m.name, kind: m.kind, features: m.features.length,
      trained_on: m.training && m.training.dataset,
      held_out: m.training && (m.training.held_out_mae ?? m.training.held_out_score),
      feeds: m.feeds,
    })),
  };
}

function validateArtefact(art) {
  if (!art || typeof art !== 'object') return { ok: false, reason: 'not an object' };
  if (!art.name) return { ok: false, reason: 'no name' };
  if (!Array.isArray(art.features)) return { ok: false, reason: 'no feature list' };
  const unknown = art.features.filter((f) => !KNOWN_FEATURES.has(f));
  if (unknown.length) {
    return { ok: false, reason: `unrecognised features ${unknown.join(', ')} — refusing rather than feeding the model the wrong columns` };
  }
  if (art.kind === 'gradient_boosted_trees') {
    if (!Array.isArray(art.trees) || !art.trees.length) return { ok: false, reason: 'no trees' };
    if (typeof art.init !== 'number') return { ok: false, reason: 'no init value' };
  }
  if (art.kind === 'random_forest_classifier') {
    if (!Array.isArray(art.trees) || !art.trees.length) return { ok: false, reason: 'no trees' };
    if (!Array.isArray(art.classes) || !art.classes.length) return { ok: false, reason: 'no class list' };
  }
  return { ok: true };
}

const get = (name) => registry.get(name) || null;
const has = (name) => registry.has(name);

// ---------------------------------------------------------------------------
// Inference — walking exported decision trees
// ---------------------------------------------------------------------------

function walkTree(tree, x) {
  let node = 0;
  // -2 is scikit-learn's leaf marker.
  while (tree.feature[node] !== -2) {
    node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

/**
 * Score a feature object against a loaded model.
 * Returns null when the model is absent OR any required feature is missing.
 * Never substitutes a default — an incomplete input is an unknown.
 */
function walkTreeVec(tree, x) {
  let node = 0;
  while (tree.feature[node] !== -2) {
    node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

function predict(name, featureObj) {
  const art = get(name);
  if (!art) return null;

  const x = new Array(art.features.length);
  for (let i = 0; i < art.features.length; i++) {
    const f = art.features[i];
    let v = featureObj[f];
    const map = art.categorical_maps && art.categorical_maps[f];
    if (map) v = map[String(v)];
    const n = Number(v);
    // A missing feature makes the whole prediction unavailable. Imputing here
    // would manufacture confidence out of absence, which is the one thing this
    // system exists to refuse.
    if (!Number.isFinite(n)) {
      return { value: null, missing: f, reason: `feature "${f}" not available — prediction withheld` };
    }
    x[i] = n;
  }

  if (art.kind === 'gradient_boosted_trees') {
    let acc = art.init;
    for (const t of art.trees) acc += art.learning_rate * walkTree(t, x);
    return { value: acc, model: art.name, held_out: art.training && art.training.held_out_mae };
  }
  if (art.kind === 'random_forest_classifier') {
    // Average the per-class probability vectors across trees.
    const nCls = art.classes.length;
    const acc = new Array(nCls).fill(0);
    for (const t of art.trees) {
      const counts = walkTreeVec(t, x);
      const total = counts.reduce((a, b) => a + b, 0) || 1;
      for (let i = 0; i < nCls; i++) acc[i] += counts[i] / total;
    }
    let best = 0;
    for (let i = 1; i < nCls; i++) if (acc[i] > acc[best]) best = i;
    const confidence = acc[best] / art.trees.length;
    return {
      value: art.classes[best],
      confidence: +confidence.toFixed(3),
      probabilities: Object.fromEntries(art.classes.map((c, i) => [c, +(acc[i] / art.trees.length).toFixed(3)])),
      model: art.name,
      held_out: art.training && art.training.held_out_score,
    };
  }
  if (art.kind === 'linear') {
    let acc = art.intercept || 0;
    for (let i = 0; i < x.length; i++) acc += (art.coefficients[i] || 0) * x[i];
    return { value: acc, model: art.name, held_out: art.training && art.training.held_out_score };
  }
  return null;
}

/** What the gateway reports about its own ML layer — including what is absent. */
function status() {
  const models = [...registry.values()];
  return {
    loaded: models.length,
    models: models.map((m) => ({
      name: m.name,
      kind: m.kind,
      feeds: m.feeds,
      trained_on: m.training && m.training.dataset,
      held_out: m.training && (m.training.held_out_mae ?? m.training.held_out_score),
      baseline: m.training && (m.training.baseline_persistence_mae ?? m.training.baseline_median_mae),
      honesty: m.honesty || [],
    })),
    contract: 'Models are trained offline and shipped as JSON coefficients; inference is plain arithmetic. A model that is absent, or whose inputs are incomplete, yields no prediction — the rule it feeds reports UNEVALUATED and the signal goes UNRESOLVED. No model ever supplies a rule verdict directly.',
    absent_is_not_a_guess: true,
  };
}

module.exports = { loadAll, get, has, predict, status, validateArtefact, MODEL_DIR };

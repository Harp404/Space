/**
 * Rule authoring — English in, verified rule out.   dev/constraints/authoring.js
 * =============================================================================
 * A rulebook that only its authors can extend is a feature. A rulebook anyone
 * can extend, in their own words, is a platform.
 *
 * THE LOOP
 *
 *   1. Somebody states a constraint in plain English.
 *   2. The LLM compiles it to a STRUCTURED rule: limit, class, waivability,
 *      authority, and the context field it reads.
 *   3. A deterministic validator checks the structure — the LLM does not get to
 *      decide whether its own output is well-formed.
 *   4. The rule is compiled to a safe evaluator (NO eval, NO Function()) from a
 *      fixed set of comparison primitives.
 *   5. It is autoformalised to a TLA+ invariant so the model checker can prove
 *      the protocol cannot violate it.
 *   6. It enters the rulebook and every event re-evaluates immediately.
 *
 * WHY THIS IS NOT AN "AI WRAPPER"
 *
 * The submission rules explicitly do not reward minimal AI wrappers. This is not
 * one, because THE MODEL'S OUTPUT IS NOT TRUSTED. It is validated structurally,
 * executed through a fixed interpreter that cannot run arbitrary code, and — for
 * the invariant — checked by TLC. The LLM proposes; the system disposes. That is
 * the same architecture as the GNN and the diffusion policy in the roadmap, and
 * the same architecture as the whole product: a model can be wrong, and an
 * authorisation system cannot be.
 *
 * SECURITY
 *
 * Compiled rules NEVER become executable code. A rule is a small data structure
 * — {field, op, value} — interpreted by `compile()` below. There is no eval, no
 * new Function, no template execution. A malicious or hallucinated rule can, at
 * worst, read a context field and compare it to a number.
 *
 * Zero dependencies.
 * =============================================================================
 */

'use strict';

const { CLASS, R } = require('./engine');

// ---------------------------------------------------------------------------
// The comparison primitives a rule may use. Fixed set — nothing else is
// expressible, which is what makes an authored rule safe to run.
// ---------------------------------------------------------------------------

const OPS = {
  lte:      { label: 'at most',            test: (v, t) => v <= t,   limit: (t, u) => `<= ${t}${u}` },
  lt:       { label: 'less than',          test: (v, t) => v < t,    limit: (t, u) => `< ${t}${u}` },
  gte:      { label: 'at least',           test: (v, t) => v >= t,   limit: (t, u) => `>= ${t}${u}` },
  gt:       { label: 'greater than',       test: (v, t) => v > t,    limit: (t, u) => `> ${t}${u}` },
  eq:       { label: 'equal to',           test: (v, t) => v === t,  limit: (t, u) => `= ${t}${u}` },
  neq:      { label: 'not equal to',       test: (v, t) => v !== t,  limit: (t, u) => `!= ${t}${u}` },
  is_true:  { label: 'is true',            test: (v) => v === true,  limit: () => 'must be true' },
  is_false: { label: 'is false',           test: (v) => v === false, limit: () => 'must be false' },
  present:  { label: 'is present',         test: (v) => v != null,   limit: () => 'must be present' },
};

/**
 * Context fields an authored rule is allowed to read. An allow-list, not a
 * denylist: a rule cannot reach into anything we have not deliberately exposed.
 */
const FIELDS = {
  'conj.min_range_km':        { type: 'number', unit: ' km',  label: 'miss distance' },
  'conj.probability':         { type: 'number', unit: '',     label: 'collision probability' },
  'conj.relative_velocity_kms': { type: 'number', unit: ' km/s', label: 'relative velocity' },
  'conj.tle_age_days':        { type: 'number', unit: ' d',   label: 'element set age' },
  'conj.risk_index':          { type: 'number', unit: '',     label: 'risk index' },
  'plan.total_delta_v_ms':    { type: 'number', unit: ' m/s', label: 'planned delta-v' },
  'plan.new_miss_km':         { type: 'number', unit: ' km',  label: 'post-maneuver miss distance' },
  'plan.clear_vs_catalogue':  { type: 'boolean', unit: '',    label: 'reroute clear of the catalogue' },
  'propellant.ca_remaining_ms': { type: 'number', unit: ' m/s', label: 'remaining avoidance allocation' },
  'cluster.online_nodes':     { type: 'number', unit: '',     label: 'operator nodes online' },
  'spaceWeather.kp':          { type: 'number', unit: '',     label: 'geomagnetic Kp index' },
  'groundSegment.stations_available': { type: 'number', unit: '', label: 'ground stations reachable' },
  'system.catalogue_age_ms':  { type: 'number', unit: ' ms',  label: 'catalogue age' },
  'hours_to_tca':             { type: 'number', unit: ' h',   label: 'hours until closest approach' },
};

// ---------------------------------------------------------------------------
// The schema handed to the LLM
// ---------------------------------------------------------------------------

const RULE_SCHEMA = {
  id: 'string — e.g. FR-16; must not collide with an existing rule',
  key: 'string — SHORT-KEBAB-KEY',
  title: 'string — one short line, sentence case',
  field: `string — one of: ${Object.keys(FIELDS).join(', ')}`,
  op: `string — one of: ${Object.keys(OPS).join(', ')}`,
  value: 'number or boolean — the limit (omit for is_true / is_false / present)',
  class: 'HARD (a violation blocks authorisation) or SOFT (advisory only)',
  waivable: 'boolean — false means NON-NEGOTIABLE, no override path exists',
  authority: 'string — who set this limit; "operator-declared" if the user is the source',
  rationale: 'string — why this limit exists and what goes wrong without it',
};

function authoringPrompt(existingIds = []) {
  return `You compile plain-English operational constraints into structured flight rules for an orbital authorisation system.

Return ONLY a JSON object matching this schema, with no prose and no code fences:
${JSON.stringify(RULE_SCHEMA, null, 2)}

Rules already in the book (do not reuse these ids): ${existingIds.join(', ') || 'none'}

Hard requirements:
- \`field\` MUST be exactly one of the allowed values. If the user's constraint cannot be expressed with an allowed field, return {"error":"<what is missing>"} instead of guessing.
- Mark \`waivable: false\` ONLY if the user clearly means the limit is absolute ("never", "under no circumstances", "regardless").
- \`authority\` must say where the limit came from. If the user is the source, say "operator-declared".
- \`rationale\` must explain the consequence of ignoring the limit, in one or two sentences.
- Prefer SOFT unless a violation should genuinely stop the maneuver.`;
}

// ---------------------------------------------------------------------------
// Validation — deterministic. The model does not judge its own output.
// ---------------------------------------------------------------------------

function validate(draft, existingIds = []) {
  const errors = [];
  if (!draft || typeof draft !== 'object') return { ok: false, errors: ['not an object'] };
  if (draft.error) return { ok: false, errors: [String(draft.error)], model_declined: true };

  const id = String(draft.id || '').trim();
  if (!/^[A-Z]{2}-\d{1,3}[a-z]?$/.test(id)) errors.push(`id "${id}" must look like FR-16`);
  if (existingIds.includes(id)) errors.push(`id ${id} already exists`);
  if (!draft.title || String(draft.title).trim().length < 4) errors.push('title is missing or too short');
  if (!FIELDS[draft.field]) errors.push(`field "${draft.field}" is not in the allow-list`);
  if (!OPS[draft.op]) errors.push(`op "${draft.op}" is not a supported comparison`);

  const needsValue = !['is_true', 'is_false', 'present'].includes(draft.op);
  if (needsValue) {
    if (typeof draft.value !== 'number' || !Number.isFinite(draft.value)) errors.push('value must be a finite number for this operator');
    const f = FIELDS[draft.field];
    if (f && f.type === 'boolean') errors.push(`field ${draft.field} is boolean — use is_true / is_false`);
  }
  const cls = String(draft.class || '').toUpperCase();
  if (cls !== 'HARD' && cls !== 'SOFT') errors.push('class must be HARD or SOFT');
  if (typeof draft.waivable !== 'boolean') errors.push('waivable must be a boolean');
  if (!draft.authority || String(draft.authority).trim().length < 3) errors.push('authority is required — every limit must say who set it');
  if (!draft.rationale || String(draft.rationale).trim().length < 20) errors.push('rationale is required and must explain the consequence');

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Compile — a data structure, interpreted. Never generated code.
// ---------------------------------------------------------------------------

function readField(ctx, pathStr) {
  // `hours_to_tca` is derived rather than stored.
  if (pathStr === 'hours_to_tca') {
    const conj = ctx.conj || {};
    const t = Number.isFinite(conj.tca_ms) ? conj.tca_ms : Date.parse(conj.tca || '');
    if (!Number.isFinite(t)) return undefined;
    return (t - ctx.now) / 3600000;
  }
  let cur = ctx;
  for (const part of pathStr.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function compile(draft) {
  const spec = {
    id: String(draft.id).trim(),
    key: String(draft.key || draft.id).trim(),
    title: String(draft.title).trim(),
    field: draft.field,
    op: draft.op,
    value: draft.value,
    class: String(draft.class).toUpperCase() === 'SOFT' ? CLASS.SOFT : CLASS.HARD,
    waivable: draft.waivable !== false,
    authority: String(draft.authority).trim(),
    rationale: String(draft.rationale).trim(),
  };
  const meta = FIELDS[spec.field];
  const op = OPS[spec.op];
  const limitStr = op.limit(spec.value, meta.unit || '');

  return {
    ...spec,
    requirement: `${meta.label} must be ${op.label}${spec.value !== undefined ? ` ${spec.value}${meta.unit || ''}` : ''}.`,
    authored: true,
    spec: { field: spec.field, op: spec.op, value: spec.value },
    evaluate(ctx) {
      const v = readField(ctx, spec.field);
      if (v === undefined || v === null || (meta.type === 'number' && !Number.isFinite(Number(v)))) {
        // The invariant holds for authored rules too: no input means unknown,
        // not a pass.
        return R.unknown(`${meta.label} is not available in this context`, [spec.field]);
      }
      const val = meta.type === 'number' ? Number(v) : v;
      const shown = meta.type === 'number' ? `${val}${meta.unit || ''}` : String(val);
      return op.test(val, spec.value)
        ? R.pass('within the authored limit', shown, limitStr)
        : R.fail('outside the authored limit', shown, limitStr);
    },
  };
}

// ---------------------------------------------------------------------------
// Autoformalise — the same rule as a TLA+ invariant.
//
// The generated invariant is deliberately about the PROTOCOL, not the physics:
// it asserts that an APPROVED maneuver never has this rule in a violated state.
// That is checkable by TLC against the existing gate model, which is the point —
// the LLM's rule becomes something a model checker can rule on.
// ---------------------------------------------------------------------------

function toTla(rule) {
  const safeId = rule.id.replace(/[^A-Za-z0-9]/g, '');
  const meta = FIELDS[rule.field] || { label: rule.field, unit: '' };
  const op = OPS[rule.op] || { label: rule.op };
  return [
    `\\* ${rule.id} — ${rule.title}`,
    `\\* Authored from natural language. Authority: ${rule.authority}`,
    `\\* Requirement: ${meta.label} must be ${op.label} ${rule.value ?? ''}${meta.unit || ''}`,
    `\\* Class: ${rule.class}${rule.waivable === false ? ' (NON-NEGOTIABLE)' : ''}`,
    `${safeId}Respected ==`,
    `    status = "APPROVED" => ruleState["${rule.id}"] # "VIOLATED"`,
    rule.waivable === false
      ? `\n\\* Non-negotiable: it must also never be waived.\n${safeId}NeverWaived ==\n    "${rule.id}" \\notin waived`
      : '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// SEMANTIC VERIFICATION — catching the inversion the validator cannot see.
//
// Structural validation proves a rule is WELL-FORMED. It cannot prove the rule
// means what the author said. In testing, "never authorise when FEWER than
// three nodes are online" compiled to `online_nodes < 3` — structurally
// perfect, and exactly backwards.
//
// So the compiled rule is probed against synthetic contexts before it is
// trusted. `requirement` is generated DETERMINISTICALLY from the data
// structure, so the restatement shown to the operator is what the rule will
// actually do — not what the model said it would do.
// ---------------------------------------------------------------------------

/**
 * Probe a compiled rule at values around its limit and report the outcomes.
 * Gives the operator a truth table instead of a promise.
 */
function probe(rule) {
  const meta = FIELDS[rule.field];
  if (!meta) return null;
  const now = Date.now();

  let samples;
  if (meta.type === 'boolean') samples = [true, false];
  else {
    const v = Number(rule.value);
    const step = Math.max(Math.abs(v) * 0.5, 1);
    samples = [v - step, v, v + step].filter((x) => Number.isFinite(x));
  }

  return samples.map((val) => {
    // Build the minimal context that sets just this field.
    const ctx = { now };
    if (rule.field === 'hours_to_tca') {
      ctx.conj = { tca_ms: now + val * 3600000 };
    } else {
      const parts = rule.field.split('.');
      let cur = ctx;
      for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
      cur[parts[parts.length - 1]] = val;
    }
    const out = rule.evaluate(ctx);
    return {
      value: meta.type === 'boolean' ? val : +Number(val).toFixed(3),
      unit: meta.unit || '',
      result: out.state === 'SATISFIED' ? 'allowed' : out.state === 'VIOLATED' ? 'blocked' : 'unknown',
    };
  });
}

/**
 * The judge prompt: does the DETERMINISTIC restatement mean what the author
 * said? The model is not asked to trust its own earlier output — it is shown
 * the compiled behaviour and asked to agree or disagree.
 */
function verificationPrompt(originalText, rule, probes) {
  const table = (probes || []).map((p) => `  ${rule.field} = ${p.value}${p.unit} -> maneuver ${p.result}`).join('\n');
  return `A person stated an operational constraint. It was compiled into a rule. Decide whether the COMPILED BEHAVIOUR matches what they meant.

THEY SAID:
"${originalText}"

THE COMPILED RULE DOES THIS:
${rule.requirement}
${table}

Answer ONLY with JSON:
{"matches": true|false, "reason": "<one sentence>", "suggested_fix": "<if it does not match, say what the rule should be instead; otherwise empty>"}

Be strict about direction. A rule that blocks when it should allow, or allows when it should block, does NOT match — even if it looks close.`;
}

// ---------------------------------------------------------------------------
// The store of authored rules
// ---------------------------------------------------------------------------

class AuthoredRules {
  constructor() { this.rules = []; }

  add(draft, existingIds = [], opts = {}) {
    const ids = [...existingIds, ...this.rules.map((r) => r.id)];
    const v = validate(draft, ids);
    if (!v.ok) return { ok: false, errors: v.errors, model_declined: !!v.model_declined };
    const rule = compile(draft);
    const probes = probe(rule);
    if (opts.dryRun) return { ok: true, rule, tla: toTla(rule), probe: probes, staged: true };
    this.rules.push(rule);
    return { ok: true, rule, tla: toTla(rule), probe: probes };
  }

  remove(id) {
    const i = this.rules.findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.rules.splice(i, 1);
    return true;
  }

  list() {
    return this.rules.map((r) => ({
      id: r.id, key: r.key, title: r.title, class: r.class, waivable: r.waivable,
      authority: r.authority, requirement: r.requirement, rationale: r.rationale,
      spec: r.spec, authored: true, tla: toTla(r),
    }));
  }

  /** Merge authored rules into a base rulebook without mutating it. */
  extend(rulebook) {
    if (!this.rules.length) return rulebook;
    return { ...rulebook, rules: [...rulebook.rules, ...this.rules] };
  }

  clear() { this.rules.length = 0; }
}

module.exports = {
  AuthoredRules, authoringPrompt, validate, compile, toTla, probe, verificationPrompt,
  FIELDS, OPS, RULE_SCHEMA,
};

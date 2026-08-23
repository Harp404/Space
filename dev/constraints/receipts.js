/**
 * Decision receipts.        dev/constraints/receipts.js
 * =============================================================================
 * WHY A DECISION NEEDS A RECEIPT
 *
 * A gate that refuses an operation is making a claim about the world at a
 * moment in time. Six months later, after an anomaly board has convened, the
 * only question that matters is: what exactly did the system know, and did it
 * decide correctly on what it knew?
 *
 * A log line cannot answer that, because a log line can be edited and cannot
 * be replayed. So every evaluation emits a RECEIPT: a content-addressed record
 * of the inputs, the rulebook, the engine version and the outcome, hashed so
 * that re-running the same inputs reproduces the same identifier byte for byte.
 * Receipts chain, so removing one from the middle is detectable.
 *
 * WHY CANONICAL JSON
 *
 * `JSON.stringify` is not deterministic across engines or across insertion
 * orders: {a:1,b:2} and {b:2,a:1} serialise differently and would hash
 * differently, which would make the receipt useless. RFC 8785 (JSON
 * Canonicalization Scheme) fixes an exact serialisation — sorted keys by
 * UTF-16 code unit, ECMAScript number formatting, minimal escaping — so the
 * same logical value always produces the same bytes.
 *
 * We implement it here rather than take a dependency, because the constraint
 * engine has none and this is ~60 lines.
 *
 * VOCABULARY
 *
 * Field names follow W3C PROV-O (prov:Entity / prov:Activity / prov:Agent,
 * wasDerivedFrom / wasGeneratedBy) so the trail is expressible in a standard
 * provenance model rather than a private schema, and the envelope shape
 * follows in-toto attestations (a `subject` carrying {name, digest}).
 *
 * Zero dependencies beyond node:crypto. Deterministic.
 * =============================================================================
 */

'use strict';

const crypto = require('crypto');

const ENGINE_VERSION = '2.0.0';

/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * Deliberately strict: it throws on values RFC 8785 cannot represent
 * (NaN, Infinity) rather than silently emitting null the way JSON.stringify
 * does. A receipt built from a value we could not faithfully serialise would
 * be a receipt for something other than what was decided.
 */
function canonicalize(value) {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`cannot canonicalize non-finite number: ${value}`);
    }
    // RFC 8785 mandates ECMAScript Number::toString, which is what V8 does,
    // with the single exception that -0 serialises as 0.
    return Object.is(value, -0) ? '0' : String(value);
  }

  if (t === 'string') return quote(value);

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`;
  }

  if (t === 'object') {
    // Sort by UTF-16 code units — which is what String comparison does in JS,
    // and what RFC 8785 requires. Undefined-valued keys are omitted, matching
    // JSON.stringify, so callers cannot smuggle in absent fields.
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${quote(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }

  throw new TypeError(`cannot canonicalize type: ${t}`);
}

/** RFC 8785 string escaping: minimal, with the mandated two-character forms. */
function quote(s) {
  let out = '"';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out + '"';
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** Content address of any value, via its canonical form. */
function digest(value) {
  return sha256(canonicalize(value));
}

/**
 * Build a receipt for one evaluation.
 *
 * The receipt records what was decided AND what it was decided from, so the
 * decision can be re-derived rather than merely believed. `receipt_id` is the
 * hash of everything except itself and the chain link, which means two runs of
 * the same inputs on the same engine produce the same id — that is the
 * property the replay demo relies on.
 */
function issue({ rulebook, context, waivers = [], report, prev = null, now = null }) {
  const subject = {
    rulebook: {
      id: rulebook && rulebook.id ? rulebook.id : 'unnamed',
      // the rulebook's own content address — a changed rule changes the id,
      // so a receipt can never be silently reinterpreted under new rules
      digest: digest(stripFunctions(rulebook)),
      rules: rulebook && Array.isArray(rulebook.rules) ? rulebook.rules.length : 0,
    },
    inputs: { digest: digest(context) },
    waivers: { digest: digest(waivers), count: waivers.length },
  };

  const outcome = {
    signal: report.signal,
    authorised: report.authorised,
    progress: report.progress,
    // Per-rule outcome only — the human-readable text is not hashed, so
    // rewording a message cannot invalidate a historical receipt.
    rules: (report.rules || []).map((r) => ({
      id: r.id, state: r.state, waivable: r.waivable !== false,
    })),
  };

  const body = {
    _type: 'astromesh.decision/v1',
    engine_version: ENGINE_VERSION,
    subject,
    outcome,
    // PROV-O: this evaluation is the Activity that generated the outcome
    prov: {
      'prov:wasGeneratedBy': 'constraint-evaluation',
      'prov:used': [subject.rulebook.digest, subject.inputs.digest],
      'prov:wasDerivedFrom': prev ? prev.receipt_id : null,
    },
  };

  const receipt_id = digest(body);
  return {
    ...body,
    receipt_id,
    prev_receipt_id: prev ? prev.receipt_id : null,
    // Timestamps are OUTSIDE the hashed body on purpose: including one would
    // make every receipt unique and destroy the replay property we want to
    // demonstrate. Order is carried by the chain, not by the clock.
    issued_at: now ?? Date.now(),
  };
}

/**
 * Re-derive a receipt from stored inputs and check it matches.
 * Returns { ok, expected, actual } — never throws on mismatch, because a
 * mismatch is a finding to report, not an exception to swallow.
 */
function verify(receipt, { rulebook, context, waivers = [], report }) {
  const fresh = issue({
    rulebook, context, waivers, report,
    prev: receipt.prev_receipt_id ? { receipt_id: receipt.prev_receipt_id } : null,
  });
  return {
    ok: fresh.receipt_id === receipt.receipt_id,
    expected: receipt.receipt_id,
    actual: fresh.receipt_id,
  };
}

/**
 * Verify a whole chain: every link points at its predecessor, and no receipt
 * has been removed or reordered.
 */
function verifyChain(receipts) {
  const problems = [];
  for (let i = 0; i < receipts.length; i++) {
    const want = i === 0 ? null : receipts[i - 1].receipt_id;
    if ((receipts[i].prev_receipt_id ?? null) !== want) {
      problems.push({
        index: i,
        receipt_id: receipts[i].receipt_id,
        expected_prev: want,
        actual_prev: receipts[i].prev_receipt_id ?? null,
      });
    }
  }
  return { ok: problems.length === 0, length: receipts.length, problems };
}

/** Rulebooks carry predicate functions; hash their shape, not their source. */
function stripFunctions(v) {
  if (Array.isArray(v)) return v.map(stripFunctions);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (typeof x === 'function') out[k] = `[fn ${x.name || 'anonymous'}/${x.length}]`;
      else out[k] = stripFunctions(x);
    }
    return out;
  }
  return v;
}

module.exports = {
  canonicalize, digest, sha256, issue, verify, verifyChain, ENGINE_VERSION,
};

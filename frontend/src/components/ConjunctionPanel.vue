<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">
        <span class="title-icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L13 7L7 13L1 7L7 1Z" stroke="currentColor" stroke-width="1.3" fill="none"/>
            <path d="M7 4v3M7 9v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </span>
        CONJUNCTION RISK MONITOR
      </div>
      <div class="panel-meta mono">{{ cdms.length }} OFFICIAL · {{ conjunctions.length }} SCREENED</div>
    </div>

    <!-- Last maneuver result -->
    <div v-if="lastManeuver" class="maneuver-result" :class="'result-' + (lastManeuver.status || '').toLowerCase()">
      <div class="result-header">
        <span class="result-label">LAST ARBITRATION</span>
        <span class="result-status">{{ lastManeuver.status }}</span>
        <span class="result-time mono" v-if="lastManeuver.duration_ms">{{ lastManeuver.duration_ms }}ms</span>
      </div>
      <div v-if="lastManeuver.votes && lastManeuver.votes.length" class="vote-row">
        <div v-for="vote in lastManeuver.votes" :key="vote.node_id"
          class="vote-chip" :class="vote.vote === 'YES' ? 'vote-yes' : 'vote-no'">
          <span class="vote-node">{{ vote.node_id }}</span>
          <span class="vote-val">{{ vote.vote }}</span>
        </div>
      </div>
    </div>

    <!-- Avoidance plan result -->
    <div v-if="activePlan" class="plan-result">
      <div class="plan-head">
        <span class="plan-title">✓ AVOIDANCE PLAN</span>
        <button class="plan-close" @click="$emit('clearPlan')">×</button>
      </div>
      <div class="plan-grid">
        <div><span class="pl-k">MISS OPENS</span><span class="pl-v ok">{{ activePlan.original_miss_km }} → {{ activePlan.new_miss_km }} km</span></div>
        <div><span class="pl-k">TOTAL Δv</span><span class="pl-v">{{ activePlan.total_delta_v_ms }} m/s</span></div>
        <div><span class="pl-k">SCREENED</span><span class="pl-v">{{ activePlan.screened_objects }} / {{ activePlan.catalogue_size }}</span></div>
        <div><span class="pl-k">VS 33K CATALOGUE</span><span class="pl-v" :class="activePlan.clear_vs_catalogue ? 'ok' : 'bad'">{{ activePlan.clear_vs_catalogue ? 'CLEAR' : activePlan.new_conjunctions.length + ' NEW' }}</span></div>
      </div>
      <div class="plan-maneuvers">
        <div v-for="(m, i) in activePlan.maneuvers" :key="i" class="pm-row">
          <span class="pm-sat">{{ m.sat }}</span>
          <span v-if="m.maneuverable" class="pm-act">
            change orbit <b>{{ m.orbit_shift_deg }}°</b> · {{ m.direction }} <b>{{ m.altitude_change_km }} km</b> · Δv {{ m.delta_v_ms }} m/s
          </span>
          <span v-else class="pm-deb">cannot maneuver — debris / rocket body</span>
        </div>
      </div>
      <div class="plan-legend"><span class="lg-red">— current path</span><span class="lg-blue">— safer path</span></div>
    </div>

    <!-- List -->
    <div class="conj-list stagger">
      <div v-if="sorted.length === 0" class="empty-state">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="12" stroke="var(--border-bright)" stroke-width="1.2"/>
          <path d="M14 8v6M14 17v1" stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>No conjunctions detected</span>
      </div>

      <div
        v-for="(conj, idx) in sorted"
        :key="conj.id"
        class="conj-row"
        :class="['risk-' + getRiskClass(conj.risk_index), { actionable: conj.source !== 'CDM' }]"
        :title="conj.source === 'CDM' ? 'Official CDM — read-only context' : 'Open the rulebook for this event'"
        @click="conj.source !== 'CDM' && $emit('showConstraints', conj.id)"
      >
        <!-- Rank -->
        <div class="rank-badge" :class="'rank-' + getRiskClass(conj.risk_index)">
          {{ idx + 1 }}
        </div>

        <!-- Satellites -->
        <div class="sat-pair">
          <div class="source-tag" :class="conj.source === 'CDM' ? 'src-cdm' : 'src-screen'">
            <template v-if="conj.source === 'CDM'">● OFFICIAL · USSF CDM</template>
            <template v-else>○ OUR SCREENING</template>
          </div>
          <div class="sat-name">{{ conj.sat1_name }}</div>
          <div class="vs-divider">
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
              <path d="M0 4h12M8 1l3 3-3 3" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="sat-name">{{ conj.sat2_name }}</div>
        </div>

        <!-- Metrics -->
        <div class="metrics">
          <div class="metric">
            <span class="metric-label">RANGE</span>
            <span class="metric-val" :class="getRangeClass(conj.min_range_km)">
              {{ formatRange(conj.min_range_km) }}
            </span>
          </div>
          <div class="metric">
            <span class="metric-label">Pc</span>
            <span class="metric-val" :class="getProbClass(conj.probability)">
              {{ formatProb(conj.probability) }}
            </span>
          </div>
          <div class="metric risk-metric">
            <span class="metric-label">RISK</span>
            <span class="metric-val risk-val" :class="getRiskClass(conj.risk_index)">
              {{ Math.round(conj.risk_index) }}
            </span>
          </div>
        </div>

        <!-- TCA -->
        <div class="tca-col">
          <span class="metric-label">TCA</span>
          <span class="tca-val mono">{{ formatTCA(conj.tca) }}</span>
        </div>

        <!-- Status + the four-state constraint signal -->
        <div class="status-col">
          <span class="status-badge" :class="'status-' + (conj.status || 'monitoring').toLowerCase()">
            {{ conj.status || 'MONITORING' }}
          </span>
          <button
            v-if="conj.constraint"
            class="csig"
            :class="'csig-' + conj.constraint.signal.toLowerCase()"
            :title="constraintTitle(conj)"
            @click.stop="$emit('showConstraints', conj.id)"
          >
            {{ SIG_SHORT[conj.constraint.signal] }}
            <span class="csig-pct">{{ conj.constraint.progress }}%</span>
          </button>
          <span v-if="conj.constraint && conj.constraint.deadline_in_ms != null" class="csig-clock" :title="'This event self-blocks when the rule deadline passes'">
            ⏱ {{ fmtDur(conj.constraint.deadline_in_ms) }}
          </span>
        </div>

        <!-- Actions -->
        <div class="actions-col">
          <span v-if="conj.source === 'CDM'" class="live-tag" title="Live operational data — read only">LIVE</span>
          <template v-else>
          <button
            class="btn-plan btn-cinema"
            title="Replay the close approach on the globe — both objects, real orbits, range ticking down"
            @click.stop="$emit('playApproach', conj.id)"
          >⏵</button>
          <button
            class="btn-plan"
            :disabled="planningId === conj.id"
            @click.stop="$emit('planManeuver', conj.id)"
            title="Plan avoidance maneuver (screens vs whole catalogue)"
          >
            {{ planningId === conj.id ? '…' : 'PLAN' }}
          </button>
          <template v-if="canManeuver(conj)">
          <button
            class="btn-approve"
            :class="{ gated: conj.constraint && !conj.constraint.authorised }"
            :disabled="conj.status === 'APPROVED' || conj.status === 'RESOLVED'"
            @click.stop="$emit('requestManeuver', conj.id)"
            :title="voteTitle(conj)"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5.5l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            VOTE
          </button>
          <button
            class="btn-emergency"
            @click.stop="$emit('emergencyOverride', conj.id)"
            title="Emergency override — bypass consensus"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1.5v4M5 7.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.1"/>
            </svg>
          </button>
          </template>
          <span v-else class="deb-tag" title="Both objects are debris / rocket bodies — cannot be commanded to maneuver">DEBRIS</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  conjunctions: {
    type: Array,
    default: () => [],
  },
  cdms: {
    type: Array,
    default: () => [],
  },
  leaderName: String,
  lastManeuver: {
    type: Object,
    default: null,
  },
  activePlan: { type: Object, default: null },
  planningId: { type: [Number, String], default: null },
})

const emit = defineEmits(['requestManeuver', 'emergencyOverride', 'planManeuver', 'clearPlan', 'showConstraints', 'playApproach'])

// The four-state completion signal, per event.
const SIG_SHORT = {
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  BLOCKED: 'BLOCKED',
  UNRESOLVED: 'UNKNOWN',
}

function constraintTitle(conj) {
  const c = conj.constraint
  if (!c) return ''
  const bits = [`${c.signal} — ${c.progress}% of constraint work closed`]
  if (c.blocking) bits.push(`${c.blocking} hard rule(s) violated`)
  if (c.unevaluated) bits.push(`${c.unevaluated} rule(s) not evaluated`)
  if (c.first) bits.push(`first: ${c.first}`)
  bits.push('Click for the full rulebook.')
  return bits.join(' · ')
}

function voteTitle(conj) {
  const c = conj.constraint
  if (c && !c.authorised) {
    return c.signal === 'BLOCKED'
      ? `Gate will refuse: a hard flight rule is violated (${c.first || '—'})`
      : `Gate will withhold: ${c.unevaluated} rule(s) not yet evaluated (${c.first || '—'})`
  }
  return 'Request the operator poll'
}

function fmtDur(ms) {
  if (ms == null) return '—'
  const m = ms / 60000
  if (m < 60) return `${Math.round(m)}m`
  if (m < 1440) return `${(m / 60).toFixed(1)}h`
  return `${(m / 1440).toFixed(1)}d`
}

// Only LIVE satellites can be commanded to maneuver — debris / rocket bodies cannot.
function isManeuverable(name) { return !/DEB|R\/B|DEBRIS|COOLANT|WESTFORD|FRAG|PLAT/i.test(name || '') }
function canManeuver(conj) { return isManeuverable(conj.sat1_name) || isManeuverable(conj.sat2_name) }

// Derive a 0-100 risk index from the operational Pc of a real CDM.
function riskFromPc(pc) {
  if (pc == null || pc <= 0) return 30
  if (pc > 1e-2) return 96
  if (pc > 3e-3) return 88
  if (pc > 1e-3) return 80
  if (pc > 1e-4) return 64
  if (pc > 1e-5) return 46
  return 32
}

// Real operational CDMs (covariance-based, US Space Force) take priority, then
// our own SGP4 screening fills out broad coverage. One unified, ranked list.
const sorted = computed(() => {
  const official = [...props.cdms].map((c) => ({
    id: 'cdm-' + c.id,
    sat1_name: c.sat1_name,
    sat2_name: c.sat2_name,
    min_range_km: c.min_range_km,
    probability: c.probability,
    risk_index: riskFromPc(c.probability),
    tca: c.tca && !c.tca.endsWith('Z') ? c.tca + 'Z' : c.tca,
    status: 'OFFICIAL',
    source: 'CDM',
    emergency: c.emergency,
  }))
  const screened = [...props.conjunctions].map((c) => ({ ...c, source: 'SGP4' }))
  official.sort((a, b) => (b.probability || 0) - (a.probability || 0))
  // Within our screening, events someone can actually ACT on lead. A
  // debris-on-debris pass is real risk but offers no button except PLAN;
  // sorting purely by risk buried every voteable event below the fold, so the
  // full path — plan, vote, watch the gate arbitrate — was never on screen.
  const voteable = (c) => (isManeuverable(c.sat1_name) || isManeuverable(c.sat2_name)) ? 1 : 0
  screened.sort((a, b) => (voteable(b) - voteable(a)) || ((b.risk_index || 0) - (a.risk_index || 0)))
  // ACTIONABLE EVENTS FIRST. The screened events are the ones with a
  // constraint signal, a PLAN button and a VOTE button; the official CDMs are
  // read-only context. Leading with eight read-only cards meant that in the
  // 360px dock a user saw nothing but dead cards and concluded the whole
  // panel did nothing — which, for the part of it they could see, was true.
  return [...screened.slice(0, 8), ...official.slice(0, 6)]
})

function getRiskClass(ri) {
  if (ri >= 70) return 'critical'
  if (ri >= 30) return 'watch'
  return 'nominal'
}

function getRangeClass(km) {
  if (km < 1) return 'critical'
  if (km < 5) return 'watch'
  return 'nominal'
}

function getProbClass(p) {
  if (p > 0.01) return 'critical'
  if (p > 0.001) return 'watch'
  return 'nominal'
}

function formatRange(km) {
  if (km == null) return '—'
  if (km < 1) return `${(km * 1000).toFixed(0)}m`
  return `${km.toFixed(2)}km`
}

function formatProb(p) {
  if (p == null) return '—'
  if (p < 0.0001) return `${(p * 1e6).toFixed(1)}×10⁻⁶`
  if (p < 0.001) return `${(p * 1000).toFixed(2)}×10⁻³`
  return `${(p * 100).toFixed(3)}%`
}

function formatTCA(tca) {
  if (!tca) return '—'
  try {
    const d = new Date(tca)
    const now = new Date()
    const diffMs = d - now
    if (diffMs < 0) return 'PASSED'
    const diffH = Math.floor(diffMs / 3600000)
    const diffM = Math.floor((diffMs % 3600000) / 60000)
    const diffS = Math.floor((diffMs % 60000) / 1000)
    if (diffH > 0) return `T-${diffH}h${diffM}m`
    if (diffM > 0) return `T-${diffM}m${diffS}s`
    return `T-${diffS}s`
  } catch {
    return tca
  }
}
</script>

<style scoped>
/* ---- four-state constraint signal ---- */
.csig {
  display: flex; align-items: center; gap: 5px;
  font-family: var(--font-mono); font-size: var(--t-micro); font-weight: 700; letter-spacing: 0.12em;
  line-height: 15px; padding: 0 6px; border-radius: 3px; cursor: pointer; background: none;
  white-space: nowrap;
}
.csig-pct { opacity: 0.7; font-weight: 500; }
.csig-complete   { color: var(--color-green);  border: 1px solid var(--color-green);  background: var(--color-green-dim); }
.csig-partial    { color: var(--color-amber);  border: 1px solid var(--color-amber);  background: var(--color-amber-dim); }
.csig-blocked    { color: var(--color-red);    border: 1px solid var(--color-red);    background: var(--color-red-dim); }
.csig-unresolved { color: var(--color-purple); border: 1px solid var(--color-purple); background: var(--color-purple-dim); }
.csig:hover { filter: brightness(1.35); }
.csig-clock { font-family: var(--font-mono); font-size: var(--t-micro); letter-spacing: 0.08em; color: var(--color-amber); white-space: nowrap; }
.btn-approve.gated { opacity: 0.5; border-style: dashed; }

.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-panel);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s3);
  padding: var(--s4) var(--s4) var(--s3);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: var(--s2);
  font-family: var(--font-mono);
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--text-primary);
}

.title-icon {
  color: var(--color-amber);
  display: flex;
  align-items: center;
}

.panel-meta {
  font-size: var(--t-micro);
  color: var(--text-dim);
  letter-spacing: 0.12em;
  white-space: nowrap;
}

/* Maneuver result */
.maneuver-result {
  margin: 8px;
  padding: 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
  flex-shrink: 0;
}

.result-approved { border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.05); }
.result-denied { border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.05); }

.result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.result-label {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  letter-spacing: 0.16em;
  color: var(--text-dim);
}

.result-status {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-primary);
}

.result-approved .result-status { color: var(--color-green); }
.result-denied .result-status { color: var(--color-red); }

.result-time {
  font-size: var(--t-label);
  color: var(--text-dim);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.vote-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.vote-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  line-height: 17px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.vote-yes {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: var(--color-green);
}

.vote-no {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--color-red);
}

.vote-node {
  opacity: 0.7;
}

/* List */
.conj-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--s3);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
}

/* =====================================================================
   A conjunction row.

   This was SIX grid columns — rank, satellite pair, three metrics, TCA,
   a status stack and three action buttons — inside a 360px dock panel.
   At that width every column collapsed to its minimum, the satellite
   names ellipsed to two characters, and the action buttons pushed out
   past the clipped edge of the list.

   It is now THREE stacked bands inside one card: who, the numbers, and
   what you can do about it. Each band gets the full panel width, so
   nothing has to fight for horizontal space.
   ================================================================== */
.conj-row.actionable { cursor: pointer; }
.conj-row.actionable:hover { border-color: var(--accent-blue); background: rgba(255, 255, 255, 0.03); }
.conj-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  grid-template-areas:
    "rank pair    status"
    "met  met     met"
    "tca  act     act";
  align-items: center;
  gap: var(--s2) var(--s2);
  padding: var(--s3);
  margin-bottom: var(--s2);
  border-radius: var(--r1);
  border: 1px solid var(--border);
  background: var(--bg-panel-3);
  transition: background var(--dur-1), border-color var(--dur-1);
  animation: fade-in-up 0.2s ease-out;
}

.conj-row:hover {
  background: var(--bg-panel-2);
  border-color: var(--border-bright);
}

/* The wash is the signal; the rank badge carries the same hue, so the
   row reads as urgent from across a room without a second border. */
.conj-row.risk-critical {
  border-color: rgba(255, 95, 86, 0.28);
  background: var(--color-red-dim);
}

.conj-row.risk-watch {
  border-color: rgba(224, 163, 46, 0.22);
}

/* Rank badge */
.rank-badge {
  grid-area: rank;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: var(--t-label);
  font-weight: 700;
  flex-shrink: 0;
}

.rank-critical { background: rgba(239, 68, 68, 0.2); color: var(--color-red); }
.rank-watch { background: rgba(245, 158, 11, 0.15); color: var(--color-amber); }
.rank-nominal { background: rgba(16, 185, 129, 0.1); color: var(--color-green); }

/* --- band 1: who --- */
.sat-pair {
  grid-area: pair;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sat-name {
  font-family: var(--font-mono);
  font-size: var(--t-body);
  font-weight: 500;
  line-height: 1.25;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vs-divider {
  color: var(--text-dim);
  display: flex;
  align-items: center;
  height: 8px;
}

/* --- band 2: the numbers ---
   A ruled strip across the full width. Four readings, evenly spaced,
   each a label over a tabular figure — so the eye can scan DOWN a
   column of rows and compare like with like. */
.metrics {
  grid-area: met;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s2);
  padding-top: var(--s3);
  border-top: 1px solid var(--border);
}

.metric,
.tca-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* Band 3, left: when it happens. Actions sit to its right. */
.tca-col {
  grid-area: tca;
  align-items: flex-start;
}

.metric-label {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  letter-spacing: 0.14em;
  color: var(--text-dim);
  text-transform: uppercase;
}

.metric-val {
  font-family: var(--font-mono);
  font-size: var(--t-body);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.metric-val.critical { color: var(--color-red); }
.metric-val.watch { color: var(--color-amber); }
.metric-val.nominal { color: var(--color-green); }

.risk-val {
  font-size: var(--t-lead);
  font-weight: 700;
}
/* No glow — the hue already carries it. */
.risk-val.critical { color: var(--color-red); }

.tca-val {
  font-family: var(--font-mono);
  font-size: var(--t-body);
  font-weight: 600;
  line-height: 1;
  color: var(--text-secondary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* --- status, top-right of band 1 --- */
.status-col {
  grid-area: status;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.status-badge {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 15px;
  padding: 0 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.status-monitoring {
  color: var(--color-amber);
  background: var(--color-amber-dim);
  border: 1px solid rgba(245, 158, 11, 0.3);
  animation: blink-dot 2s ease-in-out infinite;
}

.status-approved {
  color: var(--color-green);
  background: var(--color-green-dim);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.status-denied {
  color: var(--color-red);
  background: var(--color-red-dim);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.status-resolved {
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
}

.status-official {
  color: var(--accent-blue);
  background: rgba(201, 162, 39, 0.12);
  border: 1px solid rgba(201, 162, 39, 0.4);
}

/* Source tag (CDM = official covariance data, vs our screening).
   Was 7px — smaller than the product's own stated 10px floor, and the
   distinction it draws (official vs our own screening) is the single most
   important thing on the row to read correctly. */
.source-tag {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  font-weight: 700;
  letter-spacing: 0.14em;
  margin-bottom: 2px;
}

.src-cdm { color: var(--accent-blue); }
.src-screen { color: var(--text-dim); }

.live-tag {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 24px;
  color: var(--accent-blue);
  background: var(--accent-blue-dim);
  border: 1px solid rgba(201, 162, 39, 0.3);
  border-radius: 4px;
  padding: 0 8px;
}

/* --- band 3, right: what you can do --- */
.actions-col {
  /* Actions are the point of the card — give them the weight of a toolbar,
     not the weight of a tag. */
  grid-area: act;
  display: flex;
  gap: var(--s2);
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
}

.btn-approve,
.btn-cinema { min-width: 34px; font-size: 13px; }
.btn-plan {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 34px;
  padding: 0 16px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: 0.1em;
  transition: background var(--dur-1), border-color var(--dur-1), color var(--dur-1);
  white-space: nowrap;
}

.btn-approve {
  background: var(--accent-blue-dim);
  border: 1px solid rgba(201, 162, 39, 0.32);
  color: var(--accent-blue);
}

.btn-approve:hover:not(:disabled) {
  background: rgba(201, 162, 39, 0.22);
  border-color: var(--accent-blue);
}

.btn-approve:disabled,
.btn-plan:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.btn-emergency {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 34px;
  background: var(--color-red-dim);
  border: 1px solid rgba(255, 95, 86, 0.3);
  border-radius: 4px;
  color: var(--color-red);
  transition: background var(--dur-1), border-color var(--dur-1);
}

.btn-emergency:hover {
  background: rgba(255, 95, 86, 0.22);
  border-color: var(--color-red);
}

.mono {
  font-family: var(--font-mono);
}

/* Avoidance plan result banner */
.plan-result {
  margin: 8px;
  padding: 9px 10px;
  border-radius: 6px;
  border: 1px solid rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.06);
  flex-shrink: 0;
}
.plan-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
.plan-title { font-family: var(--font-mono); font-size: var(--t-label); font-weight: 700; letter-spacing: 0.14em; color: var(--color-green); }
.plan-close { color: var(--text-dim); font-size: 16px; line-height: 1; padding: 0 4px; }
.plan-close:hover { color: var(--text-primary); }
.plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 12px; }
.plan-grid > div { display: flex; flex-direction: column; gap: 1px; }
.pl-k { font-family: var(--font-mono); font-size: var(--t-micro); letter-spacing: 0.14em; color: var(--text-dim); }
.pl-v { font-family: var(--font-mono); font-size: var(--t-body); font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.pl-v.ok { color: var(--color-green); }
.pl-v.bad { color: var(--color-red); }
.plan-maneuvers { margin-top: 8px; display: flex; flex-direction: column; gap: 5px; }
.pm-row { display: flex; flex-direction: column; gap: 1px; border-left: 2px solid rgba(201, 162, 39, 0.4); padding-left: 7px; }
.pm-sat { font-family: var(--font-mono); font-size: var(--t-label); font-weight: 700; color: var(--text-primary); letter-spacing: 0.08em; }
.pm-act { font-size: var(--t-body); line-height: 1.45; color: var(--text-secondary); }
.pm-act b { color: var(--text-primary); font-weight: 700; }
.pm-deb { font-size: var(--t-label); color: var(--text-dim); font-style: italic; }
.plan-legend { display: flex; gap: var(--s4); margin-top: var(--s3); font-family: var(--font-mono); font-size: var(--t-micro); letter-spacing: 0.08em; }
.lg-red { color: var(--color-red); }
.lg-blue { color: var(--accent-blue); }

.btn-plan {
  background: var(--color-green-dim);
  border: 1px solid rgba(76, 199, 106, 0.35);
  color: var(--color-green);
}
.btn-plan:hover:not(:disabled) { background: rgba(76, 199, 106, 0.22); border-color: var(--color-green); }
.deb-tag {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 24px;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 8px;
  white-space: nowrap;
}
</style>

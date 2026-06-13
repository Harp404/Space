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
    <div class="conj-list">
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
        :class="'risk-' + getRiskClass(conj.risk_index)"
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

        <!-- Status -->
        <div class="status-col">
          <span class="status-badge" :class="'status-' + (conj.status || 'monitoring').toLowerCase()">
            {{ conj.status || 'MONITORING' }}
          </span>
        </div>

        <!-- Actions -->
        <div class="actions-col">
          <span v-if="conj.source === 'CDM'" class="live-tag" title="Live operational data — read only">LIVE</span>
          <template v-else>
          <button
            class="btn-plan"
            :disabled="planningId === conj.id"
            @click="$emit('planManeuver', conj.id)"
            title="Plan avoidance maneuver (screens vs whole catalogue)"
          >
            {{ planningId === conj.id ? '…' : 'PLAN' }}
          </button>
          <template v-if="canManeuver(conj)">
          <button
            class="btn-approve"
            :disabled="conj.status === 'APPROVED' || conj.status === 'RESOLVED'"
            @click="$emit('requestManeuver', conj.id)"
            title="Request consensus vote"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5.5l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            VOTE
          </button>
          <button
            class="btn-emergency"
            @click="$emit('emergencyOverride', conj.id)"
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

const emit = defineEmits(['requestManeuver', 'emergencyOverride', 'planManeuver', 'clearPlan'])

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
  screened.sort((a, b) => (b.risk_index || 0) - (a.risk_index || 0))
  // Show both layers: the highest-Pc official CDMs on top, then our own screening.
  return [...official.slice(0, 8), ...screened.slice(0, 6)]
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
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-primary);
}

.title-icon {
  color: var(--color-amber);
  display: flex;
  align-items: center;
}

.panel-meta {
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.08em;
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
  font-size: 8px;
  letter-spacing: 0.12em;
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
  font-size: 9px;
  color: var(--text-dim);
  margin-left: auto;
}

.vote-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.vote-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
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
  font-size: 8px;
}

/* List */
.conj-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 6px;
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

.conj-row {
  display: grid;
  grid-template-columns: 22px 1fr auto auto auto auto;
  align-items: center;
  gap: 6px;
  padding: 7px 6px;
  margin-bottom: 3px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.15s;
  animation: fade-in-up 0.2s ease-out;
}

.conj-row:hover {
  background: rgba(59, 130, 246, 0.05);
  border-color: var(--border);
}

.conj-row.risk-critical {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.04);
}

.conj-row.risk-watch {
  border-color: rgba(245, 158, 11, 0.15);
}

/* Rank badge */
.rank-badge {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}

.rank-critical { background: rgba(239, 68, 68, 0.2); color: var(--color-red); }
.rank-watch { background: rgba(245, 158, 11, 0.15); color: var(--color-amber); }
.rank-nominal { background: rgba(16, 185, 129, 0.1); color: var(--color-green); }

/* Sat pair */
.sat-pair {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sat-name {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vs-divider {
  color: var(--text-dim);
  display: flex;
  align-items: center;
  padding-left: 2px;
}

/* Metrics */
.metrics {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.metric-label {
  font-family: var(--font-mono);
  font-size: 7px;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  text-transform: uppercase;
}

.metric-val {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.metric-val.critical { color: var(--color-red); }
.metric-val.watch { color: var(--color-amber); }
.metric-val.nominal { color: var(--color-green); }

.risk-val {
  font-size: 14px;
  font-weight: 700;
}

.risk-val.critical {
  color: var(--color-red);
  text-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
}

/* TCA */
.tca-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.tca-val {
  font-size: 9px;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* Status badge */
.status-col {
  flex-shrink: 0;
}

.status-badge {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 5px;
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
  color: #22d3ee;
  background: rgba(34, 211, 238, 0.12);
  border: 1px solid rgba(34, 211, 238, 0.4);
}

/* Source tag (CDM = official covariance data, vs our screening) */
.source-tag {
  font-family: var(--font-mono);
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.1em;
  margin-bottom: 1px;
}

.src-cdm { color: #22d3ee; }
.src-screen { color: var(--text-dim); opacity: 0.6; }

.live-tag {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #22d3ee;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 3px;
  padding: 3px 6px;
  animation: blink-dot 2s ease-in-out infinite;
}

/* Actions */
.actions-col {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.btn-approve {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 7px;
  background: var(--accent-blue-dim);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 3px;
  color: var(--accent-blue);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn-approve:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.25);
  border-color: var(--accent-blue);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.3);
}

.btn-approve:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.btn-emergency {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: var(--color-red-dim);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 3px;
  color: var(--color-red);
  transition: all 0.15s;
}

.btn-emergency:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: var(--color-red);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
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
.plan-title { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: var(--color-green); }
.plan-close { color: var(--text-dim); font-size: 16px; line-height: 1; padding: 0 4px; }
.plan-close:hover { color: var(--text-primary); }
.plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 12px; }
.plan-grid > div { display: flex; flex-direction: column; gap: 1px; }
.pl-k { font-family: var(--font-mono); font-size: 7px; letter-spacing: 0.1em; color: var(--text-dim); }
.pl-v { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--text-primary); }
.pl-v.ok { color: var(--color-green); }
.pl-v.bad { color: var(--color-red); }
.plan-maneuvers { margin-top: 8px; display: flex; flex-direction: column; gap: 5px; }
.pm-row { display: flex; flex-direction: column; gap: 1px; border-left: 2px solid rgba(59,130,246,0.4); padding-left: 7px; }
.pm-sat { font-family: var(--font-mono); font-size: 9px; font-weight: 700; color: var(--text-primary); letter-spacing: 0.04em; }
.pm-act { font-size: 10.5px; color: var(--text-secondary); }
.pm-act b { color: #60a5fa; font-weight: 700; }
.pm-deb { font-size: 10px; color: var(--text-dim); font-style: italic; }
.plan-legend { display: flex; gap: 14px; margin-top: 8px; font-family: var(--font-mono); font-size: 8px; }
.lg-red { color: #ef4444; }
.lg-blue { color: #3b82f6; }

.btn-plan {
  display: flex;
  align-items: center;
  padding: 3px 6px;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.35);
  border-radius: 3px;
  color: var(--color-green);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  transition: all 0.15s;
}
.btn-plan:hover:not(:disabled) { background: rgba(16, 185, 129, 0.25); box-shadow: 0 0 8px rgba(16, 185, 129, 0.3); }
.btn-plan:disabled { opacity: 0.5; cursor: wait; }
.deb-tag { font-family: var(--font-mono); font-size: 8px; font-weight: 700; letter-spacing: 0.06em; color: var(--text-dim); background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 3px; padding: 3px 6px; white-space: nowrap; }
</style>

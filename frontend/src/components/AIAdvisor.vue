<template>
  <div class="advisor-panel">
    <div class="panel-header">
      <div class="panel-title">
        <!-- Brain/AI icon -->
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 2C3.343 2 2 3.343 2 5c0 .864.35 1.647.916 2.218C2.35 7.74 2 8.6 2 9.5 2 11.433 3.567 13 5.5 13c.53 0 1.03-.124 1.47-.343A2.99 2.99 0 008.5 13C10.433 13 12 11.433 12 9.5c0-.9-.35-1.76-.916-2.282A2.99 2.99 0 0012 5c0-1.657-1.343-3-3-3-.72 0-1.38.254-1.894.674A3.01 3.01 0 006 2H5z"
            stroke="currentColor" stroke-width="1.1" fill="none"/>
          <circle cx="5" cy="5" r="0.8" fill="currentColor"/>
          <circle cx="9" cy="5" r="0.8" fill="currentColor"/>
          <path d="M5 7.5c.5.5 3.5.5 4 0" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
          <path d="M7 2v1M7 11v1" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.5"/>
        </svg>
        AUTONOMOUS TRIAGE AGENT
      </div>
      <div class="agent-toggle-group">
        <button
          class="toggle-btn"
          :class="agentEnabled ? 'toggle-deactivate' : 'toggle-activate'"
          @click="$emit('toggleAgent', !agentEnabled)"
        >
          {{ agentEnabled ? 'DEACTIVATE' : 'ACTIVATE' }}
        </button>
      </div>
    </div>

    <div class="advisor-body">
      <!-- Status + scan countdown -->
      <div class="status-row">
        <div class="status-indicator" :class="agentEnabled ? 'status-active' : 'status-standby'">
          <span class="status-dot"><span v-if="agentEnabled" class="dot-pulse"></span></span>
          <span class="status-text">{{ agentEnabled ? 'ACTIVE' : 'STANDBY' }}</span>
        </div>
        <div v-if="agentEnabled" class="scan-countdown mono">NEXT SCAN {{ scanCountdown }}s</div>
      </div>

      <!-- Threat summary row -->
      <div class="threat-summary">
        <div class="threat-stat">
          <span class="tstat-val mono">{{ conjunctions.length }}</span>
          <span class="tstat-label">MONITORED</span>
        </div>
        <div class="threat-divider"></div>
        <div class="threat-stat">
          <span class="tstat-val mono critical">{{ criticalCount }}</span>
          <span class="tstat-label">CRITICAL</span>
        </div>
        <div class="threat-divider"></div>
        <div class="threat-stat">
          <span class="tstat-val mono green">{{ resolvedToday }}</span>
          <span class="tstat-label">RESOLVED</span>
        </div>
      </div>

      <!-- Escalation queue -->
      <div class="section-label">ESCALATION QUEUE</div>
      <div class="escalation-list">
        <div v-if="escalationQueue.length === 0" class="queue-empty">
          <span>— Queue clear —</span>
        </div>
        <div v-for="conj in escalationQueue" :key="conj.id" class="queue-item">
          <span class="queue-risk mono">{{ Math.round(conj.risk_index) }}</span>
          <div class="queue-sats">
            <span>{{ conj.sat1_name }}</span>
            <span class="queue-sep">×</span>
            <span>{{ conj.sat2_name }}</span>
          </div>
          <span class="queue-prob mono">{{ formatProb(conj.probability) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  agentEnabled: Boolean,
  conjunctions: {
    type: Array,
    default: () => [],
  },
  lastManeuver: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['toggleAgent'])

const scanCountdown = ref(30)
const resolvedToday = ref(0)
let scanTimer = null

// (unused helper retained for safe markdown rendering elsewhere)
function render(t) {
  const esc = String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\*)(.+?)\*/g, '$1<i>$2</i>')
    .replace(/\n/g, '<br>')
}

watch(
  () => props.agentEnabled,
  (enabled) => {
    if (enabled) {
      startScanTimer()
    } else {
      stopScanTimer()
      scanCountdown.value = 30
    }
  },
)

watch(
  () => props.lastManeuver,
  (val) => {
    if (val && (val.status === 'APPROVED' || val.status?.includes('EMERGENCY'))) {
      resolvedToday.value++
    }
  },
)

function startScanTimer() {
  stopScanTimer()
  scanTimer = setInterval(() => {
    scanCountdown.value--
    if (scanCountdown.value <= 0) {
      scanCountdown.value = 30
    }
  }, 1000)
}

function stopScanTimer() {
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }
}

onMounted(() => {
  if (props.agentEnabled) startScanTimer()
})

onUnmounted(() => stopScanTimer())

const criticalCount = computed(
  () => props.conjunctions.filter((c) => c.risk_index > 70).length,
)

const escalationQueue = computed(() =>
  [...props.conjunctions]
    .filter((c) => c.risk_index > 70 && c.status !== 'RESOLVED')
    .sort((a, b) => b.risk_index - a.risk_index)
    .slice(0, 3),
)

function formatProb(p) {
  if (p == null) return '—'
  if (p < 0.0001) return `${(p * 1e6).toFixed(0)}e-6`
  return `${(p * 100).toFixed(3)}%`
}

function formatTs(ts) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toISOString().slice(11, 19) + 'Z'
  } catch {
    return '—'
  }
}
</script>

<style scoped>
.advisor-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 8px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
}

.toggle-btn {
  padding: 3px 8px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.1em;
  transition: all 0.15s;
  white-space: nowrap;
}

.toggle-activate {
  background: var(--color-green-dim);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: var(--color-green);
}

.toggle-activate:hover {
  background: rgba(16, 185, 129, 0.2);
  border-color: var(--color-green);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.25);
}

.toggle-deactivate {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: var(--color-amber);
}

.toggle-deactivate:hover {
  background: rgba(245, 158, 11, 0.2);
  border-color: var(--color-amber);
}

.advisor-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.status-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}
.strip-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.06em;
}
.strip-stats .critical { color: var(--color-red); }

/* Status row */
.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid transparent;
}

.status-active {
  background: var(--color-green-dim);
  border-color: rgba(16, 185, 129, 0.3);
}

.status-standby {
  background: var(--color-amber-dim);
  border-color: rgba(245, 158, 11, 0.25);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  position: relative;
  flex-shrink: 0;
  display: block;
}

.status-active .status-dot {
  background: var(--color-green);
}

.status-standby .status-dot {
  background: var(--color-amber);
  animation: blink-dot 1.5s ease-in-out infinite;
}

.dot-pulse {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1px solid var(--color-green);
  animation: pulse-ring 1.5s ease-out infinite;
}

.status-text {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.status-active .status-text { color: var(--color-green); }
.status-standby .status-text { color: var(--color-amber); }

.scan-countdown {
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.08em;
}

/* Threat summary */
.threat-summary {
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--bg-panel-3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 0;
}

.threat-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.threat-divider {
  width: 1px;
  height: 24px;
  background: var(--border);
}

.tstat-val {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
}

.tstat-val.critical { color: var(--color-red); }
.tstat-val.green { color: var(--color-green); }

.tstat-label {
  font-family: var(--font-mono);
  font-size: 7px;
  letter-spacing: 0.1em;
  color: var(--text-dim);
}

/* Section labels */
.section-label {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-dim);
  text-transform: uppercase;
}

/* Escalation queue */
.escalation-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.queue-empty {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-dim);
  text-align: center;
  padding: 6px;
  letter-spacing: 0.06em;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 3px;
}

.queue-risk {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-red);
  min-width: 24px;
  text-align: center;
}

.queue-sats {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  overflow: hidden;
  white-space: nowrap;
}

.queue-sats span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-sep {
  color: var(--color-red);
  flex-shrink: 0;
}

.queue-prob {
  font-size: 8px;
  color: var(--text-dim);
  white-space: nowrap;
  flex-shrink: 0;
}

/* Last action */
.last-action {
  background: var(--bg-panel-3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 7px 8px;
  min-height: 42px;
}

.action-empty {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.06em;
}

.action-detail {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.action-type {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.action-approved { color: var(--color-green); }
.action-denied { color: var(--color-red); }

.action-desc {
  font-size: 10px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.action-ts {
  font-size: 8px;
  color: var(--text-dim);
  letter-spacing: 0.06em;
}

.mono { font-family: var(--font-mono); }

/* --- Chat console --- */
.model-tag {
  font-size: 7px;
  color: #22d3ee;
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.3);
  border-radius: 3px;
  padding: 1px 4px;
  margin-left: 6px;
  letter-spacing: 0.04em;
}

.chat-log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 4px 2px;
}

.chat-hint {
  font-size: 9px;
  color: var(--text-dim);
  line-height: 1.6;
  padding: 4px;
}
.chat-hint em { color: var(--text-secondary); font-style: normal; }

.chat-msg {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.msg-who {
  font-family: var(--font-mono);
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 4px;
  border-radius: 3px;
  flex-shrink: 0;
  margin-top: 1px;
}

.msg-user .msg-who { color: var(--accent-blue); background: var(--accent-blue-dim); }
.msg-assistant .msg-who { color: #22d3ee; background: rgba(34, 211, 238, 0.12); }

.msg-text {
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  word-break: break-word;
}
.msg-user .msg-text { color: var(--text-primary); }
.msg-text :deep(b) { color: var(--text-primary); font-weight: 700; }

.typing { display: flex; gap: 3px; padding: 4px 0; }
.typing span {
  width: 5px; height: 5px; border-radius: 50%;
  background: #22d3ee; opacity: 0.5;
  animation: typing-bounce 1s infinite ease-in-out;
}
.typing span:nth-child(2) { animation-delay: 0.15s; }
.typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes typing-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }

.chat-input-row {
  display: flex;
  gap: 5px;
  margin-top: 4px;
  flex-shrink: 0;
}

.chat-input {
  flex: 1;
  background: var(--bg-panel-3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--text-primary);
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.chat-input:focus { border-color: #22d3ee; }
.chat-input::placeholder { color: var(--text-dim); }

.chat-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  background: rgba(34, 211, 238, 0.12);
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 4px;
  color: #22d3ee;
  transition: all 0.15s;
}
.chat-send:hover:not(:disabled) { background: rgba(34, 211, 238, 0.25); box-shadow: 0 0 8px rgba(34, 211, 238, 0.3); }
.chat-send:disabled { opacity: 0.35; cursor: not-allowed; }
</style>

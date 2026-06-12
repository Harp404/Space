<template>
  <div class="feed-panel">
    <div class="panel-header">
      <div class="panel-title">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="2" fill="currentColor"/>
          <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1" fill="none" opacity="0.5"/>
          <circle cx="6" cy="6" r="6" stroke="currentColor" stroke-width="0.7" fill="none" opacity="0.25"/>
        </svg>
        MISSION FEED
      </div>
      <div class="feed-count mono">{{ events.length }}/50</div>
    </div>

    <div ref="feedEl" class="feed-scroll">
      <div v-if="events.length === 0" class="feed-empty">
        <span class="empty-icon">◌</span>
        <span>Awaiting telemetry...</span>
      </div>

      <div
        v-for="(evt, idx) in events"
        :key="idx"
        class="feed-entry"
        :class="getEntryClass(evt)"
        :style="{ animationDelay: idx === 0 ? '0ms' : '0ms' }"
      >
        <span class="entry-dot" :class="getDotClass(evt)"></span>
        <span class="entry-ts mono">{{ formatTs(evt.timestamp) }}</span>
        <span class="entry-msg">{{ formatMessage(evt) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  events: {
    type: Array,
    default: () => [],
  },
})

const feedEl = ref(null)

// Auto-scroll to top when new events arrive (events are prepended)
watch(
  () => props.events.length,
  async () => {
    await nextTick()
    if (feedEl.value) {
      feedEl.value.scrollTop = 0
    }
  },
)

function getEntryClass(evt) {
  const type = evt.type
  if (type === 'CONJUNCTION_ALERT') return 'entry-alert'
  if (type === 'MANEUVER_EVENT') {
    const s = (evt.status || '').toUpperCase()
    if (s === 'APPROVED' || s.includes('EMERGENCY')) return 'entry-approved'
    return 'entry-denied'
  }
  if (type === 'LEADER_CHANGE') return 'entry-leader'
  return 'entry-default'
}

function getDotClass(evt) {
  const type = evt.type
  if (type === 'CONJUNCTION_ALERT') return 'dot-red'
  if (type === 'MANEUVER_EVENT') {
    const s = (evt.status || '').toUpperCase()
    if (s === 'APPROVED' || s.includes('EMERGENCY')) return 'dot-green'
    return 'dot-red'
  }
  if (type === 'LEADER_CHANGE') return 'dot-blue'
  return 'dot-dim'
}

function formatMessage(evt) {
  const type = evt.type

  if (type === 'CONJUNCTION_ALERT') {
    return `⚠ HIGH-RISK CONJUNCTION: ${evt.sat1_name || '?'} × ${evt.sat2_name || '?'} — Risk Index ${Math.round(evt.risk_index || 0)}`
  }

  if (type === 'MANEUVER_EVENT') {
    const s = (evt.status || '').toUpperCase()
    const conj = evt.conjunction || evt.conjunction_id || '—'
    if (s === 'APPROVED') {
      return `✓ MANEUVER APPROVED: ${conj}${evt.duration_ms ? ` (${evt.duration_ms}ms)` : ''}`
    }
    if (s === 'DENIED') {
      return `✗ MANEUVER DENIED: ${conj} — insufficient quorum`
    }
    if (s.includes('EMERGENCY')) {
      return `⚡ EMERGENCY OVERRIDE: ${conj} — bypassing consensus`
    }
    return `◆ MANEUVER EVENT [${s}]: ${conj}`
  }

  if (type === 'LEADER_CHANGE') {
    const name = evt.node_name || `Node ${evt.node_id || '?'}`
    return `◈ LEADER ELECTION: ${name} → COMMAND`
  }

  return `• EVENT: ${type}`
}

function formatTs(ts) {
  if (!ts) return '??:??:??'
  try {
    const d = new Date(ts)
    const h = String(d.getUTCHours()).padStart(2, '0')
    const m = String(d.getUTCMinutes()).padStart(2, '0')
    const s = String(d.getUTCSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
  } catch {
    return '??:??:??'
  }
}
</script>

<style scoped>
.feed-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-secondary);
}

.feed-count {
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.08em;
}

.feed-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feed-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.empty-icon {
  font-size: 20px;
  animation: blink-dot 2s ease-in-out infinite;
}

.feed-entry {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 3px;
  border-left: 2px solid transparent;
  font-size: 10px;
  line-height: 1.4;
  animation: fade-in-up 0.2s ease-out;
  transition: background 0.1s;
}

.feed-entry:hover {
  background: rgba(255, 255, 255, 0.02);
}

.entry-alert {
  border-left-color: var(--color-red);
  background: rgba(239, 68, 68, 0.04);
}

.entry-approved {
  border-left-color: var(--color-green);
  background: rgba(16, 185, 129, 0.03);
}

.entry-denied {
  border-left-color: var(--color-red);
  background: rgba(239, 68, 68, 0.04);
}

.entry-leader {
  border-left-color: var(--accent-blue);
  background: rgba(59, 130, 246, 0.04);
}

.entry-default {
  border-left-color: var(--border);
}

/* Dot */
.entry-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
}

.dot-red {
  background: var(--color-red);
  box-shadow: 0 0 5px var(--color-red);
}

.dot-green {
  background: var(--color-green);
  box-shadow: 0 0 5px var(--color-green);
}

.dot-blue {
  background: var(--accent-blue);
  box-shadow: 0 0 5px var(--accent-blue);
}

.dot-dim {
  background: var(--text-dim);
}

/* Timestamp */
.entry-ts {
  font-size: 9px;
  color: var(--text-dim);
  flex-shrink: 0;
  letter-spacing: 0.04em;
}

/* Message */
.entry-msg {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.entry-alert .entry-msg { color: #fca5a5; }
.entry-approved .entry-msg { color: #6ee7b7; }
.entry-leader .entry-msg { color: #93c5fd; }

.mono {
  font-family: var(--font-mono);
}
</style>

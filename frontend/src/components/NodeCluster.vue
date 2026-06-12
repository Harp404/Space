<template>
  <div class="cluster-panel">
    <div class="panel-header">
      <div class="panel-title">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <circle cx="6.5" cy="6.5" r="2" stroke="currentColor" stroke-width="1.2"/>
          <path d="M6.5 1v1.5M6.5 10v1.5M1 6.5h1.5M10 6.5h1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M2.5 2.5l1 1M9 9l1 1M2.5 10.5l1-1M9 4l1-1" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
        </svg>
        GROUND CONTROL CLUSTERS
      </div>
      <div class="failover-info">
        <span class="failover-label">FAILOVER</span>
        <span class="failover-val mono">{{ failoverMs }}ms</span>
      </div>
    </div>

    <div class="nodes-grid">
      <div
        v-for="node in displayNodes"
        :key="node.id"
        class="node-card"
        :class="{
          'node-online': node.online,
          'node-offline': !node.online,
          'node-leader': node.id === leaderId,
        }"
      >
        <!-- Top row -->
        <div class="node-top">
          <div class="node-status-dot" :class="node.online ? 'dot-online' : 'dot-offline'">
            <span v-if="node.online" class="dot-ring"></span>
          </div>
          <div class="node-org-badge">{{ getOrgCode(node.name) }}</div>
          <div v-if="node.id === leaderId" class="leader-badge">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M4 1l.9 1.8 2 .3-1.45 1.4.34 2L4 5.5l-1.8.95.35-2L1.1 3.1l2-.3L4 1z" fill="currentColor"/>
            </svg>
            CMD
          </div>
        </div>

        <!-- Node name -->
        <div class="node-name">{{ node.name }}</div>

        <!-- Log ID -->
        <div class="node-logid mono" :title="'Log Index: ' + node.log_id">
          IDX {{ node.log_id != null ? node.log_id : '—' }}
        </div>

        <!-- Status text -->
        <div class="node-status-text" :class="node.online ? 'text-online' : 'text-offline'">
          {{ node.online ? 'NOMINAL' : 'OFFLINE' }}
        </div>

        <!-- Control button -->
        <button
          class="node-ctrl-btn"
          :class="node.online ? 'btn-stop' : 'btn-start'"
          @click="$emit('nodeControl', node.id, node.online ? 'stop' : 'start')"
        >
          <svg v-if="node.online" width="8" height="8" viewBox="0 0 8 8" fill="none">
            <rect x="1.5" y="1.5" width="2" height="5" fill="currentColor"/>
            <rect x="4.5" y="1.5" width="2" height="5" fill="currentColor"/>
          </svg>
          <svg v-else width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M2 1.5l4.5 2.5L2 6.5V1.5z" fill="currentColor"/>
          </svg>
          {{ node.online ? 'STOP' : 'START' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  nodes: {
    type: Array,
    default: () => [],
  },
  leaderId: {
    type: [String, Number],
    default: null,
  },
})

const emit = defineEmits(['nodeControl'])

const failoverMs = ref(Math.floor(Math.random() * 60 + 20))
let failoverInterval = null

// Simulate latency fluctuation
onMounted(() => {
  failoverInterval = setInterval(() => {
    failoverMs.value = Math.floor(Math.random() * 60 + 20)
  }, 4000)
})
onUnmounted(() => clearInterval(failoverInterval))

// Known node names for display — fill in from props, pad to 4 if needed
const KNOWN_NODES = ['ISRO', 'ESA', 'JAXA', 'SPACEX']

const displayNodes = computed(() => {
  if (props.nodes.length >= 4) return props.nodes.slice(0, 4)
  // Pad with placeholder nodes if fewer than 4
  const result = [...props.nodes]
  for (let i = result.length; i < 4; i++) {
    result.push({
      id: `placeholder_${i}`,
      name: KNOWN_NODES[i] || `NODE-${i + 1}`,
      online: false,
      log_id: null,
    })
  }
  return result
})

function getOrgCode(name) {
  if (!name) return '??'
  const upper = name.toUpperCase()
  if (upper.includes('ISRO')) return 'IN'
  if (upper.includes('ESA')) return 'EU'
  if (upper.includes('JAXA')) return 'JP'
  if (upper.includes('SPACEX') || upper.includes('SPX')) return 'US'
  return upper.slice(0, 2)
}
</script>

<style scoped>
.cluster-panel {
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

.failover-info {
  display: flex;
  align-items: center;
  gap: 5px;
}

.failover-label {
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.1em;
  color: var(--text-dim);
}

.failover-val {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-blue);
}

.nodes-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  flex: 1;
  padding: 8px;
  gap: 6px;
}

.node-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-panel-3);
  position: relative;
  transition: all 0.2s;
}

.node-online {
  border-color: rgba(16, 185, 129, 0.2);
}

.node-offline {
  border-color: rgba(239, 68, 68, 0.15);
  opacity: 0.75;
}

.node-leader {
  border-color: rgba(59, 130, 246, 0.4) !important;
  background: rgba(59, 130, 246, 0.04) !important;
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.1);
}

.node-top {
  display: flex;
  align-items: center;
  gap: 5px;
}

/* Status dot */
.node-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  position: relative;
  flex-shrink: 0;
}

.dot-online {
  background: var(--color-green);
  box-shadow: 0 0 6px var(--color-green);
}

.dot-offline {
  background: var(--color-red);
}

.dot-ring {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1px solid var(--color-green);
  animation: pulse-ring 2s ease-out infinite;
  opacity: 0.6;
}

/* Org badge */
.node-org-badge {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  padding: 1px 4px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
}

/* Leader badge */
.leader-badge {
  display: flex;
  align-items: center;
  gap: 2px;
  font-family: var(--font-mono);
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--accent-blue);
  background: var(--accent-blue-dim);
  border: 1px solid rgba(59, 130, 246, 0.3);
  padding: 1px 5px;
  border-radius: 2px;
  margin-left: auto;
}

.node-name {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.04em;
}

.node-logid {
  font-size: 8px;
  color: var(--text-dim);
  letter-spacing: 0.08em;
}

.node-status-text {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.text-online { color: var(--color-green); }
.text-offline { color: var(--color-red); }

/* Control button */
.node-ctrl-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  font-family: var(--font-mono);
  margin-top: auto;
  transition: all 0.15s;
  width: 100%;
  justify-content: center;
}

.btn-stop {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: var(--color-red);
}

.btn-stop:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: var(--color-red);
}

.btn-start {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--color-green);
}

.btn-start:hover {
  background: rgba(16, 185, 129, 0.2);
  border-color: var(--color-green);
}

.mono {
  font-family: var(--font-mono);
}
</style>

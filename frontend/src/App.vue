<template>
  <div class="app-shell">
    <TheHeader
      :ws-connected="wsConnected"
      :leader-name="leaderName"
      :active-conjunctions="activeConjunctions"
      :node-count="network.nodes.length"
      :agent-enabled="agentEnabled"
    />

    <div class="main-grid">
      <div class="globe-col">
        <GlobeView
          :satellites="network.satellites"
          :conjunctions="network.conjunctions"
          @satellite-click="onSatelliteClick"
        />
      </div>
      <div class="right-col">
        <ConjunctionPanel
          :conjunctions="network.conjunctions"
          :leader-name="leaderName"
          :last-maneuver="lastManeuver"
          @request-maneuver="requestManeuver"
          @emergency-override="emergencyOverride"
        />
      </div>
    </div>

    <div class="bottom-row">
      <NodeCluster
        :nodes="network.nodes"
        :leader-id="network.leader_id"
        @node-control="nodeControl"
      />
      <AIAdvisor
        :agent-enabled="agentEnabled"
        :conjunctions="network.conjunctions"
        :last-maneuver="lastManeuver"
        @toggle-agent="toggleAgent"
      />
      <MissionFeed :events="events" />
    </div>

    <div v-if="resetPending" class="reset-overlay">
      <div class="reset-spinner"></div>
      <span>RESETTING NETWORK...</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { WS_URL } from './config.js'
import TheHeader from './components/TheHeader.vue'
import GlobeView from './components/GlobeView.vue'
import ConjunctionPanel from './components/ConjunctionPanel.vue'
import NodeCluster from './components/NodeCluster.vue'
import AIAdvisor from './components/AIAdvisor.vue'
import MissionFeed from './components/MissionFeed.vue'

const network = ref({
  nodes: [],
  satellites: [],
  conjunctions: [],
  leader_id: null,
})

const events = ref([])
const lastManeuver = ref(null)
const wsConnected = ref(false)
const agentEnabled = ref(false)
const resetPending = ref(false)

let ws = null
let pollInterval = null

const leaderName = computed(() => {
  if (!network.value.leader_id) return 'NONE'
  const node = network.value.nodes.find((n) => n.id === network.value.leader_id)
  return node ? node.name : 'UNKNOWN'
})

const activeConjunctions = computed(
  () => network.value.conjunctions.filter((c) => c.risk_index > 50).length,
)

async function fetchNetwork() {
  try {
    const res = await fetch('/api/network')
    if (res.ok) {
      const data = await res.json()
      network.value = {
        nodes: data.nodes || [],
        satellites: data.satellites || [],
        conjunctions: data.conjunctions || [],
        leader_id: data.leader_id || null,
      }
    }
  } catch (e) {
    // silent — WS keeps us updated
  }
}

function connectWS() {
  try {
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      wsConnected.value = true
    }

    ws.onclose = () => {
      wsConnected.value = false
      setTimeout(connectWS, 3000)
    }

    ws.onerror = () => {
      wsConnected.value = false
    }

    ws.onmessage = (evt) => {
      let msg
      try {
        msg = JSON.parse(evt.data)
      } catch {
        return
      }

      const type = msg.type || msg.event

      if (type === 'NETWORK_UPDATE') {
        if (msg.data) {
          network.value = {
            nodes: msg.data.nodes || network.value.nodes,
            satellites: msg.data.satellites || network.value.satellites,
            conjunctions: msg.data.conjunctions || network.value.conjunctions,
            leader_id:
              msg.data.leader_id !== undefined
                ? msg.data.leader_id
                : network.value.leader_id,
          }
        }
      }

      if (type === 'CONJUNCTION_ALERT') {
        pushEvent({
          type: 'CONJUNCTION_ALERT',
          sat1_name: msg.sat1_name || msg.data?.sat1_name || '—',
          sat2_name: msg.sat2_name || msg.data?.sat2_name || '—',
          risk_index: msg.risk_index || msg.data?.risk_index || 0,
          timestamp: new Date(),
        })
      }

      if (type === 'MANEUVER_EVENT') {
        const payload = msg.data || msg
        pushEvent({
          type: 'MANEUVER_EVENT',
          status: payload.status,
          conjunction: payload.conjunction_id || payload.conjunction || '',
          duration_ms: payload.duration_ms,
          timestamp: new Date(),
        })
      }

      if (type === 'LEADER_CHANGE') {
        const payload = msg.data || msg
        pushEvent({
          type: 'LEADER_CHANGE',
          node_id: payload.node_id || payload.leader_id,
          node_name: payload.node_name || payload.name || `Node ${payload.node_id}`,
          timestamp: new Date(),
        })
      }
    }
  } catch (e) {
    wsConnected.value = false
    setTimeout(connectWS, 3000)
  }
}

function pushEvent(evt) {
  events.value.unshift(evt)
  if (events.value.length > 50) events.value = events.value.slice(0, 50)
}

async function requestManeuver(conjunctionId) {
  try {
    const res = await fetch('/api/maneuver/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conjunction_id: conjunctionId }),
    })
    if (res.ok) {
      const data = await res.json()
      lastManeuver.value = { ...data, conjunction_id: conjunctionId, ts: new Date() }
      pushEvent({
        type: 'MANEUVER_EVENT',
        status: data.status,
        conjunction: conjunctionId,
        duration_ms: data.duration_ms,
        timestamp: new Date(),
      })
    }
  } catch (e) {
    console.error('maneuver request failed', e)
  }
}

async function emergencyOverride(conjunctionId) {
  try {
    const res = await fetch('/api/maneuver/emergency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conjunction_id: conjunctionId }),
    })
    if (res.ok) {
      const data = await res.json()
      pushEvent({
        type: 'MANEUVER_EVENT',
        status: 'EMERGENCY_' + (data.status || 'ISSUED'),
        conjunction: conjunctionId,
        timestamp: new Date(),
      })
    }
  } catch (e) {
    console.error('emergency override failed', e)
  }
}

async function toggleAgent(enabled) {
  try {
    const res = await fetch('/api/agent/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (res.ok) {
      const data = await res.json()
      agentEnabled.value = data.agent_enabled
    }
  } catch (e) {
    agentEnabled.value = enabled
  }
}

async function nodeControl(id, action) {
  try {
    await fetch(`/control/node/${id}/${action}`, { method: 'POST' })
    await fetchNetwork()
  } catch (e) {
    console.error('node control failed', e)
  }
}

async function handleReset() {
  resetPending.value = true
  try {
    await fetch('/reset', { method: 'POST' })
    await fetchNetwork()
  } catch (e) {
    console.error('reset failed', e)
  } finally {
    setTimeout(() => {
      resetPending.value = false
    }, 1500)
  }
}

function onSatelliteClick(satellite) {
  // could open a detail modal — left for future
}

onMounted(() => {
  fetchNetwork()
  pollInterval = setInterval(fetchNetwork, 3000)
  connectWS()
})

onUnmounted(() => {
  clearInterval(pollInterval)
  if (ws) ws.close()
})
</script>

<style>
:root {
  --bg-deep: #080b12;
  --bg-panel: #0e1420;
  --bg-panel-2: #111827;
  --bg-panel-3: #0a0e1a;
  --accent-blue: #3b82f6;
  --accent-blue-dim: rgba(59, 130, 246, 0.15);
  --accent-blue-glow: rgba(59, 130, 246, 0.4);
  --color-green: #10b981;
  --color-green-dim: rgba(16, 185, 129, 0.15);
  --color-amber: #f59e0b;
  --color-amber-dim: rgba(245, 158, 11, 0.15);
  --color-red: #ef4444;
  --color-red-dim: rgba(239, 68, 68, 0.15);
  --color-purple: #8b5cf6;
  --color-purple-dim: rgba(139, 92, 246, 0.15);
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-dim: #475569;
  --border: rgba(59, 130, 246, 0.12);
  --border-bright: rgba(59, 130, 246, 0.3);
  --font-display: 'Space Grotesk', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --header-h: 52px;
  --bottom-h: 220px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border-bright);
  border-radius: 2px;
}

button {
  font-family: var(--font-mono);
  cursor: pointer;
  border: none;
  outline: none;
}

@keyframes pulse-ring {
  0% { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(2.5); opacity: 0; }
}

@keyframes blink-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}

@keyframes scan-line {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100vh); }
}

@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-deep);
  overflow: hidden;
}

.main-grid {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.globe-col {
  flex: 2;
  min-width: 0;
  position: relative;
  overflow: hidden;
}

.right-col {
  flex: 1;
  min-width: 320px;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border);
}

.bottom-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  height: var(--bottom-h);
  min-height: var(--bottom-h);
  border-top: 1px solid var(--border);
  overflow: hidden;
}

.reset-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 11, 18, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 9999;
  font-family: var(--font-mono);
  font-size: 14px;
  letter-spacing: 0.1em;
  color: var(--accent-blue);
}

.reset-spinner {
  width: 36px;
  height: 36px;
  border: 2px solid var(--border);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

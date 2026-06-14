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
          ref="globeRef"
          :satellites="network.satellites"
          :conjunctions="network.conjunctions"
          :plan="activePlan"
          :launch-plan="launchPlan"
          @satellite-click="onSatelliteClick"
          @reroute-planned="onReroutePlanned"
          @launch-clear="launchPlan = null"
          @ready="onGlobeReady"
        />
      </div>
    </div>

    <!-- Launch trajectory planner — slide-out drawer -->
    <SideDrawer label="🚀 LAUNCH" :top="688" :width="400" accent="#22d3ee">
      <LaunchPanel @plan="onLaunchPlan" @simulate="globeRef && globeRef.simulateLaunch()" />
    </SideDrawer>

    <!-- History sidebar (left) — saved reroutes + launches -->
    <SideDrawer label="◷ HISTORY" side="left" :top="380" :width="340" accent="#a855f7">
      <HistoryPanel :entries="history" @open="openHistory" @delete="deleteHistory" @rename="renameHistory" />
    </SideDrawer>

    <!-- Conjunction Risk Monitor — slide-out drawer -->
    <SideDrawer label="RISK MONITOR" :top="396" :width="660" accent="#f59e0b">
      <ConjunctionPanel
        :conjunctions="network.conjunctions"
        :cdms="network.cdms"
        :leader-name="leaderName"
        :last-maneuver="lastManeuver"
        :active-plan="activePlan"
        :planning-id="planningId"
        @request-maneuver="requestManeuver"
        @emergency-override="emergencyOverride"
        @plan-maneuver="planManeuver"
        @clear-plan="activePlan = null"
      />
    </SideDrawer>

    <!-- Operations deck — slides up from the bottom edge -->
    <SideDrawer label="▴ OPERATIONS DECK" side="bottom" :height="250" accent="#3b82f6">
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
    </SideDrawer>

    <AgentChat @action="onAgentAction" />

    <transition name="boot-fade">
      <div v-if="appLoading" class="boot">
        <div class="boot-logo">ASTRO<span>MESH</span></div>
        <div class="boot-bar"><div class="boot-bar-fill" :style="{ width: bootProgress + '%' }"></div></div>
        <div class="boot-text">DOWNLOADING ASSETS… {{ bootProgress }}%</div>
        <div class="boot-sub">{{ bootPhase }}</div>
      </div>
    </transition>

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
import AgentChat from './components/AgentChat.vue'
import SideDrawer from './components/SideDrawer.vue'
import LaunchPanel from './components/LaunchPanel.vue'
import HistoryPanel from './components/HistoryPanel.vue'

const network = ref({
  nodes: [],
  satellites: [],
  conjunctions: [],
  cdms: [],
  leader_id: null,
})

const events = ref([])
const lastManeuver = ref(null)
const activePlan = ref(null)
const planningId = ref(null)
const launchPlan = ref(null)
const appLoading = ref(true)
const bootProgress = ref(0)
// Progressive boot: preload the LIGHT models + wait for the globe's first frame, then
// reveal. The heavy 44 MB ISS is NOT preloaded — it streams on demand when tracked.
const LIGHT_MODELS = [
  '/models/types/payload.glb', '/models/types/comms.glb', '/models/types/debris.glb',
  '/models/types/rocket_body.glb', '/models/special/starlink.glb', '/models/special/20580.glb',
]
const BOOT_TOTAL = LIGHT_MODELS.length + 1   // +1 = globe ready
let bootSteps = 0
const bootPhase = ref('connecting to gateway…')
let globeIsReady = false
function bootStep() {
  bootSteps++
  bootProgress.value = Math.min(100, Math.round((bootSteps / BOOT_TOTAL) * 100))
  if (!globeIsReady) bootPhase.value = 'caching 3D models…'
  if (bootSteps >= BOOT_TOTAL) {
    bootPhase.value = 'orbital picture ready'
    // small beat so the bar visibly hits 100% before the reveal
    setTimeout(() => (appLoading.value = false), 500)
  }
}
function onGlobeReady() { globeIsReady = true; bootPhase.value = 'screening conjunctions…'; bootStep() }
onMounted(() => {
  bootPhase.value = 'caching 3D models…'
  // Download (and browser-cache) every model up front so nothing pops in later.
  LIGHT_MODELS.forEach((u) => fetch(u).then((r) => r.arrayBuffer()).catch(() => {}).finally(bootStep))
})
// Safety net: free-tier hosts stream assets slowly, so give it room (60s) before
// force-revealing — better a longer honest loader than a half-loaded scene.
setTimeout(() => { if (appLoading.value) { bootProgress.value = 100; appLoading.value = false } }, 60000)
const globeRef = ref(null)

// --- History (saved reroutes + launches), persisted to localStorage ---
const history = ref([])
try { history.value = JSON.parse(localStorage.getItem('astromesh-history') || '[]') } catch { history.value = [] }
function persistHistory() { try { localStorage.setItem('astromesh-history', JSON.stringify(history.value.slice(0, 60))) } catch { /* ignore */ } }
let histSeq = Date.now()
function addHistory(entry) { history.value.unshift({ id: histSeq++, time: Date.now(), ...entry }); persistHistory() }
function renameHistory({ id, name }) { const e = history.value.find((x) => x.id === id); if (e) { e.name = name; persistHistory() } }
function deleteHistory(id) { history.value = history.value.filter((x) => x.id !== id); persistHistory() }
function openHistory(e) {
  if (e.type === 'launch') launchPlan.value = e.data
  else if (e.type === 'reroute') activePlan.value = e.data
}
function onLaunchPlan(p) {
  launchPlan.value = p
  if (p) addHistory({ type: 'launch', name: `Launch → ${p.target_alt_km} km / ${p.inclination_deg}°`, summary: `az ${p.azimuth_deg}° · Δv ${p.delta_v_kms} km/s · ${p.period_min} min`, data: p })
}
function onReroutePlanned(p) {
  if (p) addHistory({ type: 'reroute', name: `${p.sat1_name} × ${p.sat2_name}`, summary: `miss ${p.original_miss_km}→${p.new_miss_km} km · Δv ${p.total_delta_v_ms} m/s · ${p.clear_vs_catalogue ? 'clear' : 'conflict'}`, data: p })
}

async function onAgentAction(action) {
  if (!action) return
  if (action.type === 'SHOW' && globeRef.value) {
    await globeRef.value.agentShowConjunction(action.args[0], action.args[1])
  } else if (action.type === 'REROUTE' && globeRef.value) {
    await globeRef.value.agentReroute()
  } else if (action.type === 'TRACK' && globeRef.value) {
    await globeRef.value.agentTrack(action.args.join(' '))
  } else if (action.type === 'ZOOM' && globeRef.value) {
    globeRef.value.agentZoom((action.args[0] || 'in').toLowerCase())
  } else if (action.type === 'LAUNCH') {
    const [lat, lon, alt, inc] = action.args.map(Number)
    try {
      const res = await fetch('/api/launch/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon, alt: alt || 550, inc }),
      })
      const data = await res.json()
      if (res.ok && !data.error) launchPlan.value = data
    } catch { /* ignore */ }
  }
}

async function planManeuver(conjunctionId) {
  planningId.value = conjunctionId
  activePlan.value = null
  try {
    const res = await fetch('/api/maneuver/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conjunction_id: conjunctionId }),
    })
    const data = await res.json()
    if (res.ok) activePlan.value = data
  } catch (e) {
    /* ignore */
  }
  planningId.value = null
}
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
        cdms: data.cdms || [],
        leader_id: data.leader_id || null,
      }
      // Seed the mission feed from the REAL conjunctions so it's never empty / fake.
      if (events.value.length === 0) {
        ;(data.conjunctions || []).slice(0, 6).forEach((c) =>
          pushEvent({
            type: 'CONJUNCTION_ALERT',
            sat1_name: c.sat1_name, sat2_name: c.sat2_name,
            risk_index: Math.round(c.risk_index || 0),
            source: 'SCREEN', timestamp: new Date(),
          }),
        )
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
      const p = msg.payload || msg.data || {}   // gateway broadcasts under `payload`

      if (type === 'NETWORK_UPDATE') {
        if (p) {
          network.value = {
            nodes: p.nodes || network.value.nodes,
            satellites: p.satellites || network.value.satellites,
            conjunctions: p.conjunctions || network.value.conjunctions,
            cdms: p.cdms || network.value.cdms,
            leader_id: p.leader_id !== undefined ? p.leader_id : network.value.leader_id,
          }
        }
      }

      if (type === 'CONJUNCTION_ALERT') {
        const c = p.conjunction || {}
        pushEvent({
          type: 'CONJUNCTION_ALERT',
          sat1_name: c.sat1_name || '—',
          sat2_name: c.sat2_name || '—',
          risk_index: Math.round(c.risk_index || 0),
          source: p.source || (p.agent ? 'AGENT' : 'SCREEN'),
          timestamp: new Date(),
        })
      }

      if (type === 'MANEUVER_EVENT') {
        pushEvent({
          type: 'MANEUVER_EVENT',
          status: p.status,
          conjunction: p.conjunction_id || p.conjunction || '',
          trigger: p.trigger,
          timestamp: new Date(),
        })
      }

      if (type === 'LEADER_CHANGE') {
        pushEvent({
          type: 'LEADER_CHANGE',
          node_id: p.node_id || p.new_leader || p.leader_id,
          node_name: p.node_name || p.name || `Node ${p.node_id || p.new_leader}`,
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
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.boot {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: radial-gradient(ellipse at center, #0a1322 0%, #03060c 70%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.boot-logo {
  font-family: var(--font-mono);
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.32em;
  color: #e8f1ff;
  text-shadow: 0 0 24px rgba(59,130,246,0.5);
}
.boot-logo span { color: #22d3ee; }
.boot-bar {
  width: 320px;
  height: 6px;
  border-radius: 4px;
  background: rgba(255,255,255,0.08);
  overflow: hidden;
  border: 1px solid rgba(34,211,238,0.25);
}
.boot-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #22d3ee);
  box-shadow: 0 0 12px rgba(34,211,238,0.6);
  transition: width 0.3s ease;
}
.boot-text { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.2em; color: #9fb6d0; }
.boot-sub { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.12em; color: #5f7e9f; }
.boot-fade-leave-active { transition: opacity 0.6s ease; }
.boot-fade-leave-to { opacity: 0; }

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

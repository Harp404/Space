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
    <SideDock
      ref="dockRef"
      @change="onTabChange"
      :tabs="dockTabs"
      initial="signal"
      :signal="fleetSignal && fleetSignal.signal"
    >
      <template #header>
        <ConstraintOverlay
          part="card"
          docked
          compact
          @open-detail="dockRef && dockRef.open('signal')"
          :fleet="fleetSignal"
          :events="network.conjunctions"
          :report="constraintReport"
          :selected-id="selectedEventId"
          :planning="planningId !== null"
          :replay="replayActive"
          @select="selectEvent"
          @replay="setReplay"
          @deorbit="planDeorbit(44714)"
          @longmarch="showLongMarch"
          @portability="togglePortability"
          @author="openAuthor"
          @toggle-zones="showZones = !showZones"
          :zones-on="showZones"
          @close="closeReport"
          @plan="planManeuver"
          @vote="requestManeuver"
          @waive="fileWaiver"
        />
      </template>

      <template #signal>
        <ConstraintOverlay
          part="panel"
          :fleet="fleetSignal"
          :events="network.conjunctions"
          :report="constraintReport"
          :selected-id="selectedEventId"
          :planning="planningId !== null"
          :replay="replayActive"
          @select="selectEvent"
          @replay="setReplay"
          @deorbit="planDeorbit(44714)"
          @longmarch="showLongMarch"
          @portability="togglePortability"
          @author="openAuthor"
          @toggle-zones="showZones = !showZones"
          :zones-on="showZones"
          @close="closeReport"
          @plan="planManeuver"
          @vote="requestManeuver"
          @waive="fileWaiver"
        />
      </template>

      <template #story>
        <StoryPanel @show-on-globe="showStoryOnGlobe" />
      </template>

      <template #risk>
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
          @show-constraints="selectEvent"
          @clear-plan="activePlan = null"
          @play-approach="playApproach"
        />
      </template>

      <template #gate>
        <GateControls
          :sw="spaceWeather"
          :replay="replayActive"
          :deorbit="deorbitPlan"
          :portability="portability"
          @replay="setReplay"
          @deorbit="planDeorbit"
          @retarget="retargetDeorbit"
          @portability="togglePortability"
          @author="onRuleAuthored"
        />
      </template>

      <template #launch>
        <LaunchPanel @plan="onLaunchPlan" @simulate="globeRef && globeRef.simulateLaunch()" />
      </template>

      <template #fleet>
        <NodeCluster
          :nodes="network.nodes"
          :leader-id="network.leader_id"
          @node-control="nodeControl"
        />
      </template>

      <template #feed>
        <MissionFeed :events="events" />
        <AIAdvisor
          :agent-enabled="agentEnabled"
          :conjunctions="network.conjunctions"
          :last-maneuver="lastManeuver"
          @toggle-agent="toggleAgent"
        />
      </template>

      <template #history>
        <HistoryPanel :entries="history" @open="openHistory" @delete="deleteHistory" @rename="renameHistory" />
      </template>
    </SideDock>
      <div class="globe-col">
        <GlobeView
          ref="globeRef"
          :satellites="network.satellites"
          :conjunctions="network.conjunctions"
          :plan="activePlan"
          :launch-plan="launchPlan"
          :space-weather="spaceWeather ? { ...spaceWeather, show_zones: showZones } : null"
          :deorbit="deorbitPlan"
          @satellite-click="onSatelliteClick"
          @reroute-planned="onReroutePlanned"
          @launch-clear="launchPlan = null"
          @ready="onGlobeReady"
        />
      </div>
    </div>

    <!-- Launch trajectory planner — slide-out drawer -->
    <!-- ONE dock, one panel at a time.
         Five overlapping drawers with five accent colours became a single
         neutral dock: the planet stays visible, nothing overlaps, and the only
         coloured pixels left in the chrome are the four completion states. -->


    <AgentChat @action="onAgentAction" />

    <!-- Action outcomes, over the globe. A refusal is the product working, so
         it gets said out loud instead of only being filed in the feed. -->
    <div class="toasts" role="status" aria-live="polite">
      <transition-group name="toast">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="'t-' + t.kind" @click="dismissToast(t.id)">
          <span class="toast-bar"></span>
          <div class="toast-body">
            <div class="toast-title">{{ t.title }}</div>
            <div v-if="t.detail" class="toast-detail">{{ t.detail }}</div>
          </div>
          <button class="toast-x" title="Dismiss" @click.stop="dismissToast(t.id)">×</button>
        </div>
      </transition-group>
    </div>

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
import { ref, computed, onMounted, onUnmounted, onErrorCaptured } from 'vue'
import { WS_URL } from './config.js'
import TheHeader from './components/TheHeader.vue'
import GlobeView from './components/GlobeView.vue'
import ConjunctionPanel from './components/ConjunctionPanel.vue'
import NodeCluster from './components/NodeCluster.vue'
import AIAdvisor from './components/AIAdvisor.vue'
import MissionFeed from './components/MissionFeed.vue'
import AgentChat from './components/AgentChat.vue'
import SideDock from './components/SideDock.vue'
import StoryPanel from './components/StoryPanel.vue'
import LaunchPanel from './components/LaunchPanel.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import GateControls from './components/GateControls.vue'
import ConstraintOverlay from './components/ConstraintOverlay.vue'

const network = ref({
  nodes: [],
  satellites: [],
  conjunctions: [],
  cdms: [],
  leader_id: null,
})

const events = ref([])
const lastManeuver = ref(null)
// Constraint gate state
const fleetSignal = ref(null)
const constraintReport = ref(null)
const selectedEventId = ref(null)
// Space weather + the return leg
const spaceWeather = ref(null)
const deorbitPlan = ref(null)
const deorbitReport = ref(null)
const replayActive = ref(null)
const portability = ref(null)
const showZones = ref(false)
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
/**
 * A render error in one panel used to blank the whole tab with no message —
 * you switched to Storms and got an empty box, and only a reload fixed it.
 * Vue swallows the error and unmounts the subtree; catching it here keeps the
 * rest of the app alive and says what happened instead of showing nothing.
 */
onErrorCaptured((err, instance, info) => {
  const where = (instance && instance.$options && instance.$options.__name) || 'a panel'
  console.error('[panel error]', where, info, err)
  pushToast('refused', `${String(where).toUpperCase()} FAILED TO RENDER`,
    `${String(err.message || err).slice(0, 120)} — switch tabs and back, or reload.`)
  return false   // stop it propagating and tearing down more of the tree
})

onMounted(() => {
  bootPhase.value = 'caching 3D models…'
  // Download (and browser-cache) every model up front so nothing pops in later.
  LIGHT_MODELS.forEach((u) => fetch(u).then((r) => r.arrayBuffer()).catch(() => {}).finally(bootStep))
})
// Safety net: free-tier hosts stream assets slowly, so give it room (60s) before
// force-revealing — better a longer honest loader than a half-loaded scene.
setTimeout(() => { if (appLoading.value) { bootProgress.value = 100; appLoading.value = false } }, 60000)
const globeRef = ref(null)
const dockRef = ref(null)

/**
 * The dock's sections.
 *
 * `badge` and `flag` are DERIVED FROM STATE, never decorative. A badge is a
 * count of things needing attention; a flag means that section currently holds
 * something BLOCKED or UNRESOLVED. This is the dark-cockpit rule: the rail is
 * quiet until it has a reason not to be, so when it does light up it means
 * something.
 */
const dockTabs = computed(() => {
  const conj = (network.value.conjunctions || [])
  const urgent = conj.filter((c) => (c.miss_km ?? 99) < 5 || (c.pc ?? 0) >= 1e-4).length
  const sig = fleetSignal.value && fleetSignal.value.signal
  const gateFlag = sig === 'BLOCKED' || sig === 'UNRESOLVED'
  // `icon` names a drawn glyph in SideDock rather than a unicode character.
  // ⛒ ⛨ ⬡ ◷ have no consistent rendering across platforms — they fall back
  // to whatever the OS happens to have, at whatever weight it happens to
  // use, so the rail looked different on every machine it ran on.
  return [
    // The decision chain leads, because it is the only view that explains the
    // rest. Everything else is a detail of something this walks through.
    { key: 'story',   label: 'How this was decided', icon: 'chain',
      sub: 'one event, every layer' },
    { key: 'signal',  label: 'Constraint Detail', icon: 'gauge',
      sub: sig || '—', flag: gateFlag },
    { key: 'risk',    label: 'Risk Monitor',   icon: 'alert', sub: `${conj.length} tracked`,
      badge: urgent || 0 },
    // "Gate Controls" told nobody what was inside. This tab holds the storm
    // replay, the deorbit planner and the theme-independence proof — say so.
    { key: 'gate',    label: 'Storms & Re-entry',  icon: 'shield',
      sub: 'Gannon replay · deorbit · portability', flag: gateFlag },
    { key: 'fleet',   label: 'Fleet',          icon: 'hex',
      sub: `${(network.value.nodes || []).length} nodes` },
    { key: 'feed',    label: 'Mission Feed',   icon: 'feed', sub: `${events.value.length}` },
    { key: 'launch',  label: 'Launch',         icon: 'launch' },
    { key: 'history', label: 'History',        icon: 'clock', sub: `${history.value.length}` },
  ]
})

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
    if (res.ok) {
      activePlan.value = data
      // Confirmation the click DID something, with the numbers that matter —
      // the globe redraw alone was easy to miss when the camera was elsewhere.
      pushToast('ok', 'AVOIDANCE PLAN COMPUTED',
        `Δv ${data.total_delta_v_ms} m/s · miss ${data.original_miss_km} → ${data.new_miss_km} km`)
      // A plan closes the plan-dependent rules, so the signal moves.
      await showConstraints(conjunctionId)
      await refreshFleetSignal()
    } else {
      pushToast('refused', 'PLAN FAILED', data.error || `Gateway returned ${res.status}.`)
    }
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
let fleetInterval = null
let swInterval = null

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
          if (p.fleet_signal) fleetSignal.value = p.fleet_signal
        }
      }

      // The constraint gate speaks: a signal changed, a waiver was filed, an
      // emergency was refused, or the agent stood down.
      if (type === 'CONSTRAINT_EVENT') {
        pushEvent({
          type: 'CONSTRAINT_EVENT',
          status: p.signal || (p.emergency_refused ? 'REFUSED' : '—'),
          conjunction: p.conjunction_id || '',
          message: p.headline,
          timestamp: new Date(),
        })
        // Keep an open report in sync with whatever just changed.
        if (constraintReport.value && p.conjunction_id === constraintReport.value.conjunction_id) {
          showConstraints(p.conjunction_id)
        }
        refreshFleetSignal()
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

      if (type === 'AGENT_SCAN') {
        // The agent's heartbeat. The feed dedupes identical lines, so a quiet
        // agent shows one entry with a moving timestamp, not a wall of scans.
        pushEvent({
          type: 'EVENT',
          status: p.acting ? 'PLANNING' : 'STANDBY',
          message: p.acting
            ? `AGENT engaging ${p.top.pair} (risk ${p.top.risk}) — planning, then the gate decides`
            : `AGENT scanned ${p.scanned} commandable events · top risk ${p.top ? p.top.risk : '—'} · threshold ${p.threshold} · standing by`,
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
  // The screening loop re-announces the same top conjunction every pass, which
  // filled the feed with fourteen copies of one fact. A repeat within ten
  // minutes bumps the existing entry's timestamp instead of stacking a copy —
  // the feed is a log of CHANGES, not a heartbeat.
  const dup = events.value.find((e) =>
    e.type === evt.type && e.message === evt.message
    && (new Date(evt.timestamp) - new Date(e.timestamp)) < 600000)
  if (dup) { dup.timestamp = evt.timestamp; return }
  events.value.unshift(evt)
  if (events.value.length > 50) events.value = events.value.slice(0, 50)
}

/* ---------------------------------------------------------------------------
   TOASTS — say something where the click happened.

   Almost every action in this product can be REFUSED by the constraint gate,
   and refusal is the point: a 409 means a hard flight rule is violated or a
   rule was never evaluated. But the refusal was only ever written into the
   Mission Feed, which lives behind a different dock tab. So the operator
   clicked VOTE on a BLOCKED event, the gate correctly refused, and from where
   they were sitting the button simply did nothing.

   Every terminal outcome now also raises a toast over the globe.
   ------------------------------------------------------------------------ */
const toasts = ref([])
let toastSeq = 0
function pushToast(kind, title, detail = '') {
  const id = ++toastSeq
  toasts.value.push({ id, kind, title, detail })
  // Refusals stay longer — they carry a reason worth reading.
  setTimeout(() => dismissToast(id), kind === 'refused' ? 7000 : 4500)
}
function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

async function requestManeuver(conjunctionId) {
  try {
    const res = await fetch('/api/maneuver/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conjunction_id: conjunctionId }),
    })
    const data = await res.json()

    // 409 = the constraint gate refused. This is not an error to hide — it is
    // the feature. Show exactly what is outstanding.
    if (res.status === 409) {
      await showConstraints(conjunctionId)
      pushEvent({
        type: 'GATE_REFUSED',
        status: data.signal,
        conjunction: conjunctionId,
        message: data.headline,
        timestamp: new Date(),
      })
      pushToast('refused', 'OPERATOR VOTE REFUSED', data.headline || 'The constraint gate withheld authorisation.')
      return
    }
    if (!res.ok) { pushToast('refused', 'REQUEST FAILED', `Gateway returned ${res.status}.`); return }

    lastManeuver.value = { ...data, conjunction_id: conjunctionId, ts: new Date() }
    pushToast(data.status === 'APPROVED' ? 'ok' : 'warn', `VOTE ${data.status || 'COMPLETE'}`,
      data.duration_ms ? `Consensus reached in ${data.duration_ms} ms.` : '')
    pushEvent({
      type: 'MANEUVER_EVENT',
      status: data.status,
      conjunction: conjunctionId,
      duration_ms: data.duration_ms,
      timestamp: new Date(),
    })
    await showConstraints(conjunctionId)
  } catch (e) {
    console.error('maneuver request failed', e)
  }
}

// ---- Constraint gate ----

/** The Long March 5B re-entry, evaluated by the live rulebook. */
/** The story wants the corridor AND the planet-wide ground layer. */
/**
 * Leaving a tab undoes what that tab painted.
 *
 * The story tab draws a re-entry corridor and turns on the planet-wide land
 * cover. Without this the globe stayed frozen on that scene while the user was
 * looking at Risk or Storms, which read as the app being stuck.
 */
function onTabChange({ from, to }) {
  if (from === 'story' && to !== 'story') {
    deorbitPlan.value = null          // clears corridor, ground strip, descent
    if (globeRef.value) {
      if (globeRef.value.stopFollowing) globeRef.value.stopFollowing()
      if (globeRef.value.hideGlobalGround) globeRef.value.hideGlobalGround()
      if (globeRef.value.agentZoom) globeRef.value.agentZoom('reset')
    }
  }
  // Leaving Risk stops an approach replay that would otherwise hold the camera.
  if (from === 'risk' && to !== 'risk' && globeRef.value && globeRef.value.stopApproach) {
    globeRef.value.stopApproach()
  }
}

async function showStoryOnGlobe() {
  await showLongMarch()
  if (globeRef.value && globeRef.value.showGlobalGround) globeRef.value.showGlobalGround()
}

async function showLongMarch() {
  try {
    const res = await fetch('/api/deorbit/replay/long_march_5b')
    if (!res.ok) return
    const data = await res.json()
    deorbitPlan.value = { ...data.replay, name: data.replay.title }
    deorbitReport.value = { conjunction_id: null, pair: data.replay.title, ...data.constraint }
    constraintReport.value = deorbitReport.value
    pushEvent({
      type: 'CONSTRAINT_EVENT', status: data.constraint.signal,
      message: `${data.replay.title} — ${data.constraint.headline}`, timestamp: new Date(),
    })
  } catch (e) { console.error('long march replay failed', e) }
}

function openAuthor() {
  // The authoring control lives in the gate-controls drawer; nudge the operator there.
  pushEvent({
    type: 'CONSTRAINT_EVENT', status: 'AUTHOR',
    message: 'Open GATE CONTROLS (right edge) → "WRITE A NEW RULE, IN ENGLISH"',
    timestamp: new Date(),
  })
}

async function togglePortability() {
  if (portability.value) { portability.value = null; return }
  try {
    const res = await fetch('/api/portability')
    if (res.ok) portability.value = await res.json()
  } catch (e) { console.error('portability failed', e) }
}

function onRuleAuthored(result) {
  pushEvent({
    type: 'CONSTRAINT_EVENT',
    status: result.rule.id,
    message: `New rule authored: ${result.rule.title} (${result.rule.class}${result.rule.waivable ? '' : ', non-negotiable'})`,
    timestamp: new Date(),
  })
  refreshFleetSignal()
  fetchNetwork()
}

async function refreshSpaceWeather() {
  try {
    const res = await fetch('/api/spaceweather')
    // 503 means the feed is down. Leave it null — the rules report UNRESOLVED,
    // which is the honest state, not a reason to show stale conditions.
    spaceWeather.value = res.ok ? await res.json() : null
    if (spaceWeather.value) replayActive.value = spaceWeather.value.replay || null
  } catch { spaceWeather.value = null }
}

/** Replay a recorded historical scenario, or return to live conditions. */
async function setReplay(id) {
  try {
    const res = await fetch('/api/spaceweather/replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) { pushToast('refused', 'REPLAY FAILED', `Gateway returned ${res.status}.`); return }
    const data = await res.json()
    replayActive.value = data.replay
    // A storm replay with the zones hidden changes numbers and nothing else —
    // it looked like a dead button. The zones ARE the storm: aurora boundary,
    // HF blackout, scintillation band. Show them for the storm, drop them on
    // return to live.
    showZones.value = !!data.replay
    if (data.replay && globeRef.value && globeRef.value.agentZoom) globeRef.value.agentZoom('reset')
    pushToast(data.replay ? 'warn' : 'ok',
      data.replay ? `REPLAY — ${(data.replay.title || data.replay.id || '').toUpperCase()}` : 'RETURNED TO LIVE DATA',
      data.replay ? 'Space weather is now the recorded storm, not the live feed. Zones and rules follow it.' : 'NOAA live feed restored.')
    await refreshSpaceWeather()
    await refreshFleetSignal()
    pushEvent({
      type: 'CONSTRAINT_EVENT',
      status: data.fleet_signal.signal,
      message: id ? `REPLAY: ${data.replay.title} — ${data.fleet_signal.headline}` : 'Returned to live space-weather conditions',
      timestamp: new Date(),
    })
    // Re-run any open deorbit under the new conditions — this is the chain:
    // storm -> wider footprint -> different verdict.
    if (deorbitPlan.value) await planDeorbit(deorbitPlan.value.norad)
  } catch (e) { console.error('replay failed', e) }
}

async function planDeorbit(norad) {
  try {
    const res = await fetch('/api/deorbit/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ norad }),
    })
    const data = await res.json()
    if (!res.ok) { pushToast('refused', 'DEORBIT PLAN FAILED', data.error || `Gateway returned ${res.status}.`); return }
    deorbitPlan.value = data.plan
    deorbitReport.value = { conjunction_id: null, pair: `DEORBIT ${data.plan.name}`, ...data.constraint }
    constraintReport.value = deorbitReport.value
    const fp = data.plan && data.plan.footprint
    pushToast(data.constraint && data.constraint.signal === 'BLOCKED' ? 'warn' : 'ok',
      `DEORBIT — ${data.plan.name}`,
      fp && !fp.unresolved
        ? `corridor ${fp.span_km} km · Ec ${data.plan.casualty ? data.plan.casualty.ec.toExponential(1) : '—'} · gate ${data.constraint ? data.constraint.signal : '—'}`
        : 'footprint could not be characterised — see the rulebook for why')
  } catch (e) { console.error('deorbit plan failed', e) }
}

/** "What would fix it" — the minimum burn-epoch shift that clears the rulebook. */
async function retargetDeorbit() {
  if (!deorbitPlan.value) return
  try {
    const res = await fetch('/api/deorbit/retarget', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ norad: deorbitPlan.value.norad }),
    })
    const data = await res.json()
    if (!res.ok) return
    if (data.plan) deorbitPlan.value = data.plan
    if (data.report) {
      deorbitReport.value = { conjunction_id: null, pair: `DEORBIT ${data.plan.name}`, ...data.report }
      constraintReport.value = deorbitReport.value
    }
    pushEvent({
      type: 'CONSTRAINT_EVENT',
      status: data.offset_s ? 'RETARGETED' : 'NO SOLUTION',
      message: data.offset_s
        ? `Shift the burn by ${data.offset_human}: ${data.from.worst} → ${data.to.worst}`
        : data.note,
      timestamp: new Date(),
    })
  } catch (e) { console.error('retarget failed', e) }
}

async function refreshFleetSignal() {
  try {
    const res = await fetch('/api/constraints/fleet')
    if (res.ok) fleetSignal.value = await res.json()
    // Keep an open report in step with the fleet poll.
    if (selectedEventId.value != null) showConstraints(selectedEventId.value)
  } catch { /* leave the previous value; a failed poll is not a clear signal */ }
}

/** Replay the close approach — both objects on their real orbits. */
function playApproach(id) {
  const c = (network.value.conjunctions || []).find((x) => x.id === id)
  if (c && globeRef.value && globeRef.value.playApproach) globeRef.value.playApproach(c)
}

function selectEvent(id) {
  selectedEventId.value = id
  showConstraints(id)
  // The rulebook renders in the Constraint tab. Without switching to it, a
  // click on a risk card did all its work in a panel the user was not looking
  // at — which is indistinguishable from doing nothing.
  if (dockRef.value) dockRef.value.open('signal')
}
function closeReport() {
  selectedEventId.value = null
  constraintReport.value = null
}

async function showConstraints(conjunctionId) {
  try {
    const res = await fetch(`/api/constraints/${conjunctionId}`)
    if (res.ok) constraintReport.value = await res.json()
  } catch (e) {
    console.error('constraint report failed', e)
  }
}

async function fileWaiver({ rule_id, party, reason }) {
  const id = constraintReport.value && constraintReport.value.conjunction_id
  if (!id) return
  try {
    const res = await fetch(`/api/constraints/${id}/waive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rule_id, party, reason }),
    })
    const data = await res.json()
    if (res.status === 409) {
      // The engine refused the waiver — non-negotiable, or never evaluated.
      pushEvent({ type: 'WAIVER_REFUSED', status: rule_id, message: data.error, timestamp: new Date() })
      pushToast('refused', `WAIVER REFUSED — ${rule_id}`, data.error || 'This rule cannot be waived.')
    } else if (res.ok) {
      pushEvent({ type: 'WAIVER_FILED', status: rule_id, message: `${party}: ${reason}`, timestamp: new Date() })
      pushToast('ok', `WAIVER FILED — ${rule_id}`, `${party}: ${reason}`)
    }
    await showConstraints(id)
    await refreshFleetSignal()
  } catch (e) {
    console.error('waiver failed', e)
  }
}

async function emergencyOverride(conjunctionId) {
  try {
    const res = await fetch('/api/maneuver/emergency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conjunction_id: conjunctionId }),
    })
    const data = await res.json()

    // The emergency path can be REFUSED — non-negotiable rules have no override,
    // and an emergency is not evidence for a rule that was never evaluated.
    if (res.status === 409) {
      await showConstraints(conjunctionId)
      pushEvent({
        type: 'EMERGENCY_REFUSED',
        status: 'REFUSED',
        conjunction: conjunctionId,
        message: data.reason,
        timestamp: new Date(),
      })
      pushToast('refused', 'EMERGENCY OVERRIDE REFUSED', data.reason || 'This rule has no override path.')
      return
    }
    if (res.ok) {
      pushEvent({
        type: 'MANEUVER_EVENT',
        status: 'EMERGENCY_' + (data.status || 'ISSUED'),
        conjunction: conjunctionId,
        message: data.note,
        timestamp: new Date(),
      })
      await showConstraints(conjunctionId)
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
    // Stopping a node is the live demo of FR-08: quorum is non-negotiable, so
    // killing operators visibly drags the whole gate toward BLOCKED. Say so at
    // the moment of the click, with the count that matters.
    const nodes = network.value.nodes || []
    const online = nodes.filter((n) => n.online).length
    const name = (nodes.find((n) => n.id === id) || {}).name || `node ${id}`
    if (action === 'stop') {
      pushToast(online < 3 ? 'refused' : 'warn', `${name.toUpperCase()} OFFLINE`,
        `${online}/${nodes.length} operators up. ` + (online < 3
          ? 'Quorum LOST — FR-08 is non-negotiable, every maneuver is now BLOCKED.'
          : 'Quorum holds. One more loss blocks every maneuver.'))
    } else if (action === 'start') {
      pushToast('ok', `${name.toUpperCase()} BACK ONLINE`, `${online}/${nodes.length} operators up.`)
    }
    await refreshFleetSignal()
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
  refreshFleetSignal()
  refreshSpaceWeather()
  pollInterval = setInterval(fetchNetwork, 3000)
  // The fleet signal is cheap (pure arithmetic server-side) but doesn't need to
  // be as hot as the globe — 6 s keeps the burndown live without churn.
  fleetInterval = setInterval(refreshFleetSignal, 6000)
  swInterval = setInterval(refreshSpaceWeather, 30000)
  connectWS()
})

onUnmounted(() => {
  clearInterval(pollInterval)
  clearInterval(fleetInterval)
  clearInterval(swInterval)
  if (ws) ws.close()
})
</script>

<style>
:root {
  /* ------------------------------------------------------------------
     Orbital flight-ops console.

     Two decisions drive this palette:

       1. THE PLANET IS THE HERO. Surfaces sit ON the globe, so they are
          near-opaque and neutral — they must not tint the Earth behind
          them or compete with it. Nothing glows.

       2. COLOUR IS EARNED. Only the four completion states carry hue, so
          a coloured pixel always means something. UNRESOLVED gets a cold
          slate rather than a fifth competing colour — an unlit lamp.
     ------------------------------------------------------------------ */

  --bg-deep: #08090b;
  --bg-panel: #131417;          /* panel body — reads as a surface, not a void */
  --bg-panel-2: #1b1c20;        /* raised: inputs, buttons */
  --bg-panel-3: #101114;        /* recessed: rows, wells */

  /* chrome accent — warm steel, used ONLY for focus and interaction */
  --accent-blue: #c9a227;
  --accent-blue-dim: rgba(201, 162, 39, 0.10);
  --accent-blue-glow: rgba(201, 162, 39, 0.28);

  /* --- the four states — the only hues in the system --- */
  --color-green: #4cc76a;                          /* COMPLETE */
  --color-green-dim: rgba(76, 199, 106, 0.14);
  --color-amber: #e0a32e;                          /* PARTIAL */
  --color-amber-dim: rgba(224, 163, 46, 0.14);
  --color-red: #ff5f56;                            /* BLOCKED */
  --color-red-dim: rgba(255, 95, 86, 0.14);
  --color-purple: #8b93a1;                         /* UNRESOLVED — unlit */
  --color-purple-dim: rgba(139, 147, 161, 0.12);

  /* high-contrast warm text — legible over a bright globe */
  --text-primary: #f2efea;
  --text-secondary: #b0aca6;
  --text-dim: #6e6b66;

  --border: rgba(255, 255, 255, 0.07);
  --border-bright: rgba(255, 255, 255, 0.14);

  /* ---- glass -------------------------------------------------------
     Panels float ON the planet rather than boxing it in. They are
     translucent and blurred so the Earth stays legible through them —
     the planet is the subject, the panels are instruments laid over it.
     ------------------------------------------------------------------ */
  --glass: rgba(13, 14, 17, 0.66);
  --glass-strong: rgba(11, 12, 15, 0.86);
  --glass-blur: saturate(140%) blur(22px);

  /* ---- spacing scale — one ruler for the whole product ------------- */
  --s1: 4px;  --s2: 8px;  --s3: 12px; --s4: 16px;
  --s5: 22px; --s6: 30px; --s7: 44px;

  --r1: 8px;  --r2: 14px; --r3: 20px;

  --font-display: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  --header-h: 56px;
  --bottom-h: 220px;

  /* ---- type scale ---------------------------------------------------
     A console is read at arm's length under stage lighting. 10px is the
     floor for anything a person must actually read; 9px is reserved for
     all-caps micro-labels, which are shapes more than words.
     -------------------------------------------------------------------- */
  --t-micro: 9px;    /* all-caps kickers only */
  --t-label: 10px;   /* field labels */
  --t-body:  12px;   /* default reading size */
  --t-read:  13px;   /* primary rows, prose */
  --t-lead:  16px;   /* section leads */
  --t-num:   20px;   /* single hero numbers */

  /* ---- elevation ----------------------------------------------------
     Three steps only. Panels that sit ON the globe get e2; things that
     float ABOVE a panel get e3. Nothing else casts a shadow, so depth
     stays a signal rather than decoration.
     -------------------------------------------------------------------- */
  --e1: 0 1px 2px rgba(0, 0, 0, 0.35);
  --e2: 0 10px 30px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.03) inset;
  --e3: 0 24px 70px rgba(0, 0, 0, 0.62), 0 1px 0 rgba(255, 255, 255, 0.04) inset;

  /* ---- interaction --------------------------------------------------- */
  --focus-ring: 0 0 0 2px var(--bg-deep), 0 0 0 3px var(--accent-blue);
  --hover-wash: rgba(255, 255, 255, 0.05);
  --active-wash: rgba(255, 255, 255, 0.09);

  /* ---- motion -------------------------------------------------------- */
  --ease: cubic-bezier(0.32, 0.72, 0, 1);
  --dur-1: 0.12s;
  --dur-2: 0.2s;
  --dur-3: 0.32s;

  /* ---- layer order ----------------------------------------------------
     Every stacking context in the product is named HERE. Previously each
     component invented its own z-index (5, 60, 200, 250, 300, 900, 1500),
     which is exactly how things end up on top of each other by accident.
     -------------------------------------------------------------------- */
  --z-globe-hud: 10;      /* things drawn on the globe */
  --z-globe-panel: 20;    /* the globe's own slide-out panels */
  --z-dock: 50;           /* the left dock */
  --z-header: 100;        /* the top bar */
  --z-float: 400;         /* transient cards + tooltips over everything */
  --z-drawer: 900;        /* the AI drawer */
  --z-overlay: 9000;      /* boot / reset blockers */
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
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.10);
  border-radius: 99px;
  /* The border is transparent and the background is clipped to it, which
     insets the thumb without needing a wrapper — so an 8px-wide gutter
     carries a 4px-wide thumb and the track stays invisible. */
  border: 2px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.20);
  background-clip: content-box;
}
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
}

button {
  font-family: var(--font-mono);
  cursor: pointer;
  border: none;
  outline: none;
  color: inherit;
}

/* ---------------------------------------------------------------------
   Focus. Every interactive element gets the SAME ring, and only when the
   keyboard asked for it. A console that cannot be driven from the keyboard
   is not a console.
   ------------------------------------------------------------------- */
:focus { outline: none; }
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--r1);
  position: relative;
  z-index: 1;
}

/* Anything disabled should look unavailable, uniformly. */
button:disabled,
input:disabled {
  cursor: not-allowed;
}

/* Numbers that update every tick must not reflow the layout under them. */
.mono, .tabular {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}

/* ---------------------------------------------------------------------
   Respect the setting. Blinking lamps and pulsing rings are the first
   thing to go for anyone who asked the OS for less motion.
   ------------------------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
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

/* ---------------------------------------------------------------------
   MOTION

   Three jobs only, so movement stays meaningful in a console:

     1. ARRIVAL  — new rows in a list settle in, staggered, so you can see
                   that something arrived rather than finding it already
                   there on the next glance.
     2. CHANGE   — a value that just updated flashes its own colour once.
     3. WAITING  — a shimmer on anything the gateway has not answered yet.

   Everything here is disabled wholesale by the prefers-reduced-motion
   block above.
   ------------------------------------------------------------------- */

/* 1. ARRIVAL — stagger the first ten rows of any list. Cheap: pure CSS,
      no per-row JS, and rows past the tenth simply appear. */
.stagger > *:nth-child(1)  { animation: fade-in-up .34s var(--ease) both; animation-delay: .00s; }
.stagger > *:nth-child(2)  { animation: fade-in-up .34s var(--ease) both; animation-delay: .03s; }
.stagger > *:nth-child(3)  { animation: fade-in-up .34s var(--ease) both; animation-delay: .06s; }
.stagger > *:nth-child(4)  { animation: fade-in-up .34s var(--ease) both; animation-delay: .09s; }
.stagger > *:nth-child(5)  { animation: fade-in-up .34s var(--ease) both; animation-delay: .12s; }
.stagger > *:nth-child(6)  { animation: fade-in-up .34s var(--ease) both; animation-delay: .15s; }
.stagger > *:nth-child(7)  { animation: fade-in-up .34s var(--ease) both; animation-delay: .18s; }
.stagger > *:nth-child(8)  { animation: fade-in-up .34s var(--ease) both; animation-delay: .21s; }
.stagger > *:nth-child(9)  { animation: fade-in-up .34s var(--ease) both; animation-delay: .24s; }
.stagger > *:nth-child(10) { animation: fade-in-up .34s var(--ease) both; animation-delay: .27s; }

/* 2. CHANGE — one flash, then back to normal. */
@keyframes value-flash {
  0%   { color: var(--accent-blue); }
  100% { color: inherit; }
}

/* 3. WAITING — a travelling highlight for not-yet-loaded content. */
@keyframes shimmer {
  from { background-position: -220% 0; }
  to   { background-position: 320% 0; }
}
.is-loading {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.06) 45%,
    rgba(255, 255, 255, 0.06) 55%,
    transparent 100%
  );
  background-size: 220% 100%;
  animation: shimmer 1.4s linear infinite;
}

/* The state lamp only pulses while something is actually blocked — motion
   that stops when the problem does. */
@keyframes lamp-breathe {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 95, 86, 0.45); }
  70%      { box-shadow: 0 0 0 7px rgba(255, 95, 86, 0); }
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
  flex: 1 1 auto;
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

/* ---------------------------------------------------------------------
   Boot. The first thing anyone sees, so it is the palette's opening
   statement: warm steel on near-black, one thin progress line, no glow.
   ------------------------------------------------------------------- */
.boot {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background:
    radial-gradient(ellipse 80% 60% at 50% 42%, rgba(201, 162, 39, 0.07) 0%, transparent 70%),
    var(--bg-deep);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s5);
}
.boot-logo {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 300;
  letter-spacing: 0.42em;
  /* the letter-spacing pushes the last glyph off-centre — pull it back */
  text-indent: 0.42em;
  color: var(--text-primary);
}
.boot-logo span { color: var(--accent-blue); font-weight: 500; }
.boot-bar {
  width: 260px;
  height: 2px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.boot-bar-fill {
  height: 100%;
  background: var(--accent-blue);
  transition: width var(--dur-3) var(--ease);
}
.boot-text {
  font-family: var(--font-mono);
  font-size: var(--t-label);
  letter-spacing: 0.22em;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.boot-sub {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  letter-spacing: 0.14em;
  color: var(--text-dim);
  margin-top: calc(var(--s5) * -1 + var(--s2));
}
.boot-fade-leave-active { transition: opacity 0.6s ease; }
.boot-fade-leave-to { opacity: 0; }

/* ---------------------------------------------------------------------
   Toasts. Bottom-right, above the AI tab, clear of the left dock.
   ------------------------------------------------------------------- */
.toasts {
  position: fixed;
  right: var(--s5);
  bottom: calc(var(--s5) + 40px + 36px + var(--s3));
  z-index: var(--z-float);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--s2);
  width: min(380px, calc(100vw - var(--s6)));
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: stretch;
  gap: var(--s3);
  width: 100%;
  padding: var(--s3) var(--s2) var(--s3) 0;
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-radius: var(--r1);
  box-shadow: var(--e3);
  cursor: pointer;
}
.toast-bar { width: 2px; flex: none; margin-left: -1px; border-radius: 2px; background: var(--text-dim); }
.t-refused .toast-bar { background: var(--color-red); }
.t-warn .toast-bar { background: var(--color-amber); }
.t-ok .toast-bar { background: var(--color-green); }
.toast-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.toast-title {
  font: 700 var(--t-label)/1.3 var(--font-mono);
  letter-spacing: 0.14em;
  color: var(--text-primary);
}
.t-refused .toast-title { color: var(--color-red); }
.t-ok .toast-title { color: var(--color-green); }
.toast-detail { font: 400 var(--t-body)/1.5 var(--font-display); color: var(--text-secondary); }
.toast-x {
  flex: none; align-self: flex-start;
  width: 22px; height: 22px; display: grid; place-items: center;
  border-radius: var(--r1); background: none; color: var(--text-dim);
  font-size: 15px; line-height: 1;
}
.toast-x:hover { color: var(--text-primary); background: var(--hover-wash); }

/* Slide in from the right, collapse out. `toast-move` keeps the survivors
   gliding into place when one above them is dismissed. */
.toast-enter-active { transition: opacity var(--dur-2) var(--ease), transform var(--dur-2) var(--ease); }
.toast-leave-active { transition: opacity var(--dur-2) ease, transform var(--dur-2) var(--ease); position: absolute; }
.toast-enter-from { opacity: 0; transform: translateX(16px) scale(0.98); }
.toast-leave-to { opacity: 0; transform: translateX(16px); }
.toast-move { transition: transform var(--dur-3) var(--ease); }

.reset-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 11, 18, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: var(--z-overlay);
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

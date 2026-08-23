<template>
  <header class="header">
    <!-- Brand -->
    <div class="brand">
      <div class="logo-mark">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Earth core -->
          <circle cx="16" cy="16" r="6" fill="var(--bg-panel-2)" stroke="var(--accent-blue)" stroke-width="1"/>
          <!-- Orbital ring 1 -->
          <ellipse cx="16" cy="16" rx="13" ry="5" stroke="var(--accent-blue)" stroke-width="1.2" fill="none" opacity="0.7"
            transform="rotate(-20, 16, 16)"/>
          <!-- Orbital ring 2 -->
          <ellipse cx="16" cy="16" rx="13" ry="5" stroke="#8b5cf6" stroke-width="0.8" fill="none" opacity="0.5"
            transform="rotate(60, 16, 16)"/>
          <!-- Satellite dot -->
          <circle cx="27.2" cy="12.5" r="1.8" fill="var(--color-red)">
            <animateTransform attributeName="transform" type="rotate"
              from="0 16 16" to="360 16 16" dur="8s" repeatCount="indefinite"/>
          </circle>
          <!-- Safe satellite dot -->
          <circle cx="4.8" cy="19" r="1.4" fill="#10b981">
            <animateTransform attributeName="transform" type="rotate"
              from="360 16 16" to="0 16 16" dur="12s" repeatCount="indefinite"/>
          </circle>
        </svg>
      </div>
      <div class="brand-text">
        <span class="brand-name">ASTROMESH</span>
        <span class="brand-sub">ORBITAL DEBRIS INTELLIGENCE</span>
      </div>
    </div>

    <!-- ===================== READOUTS =====================
         Each reading is a LABEL STACKED OVER A VALUE, separated from its
         neighbours by a hairline rule. Previously these were inline
         label-value pairs with a 4px gap — a smaller gap BETWEEN readings
         than inside them, which made the whole bar read as one run-on
         string. Stacking the pair and ruling between them means the eye
         parses six readings instead of one sentence. -->
    <div class="status-bar">
      <!-- UTC Clock -->
      <div class="readout r-clock">
        <span class="ro-label">UTC</span>
        <span class="ro-value mono">{{ utcTime }}</span>
      </div>

      <!-- Link status -->
      <div class="readout" :class="wsConnected ? 'link-ok' : 'link-err'">
        <span class="ro-label">Link</span>
        <span class="ro-value ro-lamped">
          <span class="link-dot"></span>{{ wsConnected ? 'NOMINAL' : 'OFFLINE' }}
        </span>
      </div>

      <!-- Active threats -->
      <div class="readout" :class="{ 'has-threats': activeConjunctions > 0 }">
        <span class="ro-label">Active threats</span>
        <span class="ro-value threat-count mono">{{ activeConjunctions }}</span>
      </div>

      <!-- Node count -->
      <div class="readout r-nodes">
        <span class="ro-label">Nodes</span>
        <span class="ro-value mono">{{ nodeCount }}</span>
      </div>

      <!-- Space weather badge -->
      <div class="readout r-weather">
        <span class="ro-label">Space weather</span>
        <span class="ro-value">
          <span class="weather-badge" :class="weatherClass">{{ weatherLabel }}</span>
        </span>
      </div>

      <!-- Agent status. The lamp is a LAID-OUT sibling of the text, not an
           absolutely-positioned dot on top of it — which is what used to
           put a green circle through the word STANDBY. -->
      <div class="readout r-agent" :class="agentEnabled ? 'agent-active' : 'agent-standby'">
        <span class="ro-label">Autonomy</span>
        <span class="ro-value ro-lamped">
          <span class="agent-icon">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="5" r="3" stroke="currentColor" stroke-width="1.2"/>
              <path d="M1 13c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              <circle cx="7" cy="5" r="1.2" fill="currentColor"/>
            </svg>
          </span>
          {{ agentEnabled ? 'ACTIVE' : 'STANDBY' }}
        </span>
      </div>

      <!-- Fullscreen -->
      <button class="fullscreen-btn" @click="toggleFullscreen" :title="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'">
        <svg v-if="!isFullscreen" width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M1 1h4M1 1v4M15 1h-4M15 1v4M1 15h4M1 15v-4M15 15h-4M15 15v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <svg v-else width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M5 1v4H1M11 1v4h4M5 15v-4H1M11 15v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  wsConnected: Boolean,
  leaderName: String,
  activeConjunctions: Number,
  nodeCount: Number,
  agentEnabled: Boolean,
})

const utcTime = ref('')
const isFullscreen = ref(false)

let clockInterval = null

function updateClock() {
  const now = new Date()
  const h = String(now.getUTCHours()).padStart(2, '0')
  const m = String(now.getUTCMinutes()).padStart(2, '0')
  const s = String(now.getUTCSeconds()).padStart(2, '0')
  const y = now.getUTCFullYear()
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  utcTime.value = `${y}-${mo}-${d} ${h}:${m}:${s}`
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.()
    isFullscreen.value = true
  } else {
    document.exitFullscreen?.()
    isFullscreen.value = false
  }
}

// Pseudo space weather based on active threats
const weatherLabel = computed(() => {
  if (props.activeConjunctions > 5) return 'SEVERE'
  if (props.activeConjunctions > 2) return 'ELEVATED'
  return 'NOMINAL'
})

const weatherClass = computed(() => {
  if (props.activeConjunctions > 5) return 'weather-severe'
  if (props.activeConjunctions > 2) return 'weather-elevated'
  return 'weather-nominal'
})

onMounted(() => {
  updateClock()
  clockInterval = setInterval(updateClock, 1000)
})

onUnmounted(() => {
  clearInterval(clockInterval)
})
</script>

<style scoped>
.header {
  height: var(--header-h);
  min-height: var(--header-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--s5);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--border);
  position: relative;
  z-index: var(--z-header);
  gap: var(--s4);
}


.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.logo-mark {
  display: flex;
  /* No glow. The mark is a mark, not a light source. */
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.brand-name {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.22em;
  color: var(--text-primary);
  line-height: 1;
}

.brand-sub {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  letter-spacing: 0.18em;
  color: var(--text-dim);
  line-height: 1;
}

.status-bar {
  display: flex;
  align-items: stretch;
  gap: 0;
  flex: 1;
  min-width: 0;
  justify-content: flex-end;
  height: 30px;
  align-self: center;
}

/* ---------------------------------------------------------------------
   A readout: micro label over a value, ruled off from its neighbour.
   ------------------------------------------------------------------- */
.readout {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 0 var(--s4);
  white-space: nowrap;
  position: relative;
  border-left: 1px solid var(--border);
  flex-shrink: 0;
}
.readout:first-child { border-left: 0; }

.ro-label {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  line-height: 1;
  letter-spacing: 0.16em;
  color: var(--text-dim);
  text-transform: uppercase;
}

.ro-value {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.04em;
}

/* A value with a lamp or glyph in front of it. */
.ro-lamped {
  display: flex;
  align-items: center;
  gap: 6px;
}

.r-clock .ro-value {
  color: var(--text-secondary);
  font-weight: 400;
}
.r-nodes .ro-value { color: var(--accent-blue); }

/* Link status */
.link-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.link-ok .link-dot {
  background: var(--color-green);
  animation: blink-dot 2s ease-in-out infinite;
}

.link-err .link-dot {
  background: var(--color-red);
}

.link-ok .ro-value { color: var(--color-green); }
.link-err .ro-value { color: var(--color-red); }

/* Threats. A count of zero is not news, so it stays neutral; the readout
   only takes on the red wash once there is something in it. */
.threat-count {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0;
}
.has-threats .threat-count { color: var(--color-red); }
.has-threats::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--color-red-dim);
  pointer-events: none;
}
.has-threats > * { position: relative; }

/* Weather */
.weather-badge {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  font-weight: 700;
  line-height: 12px;
  letter-spacing: 0.12em;
  padding: 0 6px;
  border-radius: 3px;
}

.weather-nominal {
  background: var(--color-green-dim);
  color: var(--color-green);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.weather-elevated {
  background: var(--color-amber-dim);
  color: var(--color-amber);
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.weather-severe {
  background: var(--color-red-dim);
  color: var(--color-red);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

/* Agent */
.agent-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.agent-active .agent-icon,
.agent-active .ro-value { color: var(--color-green); }

.agent-standby .agent-icon,
.agent-standby .ro-value { color: var(--text-secondary); }

/* Fullscreen */
.fullscreen-btn {
  width: 30px;
  height: 30px;
  margin-left: var(--s3);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  color: var(--text-dim);
  transition: color var(--dur-1), border-color var(--dur-1), background var(--dur-1);
  flex-shrink: 0;
  align-self: center;
}

.fullscreen-btn:hover {
  background: var(--hover-wash);
  border-color: var(--border-bright);
  color: var(--text-primary);
}

/* ---------------------------------------------------------------------
   Narrow frames. Readouts are dropped in reverse order of importance
   rather than being clipped mid-word by an overflow:hidden, which is what
   used to leave half a value hanging off the edge of the bar.
   ------------------------------------------------------------------- */
@media (max-width: 1380px) {
  .r-weather { display: none; }
}
@media (max-width: 1180px) {
  .r-nodes { display: none; }
  .readout { padding: 0 var(--s3); }
}
@media (max-width: 1000px) {
  .r-clock { display: none; }
  .brand-sub { display: none; }
}
@media (max-width: 820px) {
  .r-agent { display: none; }
}
</style>

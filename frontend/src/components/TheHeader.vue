<template>
  <header class="header">
    <!-- Brand -->
    <div class="brand">
      <div class="logo-mark">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Earth core -->
          <circle cx="16" cy="16" r="6" fill="#1e3a5f" stroke="#3b82f6" stroke-width="1"/>
          <!-- Orbital ring 1 -->
          <ellipse cx="16" cy="16" rx="13" ry="5" stroke="#3b82f6" stroke-width="1.2" fill="none" opacity="0.7"
            transform="rotate(-20, 16, 16)"/>
          <!-- Orbital ring 2 -->
          <ellipse cx="16" cy="16" rx="13" ry="5" stroke="#8b5cf6" stroke-width="0.8" fill="none" opacity="0.5"
            transform="rotate(60, 16, 16)"/>
          <!-- Satellite dot -->
          <circle cx="27.2" cy="12.5" r="1.8" fill="#ef4444">
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

    <!-- Status widgets -->
    <div class="status-bar">
      <!-- UTC Clock -->
      <div class="widget clock-widget">
        <span class="widget-label">UTC</span>
        <span class="widget-value mono">{{ utcTime }}</span>
      </div>

      <!-- Link status -->
      <div class="widget link-widget" :class="wsConnected ? 'link-ok' : 'link-err'">
        <span class="link-dot"></span>
        <span class="widget-label">LINK</span>
        <span class="widget-value">{{ wsConnected ? 'NOMINAL' : 'OFFLINE' }}</span>
      </div>

      <!-- Active threats -->
      <div class="widget threat-widget" :class="{ 'has-threats': activeConjunctions > 0 }">
        <span class="widget-label">ACTIVE THREATS</span>
        <span class="widget-value threat-count">{{ activeConjunctions }}</span>
      </div>

      <!-- Node count -->
      <div class="widget">
        <span class="widget-label">NODES</span>
        <span class="widget-value mono">{{ nodeCount }}</span>
      </div>

      <!-- Space weather badge -->
      <div class="widget weather-widget">
        <span class="widget-label">SPACE WEATHER</span>
        <span class="weather-badge" :class="weatherClass">{{ weatherLabel }}</span>
      </div>

      <!-- Agent status -->
      <div class="widget agent-widget" :class="agentEnabled ? 'agent-active' : 'agent-standby'">
        <span class="agent-icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="5" r="3" stroke="currentColor" stroke-width="1.2"/>
            <path d="M1 13c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            <circle cx="7" cy="5" r="1.2" fill="currentColor"/>
          </svg>
        </span>
        <span class="widget-label">AGENT</span>
        <span class="widget-value">{{ agentEnabled ? 'ACTIVE' : 'STANDBY' }}</span>
        <span v-if="agentEnabled" class="agent-pulse-ring"></span>
      </div>

      <!-- Fullscreen -->
      <button class="fullscreen-btn" @click="toggleFullscreen" title="Toggle fullscreen">
        <svg v-if="!isFullscreen" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M1 1h4M1 1v4M15 1h-4M15 1v4M1 15h4M1 15v-4M15 15h-4M15 15v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
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
  padding: 0 16px;
  background: linear-gradient(180deg, rgba(14, 20, 32, 0.98) 0%, rgba(8, 11, 18, 0.95) 100%);
  border-bottom: 1px solid var(--border-bright);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  position: relative;
  z-index: 100;
  gap: 16px;
}

/* Subtle scan line effect */
.header::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(59, 130, 246, 0.03) 30%,
    rgba(59, 130, 246, 0.06) 50%,
    rgba(59, 130, 246, 0.03) 70%,
    transparent 100%
  );
  pointer-events: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.logo-mark {
  filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.5));
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.brand-name {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #fff;
  line-height: 1;
  background: linear-gradient(135deg, #e2e8f0 0%, #93c5fd 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.brand-sub {
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.2em;
  color: var(--text-dim);
  line-height: 1;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  justify-content: flex-end;
  overflow: hidden;
}

.widget {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 4px;
  white-space: nowrap;
  position: relative;
  overflow: hidden;
}

.widget-label {
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.12em;
  color: var(--text-dim);
  text-transform: uppercase;
}

.widget-value {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.widget-value.mono {
  font-size: 12px;
  color: var(--accent-blue);
}

.clock-widget .widget-value {
  font-size: 11px;
  color: #93c5fd;
  letter-spacing: 0.05em;
}

/* Link status */
.link-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.link-ok .link-dot {
  background: var(--color-green);
  box-shadow: 0 0 6px var(--color-green);
  animation: blink-dot 2s ease-in-out infinite;
}

.link-err .link-dot {
  background: var(--color-red);
  box-shadow: 0 0 6px var(--color-red);
}

.link-ok .widget-value {
  color: var(--color-green);
}

.link-err .widget-value {
  color: var(--color-red);
}

/* Threats */
.has-threats {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.08);
  animation: threat-pulse 2s ease-in-out infinite;
}

@keyframes threat-pulse {
  0%, 100% { border-color: rgba(239, 68, 68, 0.3); }
  50% { border-color: rgba(239, 68, 68, 0.7); box-shadow: 0 0 10px rgba(239, 68, 68, 0.2); }
}

.threat-count {
  font-size: 16px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--color-red) !important;
  min-width: 20px;
  text-align: center;
}

/* Weather */
.weather-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 2px 6px;
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
.agent-widget {
  position: relative;
  overflow: visible;
}

.agent-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.agent-active {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.08);
}

.agent-active .agent-icon,
.agent-active .widget-value {
  color: var(--color-green);
}

.agent-standby {
  border-color: rgba(245, 158, 11, 0.3);
}

.agent-standby .agent-icon,
.agent-standby .widget-value {
  color: var(--color-amber);
}

.agent-pulse-ring {
  position: absolute;
  top: 50%;
  right: 8px;
  width: 6px;
  height: 6px;
  margin-top: -3px;
  border-radius: 50%;
  background: var(--color-green);
}

.agent-pulse-ring::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1px solid var(--color-green);
  animation: pulse-ring 1.5s ease-out infinite;
}

/* Fullscreen */
.fullscreen-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  transition: all 0.15s;
  flex-shrink: 0;
}

.fullscreen-btn:hover {
  background: var(--accent-blue-dim);
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}
</style>

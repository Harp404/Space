<template>
  <div class="lp">
    <div class="lp-intro">The planner finds the optimal azimuth, achievable inclination &amp; insertion Δv (with Earth-rotation assist), screens the target shell, then simulates the ascent with real physics.</div>

    <div class="lp-sec">① LAUNCH SITE <span class="lp-sec-x">(start)</span></div>
    <label class="lp-row">PRESET PAD
      <select v-model="preset" @change="applyPreset" class="lp-in">
        <option v-for="s in sites" :key="s.name" :value="s.name">{{ s.name }}</option>
        <option value="custom">Custom…</option>
      </select>
    </label>
    <div class="lp-grid">
      <label>SITE LAT °<input v-model.number="form.lat" type="number" step="0.01" class="lp-in" /></label>
      <label>SITE LON °<input v-model.number="form.lon" type="number" step="0.01" class="lp-in" /></label>
    </div>

    <div class="lp-sec">② TARGET ORBIT <span class="lp-sec-x">(destination)</span></div>
    <label class="lp-row">ORBIT TYPE
      <select v-model="orbitType" @change="applyOrbit" class="lp-in">
        <option v-for="o in orbits" :key="o.name" :value="o.name">{{ o.name }}</option>
        <option value="custom">Custom…</option>
      </select>
    </label>
    <div class="lp-grid">
      <label>ALTITUDE km<input v-model.number="form.alt" type="number" step="10" class="lp-in" @input="orbitType='custom'" /></label>
      <label>INCLINATION °<input v-model.number="form.inc" type="number" step="1" class="lp-in" @input="orbitType='custom'" /></label>
    </div>

    <button class="lp-go" :disabled="busy" @click="plan">{{ busy ? 'COMPUTING TRAJECTORY…' : '⟳ PLAN TRAJECTORY' }}</button>

    <div v-if="result" class="lp-res">
      <div v-if="result.note" class="lp-note">⚠ {{ result.note }}</div>
      <div class="lp-best">★ BEST LAUNCH WINDOW<br /><b>{{ windowText }}</b></div>
      <div class="lp-stats">
        <div><span>LAUNCH AZIMUTH</span><b>{{ result.azimuth_deg }}° · {{ result.azimuth_compass }}</b></div>
        <div><span>INCLINATION</span><b>{{ result.inclination_deg }}°</b></div>
        <div><span>ORBITAL VELOCITY</span><b>{{ result.orbit_velocity_kms }} km/s</b></div>
        <div><span>EARTH ASSIST</span><b class="ok">+{{ result.earth_assist_kms }} km/s</b></div>
        <div><span>INSERTION Δv</span><b>{{ result.delta_v_kms }} km/s</b></div>
        <div><span>ORBIT PERIOD</span><b>{{ result.period_min }} min</b></div>
        <div class="wide"><span>TARGET SHELL CONGESTION (COLA)</span><b :class="result.objects_in_altitude_band > 1000 ? 'bad' : 'ok'">{{ result.objects_in_altitude_band }} tracked objects in ±25 km</b></div>
      </div>
      <div class="lp-legend"><span class="o">— ascent</span><span class="c">— target orbit</span><span class="v">▲ vehicle</span></div>
      <div class="lp-actions">
        <button class="lp-sim" @click="$emit('simulate')">▶ SIMULATE LAUNCH</button>
        <button class="lp-clear" @click="clear">↩ BACK</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
const emit = defineEmits(['plan', 'simulate'])

// Standard mission orbits (how space agencies actually specify a target).
const orbits = [
  { name: 'ISS orbit (LEO)', alt: 420, inc: 51.6 },
  { name: 'Starlink shell (LEO)', alt: 550, inc: 53 },
  { name: 'Sun-synchronous (SSO)', alt: 700, inc: 98.2 },
  { name: 'Polar', alt: 800, inc: 90 },
  { name: 'GPS / MEO', alt: 20180, inc: 55 },
  { name: 'Geostationary (GEO)', alt: 35786, inc: 0 },
]
const orbitType = ref('Starlink shell (LEO)')
function applyOrbit() {
  const o = orbits.find((x) => x.name === orbitType.value)
  if (o) { form.alt = o.alt; form.inc = o.inc }
}
const windowText = computed(() => {
  const r = result.value
  if (!r || r.launch_window_min == null) return '—'
  const m = r.launch_window_min
  const t = r.launch_window_utc ? new Date(r.launch_window_utc).toISOString().slice(11, 16) + ' UTC' : ''
  if (m < 1) return `OPEN NOW (next ascending-node pass) · ${t}`
  if (m < 60) return `T-${m.toFixed(0)} min · ${t}`
  return `T-${(m / 60).toFixed(1)} h · ${t}`
})

const sites = [
  { name: 'Sriharikota (ISRO)', lat: 13.733, lon: 80.235 },
  { name: 'Cape Canaveral (USA)', lat: 28.562, lon: -80.577 },
  { name: 'Baikonur (Kazakhstan)', lat: 45.965, lon: 63.305 },
  { name: 'Kourou (ESA)', lat: 5.239, lon: -52.768 },
  { name: 'Vandenberg (USA)', lat: 34.742, lon: -120.573 },
]
const preset = ref('Sriharikota (ISRO)')
const form = reactive({ lat: 13.733, lon: 80.235, alt: 550, inc: 45 })
const result = ref(null)
const busy = ref(false)

function applyPreset() {
  const s = sites.find((x) => x.name === preset.value)
  if (s) { form.lat = s.lat; form.lon = s.lon }
}
async function plan() {
  busy.value = true
  try {
    const res = await fetch('/api/launch/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: form.lat, lon: form.lon, alt: form.alt, inc: form.inc }),
    })
    const data = await res.json()
    if (res.ok && !data.error) { result.value = data; emit('plan', data) }
  } catch { /* ignore */ }
  busy.value = false
}
function clear() { result.value = null; emit('plan', null) }
</script>

<style scoped>
.lp { padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; font: 12px/1.4 ui-monospace, monospace; }
.lp-intro { font-size: 11px; color: var(--text-dim); line-height: 1.5; }
.lp-sec { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: #22d3ee; margin-top: 2px; }
.lp-sec-x { color: var(--text-dim); font-weight: 400; }
.lp-row { display: flex; flex-direction: column; gap: 4px; font-size: 9px; letter-spacing: 0.08em; color: var(--text-dim); }
.lp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.lp-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 9px; letter-spacing: 0.08em; color: var(--text-dim); }
.lp-in { background: var(--bg-panel-3); border: 1px solid var(--border); border-radius: 5px; padding: 7px 9px; color: var(--text-primary); font-family: inherit; font-size: 12px; outline: none; }
.lp-in:focus { border-color: #22d3ee; }
.lp-go { padding: 11px; background: rgba(34,211,238,0.14); border: 1.5px solid #22d3ee; border-radius: 7px; color: #cdf3fb; font-weight: 700; letter-spacing: 0.08em; cursor: pointer; transition: all 0.15s; }
.lp-go:hover:not(:disabled) { background: rgba(34,211,238,0.28); box-shadow: 0 0 14px rgba(34,211,238,0.4); }
.lp-go:disabled { opacity: 0.7; cursor: wait; }
.lp-res { display: flex; flex-direction: column; gap: 10px; }
.lp-note { font-size: 11px; color: var(--color-amber); background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); border-radius: 5px; padding: 7px 9px; line-height: 1.45; }
.lp-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 12px; }
.lp-stats > div { display: flex; flex-direction: column; gap: 1px; }
.lp-stats .wide { grid-column: 1 / -1; }
.lp-stats span { font-size: 8px; letter-spacing: 0.08em; color: var(--text-dim); }
.lp-stats b { font-size: 12px; color: var(--text-primary); }
.lp-stats b.ok { color: #34d399; }
.lp-stats b.bad { color: #f87171; }
.lp-legend { display: flex; gap: 14px; font-size: 9px; }
.lp-legend .o { color: #f59e0b; } .lp-legend .c { color: #22d3ee; } .lp-legend .v { color: #fff; }
.lp-best { background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.4); border-radius: 6px; padding: 8px 10px; font-size: 9px; letter-spacing: 0.08em; color: #6f8eae; }
.lp-best b { display: block; margin-top: 3px; font-size: 13px; color: #34d399; letter-spacing: 0; }
.lp-actions { display: flex; gap: 8px; }
.lp-sim { flex: 1; padding: 10px; background: rgba(245,158,11,0.16); border: 1.5px solid #f59e0b; border-radius: 7px; color: #ffe6bd; font-weight: 700; letter-spacing: 0.06em; cursor: pointer; transition: all 0.15s; }
.lp-sim:hover { background: rgba(245,158,11,0.3); box-shadow: 0 0 14px rgba(245,158,11,0.4); }
.lp-clear { padding: 10px 14px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 7px; color: var(--text-secondary); cursor: pointer; }
.lp-clear:hover { background: rgba(255,255,255,0.1); }
</style>

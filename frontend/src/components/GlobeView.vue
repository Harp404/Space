<template>
  <div class="globe-wrap">
    <div ref="cesiumContainer" class="cesium-container"></div>

    <!-- ===================== TOP-CENTRE STACK =====================
         The search field and the launch telemetry HUD both used to be
         absolutely positioned at left:50% with hard-coded top offsets of
         16px and 58px — so the moment a search returned results they drew
         straight through each other. They are now siblings in ONE centred
         flex column, which cannot overlap by construction. -->
    <div class="hud-top">
      <!-- Hidden while tracking: the top-left corner is the RETURN control in
           that mode, and on a narrow globe column a centred 380px search box
           reaches back far enough to sit on top of it. -->
      <div v-if="!trackedSat" class="sat-search">
        <span class="sat-search-icon" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.4" stroke="currentColor" stroke-width="1.3"/>
            <path d="M9.4 9.4L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </span>
        <input
          class="sat-search-input"
          v-model="searchQuery"
          placeholder="Search satellite name or NORAD ID…"
          aria-label="Search satellite name or NORAD ID"
          @keydown.enter="searchIsNorad && searchByNorad()"
        />
        <button v-if="searchQuery" class="sat-search-clear" title="Clear" @click="searchQuery = ''">×</button>
        <div v-if="searchQuery && (searchResults.length || searchIsNorad)" class="sat-search-results">
          <div v-for="r in searchResults" :key="r.id" class="sat-search-row" @click="selectResult(r)">
            <span class="ssr-name">{{ r.name }}</span>
            <span class="ssr-meta">NORAD {{ r.norad_id }} · {{ r.operator }}</span>
          </div>
          <div
            v-if="searchIsNorad && !searchResults.some(r => String(r.norad_id) === searchQuery.trim())"
            class="sat-search-row fetch"
            @click="searchByNorad"
          >
            {{ searchBusy ? 'fetching…' : `↗ fetch & track NORAD ${searchQuery.trim()}` }}
          </div>
        </div>
      </div>

      <!-- Launch telemetry HUD -->
      <div v-if="launchHud.active" class="launch-hud">
        <div class="lh-phase">{{ launchHud.phase }}</div>
        <div class="lh-stats">
          <div><span>SPEED</span><b>{{ launchHud.speed }}<i>km/s</i></b></div>
          <div><span>ALTITUDE</span><b>{{ launchHud.alt }}<i>km</i></b></div>
          <div><span>STATUS</span><b class="lh-eta">{{ launchHud.eta }}</b></div>
        </div>
      </div>
    </div>

    <!-- Filter tab + sliding panel (right edge). A pill, not a 40px circle:
         the label "FILTERS" is 46px wide and used to spill straight out of
         the round button it was nominally inside. -->

    <!-- MAP KEY — only while something painted is on screen -->
    <div v-if="zonesOnScreen || groundActive || globalGround" class="map-key">
      <div class="mk-title">MAP KEY</div>
      <template v-if="zonesOnScreen">
        <div class="mk-sec">STORM EXPOSURE — whole-latitude bands (that is the physics)</div>
        <div class="mk-row"><i class="mk-swatch" style="background:rgba(255,95,86,.55)"></i> HF blackout — polar caps, radio dead above 63°</div>
        <div class="mk-row"><i class="mk-swatch" style="background:rgba(76,199,106,.5)"></i> Auroral oval — GNSS degraded</div>
        <div class="mk-row"><i class="mk-swatch" style="background:rgba(224,163,46,.5)"></i> Scintillation belt — equatorial fading</div>
        <div class="mk-src">recorded NOAA conditions · boundaries derived from Kp</div>
      </template>
      <template v-if="groundActive || globalGround">
        <div class="mk-sec">{{ globalGround ? "GROUND — DINOv3 vision, whole scanned Earth" : "GROUND UNDER THE CORRIDOR — DINOv3 vision, 3.4 km" }}</div>
        <div class="mk-row"><i class="mk-swatch" style="background:rgba(235,90,70,.7)"></i> Built-up</div>
        <div class="mk-row"><i class="mk-swatch" style="background:rgba(64,140,220,.6)"></i> Water</div>
        <div class="mk-row"><i class="mk-swatch" style="background:rgba(90,170,90,.55)"></i> Sparse</div>
        <div class="mk-row"><i class="mk-swatch mk-hatch"></i> Model refuses to classify</div>
        <div class="mk-src">18.2M sub-cells · 90% held-out · validated vs GHS-POP</div>
      </template>
    </div>
    <!-- The descent chase-cam. Appears only while a corridor is on screen. -->
    <button v-if="hasDescent" class="follow-btn" :class="{ on: following }"
            @click="following ? stopFollowing() : followDescent()">
      {{ following ? '✕ STOP FOLLOWING' : '⏵ FOLLOW DESCENT' }}
    </button>
    <div v-if="approach" class="approach-hud mono">
      <template v-if="approach.error">
        <div class="ah-err">{{ approach.error }}</div>
      </template>
      <template v-else>
        <div class="ah-pair"><b class="a">{{ approach.aName }}</b> × <b class="b">{{ approach.bName }}</b></div>
        <div class="ah-range" :class="{ close: approach.range_km < 50 }">{{ approach.range_km }} km</div>
        <div class="ah-sub">{{ approach.done ? 'closest approach: ' + approach.min_range_km + ' km' : (approach.t_to_tca_s > 0 ? 'TCA in ' + approach.t_to_tca_s + ' s (sim)' : 'past TCA') }}</div>
        <div v-if="approach.verdict" class="ah-verdict" :class="'v-' + approach.verdict.toLowerCase()">
          GATE: {{ approach.verdict }}
        </div>
      </template>
      <button class="ah-x" @click="stopApproach">✕ EXIT</button>
    </div>
    <div v-if="descentHud" class="descent-hud mono">
      <div class="dh-row"><span>ALT</span><b>{{ descentHud.alt_km }} km</b></div>
      <div class="dh-row"><span>FLIGHT-PATH ANGLE</span><b>{{ descentHud.fpa_deg }}°</b></div>
      <div class="dh-row"><span>DOWNRANGE</span><b>{{ descentHud.downrange_km }} / {{ descentHud.span_km }} km</b></div>
      <div v-if="descentHud.entry" class="dh-row"><span>ENTRY INTERFACE</span><b>{{ descentHud.entry }}</b></div>
      <div v-if="descentHud.incl" class="dh-row"><span>INCLINATION</span><b>{{ descentHud.incl }}°</b></div>
      <div v-if="descentHud.bc" class="dh-row"><span>BALLISTIC COEFF</span><b>{{ descentHud.bc }} kg/m²</b></div>
      <div class="dh-bar"><i :style="{ width: descentHud.pct + '%' }"></i></div>
      <div class="dh-controls">
        <button :class="{ on: descentSpeed === 0.25 }" @click="descentSpeed = 0.25">¼×</button>
        <button :class="{ on: descentSpeed === 0 }" @click="descentSpeed = descentSpeed === 0 ? 1 : 0">{{ descentSpeed === 0 ? '⏵' : '⏸' }}</button>
        <button :class="{ on: descentSpeed === 1 }" @click="descentSpeed = 1">1×</button>
        <button :class="{ on: descentSpeed === 4 }" @click="descentSpeed = 4">4×</button>
      </div>
      <div class="dh-note">corridor & parameters: recorded event · motion: kinematic replay, not live telemetry</div>
    </div>

    <button class="filter-tab" :class="{ shifted: filterOpen }" :aria-expanded="filterOpen" @click="filterOpen = !filterOpen">
      <span class="filter-tab-icon" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M1 2.5h10M3 6h6M5 9.5h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="filter-tab-label">FILTERS</span>
    </button>
    <div class="filter-panel" :class="{ open: filterOpen }">
      <div class="fp-title">SATELLITE FILTERS</div>
      <label v-for="g in GROUPS" :key="g.key" class="fp-row">
        <input type="checkbox" v-model="enabled[g.key]" />
        <span class="fp-dot" :style="{ background: g.color }"></span>
        <span class="fp-label">{{ g.label }}</span>
        <span class="fp-count">{{ groupCounts[g.key] }}</span>
      </label>
      <div class="fp-sep"></div>
      <label class="fp-row danger">
        <input type="checkbox" v-model="dangerousOnly" />
        <span class="fp-label">⚠ Dangerous only</span>
        <span class="fp-count">≥70</span>
      </label>
      <div class="fp-sep"></div>
      <button class="fp-gpu" :disabled="gpuBusy" @click="runGpuScreen">
        {{ gpuBusy ? 'SCREENING…' : '⚡ GPU SCREEN — every pair, this machine' }}
      </button>
      <div v-if="gpuResult" class="fp-gpu-out mono">
        <template v-if="gpuResult.error"><span class="bad">{{ gpuResult.error }}</span></template>
        <template v-else-if="gpuResult.phase">{{ gpuResult.phase }}</template>
        <template v-else>
          <div><b>{{ gpuResult.objects.toLocaleString() }}</b> objects · <b>{{ gpuResult.pairs_checked.toLocaleString() }}</b> pairs</div>
          <div><b>{{ gpuResult.ms }} ms</b> — {{ (gpuResult.pairs_per_sec / 1e9).toFixed(2) }} B pair-checks/s on your GPU</div>
          <div><b>{{ gpuResult.candidates_found.toLocaleString() }}</b> candidates &lt; {{ gpuResult.threshold_km }} km in the next hour</div>
          <div class="fp-gpu-note">{{ gpuResult.honesty }}</div>
        </template>
      </div>
      <div class="fp-sep"></div>
      <label class="fp-row">
        <input type="checkbox" :checked="globalGround" @change="toggleGlobalGround" />
        <span class="fp-label">◼ DINOv3 ground layer</span>
        <span class="fp-count">18.2M cells</span>
      </label>
      <div v-if="globalGround" class="fp-hint">What the vision model sees: red built · blue water · green sparse · grey refused. 3.4 km grid, majority-voted for display.</div>
      <div class="fp-sep"></div>
      <label class="fp-row allobj">
        <input type="checkbox" v-model="showAll" />
        <span class="fp-label">🛰 Show all tracked objects</span>
        <span class="fp-count">{{ catalogueLoading ? '…' : (catalogueCount || '~31k') }}</span>
      </label>
      <div v-if="showAll" class="fp-hint">Live cloud of every active satellite + major debris fields.</div>
      <label v-if="showAll" class="fp-row models">
        <span class="fp-label">3D models (nearest)</span>
        <input class="fp-num" type="number" min="0" max="2000" step="25" v-model.number="NEAREST_MODELS" />
      </label>
      <div v-if="showAll" class="fp-hint">Higher = prettier but heavier. Past a few hundred it will choke.</div>
    </div>

    <button v-if="trackedSat" class="return-btn" @click="stopTracking">
      ◂ RETURN TO ORBIT VIEW
      <span class="return-sub">tracking {{ trackedSat.name }}</span>
    </button>

    <!-- Conjunctions sidebar — slides in from the LEFT (tab-triggered) -->
    <button v-if="!trackedSat" class="conj-tab" :class="{ shifted: conjOpen }" @click="conjOpen = !conjOpen">
      <span class="conj-tab-label">{{ conjOpen ? '◂' : '▸' }} CONJUNCTIONS</span>
    </button>
    <div v-if="!trackedSat" class="conj-panel" :class="{ open: conjOpen }">
      <div class="conj-head">
        PREDICTED CLOSE APPROACHES · NEXT 24h
        <button class="conj-refresh" :class="{ spin: conjBusy }" @click="runConjunctionScan" title="Refresh now">↻</button>
      </div>
      <div v-if="conjList.length" class="conj-list">
        <div v-for="c in conjList" :key="c.a + '-' + c.b" class="conj-row" :class="{ selected: selectedConj && selectedConj.id === c.id }" @click="selectConj(c)">
          <div class="conj-names">{{ shortName(c.aName) }} <span class="x">×</span> {{ shortName(c.bName) }}</div>
          <div class="conj-meta">
            <span class="conj-miss" :style="{ color: conjColor(c.missKm) }">{{ c.missKm.toFixed(2) }} km</span>
            <span>TCA {{ (nowTick, tcaCountdown(c.tcaMs)) }}</span>
            <span>{{ c.relVelKmS.toFixed(1) }} km/s</span>
          </div>
          <div class="conj-pc">Pc ≈ {{ fmtPc(c.pc) }}</div>
        </div>
        <div class="conj-foot">screening-grade · verify vs Space-Track / SOCRATES · auto-refresh</div>
      </div>
      <div v-else class="conj-empty">{{ conjBusy ? 'Loading predictions…' : 'No conjunctions in window.' }}</div>
    </div>

    <!-- ===================== BOTTOM-CENTRE STACK =====================
         Three separate floating groups (route detail, reroute actions,
         launch actions) used to be positioned independently at bottom:150px,
         bottom:96px and bottom:96px — so two of them landed on exactly the
         same pixels and the third sat 54px above. One centred column now
         owns the whole zone and stacks whatever happens to be live. -->
    <div class="hud-bottom">
      <!-- Clicked route detail -->
      <div v-if="selectedRoute" class="route-sel" :style="{ borderColor: selectedRoute.css }">
        <button class="rs-close" title="Dismiss" @click="clearRouteSelection">×</button>
        <div class="rs-sat" :style="{ color: selectedRoute.css }">{{ shortName(selectedRoute.sat) }}</div>
        <div class="rs-type">{{ selectedRoute.type }}</div>
        <div class="rs-sub">{{ selectedRoute.sub }}</div>
      </div>

      <div v-if="!trackedSat && selectedConj" class="reroute-actions">
        <button v-if="!planResult" class="reroute-btn2 primary" :disabled="planning" @click="planReroute">
          {{ planning ? 'PLANNING… screening 33k objects' : '⟳ PLAN OPTIMAL REROUTE' }}
        </button>
        <button class="reroute-btn2 back" @click="clearReroute">↩ BACK TO GLOBE</button>
      </div>

      <!-- Launch on-globe controls -->
      <div v-if="launchActive" class="reroute-actions">
        <button class="reroute-btn2 launch" @click="simulateLaunch">▶ SIMULATE LAUNCH</button>
        <button class="reroute-btn2 back" @click="exitLaunch">↩ EXIT LAUNCH</button>
      </div>
    </div>

    <!-- Reroute result card — its own corner, so it never fights the stack -->
    <template v-if="!trackedSat">
      <div v-if="planResult" class="reroute-card" :class="{ shifted: filterOpen }">
        <div class="rc-head">
          <span class="rc-title">✓ OPTIMAL REROUTE</span>
          <button class="rc-close" @click="clearReroute">×</button>
        </div>
        <div class="rc-stats">
          <div><span>MISS OPENS</span><b class="ok">{{ planResult.original_miss_km }} → {{ planResult.new_miss_km }} km</b></div>
          <div><span>TOTAL Δv</span><b>{{ planResult.total_delta_v_ms }} m/s</b></div>
          <div><span>SCREENED</span><b>{{ planResult.screened_objects }} / {{ planResult.catalogue_size }}</b></div>
          <div><span>VS 33K CATALOGUE</span><b :class="planResult.clear_vs_catalogue ? 'ok' : 'bad'">{{ planResult.clear_vs_catalogue ? 'CLEAR' : planResult.new_conjunctions.length + ' NEW' }}</b></div>
        </div>
        <div class="rc-mans">
          <div v-for="(m, i) in planResult.maneuvers" :key="i" class="rc-man">
            <span class="rc-sat">{{ m.sat }}</span>
            <span v-if="m.maneuverable" class="rc-act">change orbit <b>{{ m.orbit_shift_deg }}°</b> · {{ m.direction }} <b>{{ m.altitude_change_km }} km</b> · Δv {{ m.delta_v_ms }} m/s</span>
            <span v-else class="rc-deb">cannot maneuver — debris / rocket body</span>
          </div>
        </div>
        <div class="rc-legend">
          <span style="color:var(--color-red)">━ {{ shortName(planResult.sat1_name) }}</span>
          <span style="color:var(--color-amber)">━ {{ shortName(planResult.sat2_name) }}</span>
          <span style="color:var(--text-secondary)">┄ safer (dashed)</span>
        </div>
      </div>
    </template>

    <!-- Hover tooltip over a route line -->
    <div v-if="routeTip" class="route-tip" :style="{ left: routeTip.x + 14 + 'px', top: routeTip.y + 14 + 'px', borderColor: routeTip.css }">
      <div class="rt-sat" :style="{ color: routeTip.css }">{{ shortName(routeTip.sat) }}</div>
      <div class="rt-type">{{ routeTip.type }}</div>
    </div>

    <div v-if="trackInfo" class="sat-info">
      <div class="si-name">{{ trackInfo.name }}</div>
      <div class="si-sub">NORAD {{ trackInfo.norad }} · {{ trackInfo.operator }}</div>
      <div class="si-grid">
        <div><span>LAT</span>{{ trackInfo.lat.toFixed(2) }}°</div>
        <div><span>LON</span>{{ trackInfo.lon.toFixed(2) }}°</div>
        <div><span>ALT</span>{{ trackInfo.alt.toFixed(0) }} km</div>
        <div><span>SPEED</span>{{ trackInfo.speed.toFixed(2) }} km/s</div>
      </div>
      <div v-if="trackInfo.risk != null" class="si-risk" :class="riskClass(trackInfo.risk)">
        RISK INDEX {{ trackInfo.risk }}
      </div>
    </div>
  </div>
</template>

<script setup>
// ──────────────────────────────────────────────────────────────────────────
// AstroMesh globe — REBUILD v1
// Step 1: bare default CesiumJS earth. No custom imagery, no satellites yet.
// We add features back one at a time so any error is isolated, not guessed.
// The old full implementation is kept at GlobeView.backup.vue for reference.
// ──────────────────────────────────────────────────────────────────────────
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import * as Cesium from 'cesium'
import { exportStatesEci, loadGroupForNorads, loadByNorad, hasRealOrbit, realLatLng, loadCatalogue, loadFullCatalogue, ecefAt, gmstOf, periodMinutes, orbitEciKm, eciKmToEcefMeters } from '../lib/realOrbit.js'

/**
 * Resolve a CSS custom property to a concrete colour string.
 *
 * Cesium.Color.fromCssColorString cannot parse "var(--color-red)" — it needs a
 * literal. Rather than duplicate the palette in JavaScript and let the two
 * drift, we read it back out of the document, so :root in App.vue stays the
 * single source of truth for every colour in the product.
 */
const _cssVarCache = new Map()
function cssVar(name, fallback = '#ffffff') {
  if (_cssVarCache.has(name)) return _cssVarCache.get(name)
  let v = fallback
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (raw) v = raw
  } catch { /* SSR or detached document — fallback stands */ }
  _cssVarCache.set(name, v)
  return v
}

// Same props/emits as the old component so App.vue needs no changes.
const props = defineProps({
  satellites: { type: Array, default: () => [] },
  conjunctions: { type: Array, default: () => [] },
  plan: { type: Object, default: null },   // active avoidance plan (orbits to draw)
  launchPlan: { type: Object, default: null },  // active launch trajectory to draw + animate
  spaceWeather: { type: Object, default: null }, // NOAA conditions + derived exposure zones
  deorbit: { type: Object, default: null },      // active deorbit plan: corridor + footprint
})

const emit = defineEmits(['satellite-click', 'reroute-planned', 'launch-clear', 'ready'])
const cesiumContainer = ref(null)
const trackedSat = ref(null)   // the satellite the camera is currently following
const trackInfo = ref(null)    // live readout (lat/lon/alt/speed) for the tracked sat
let viewer = null
let placeLabelLayer = null    // Ion place-name overlay; off by default
let clickHandler = null
let infoTimer = null

onMounted(() => {
  Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN

  viewer = new Cesium.Viewer(cesiumContainer.value, {
    // Highest-quality global imagery on Cesium Ion (Oct 2025): Google Maps 2D
    // Satellite (asset 3830182). Sharper than the old Bing Aerial default.
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.IonImageryProvider.fromAssetId(3830182)
    ),
    // Strip the default widgets — we want a clean canvas.
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  })

  // Hide the Cesium Ion credit watermark logo (keep attribution text only).
  viewer.cesiumWidget.creditContainer.style.display = 'none'

  // Tell the app the globe is up after the first frame renders → hide boot loader.
  const onFirstRender = () => { emit('ready'); viewer.scene.postRender.removeEventListener(onFirstRender) }
  viewer.scene.postRender.addEventListener(onFirstRender)

  const scene = viewer.scene
  const globe = scene.globe

  // Single-frustum logarithmic depth: handles the huge near→far range (metres to
  // the distant sun) without the multi-frustum boundary flicker you get with it
  // off — that boundary landed on the satellites and made the view jitter.
  scene.logarithmicDepthBuffer = true

  // ── Atmosphere ("and stuff") ────────────────────────────────────────────
  // Keep the blue glow limb (sky atmosphere) but turn OFF the ground
  // atmosphere — from far away it adds a whitish haze that washes out the
  // crisp surface. Sky atmosphere alone gives the nice edge glow.
  scene.skyAtmosphere.show = true
  globe.showGroundAtmosphere = false
  // A deeper, cooler limb. The reference look is a dark planet with one bright
  // rim of scattered light, so push intensity up and pull the hue toward blue
  // rather than the default cyan-white wash.
  scene.skyAtmosphere.atmosphereLightIntensity = 20.0
  scene.skyAtmosphere.hueShift = -0.02
  scene.skyAtmosphere.saturationShift = 0.18
  scene.skyAtmosphere.brightnessShift = -0.05
  // Slightly darken the daylit surface so the limb glow and the city lights
  // read against it instead of competing with a bright blue disc.
  globe.nightFadeInDistance = 1.0e7
  globe.nightFadeOutDistance = 1.0e7
  // HDR OFF. Cesium's tone-mapper clips each colour channel independently, and
  // the Black Marble night layer added below sits right at the top of its
  // range — which turned dense city lights into yellow/cyan/magenta blobs.
  // With HDR off the night side renders in true colour.
  if (scene.highDynamicRange !== undefined) scene.highDynamicRange = false

  // ── Real-time day / night ───────────────────────────────────────────────
  // Shade the globe by the ACTUAL current sun position — the day/night
  // terminator is real and live (driven by the clock = now).
  globe.enableLighting = true
  // Pin the clock to the REAL current time, advancing at real 1× speed, so the
  // sun position — and therefore the day/night terminator — is genuinely live.
  viewer.clock.currentTime = Cesium.JulianDate.now()
  viewer.clock.multiplier = 1
  viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK   // tick = wall clock
  viewer.clock.shouldAnimate = true

  // NASA "Earth at Night" (Black Marble, Ion asset 3812) on the dark side only.
  //
  // WHY THE SETTINGS ARE NEUTRAL: this used to run brightness 2.4 / contrast
  // 1.5. Composited under `scene.highDynamicRange` (disabled just above) the
  // tone-mapper clipped each colour channel independently, so dense city
  // regions came out as flat yellow, cyan and magenta blobs floating over an
  // otherwise invisible night side. Softening those numbers alone did NOT fix
  // it — the false colour came from the HDR composite. With HDR off the layer
  // can be left essentially untouched and the lights render as lights.
  const nightLayer = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.IonImageryProvider.fromAssetId(3812)
  )
  // With HDR off there is headroom to lift the lights again — the old 2.4 only
  // blew out because the tone-mapper was clipping on top of it.
  nightLayer.dayAlpha = 0.0     // FULLY invisible on the daylit side
  nightLayer.nightAlpha = 1.0   // full city lights on the dark side
  nightLayer.contrast = 1.25    // dark ocean stays dark so the lights separate

  // ── Why brightness is a FUNCTION of zoom ────────────────────────────────
  // City lights are SPARSE: a few brilliant pixels surrounded by black. When
  // the camera pulls back, Cesium serves a coarser tile level and each texel
  // becomes the AVERAGE of a large area — so a city's handful of bright pixels
  // gets averaged against all the darkness around it and the whole continent
  // fades out. That is why the lights looked fine up close and dim from orbit:
  // it is the mip-level average, not the brightness setting.
  //
  // So we pay the averaging back: brighten as the camera pulls away, and taper
  // to neutral once real pixels are on screen.
  //
  // DO NOT assign a function here. ImageryLayer's .d.ts still documents
  // `brightness` as `number | function(frameState, layer, x, y, level)`, but as
  // of Cesium 1.142 the globe surface shader reads `imageryLayer.brightness`
  // STRAIGHT into a float uniform (`dayTextureBrightness`) and never calls it.
  // A function lands in the uniform as NaN and blacks out every tile on the
  // planet — base imagery included — with no console error to explain it.
  // Driving a plain number off the camera height does the same job safely.
  const NIGHT_NEAR = 1.7        // close in, real pixels — leave them alone
  const NIGHT_FAR = 3.6         // whole-Earth view — undo the mip averaging
  const H_NEAR = 1.5e6          // ≤1500 km up: detail is real
  const H_FAR = 1.8e7           // ≥18000 km up: fully averaged
  let lastNightBrightness = -1
  scene.preRender.addEventListener(() => {
    const h = viewer.camera.positionCartographic.height
    const t = Cesium.Math.clamp((h - H_NEAR) / (H_FAR - H_NEAR), 0.0, 1.0)
    const b = NIGHT_NEAR + (NIGHT_FAR - NIGHT_NEAR) * t
    // Only write on a meaningful change — the setter dirties layer state.
    if (Math.abs(b - lastNightBrightness) > 0.01) {
      lastNightBrightness = b
      nightLayer.brightness = b
    }
  })
  viewer.imageryLayers.add(nightLayer)

  // ── Realistic sun ─────────────────────────────────────────────────────────
  // Hide Cesium's flat spiky sun billboard and draw our own: a warm radial
  // orb (white-hot core → orange → red) placed at the REAL sun direction, made
  // to glow with bloom. Looks like a real star, not an old-game sprite.
  scene.sun.show = false
  const bloom = scene.postProcessStages.bloom
  bloom.enabled = true
  bloom.uniforms.glowOnly = false
  // Only the VERY brightest pixels (the sun) bloom — not surface/city features.
  // brightness was -0.85, which still let clipped city-light patches through;
  // -0.95 puts the threshold above anything on the surface, so the only thing
  // in the scene that glows is the star.
  bloom.uniforms.contrast = 255
  bloom.uniforms.brightness = -0.95
  bloom.uniforms.delta = 1.0
  bloom.uniforms.sigma = 2.0      // tighter halo — was 3.0
  bloom.uniforms.stepSize = 1.0
  addRealisticSun()

  // ── Clouds ──────────────────────────────────────────────────────────────
  // LIVE clouds from OpenWeatherMap (transparent tiles, refreshed ~hourly) if
  // an API key is set; otherwise fall back to the static 4K cloud texture.
  addCloudLayer()

  // ── Place labels ──────────────────────────────────────────────────────────
  // Google "Labels Only" (Ion 3830185): transparent place-name overlay that
  // shows country names when zoomed out and progressively reveals cities/towns
  // as you zoom in — auto-sized and readable. Sits on top of everything.
  const labels = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.IonImageryProvider.fromAssetId(3830185)
  )
  labels.show = false          // the planet is the subject, not a road atlas
  viewer.imageryLayers.add(labels)
  placeLabelLayer = labels

  // ── Idle auto-spin ──────────────────────────────────────────────────────
  // Slowly rotate the globe when the user isn't touching it. Pauses for 3 s
  // after any interaction (drag / zoom), and stays paused while zoomed in
  // closer than MIN_SPIN_HEIGHT so it never fights you up close.
  // Only ZOOM (scroll wheel) pauses the spin for a moment. Dragging to rotate
  // is in the same spirit as the auto-spin, so we let it keep spinning.
  const markInteract = () => { lastInteract = performance.now() }
  scene.canvas.addEventListener('wheel', markInteract, { passive: true })
  scene.postRender.addEventListener(() => {
    // integrate playback (runs whether or not the camera follows)
    if (descentAt) {
      const nowMs = performance.now()
      descentProgress = (descentProgress + ((nowMs - descentLastTick) / DESCENT_BASE_MS) * descentSpeed.value) % 1
      descentLastTick = nowMs
    }
    // the conjunction moment owns the camera while it plays
    if (apPlay && apPlay.camTick) { apPlay.camTick(); return }
    // chase camera: behind and above the descending stage, every frame
    if (following.value && descentAt) {
      const t = descentProgress
      const pos = descentAt(t)
      const ahead = descentAt(Math.min(0.999, t + 0.01))
      const dir = Cesium.Cartesian3.subtract(ahead, pos, new Cesium.Cartesian3())
      const heading = Math.atan2(dir.y, dir.x)
      viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(heading, -0.42, 520000))
      return   // the chase owns the camera; nothing else may move it this frame
    }
    // Never spin while following a satellite — checked from the click instant
    // (trackedSat) AND during fly-in, so the spin can't fight the flyTo camera.
    if (trackedSat.value || viewer.trackedEntity || following.value || apPlay) return
    if (performance.now() - lastInteract < SPIN_RESUME_MS) return
    if (scene.camera.positionCartographic.height < MIN_SPIN_HEIGHT) return
    scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, SPIN_RATE)
  })

  // ── Click a satellite → fly in + follow it ────────────────────────────────
  clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas)
  clickHandler.setInputAction((click) => {
    const picked = scene.pick(click.position)
    const id = picked && picked.id
    if (id && id._routeMeta) { selectRoute(id); return }            // a reroute orbit line
    if (id && id._conjMeta) { selectConj(id._conjMeta); return }    // a conjunction dot
    if (id && id._satData) { trackSat(id._satData); return }       // curated satellite
    if (id && id._catNorad) { trackCatalogueObject(id._catNorad, id._catName); return }  // a cloud MODEL
    if (id && id._catalogue) { trackCatalogueObject(id.norad, id.name); return }  // a cloud point
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // Hover over a reroute line → tooltip only (DOM). We do NOT change polyline
  // geometry on hover — rewriting width rebuilds the line and makes it flicker as
  // the thin-line pick toggles hit/miss while the cursor moves.
  clickHandler.setInputAction((m) => {
    const picked = scene.pick(m.endPosition)
    const idp = picked && picked.id
    if (idp && idp._routeMeta) { routeTip.value = { x: m.endPosition.x, y: m.endPosition.y, ...idp._routeMeta }; scene.canvas.style.cursor = 'pointer' }
    else if (idp && idp._conjMeta) { const c = idp._conjMeta; routeTip.value = { x: m.endPosition.x, y: m.endPosition.y, sat: `${shortName(c.aName)} × ${shortName(c.bName)}`, type: 'CONJUNCTION', sub: `${c.missKm.toFixed(2)} km`, css: cssVar('--color-purple') }; scene.canvas.style.cursor = 'pointer' }
    else if (idp && idp.name) {
      // Generic fallback: anything painted with a name — storm bands, ground
      // stations, the corridor, the impact scatter — explains itself on hover.
      // Painted regions with no hover read as decoration, and decoration is
      // exactly what they are not.
      const desc = typeof idp.description?.getValue === 'function'
        ? idp.description.getValue(viewer.clock.currentTime) : (idp.description || '')
      routeTip.value = {
        x: m.endPosition.x, y: m.endPosition.y,
        sat: idp.name, type: 'LAYER',
        sub: String(desc).replace(/<[^>]*>/g, '').slice(0, 120),
        css: cssVar('--text-secondary'),
      }
      scene.canvas.style.cursor = 'help'
    }
    else { routeTip.value = null; scene.canvas.style.cursor = '' }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

  // Hidden camera-target point: the camera tracks THIS (a clean centred point at
  // a damped position), not the model — so the handoff has no off-centre snap and
  // per-frame satellite jitter is filtered out of the camera.
  camFallbackPos = new Cesium.CallbackPositionProperty(
    () => (smoothPos ? smoothPos.clone() : CAM_TARGET_FALLBACK), false)
  camTargetEntity = viewer.entities.add({
    position: camFallbackPos,
    point: { pixelSize: 1, color: Cesium.Color.TRANSPARENT },
    // Always track in the VELOCITY frame (not Cesium's AUTODETECT, which flips
    // to a north-up frame for high orbits → caused the "weird angle" jump). Now
    // our computed fly-in pose always matches the tracker's frame.
    trackingReferenceFrame: Cesium.TrackingReferenceFrame.VELOCITY,
  })

  // Per frame: damp the camera target toward the real satellite (filters jitter).
  scene.postRender.addEventListener(() => {
    // integrate playback (runs whether or not the camera follows)
    if (descentAt) {
      const nowMs = performance.now()
      descentProgress = (descentProgress + ((nowMs - descentLastTick) / DESCENT_BASE_MS) * descentSpeed.value) % 1
      descentLastTick = nowMs
    }
    // the conjunction moment owns the camera while it plays
    if (apPlay && apPlay.camTick) { apPlay.camTick(); return }
    // chase camera: behind and above the descending stage, every frame
    if (following.value && descentAt) {
      const t = descentProgress
      const pos = descentAt(t)
      const ahead = descentAt(Math.min(0.999, t + 0.01))
      const dir = Cesium.Cartesian3.subtract(ahead, pos, new Cesium.Cartesian3())
      const heading = Math.atan2(dir.y, dir.x)
      viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(heading, -0.42, 520000))
      return   // the chase owns the camera; nothing else may move it this frame
    }
    if (!trackedReal || !smoothPos) return
    // Read the tracked object's position via ecefAt (same proven path that
    // moves the cloud) so the follow can't freeze on cloud/catalogue objects.
    let real
    const nid = trackedSat.value && trackedSat.value.norad_id
    if (nid && hasRealOrbit(nid)) {
      const e = ecefAt(nid, Cesium.JulianDate.toDate(viewer.clock.currentTime))
      if (e) real = new Cesium.Cartesian3(e.x, e.y, e.z)
    }
    if (!real) real = trackedReal.position.getValue(viewer.clock.currentTime)
    if (real) Cesium.Cartesian3.lerp(smoothPos, real, 0.12, smoothPos)
  })

  // ── Satellites ────────────────────────────────────────────────────────────
  // Make the clock run so SGP4 positions advance in real time.
  viewer.clock.shouldAnimate = true
  // Build dots for whatever satellites we already have, and react to updates.
  if (props.satellites.length) buildSats()

  nowTickTimer = setInterval(() => { nowTick.value++ }, 1000)   // live TCA countdowns
})

// Auto-spin tuning.
const SPIN_RATE = 0.0004        // radians/frame (~1.4°/s) — gentle
const SPIN_RESUME_MS = 2500     // resume ~2.5 s after the last interaction
// No spin when zoomed closer than this. The full-globe view is ~6000 km up, so
// this must be lower than that or it never spins at the normal view. At 3000 km
// it keeps spinning out far and stops once you zoom in to a region.
const MIN_SPIN_HEIGHT = 3_000_000  // metres (3000 km)
let lastInteract = 0

// OWM serves transparent cloud tiles (white/grey clouds, clear elsewhere) that
// sit cleanly over the satellite base. Data updates every few hours, so we
// reload the layer once an hour — not per-frame (that would waste the quota).
// Cloud source: static 4K texture looks cleaner/crisper and is bulletproof for
// demos. Flip USE_LIVE_CLOUDS to true to stream live OpenWeatherMap clouds.
const USE_LIVE_CLOUDS = false
const OWM_KEY = import.meta.env.VITE_OWM_KEY
let cloudLayer = null

function staticCloudProvider() {
  return new Cesium.SingleTileImageryProvider({
    url: '/textures/clouds4k.png',
    tileWidth: 4096,
    tileHeight: 2048,
  })
}

function addStaticClouds() {
  const layer = viewer.imageryLayers.addImageryProvider(staticCloudProvider())
  layer.dayAlpha = 0.85    // normal clouds on the daylit side
  layer.nightAlpha = 0.12  // nearly gone at night so it doesn't brighten the dark
  layer.brightness = 1.1
  if (cloudLayer) viewer.imageryLayers.remove(cloudLayer, true)
  cloudLayer = layer
}

function addCloudLayer() {
  if (!USE_LIVE_CLOUDS || !OWM_KEY) { addStaticClouds(); return }

  // Try LIVE OpenWeatherMap clouds. If the tiles error (e.g. key not yet
  // active), fall back to the static cloud map automatically.
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`,
    maximumLevel: 9,
    credit: 'Clouds © OpenWeatherMap',
  })
  let fellBack = false
  provider.errorEvent.addEventListener(() => {
    if (fellBack) return
    fellBack = true
    addStaticClouds()           // OWM failed → show static instead
  })

  const layer = viewer.imageryLayers.addImageryProvider(provider)
  layer.dayAlpha = 0.5        // let the crisp surface show through (realistic)
  layer.nightAlpha = 0.1      // clouds nearly gone at night (don't brighten dark)
  layer.brightness = 1.3      // brighten clouds so they read white, not grey
  layer.contrast = 1.25       // drop faint grey haze, keep only real clouds
  if (cloudLayer) viewer.imageryLayers.remove(cloudLayer, true)
  cloudLayer = layer

  if (cloudTimer) clearInterval(cloudTimer)
  cloudTimer = setInterval(addCloudLayer, 60 * 60 * 1000)  // hourly refresh
}
let cloudTimer = null

// ── Realistic sun ───────────────────────────────────────────────────────────
// A canvas radial gradient: brilliant white core → warm yellow → orange → deep
// red, fading to transparent. Reads like a real sun photographed from space.
function createSunTexture() {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0.00, 'rgba(255,255,255,1.0)')
  g.addColorStop(0.12, 'rgba(255,250,235,1.0)')
  g.addColorStop(0.30, 'rgba(255,214,140,0.95)')
  g.addColorStop(0.52, 'rgba(255,150,70,0.65)')
  g.addColorStop(0.74, 'rgba(255,90,40,0.28)')
  g.addColorStop(1.00, 'rgba(255,70,30,0.0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return c
}

// The sun's real direction from Earth's centre at a given time. We place the
// billboard a fixed distance along that direction so the globe can occlude it.
const sunIcrf = new Cesium.Cartesian3()
const sunMat = new Cesium.Matrix3()
function sunFixedPosition(time) {
  Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time, sunIcrf)
  let m = Cesium.Transforms.computeIcrfToFixedMatrix(time, sunMat)
  if (!Cesium.defined(m)) m = Cesium.Transforms.computeTemeToPseudoFixedMatrix(time, sunMat)
  const fixed = Cesium.Matrix3.multiplyByVector(m, sunIcrf, new Cesium.Cartesian3())
  const dir = Cesium.Cartesian3.normalize(fixed, fixed)
  return Cesium.Cartesian3.multiplyByScalar(dir, 3.0e8, dir)  // far enough to look distant, globe occludes
}

// Surface glow baked into the sun model: brighten the texture (emissive) and add
// a hot fresnel rim so the edges glow like a real sun's limb, not a flat ball.
const SUN_SHADER = new Cesium.CustomShader({
  lightingModel: Cesium.LightingModel.UNLIT,
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec3 base = material.diffuse;
      vec3 viewDir = normalize(-fsInput.attributes.positionEC);
      vec3 normal  = normalize(fsInput.attributes.normalEC);
      float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 2.2);
      vec3 rim = vec3(1.0, 0.55, 0.15) * fresnel * 2.2;   // hot orange limb
      vec3 glow = base * 1.7 + rim;                        // brighten + rim
      material.diffuse = glow;
      material.emissive = glow;
    }
  `,
})

function addRealisticSun() {
  const sunPos = new Cesium.CallbackPositionProperty((time) => sunFixedPosition(time), false)

  // 1) Soft warm corona BEHIND the model so light appears to radiate from it.
  viewer.entities.add({
    position: sunPos,
    billboard: {
      image: createSunTexture(),
      width: 360,
      height: 360,
      sizeInMeters: false,
      blendOption: Cesium.BlendOption.TRANSLUCENT,
    },
  })

  // 2) The user's glTF sun on top. UNLIT (it IS the light, never shaded),
  //    animations OFF (the model has a baked spin we don't want), orientation
  //    locked so it doesn't tumble as it tracks the real sun direction.
  viewer.entities.add({
    position: sunPos,
    orientation: new Cesium.ConstantProperty(Cesium.Quaternion.IDENTITY),
    model: {
      uri: '/models/sun/scene.gltf',
      minimumPixelSize: 150,
      maximumScale: 2.0e8,
      scale: 1.0e6,
      runAnimations: false,
      customShader: SUN_SHADER,
    },
  })
}

// ── Satellite dots ──────────────────────────────────────────────────────────
// One Cesium point entity per satellite. Its position is a CallbackPosition
// Property that runs SGP4 every frame from the real CelesTrak TLE, so the dot
// moves along the true orbit in real time. Colour encodes collision risk.
const satEntities = new Map()   // sat.id → Cesium.Entity
const liveSat = new Map()        // sat.id → latest gateway record (lat/lon/alt)
let tleLoaded = false
// Camera tracking (backup approach): the camera tracks a hidden CLEAN point whose
// position is `smoothPos` — a damped position trailing the real satellite. Tracking
// a damped centered point (not the off-centre model) removes the per-frame jitter.
let camTargetEntity = null
let camFallbackPos = null        // the CallbackPositionProperty used when not tracking
let smoothPos = null            // damped position trailing the tracked satellite
let trackedReal = null          // the real satellite entity being followed
const CAM_TARGET_FALLBACK = Cesium.Cartesian3.fromDegrees(0, 0, 40_000_000)

// Camera offset used both for the fly-in target AND while tracking, so the
// fly-in lands EXACTLY where tracking begins (no side-snap at handoff).
// Stable far-ish tracking distance (no close-range SGP4/Cesium position jitter).
// Models are size-normalised (NORM_TARGET) so every object frames the same here.
const TRACK_VIEW_FROM = new Cesium.Cartesian3(0, -550_000, 300_000)

// Constant offset (models are size-normalised) → every clicked object frames the same.
function viewFromFor() { return TRACK_VIEW_FROM.clone() }

// The exact camera pose Cesium's tracker will impose: it builds the frame from
// position + velocity (rotationMatrixFromPositionVelocity: x=velocity, y=right,
// z=up) and places the camera at frame·viewFrom looking at the object. We fly
// the camera to that same pose so the handoff is seamless. null if no velocity.
function trackingPose(sat, leadMs = 0) {
  const nid = sat.norad_id
  if (!nid || !hasRealOrbit(nid)) return null
  // Aim at where the object WILL be after leadMs (the fly-in duration) so the
  // camera and the tracker agree at the handoff instant → no snap.
  const jd = new Date(Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime() + leadMs)
  const e0 = ecefAt(nid, jd)
  const ep = ecefAt(nid, new Date(jd.getTime() + 2000))
  const em = ecefAt(nid, new Date(jd.getTime() - 2000))
  if (!e0 || !ep || !em) return null
  const pos = new Cesium.Cartesian3(e0.x, e0.y, e0.z)
  let vel = new Cesium.Cartesian3((ep.x - em.x) / 4, (ep.y - em.y) / 4, (ep.z - em.z) / 4)
  if (Cesium.Cartesian3.magnitude(vel) < 1) return null
  vel = Cesium.Cartesian3.normalize(vel, vel)
  const rot = Cesium.Transforms.rotationMatrixFromPositionVelocity(pos, vel, Cesium.Ellipsoid.WGS84, new Cesium.Matrix3())
  const off = Cesium.Matrix3.multiplyByVector(rot, TRACK_VIEW_FROM, new Cesium.Cartesian3())
  const dest = Cesium.Cartesian3.add(pos, off, new Cesium.Cartesian3())
  const dir = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(pos, dest, new Cesium.Cartesian3()), new Cesium.Cartesian3())
  const up = Cesium.Matrix3.getColumn(rot, 2, new Cesium.Cartesian3())
  return { dest, dir, up }
}

// The exact tracking pose, computed from the SampledPositionProperty the
// tracker will use (so the fly-in lands precisely where tracking begins).
function poseFromProp(prop, leadMs, viewFrom) {
  const now = viewer.clock.currentTime
  const tH = Cesium.JulianDate.addSeconds(now, leadMs / 1000, new Cesium.JulianDate())
  const pos = prop.getValue(tH, new Cesium.Cartesian3())
  const pp = prop.getValue(Cesium.JulianDate.addSeconds(tH, 2, new Cesium.JulianDate()), new Cesium.Cartesian3())
  const pm = prop.getValue(Cesium.JulianDate.addSeconds(tH, -2, new Cesium.JulianDate()), new Cesium.Cartesian3())
  if (!pos || !pp || !pm) return null
  let vel = Cesium.Cartesian3.subtract(pp, pm, new Cesium.Cartesian3())
  if (Cesium.Cartesian3.magnitude(vel) < 1) return null
  vel = Cesium.Cartesian3.normalize(vel, vel)
  const rot = Cesium.Transforms.rotationMatrixFromPositionVelocity(pos, vel, Cesium.Ellipsoid.WGS84, new Cesium.Matrix3())
  const off = Cesium.Matrix3.multiplyByVector(rot, viewFrom, new Cesium.Cartesian3())
  const dest = Cesium.Cartesian3.add(pos, off, new Cesium.Cartesian3())
  const dir = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(pos, dest, new Cesium.Cartesian3()), new Cesium.Cartesian3())
  const up = Cesium.Matrix3.getColumn(rot, 2, new Cesium.Cartesian3())
  return { dest, dir, up }
}

// Time-interpolated orbit samples for SMOOTH camera tracking. Cesium's
// EntityView interpolates these (and uses the VVLH frame for fast objects),
// which is far steadier than a per-frame lerp that wobbles when FPS varies.
function buildSampledOrbit(norad) {
  const prop = new Cesium.SampledPositionProperty()
  prop.setInterpolationOptions({
    interpolationDegree: 5,
    interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
  })
  const now = viewer.clock.currentTime
  const periodMin = periodMinutes(norad) || 95
  const totalS = periodMin * 60 * 2          // ~2 orbits of samples
  const stepS = Math.max(4, totalS / 360)
  for (let s = -2 * stepS; s <= totalS; s += stepS) {
    const t = Cesium.JulianDate.addSeconds(now, s, new Cesium.JulianDate())
    const e = ecefAt(norad, Cesium.JulianDate.toDate(t))
    if (e) prop.addSample(t, new Cesium.Cartesian3(e.x, e.y, e.z))
  }
  return prop
}

// Map a 0-100 risk score to a colour (green → amber → red).
function riskColor(score) {
  if (score >= 70) return Cesium.Color.fromCssColorString(cssVar('--color-red'))   // high
  if (score >= 40) return Cesium.Color.fromCssColorString(cssVar('--color-amber'))   // medium
  return Cesium.Color.fromCssColorString('#39d98a')                     // low
}

// Position of a satellite at a Cesium time. Prefer REAL SGP4 (from CelesTrak
// TLE); fall back to the gateway's live lat/lon/alt so every satellite always
// shows and moves, then auto-upgrades to the true orbit once its TLE loads.
function satPosition(sat, time) {
  // Use ecefAt — the SAME position path the tracking camera follows — so the model
  // and camera agree exactly (no front/back oscillation when zoomed in close).
  if (hasRealOrbit(sat.norad_id)) {
    const e = ecefAt(sat.norad_id, Cesium.JulianDate.toDate(time))
    if (e) return new Cesium.Cartesian3(e.x, e.y, e.z)
  }
  const s = liveSat.get(sat.id) || sat
  if (typeof s.lat === 'number' && typeof s.lon === 'number') {
    return Cesium.Cartesian3.fromDegrees(s.lon, s.lat, (s.alt_km || 500) * 1000)
  }
  return undefined
}

// Pick the 3D model for a satellite by its type. Falls back to the existing
// generic payload model (which also serves imaging/EO sats).
const GENERIC_MODEL = '/models/types/payload.glb'
// Special models for iconic objects (drop the .glb at the path to activate).
const SPECIAL_MODELS = { 25544: '/models/special/25544.glb', 20580: '/models/special/20580.glb' }
const HAVE_SPECIAL = { 25544: true, 20580: true }  // confirmed present (async check below refines)

// Models come in wildly different native sizes — normalise each to one world size
// so a tracked object always frames consistently (measured max-dimension per file).
const MODEL_DIM = {
  '/models/types/payload.glb': 13.08, '/models/types/comms.glb': 6.42, '/models/types/debris.glb': 7.19,
  '/models/types/rocket_body.glb': 4.92, '/models/types/station.glb': 14,
  '/models/special/starlink.glb': 6.42, '/models/special/25544.glb': 111.99, '/models/special/20580.glb': 525.49,
}
const NORM_TARGET = 150_000     // every model rendered ≈ 150 km — framed well at the tracking distance, never gigantic
function normScale(uri) { const d = MODEL_DIM[uri]; return d ? NORM_TARGET / d : 1 }
function modelByNorad(norad) { return HAVE_SPECIAL[norad] ? SPECIAL_MODELS[norad] : null }
function isRocketBody(name) { return /R\/B|ROCKET BODY|ROCKET BOOSTER|\bAKM\b|\bPKM\b/i.test(name || '') }
function modelForSat(sat) {
  const sp = modelByNorad(sat.norad_id); if (sp) return sp
  if (isRocketBody(sat.name)) return '/models/types/rocket_body.glb'
  switch (groupOf(sat)) {
    case 'stations': return HAVE_SPECIAL[25544] ? '/models/special/25544.glb' : '/models/types/station.glb'
    case 'starlink':
    case 'oneweb':   return '/models/types/comms.glb'
    case 'debris':   return '/models/types/debris.glb'
    default:         return GENERIC_MODEL   // imaging / other payloads
  }
}
// Confirm which special models actually exist. The dev server returns index.html
// (200) for missing files, so verify the real glTF magic bytes ("glTF"), not status.
;(async () => {
  for (const [norad, url] of Object.entries(SPECIAL_MODELS)) {
    try {
      const r = await fetch(url); if (!r.ok) continue
      const m = new Uint8Array((await r.arrayBuffer()).slice(0, 4))
      if (m[0] === 0x67 && m[1] === 0x6c && m[2] === 0x54 && m[3] === 0x46) HAVE_SPECIAL[norad] = true
    } catch { /* missing */ }
  }
})()

function makeSatEntity(sat) {
  const posProp = new Cesium.CallbackPositionProperty(
    (time) => satPosition(sat, time), false)
  const isAlert = sat.risk_score >= 70
  // Catalogue objects: size from real RCS class (proportional). Seeds: fixed.
  const catSz = sat._catalogue ? modelSizeFor(sat.norad_id, groupOf(sat) === 'debris') : null
  const entity = viewer.entities.add({
    position: posProp,
    // Real 3D satellite model, chosen by type — shown only within ~2500 km.
    // Catalogue objects match the cloud model size so clicking doesn't resize it.
    model: {
      uri: (() => { const u = modelForSat(sat); sat._modelUri = u; return u })(),
      minimumPixelSize: catSz ? catSz.minPix : (isAlert ? 42 : 34),
      maximumScale: catSz ? catSz.maxScale : 60000,
      scale: normScale(sat._modelUri),
      colorBlendMode: Cesium.ColorBlendMode.HIGHLIGHT,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 2_500_000),
    },
    // Risk-coloured dot — shown only when FARTHER than ~2500 km. Mutually
    // exclusive with the model so the two never overlap and z-fight (the flicker).
    point: {
      pixelSize: isAlert ? 7 : 5,
      color: riskColor(sat.risk_score),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1,
      // Depth-tested (no disableDepthTestDistance) → globe occludes far-side dots.
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2_500_000, 1.0e10),
    },
  })
  entity._satData = sat
  satEntities.set(sat.id, entity)
}

// CelesTrak GROUPs that collectively cover our seed satellites. One request
// each (cached 6 h) — rate-limit safe. Any seed not in a group simply keeps its
// gateway position. Loaded sequentially so we never burst CelesTrak.
const SEED_GROUPS = [
  'stations', 'starlink', 'oneweb',
  'cosmos-2251-debris', 'iridium-33-debris', '1999-025', 'cosmos-1408-debris',
  'resource', 'goes',
]

// Build dots/models immediately from gateway data, then load real TLEs in the
// background so each satellite upgrades to its true SGP4 orbit when ready.
async function buildSats() {
  if (tleLoaded) return
  tleLoaded = true
  for (const sat of props.satellites) {
    liveSat.set(sat.id, sat)
    if (!satEntities.has(sat.id)) makeSatEntity(sat)
  }
  applyFilters()
  // PRIMARY orbit source: the full Space-Track catalogue served by our own
  // gateway (/api/catalogue). It registers an SGP4 satrec for every object —
  // including all curated NORADs — so satellites move immediately. This works
  // in production where the public CelesTrak endpoint is blocked/unreachable.
  await ensureCatalogue()
  // FALLBACK only for any seed sat the catalogue somehow missed: try CelesTrak
  // (gracefully no-ops in production where the proxy is blocked).
  for (const group of SEED_GROUPS) {
    if (props.satellites.some(s => s.norad_id && !hasRealOrbit(s.norad_id))) {
      try { await loadGroupForNorads(group, props.satellites.map(s => s.norad_id).filter(Boolean)) } catch {}
    }
  }
  for (const sat of props.satellites) {
    if (sat.norad_id && !hasRealOrbit(sat.norad_id)) { try { await loadByNorad(sat.norad_id) } catch {} }
  }
}

// Satellites arrive asynchronously from the gateway — build once, and keep the
// gateway-fallback positions fresh on every update.
watch(() => props.satellites, (list) => {
  if (!list || !list.length) return
  for (const sat of list) liveSat.set(sat.id, sat)
  if (!tleLoaded) buildSats()
})

// ── Search ──────────────────────────────────────────────────────────────────
const searchQuery = ref('')
const searchBusy = ref(false)
const extraSats = ref([])        // satellites pulled in on demand via NORAD search
const searchIsNorad = computed(() => /^\d{1,6}$/.test(searchQuery.value.trim()))
const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  const pool = [...(props.satellites || []), ...extraSats.value]
  return pool
    .filter(s => s.name?.toLowerCase().includes(q) || String(s.norad_id).includes(q))
    .slice(0, 8)
})

// Make sure a satellite has an entity (search results / NORAD fetches may not be
// part of the gateway's set), then fly to and track it.
function ensureSatEntity(sat) {
  if (!satEntities.has(sat.id)) { liveSat.set(sat.id, sat); makeSatEntity(sat); applyFilters() }
}
function riskClass(score) {
  if (score >= 70) return 'risk-high'
  if (score >= 40) return 'risk-med'
  return 'risk-low'
}

// ── Group filters ─────────────────────────────────────────────────────────
const filterOpen = ref(false)
const GROUPS = [
  { key: 'stations', label: 'Space Stations', color: cssVar('--accent-blue') },
  { key: 'starlink', label: 'Starlink',       color: '#39d98a' },
  { key: 'oneweb',   label: 'OneWeb',          color: '#a78bfa' },
  { key: 'debris',   label: 'Debris / R/B',    color: cssVar('--color-red') },
  { key: 'other',    label: 'Other Payloads',  color: cssVar('--color-amber') },
]
const enabled = reactive({ stations: true, starlink: true, oneweb: true, debris: true, other: true })
const dangerousOnly = ref(false)

// ── Full catalogue cloud (~all tracked objects as cheap points) ────────────
// Off by default (a clean ~20 curated view). Toggle ON to reveal the real
// orbital clutter — every active satellite + major debris fields, live.
const showAll = ref(false)
const catalogueCount = ref(0)
const catalogueLoading = ref(false)
const CATALOGUE_GROUPS = ['active', 'cosmos-2251-debris', 'iridium-33-debris', '1999-025', 'cosmos-1408-debris']
let cataloguePoints = null     // Cesium.PointPrimitiveCollection
let catalogueItems = []        // [{ norad, p }]
let catalogueTimer = null
let catalogueLoaded = false

// Real RCS size class per object (from Space-Track SATCAT via the gateway):
// 0 = SMALL (<0.1 m²), 1 = MEDIUM, 2 = LARGE (>1 m²). Used to size models
// PROPORTIONALLY (still exaggerated, but big objects bigger than tiny debris).
const rcsMap = new Map()
async function loadRcsSizes() {
  try {
    const res = await fetch('/api/satcat')
    if (!res.ok) return
    const m = await res.json()
    for (const k in m) rcsMap.set(+k, m[k])
  } catch { /* gateway down — fall back to type-based sizing */ }
}
function modelSizeFor(norad, debris) {
  const r = rcsMap.has(norad) ? rcsMap.get(norad) : (debris ? 0 : 1)  // fallback by type
  // DRAMATIC proportional sizing so small/medium/large are clearly distinct in
  // the swarm (pixel floor 7→16→32) while world-scale ÷ view-distance stays
  // constant so the clicked object frames consistently.
  // Real models are real-world scale → base scale 1; pixel floor sets far visibility
  // (RCS-differentiated), maxScale lets far/tiny objects reach the floor without ballooning.
  if (r === 2) return { scale: 1, minPix: 56, maxScale: 90000 }   // LARGE
  if (r === 1) return { scale: 1, minPix: 38, maxScale: 60000 }   // MEDIUM
  return { scale: 1, minPix: 24, maxScale: 40000 }                 // SMALL / unknown
}

// How many of the nearest-to-camera objects get a real 3D model (rest = points).
// Crank this up to "try" more models — past a few hundred it WILL choke (which
// is the whole reason the cloud is points, not models).
const NEAREST_MODELS = ref(25)
const modelCloud = new Map()   // norad → Cesium.Entity (the nearest-N models)

async function ensureCatalogue() {
  if (catalogueLoaded || catalogueLoading.value) return
  catalogueLoading.value = true
  // Full ~31k catalogue + real RCS sizes via the gateway (parallel).
  const [full] = await Promise.all([loadFullCatalogue(), loadRcsSizes()])
  let list = full
  if (!list.length) list = await loadCatalogue(CATALOGUE_GROUPS)
  const seedNorads = new Set(props.satellites.map(s => s.norad_id))
  cataloguePoints = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
  const active = Cesium.Color.fromCssColorString(cssVar('--text-secondary')).withAlpha(0.9)
  const debris = Cesium.Color.fromCssColorString('#ff8a5c').withAlpha(0.9)
  for (const o of list) {
    if (seedNorads.has(o.norad)) continue          // already a curated entity
    const p = cataloguePoints.add({
      position: Cesium.Cartesian3.ZERO,
      pixelSize: 3,
      color: o.debris ? debris : active,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.35),
      outlineWidth: 1,
      // id makes the point pickable/clickable like the curated satellites.
      id: { norad: o.norad, name: o.name, _catalogue: true },
    })
    catalogueItems.push({ norad: o.norad, p, debris: o.debris, name: o.name })
  }
  cataloguePoints.show = false
  catalogueCount.value = catalogueItems.length
  catalogueLoaded = true
  catalogueLoading.value = false
  updateCatalogue()
}

// Position update for the cloud, CHUNKED across frames so 31k propagations
// never hitch in one tick (which was starving the camera follow). Each call
// advances ~1/4 of the cloud; a full refresh completes ~4× per second.
let catalogueChunk = 0
const CATALOGUE_CHUNKS = 4
function updateCatalogue() {
  if (!cataloguePoints) return
  const jsDate = Cesium.JulianDate.toDate(viewer.clock.currentTime)
  const g = gmstOf(jsDate)
  const n = catalogueItems.length
  const per = Math.ceil(n / CATALOGUE_CHUNKS)
  const start = catalogueChunk * per
  const end = Math.min(start + per, n)
  for (let i = start; i < end; i++) {
    const it = catalogueItems[i]
    const e = ecefAt(it.norad, jsDate, g)
    if (e) { it.p.position = new Cesium.Cartesian3(e.x, e.y, e.z); it.valid = true }
    else { it.valid = false; it.p.show = false }
  }
  catalogueChunk = (catalogueChunk + 1) % CATALOGUE_CHUNKS
  if (catalogueChunk === 0) updateNearestModels()   // once per full cycle
}

// Give the N objects closest to the camera a real 3D model; points elsewhere.
function updateNearestModels() {
  const N = NEAREST_MODELS.value
  const camPos = viewer.camera.positionWC
  // The tracked object is represented by its own entity — exclude it from the
  // cloud's models AND points so there's no duplicate (which looked "bigger").
  const trackedN = trackedSat.value?.norad_id
  const ranked = catalogueItems
    .filter(it => it.valid && it.norad !== trackedN)
    .map(it => ({ it, d: Cesium.Cartesian3.distanceSquared(camPos, it.p.position) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, N)
  const modelSet = new Set(ranked.map(r => r.it.norad))
  // Models: keep exactly modelSet.
  for (const [norad, ent] of modelCloud) {
    if (!modelSet.has(norad)) { viewer.entities.remove(ent); modelCloud.delete(norad) }
  }
  // Point visibility: a point shows only if valid, NOT a model, and NOT tracked.
  for (const it of catalogueItems) {
    it.p.show = it.valid && !modelSet.has(it.norad) && it.norad !== trackedN
  }
  // Add models for newly-nearest objects.
  for (const { it } of ranked) {
    if (!modelCloud.has(it.norad)) {
      const ent = viewer.entities.add({
        position: new Cesium.CallbackPositionProperty((time) => {
          const e = ecefAt(it.norad, Cesium.JulianDate.toDate(time))
          return e ? new Cesium.Cartesian3(e.x, e.y, e.z) : undefined
        }, false),
        model: (() => {
          const sz = modelSizeFor(it.norad, it.debris)   // RCS → pixel floor (far swarm)
          const uri = modelByNorad(it.norad) || (it.debris ? '/models/types/debris.glb' : isRocketBody(it.name) ? '/models/types/rocket_body.glb' : GENERIC_MODEL)
          return {
            uri,
            minimumPixelSize: sz.minPix,
            maximumScale: sz.maxScale,
            scale: normScale(uri),   // normalise so every model frames the same when tracked
          }
        })(),
      })
      ent._catNorad = it.norad     // makes the MODEL clickable → tracks that object
      ent._catName = it.name
      modelCloud.set(it.norad, ent)
    }
  }
}

function clearModelCloud() {
  for (const ent of modelCloud.values()) viewer.entities.remove(ent)
  modelCloud.clear()
}

watch(showAll, async (on) => {
  if (on) {
    await ensureCatalogue()
    if (cataloguePoints) cataloguePoints.show = true
    if (catalogueTimer) clearInterval(catalogueTimer)
    catalogueTimer = setInterval(updateCatalogue, 250)   // 1/4 each tick → full refresh ~1 Hz, no big hitch
  } else {
    if (cataloguePoints) cataloguePoints.show = false
    if (catalogueTimer) { clearInterval(catalogueTimer); catalogueTimer = null }
    clearModelCloud()
  }
})
// Re-evaluate the model set immediately when the count, or the tracked object,
// changes (so the tracked object's duplicate cloud model/point clears at once).
watch(NEAREST_MODELS, () => { if (showAll.value) updateNearestModels() })
watch(trackedSat, () => { if (showAll.value && cataloguePoints) updateNearestModels() })

// ── Conjunctions — fetch the REAL ones the gateway already computed ──────────
// The gateway runs our SGP4 screening once (cached); the UI just fetches the
// results (instant) and draws them. No slow in-browser scan.
const conjList = ref([])
const conjBusy = ref(false)
const conjProgress = ref(0)
const conjEntities = []
const conjOpen = ref(false)
let conjRefreshTimer = null

// Auto-load conjunctions from the server on page load (already computed + cached),
// and keep them fresh while the page stays open (server recomputes 3×/day).
onMounted(() => {
  setTimeout(() => runConjunctionScan(), 900)
  conjRefreshTimer = setInterval(() => { if (!conjBusy.value && !selectedConj.value) runConjunctionScan() }, 10 * 60 * 1000)
})
onUnmounted(() => { if (conjRefreshTimer) clearInterval(conjRefreshTimer) })

async function runConjunctionScan() {
  if (conjBusy.value) return
  conjBusy.value = true
  conjProgress.value = 0.5
  try {
    const res = await fetch('/api/conjunctions')
    const raw = await res.json()
    const list = (raw || []).map((c) => ({
      id: c.id,
      a: c.sat1_id, b: c.sat2_id, aName: c.sat1_name, bName: c.sat2_name,
      missKm: c.min_range_km, tcaMs: c.tca_ms || Date.parse(c.tca),
      pc: c.probability, relVelKmS: c.relative_velocity_kms || 0,
      p1: c.sat1_pos, p2: c.sat2_pos,
    }))
    conjList.value = list
    drawConjunctions(list)
  } catch { /* gateway down */ }
  conjBusy.value = false
  conjProgress.value = 1
}

function conjColor(missKm) {
  return missKm < 1 ? cssVar('--color-red') : missKm < 5 ? cssVar('--color-amber') : cssVar('--text-secondary')
}
function clearConjunctions() {
  for (const e of conjEntities) viewer.entities.remove(e)
  conjEntities.length = 0
}

// --- Avoidance-plan orbit drawing + interactive route picking ---
const planEntities = []
const routeTip = ref(null)        // hover tooltip {x,y,sat,type,sub,css}
const selectedRoute = ref(null)   // clicked route detail {sat,type,sub,css}
let selectedRouteEnt = null
let hoveredRouteEnt = null
function highlightRoute(ent) {
  for (const e of planEntities) {
    if (e._routeMeta && e.polyline) e.polyline.width = new Cesium.ConstantProperty(e._routeMeta.baseWidth)
  }
  if (ent && ent.polyline) ent.polyline.width = new Cesium.ConstantProperty((ent._routeMeta?.baseWidth || 2.5) + 4)
}
function selectRoute(ent) {
  selectedRouteEnt = ent
  selectedRoute.value = { ...ent._routeMeta }
  highlightRoute(ent)
}
function clearRouteSelection() { selectedRoute.value = null; selectedRouteEnt = null; highlightRoute(null) }
function clearPlan() {
  for (const e of planEntities) viewer.entities.remove(e)
  planEntities.length = 0
  selectedRoute.value = null; selectedRouteEnt = null; routeTip.value = null
}
function toCarts(arr) {
  return (arr || []).map((p) => new Cesium.Cartesian3(p.x, p.y, p.z))
}
function planLine(carts, css, width, labelText, frac = 0.4, meta = null, dashed = false) {
  if (!carts || !carts.length) return
  const color = Cesium.Color.fromCssColorString(css)
  const material = dashed
    ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 18 })
    : new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.28, color })
  const ent = viewer.entities.add({
    polyline: { positions: carts, width, arcType: Cesium.ArcType.NONE, material },
  })
  if (meta) { ent._routeMeta = { ...meta, css, baseWidth: width }; ent._routeBody = ent }
  planEntities.push(ent)
  if (labelText) {
    const at = carts[Math.floor(carts.length * frac)] || carts[0]
    planEntities.push(viewer.entities.add({
      position: at,
      label: { text: labelText, font: '600 11px ui-monospace, monospace', fillColor: Cesium.Color.fromCssColorString(css),
        showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#050a12').withAlpha(0.9),
        pixelOffset: new Cesium.Cartesian2(0, 0), disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1.0e6, 1.1, 4.0e7, 0.7) },
    }))
  }
}
function planMarker(cart, css, text, labelOffsetY = -26) {
  if (!cart) return
  const YEL = Cesium.Color.fromCssColorString('#facc15')   // bright yellow — distinct from every other dot
  // big translucent halo
  planEntities.push(viewer.entities.add({
    position: cart,
    point: { pixelSize: 34, color: YEL.withAlpha(0.2), disableDepthTestDistance: Number.POSITIVE_INFINITY },
  }))
  // solid bright-yellow core with dark outline so it reads on any background
  planEntities.push(viewer.entities.add({
    position: cart,
    point: { pixelSize: 18, color: YEL, outlineColor: Cesium.Color.fromCssColorString('#1a1205'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text, font: '700 12px ui-monospace, monospace', fillColor: Cesium.Color.fromCssColorString('#1a1205'),
      showBackground: true, backgroundColor: YEL.withAlpha(0.95),
      pixelOffset: new Cesium.Cartesian2(0, labelOffsetY), disableDepthTestDistance: Number.POSITIVE_INFINITY },
  }))
}
// Exaggerate the tiny rerouted divergence so it's visible at globe scale.
function exaggerate(cur, rer, factor) {
  return cur.map((c, i) => {
    const r = rer[i]; if (!r) return c
    return new Cesium.Cartesian3(c.x + (r.x - c.x) * factor, c.y + (r.y - c.y) * factor, c.z + (r.z - c.z) * factor)
  })
}
function drawPlan(plan) {
  clearPlan()
  if (!plan) return
  // Each satellite gets its own colour for its CURRENT path; rerouted = same hue
  // but DASHED + brighter, so the safer path shows even where it overlaps the
  // current orbit (the nudge is tiny, so they coincide except near the conjunction).
  const C1 = cssVar('--color-red'), C1R = cssVar('--color-red'), C2 = cssVar('--color-amber'), C2R = '#fcd34d'
  const n1 = shortName(plan.sat1_name), n2 = shortName(plan.sat2_name)
  const s1c = toCarts(plan.sat1_current), s2c = toCarts(plan.sat2_current)
  const s1r = toCarts(plan.sat1_rerouted), s2r = toCarts(plan.sat2_rerouted)
  const man = (name) => (plan.maneuvers || []).find((m) => m.sat === name) || {}
  const manStr = (m) => m.maneuverable ? `Δv ${m.delta_v_ms} m/s · ${m.direction} · ${m.orbit_shift_deg}° · ${m.altitude_change_km} km` : 'debris — cannot maneuver'
  const curSub = `current path · miss ${plan.original_miss_km} km · COLLISION RISK`
  // current (collision) paths — solid, per-satellite colour
  planLine(s1c, C1, 2.5, `${n1} · current`, 0.28, { sat: plan.sat1_name, type: 'CURRENT PATH', sub: curSub })
  planLine(s2c, C2, 2.5, `${n2} · current`, 0.62, { sat: plan.sat2_name, type: 'CURRENT PATH', sub: curSub })
  // safer rerouted paths — DASHED, REAL geometry (no exaggeration). The nudge is
  // tiny so it overlaps the current orbit except near the conjunction — that's the
  // honest picture; the avoidance is told by the numbers + the conjunction markers.
  const rSub = (name) => `${manStr(man(name))} · miss → ${plan.new_miss_km} km`
  if (s1r.length) planLine(s1r, C1R, 3, `${n1} · SAFER`, 0.44, { sat: plan.sat1_name, type: 'REROUTED (SAFE)', sub: rSub(plan.sat1_name) }, true)
  if (s2r.length) planLine(s2r, C2R, 3, `${n2} · SAFER`, 0.5, { sat: plan.sat2_name, type: 'REROUTED (SAFE)', sub: rSub(plan.sat2_name) }, true)
  // object markers at the REAL closest-approach positions (offset labels so both read)
  const m1 = plan.sat1_tca_pos ? new Cesium.Cartesian3(plan.sat1_tca_pos.x, plan.sat1_tca_pos.y, plan.sat1_tca_pos.z) : (s1c[0] || null)
  const m2 = plan.sat2_tca_pos ? new Cesium.Cartesian3(plan.sat2_tca_pos.x, plan.sat2_tca_pos.y, plan.sat2_tca_pos.z) : (s2c[0] || null)
  planMarker(m1, C1, n1, -26)
  planMarker(m2, C2, n2, 22)
  // frame the whole maneuver
  if (planEntities.length && viewer) viewer.flyTo(planEntities, { duration: 1.5 }).catch(() => {})
  if (typeof window !== 'undefined') window.__routeLines = planEntities.filter((e) => e.polyline && e._routeMeta).length
}
watch(() => props.plan, (p) => { if (viewer) (p ? drawPlan(p) : clearPlan()) })

// ---------------------------------------------------------------------------
// SPACE-WEATHER EXPOSURE ZONES
//
// Three bands, derived from the live NOAA feed. These are EXPOSURE ZONES, not
// outage predictions: they show where a documented class of effect applies, and
// each carries its basis. We do not claim a specific station, grid or aircraft
// will fail.
//
// The polar band is the one that matters operationally — it is what takes the
// polar ground stations offline and violates FR-19.
// ---------------------------------------------------------------------------
const swEntities = []

function clearSpaceWeather() {
  for (const e of swEntities) viewer.entities.remove(e)
  swEntities.length = 0
}

/**
 * A zone BOUNDARY, drawn as a thin line at the latitude — not a filled dome.
 *
 * The first version painted translucent rectangles across whole latitude bands.
 * On a lit globe that reads as coloured haze smeared over the Earth: it hides
 * the planet, which is the thing worth looking at, and it says nothing precise.
 * A boundary line says exactly what a zone boundary is, and the Earth stays
 * visible through it.
 */
/**
 * A filled latitude band. The boundary polylines alone were technically
 * present and effectively invisible — 1px lines over the night side of the
 * planet during the one demo where visibility mattered most. A translucent
 * band reads at any zoom and any lighting; the boundary line stays as its
 * hard edge.
 */
function addBand(latLo, latHi, colour, name, description, focus = 'hi') {
  // A single flat rectangle read as beach-ball paint. Real exposure is not
  // uniform: proton flux concentrates at the pole, auroral effects at the
  // oval's edge, scintillation at the magnetic equator. Six strips with alpha
  // falling away from the physical maximum give the band a shape that matches
  // the phenomenon instead of a printing error.
  const STRIPS = 6
  for (const sign of latLo < 0 ? [1] : [1, -1]) {
    const lo = sign > 0 ? latLo : -latHi
    const hi = sign > 0 ? latHi : -latLo
    for (let k = 0; k < STRIPS; k++) {
      // Overlap adjacent strips by a sliver: rectangles that merely abut leave
      // visible seam rings where floating point disagrees about the shared edge.
      const step = (hi - lo) / STRIPS
      const a = lo + step * k
      const b = Math.min(hi, a + step + step * 0.2)
      // where is this strip relative to the band's physical maximum?
      let w = (k + 0.5) / STRIPS                       // 0 at lo edge, 1 at hi
      if (sign < 0) w = 1 - w
      let strength
      if (focus === 'hi') strength = w
      else if (focus === 'lo') strength = 1 - w
      else strength = 1 - Math.abs(2 * ((k + 0.5) / STRIPS) - 1)   // mid
      swEntities.push(viewer.entities.add({
        name,
        description,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(-180, a, 180, b),
          material: colour.withAlpha(0.05 + 0.30 * strength),
          outline: false,
        },
      }))
    }
    swEntities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(0, (lo + hi) / 2, 250000),
      label: {
        text: name,
        font: '600 12px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(8e6, 1.0, 8e7, 0.55),
      },
    }))
  }
}

function addBoundary(latDeg, colour, name, description, dashed) {
  for (const sign of [1, -1]) {
    const lat = sign * latDeg;
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 2) pts.push(lon, lat);
    swEntities.push(viewer.entities.add({
      name,
      description,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(pts),
        width: 1.6,
        clampToGround: false,
        material: dashed
          ? new Cesium.PolylineDashMaterialProperty({ color: colour, dashLength: 14 })
          : colour,
        arcType: Cesium.ArcType.RHUMB,
      },
    }));
  }
}

/**
 * Space-weather zones are OFF by default.
 *
 * They were drawn automatically whenever a zone was "active", which meant the
 * globe got covered in rings the moment geomagnetic activity rose — including
 * during a replay. The planet is the thing worth looking at. These are an
 * optional overlay the operator asks for, not decoration we impose.
 */
function drawSpaceWeather(sw) {
  if (!viewer) return
  clearSpaceWeather()
  if (!sw || !sw.zones || !sw.show_zones) return
  const z = sw.zones

  // Polar cap absorption — the boundary above which HF is blacked out. This is
  // the one that actually takes ground stations offline, so it is solid.
  if (z.polar_cap_absorption && z.polar_cap_absorption.active) {
    addBand(z.polar_cap_absorption.magnetic_latitude_deg, 90,
      Cesium.Color.fromCssColorString(cssVar('--color-red')),
      `HF BLACKOUT — polar cap (${z.polar_cap_absorption.level})`,
      z.polar_cap_absorption.effect, 'hi')
    addBoundary(z.polar_cap_absorption.magnetic_latitude_deg,
      Cesium.Color.fromCssColorString(cssVar('--color-red')).withAlpha(0.9),
      `Polar cap absorption — ${z.polar_cap_absorption.level}`,
      `${z.polar_cap_absorption.effect} · typical duration ${z.polar_cap_absorption.typical_duration}`,
      false)
  }

  // Auroral oval — advisory, so dashed.
  if (z.auroral_oval && z.auroral_oval.active) {
    addBand(z.auroral_oval.equatorward_boundary_deg,
      (z.polar_cap_absorption && z.polar_cap_absorption.active)
        ? z.polar_cap_absorption.magnetic_latitude_deg : 90,
      Cesium.Color.fromCssColorString('#4cc76a'),
      'AURORAL OVAL — GNSS degraded',
      z.auroral_oval.effect, 'lo')
    addBoundary(z.auroral_oval.equatorward_boundary_deg,
      Cesium.Color.fromCssColorString('#4cc76a').withAlpha(0.75),
      'Auroral oval — equatorward boundary',
      z.auroral_oval.effect, true)
  }

  // Equatorial scintillation belt — advisory, dashed.
  if (z.equatorial_scintillation && z.equatorial_scintillation.active) {
    addBand(-z.equatorial_scintillation.band_deg, z.equatorial_scintillation.band_deg,
      Cesium.Color.fromCssColorString('#e0a32e'),
      'SCINTILLATION BELT',
      z.equatorial_scintillation.effect, 'mid')
    addBoundary(z.equatorial_scintillation.band_deg,
      Cesium.Color.fromCssColorString('#e0a32e').withAlpha(0.6),
      'Equatorial scintillation belt',
      z.equatorial_scintillation.effect, true)
  }

  // Ground stations. Only drawn when something is actually degraded — a row of
  // green dots in nominal conditions is noise, not information.
  const degraded = sw.ground_segment && sw.ground_segment.stations_available < sw.ground_segment.stations_assigned
  if (!degraded) return

  for (const st of sw.ground_segment.stations) {
    swEntities.push(viewer.entities.add({
      name: st.name,
      description: st.available ? 'Reachable' : `UNREACHABLE — ${st.reason}`,
      position: Cesium.Cartesian3.fromDegrees(st.lon, st.lat, 0),
      point: {
        pixelSize: st.available ? 6 : 10,
        color: st.available
          ? Cesium.Color.fromCssColorString('#8b93a1')
          : Cesium.Color.fromCssColorString(cssVar('--color-red')),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5,
      },
      label: st.available ? undefined : {
        text: `${st.id} ✕`,
        font: '600 11px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString(cssVar('--color-red')),
        pixelOffset: new Cesium.Cartesian2(0, -17),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.72),
        scaleByDistance: new Cesium.NearFarScalar(6e6, 1.0, 4e7, 0.0),
      },
    }))
  }
}

// The feed refreshes every few seconds. Tearing down and repainting the bands
// on every poll made them flicker even when nothing had changed — so redraw
// only when something the drawing depends on is actually different.
let swSignature = ''
function swSig(sw) {
  if (!sw || !sw.zones) return 'off'
  const z = sw.zones, g = sw.ground_segment || {}
  return [
    sw.show_zones ? 1 : 0,
    z.polar_cap_absorption && z.polar_cap_absorption.active ? z.polar_cap_absorption.magnetic_latitude_deg : '-',
    z.auroral_oval && z.auroral_oval.active ? z.auroral_oval.equatorward_boundary_deg : '-',
    z.equatorial_scintillation && z.equatorial_scintillation.active ? z.equatorial_scintillation.band_deg : '-',
    g.stations_available, g.stations_assigned,
  ].join('|')
}
watch(() => props.spaceWeather, (sw) => {
  if (!viewer) return
  const sig = swSig(sw)
  if (sig === swSignature) return
  swSignature = sig
  drawSpaceWeather(sw)
}, { deep: true })

// ---------------------------------------------------------------------------
// RE-ENTRY CORRIDOR — the return leg
//
// The footprint is a DISTRIBUTION, not a line, because re-entry uncertainty is
// dominated by atmospheric drag. Drawing it as a line would be a lie about the
// physics, so the Monte Carlo samples are drawn as a scatter and the corridor
// as its spine.
// ---------------------------------------------------------------------------
const deorbitEntities = []
let groundLayer = null      // the DINOv3 land-cover overlay under a corridor
const groundActive = ref(false)
const globalGround = ref(false)      // the whole-planet DINOv3 layer
const gpuResult = ref(null)          // last WebGPU screening result
const gpuBusy = ref(false)

/**
 * Screen every pair in the loaded catalogue on THIS machine's GPU.
 *
 * The point is not decoration: this is the O(N^2) coarse filter every real
 * screening pipeline runs, executed as a compute shader in the browser, with
 * the throughput measured live rather than claimed. Candidates go back to the
 * gateway for full SGP4 refinement — the verdict never comes from this pass,
 * and the result panel says so.
 */
async function runGpuScreen() {
  if (gpuBusy.value) return
  gpuBusy.value = true
  gpuResult.value = { phase: 'propagating the catalogue…' }
  try {
    // catalogue must be loaded; nudge the full set in if it is not
    await loadFullCatalogue().catch(() => {})
    const snap = exportStatesEci(new Date())
    if (snap.ids.length < 100) {
      gpuResult.value = { error: 'catalogue not loaded yet — toggle "Show all tracked objects" first' }
      return
    }
    gpuResult.value = { phase: `screening ${snap.ids.length.toLocaleString()} objects…` }
    const { gpuScreen } = await import('../lib/gpuScreen.js')
    const r = await gpuScreen(snap)
    if (!r.supported) { gpuResult.value = { error: r.reason }; return }
    gpuResult.value = r
    // paint the ten closest candidate pairs for a few seconds
    const tmp = []
    const now = new Date()
    for (const c of r.candidates.slice(0, 10)) {
      const pa = ecefAt(c.a, now), pb = ecefAt(c.b, now)
      if (!pa || !pb) continue
      tmp.push(viewer.entities.add({
        polyline: {
          positions: [new Cesium.Cartesian3(pa.x, pa.y, pa.z), new Cesium.Cartesian3(pb.x, pb.y, pb.z)],
          width: 1.5,
          material: Cesium.Color.WHITE.withAlpha(0.5),
        },
      }))
    }
    setTimeout(() => { for (const e of tmp) viewer.entities.remove(e) }, 12000)
  } catch (e) {
    gpuResult.value = { error: String(e.message || e) }
  } finally {
    gpuBusy.value = false
  }
}
let globalGroundLayer = null

/**
 * The whole planet as the vision model classified it — every cell it scanned,
 * majority-voted down to 4x4 per cell. Drawn once to a canvas, kept as a
 * single imagery layer, toggled from the FILTERS panel.
 */
/** Turn the global layer ON if it is not already — used by the story tab. */
async function showGlobalGround() {
  if (!globalGroundLayer) await toggleGlobalGround()
}

function hideGlobalGround() {
  if (globalGroundLayer) toggleGlobalGround()
}

async function toggleGlobalGround() {
  if (globalGroundLayer) {
    viewer.imageryLayers.remove(globalGroundLayer, true)
    globalGroundLayer = null
    globalGround.value = false
    return
  }
  let data
  try {
    const res = await fetch('/api/ground/global')
    if (!res.ok) return
    data = await res.json()
  } catch { return }
  const D = data.grid, NX = data.nx
  const canvas = document.createElement('canvas')
  canvas.width = NX * D
  canvas.height = 360 * D
  const c2 = canvas.getContext('2d')
  const COLOUR = {
    WATER: 'rgba(30, 95, 185, 0.85)',
    SPARSE: 'rgba(52, 130, 52, 0.8)',
    BUILT: 'rgba(205, 48, 34, 0.9)',
    UNKNOWN: 'rgba(135, 135, 145, 0.85)',
  }
  for (const [key, g] of data.cells) {
    const iy = Math.floor(key / NX), ix = key % NX
    for (let i = 0; i < g.length; i++) {
      c2.fillStyle = COLOUR[data.classes[g[i]]] || COLOUR.UNKNOWN
      c2.fillRect(ix * D + (i % D), iy * D + Math.floor(i / D), 1, 1)
    }
  }
  globalGroundLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.SingleTileImageryProvider({
      url: canvas.toDataURL(),
      rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
      tileWidth: canvas.width,
      tileHeight: canvas.height,
    }),
  )
  globalGroundLayer.alpha = 0.72
  globalGround.value = true
}
const zonesOnScreen = computed(() => {
  const sw = props.spaceWeather
  if (!sw || !sw.show_zones || !sw.zones) return false
  const z = sw.zones
  return ['polar_cap_absorption', 'auroral_oval', 'equatorial_scintillation']
    .some((k) => z[k] && z[k].active)
})

function clearGroundLayer() {
  if (groundLayer && viewer) viewer.imageryLayers.remove(groundLayer, true)
  groundLayer = null
  groundActive.value = false
}

/**
 * Paint what the vision model sees under the corridor.
 *
 * 18.2 million sub-cells were classified on an A100 and then shown to nobody.
 * This fetches the 3.4 km grid for the corridor's bounding box, renders it to
 * a canvas — one pixel per sub-cell — and drapes it as an imagery layer:
 *
 *   blue   water          green  sparse ground
 *   red    built-up       grey hatch  the model REFUSING to classify
 *
 * The refusals are drawn, not hidden: an UNKNOWN cell is the model saying
 * "I have not seen ground like this", and that admission is the point.
 */
async function drawGroundUnder(fp) {
  clearGroundLayer()
  if (!fp || !Array.isArray(fp.centreline) || !fp.centreline.length) return
  const lats = fp.centreline.map((p) => p.lat)
  const lons = fp.centreline.map((p) => p.lon)
  const pad = 2.5
  const w = Math.max(-180, Math.min(...lons) - pad)
  const e = Math.min(180, Math.max(...lons) + pad)
  const s = Math.max(-89, Math.min(...lats) - pad)
  const n = Math.min(89, Math.max(...lats) + pad)

  let data
  try {
    const res = await fetch(`/api/ground/dense?w=${w}&s=${s}&e=${e}&n=${n}`)
    if (!res.ok) return
    data = await res.json()
  } catch { return }
  if (!data.cells || !data.cells.length) return

  const G = data.grid, RES = data.res_deg
  const x0 = Math.floor((w + 180) / RES), y0 = Math.floor((90 - n) / RES)
  const cols = Math.floor((e + 180) / RES) - x0 + 1
  const rows = Math.floor((90 - s) / RES) - y0 + 1
  const canvas = document.createElement('canvas')
  canvas.width = cols * G
  canvas.height = rows * G
  const ctx2 = canvas.getContext('2d')
  const COLOUR = {
    WATER: 'rgba(38, 110, 200, 0.78)',
    SPARSE: 'rgba(60, 145, 60, 0.72)',
    BUILT: 'rgba(215, 55, 40, 0.85)',
    UNKNOWN: 'rgba(140, 140, 150, 0.8)',
  }
  // ONLY the ground the corridor can actually reach. Painting the whole
  // bounding box of an 11,000 km corridor flooded half a continent in red and
  // buried the corridor graphics themselves — the strip is the subject, the
  // box was noise.
  const RESC = data.res_deg
  const near = (ix, iy) => {
    const clat = 90 - (iy + 0.5) * RESC
    const clon = (ix + 0.5) * RESC - 180
    for (const pt of fp.centreline) {
      const dLat = clat - pt.lat
      let dLon = clon - pt.lon
      if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360
      // ~2 degrees ≈ the ±2σ corridor plus one cell of margin
      if (dLat * dLat + dLon * dLon * Math.cos(clat * Math.PI / 180) ** 2 < 4) return true
    }
    return false
  }

  for (const c of data.cells) {
    if (!near(c.ix, c.iy)) continue
    const bx = (c.ix - x0) * G, by = (c.iy - y0) * G
    for (let i = 0; i < c.g.length; i++) {
      const cls = data.classes[c.g[i]]
      ctx2.fillStyle = COLOUR[cls] || COLOUR.UNKNOWN
      const px = bx + (i % G), py = by + Math.floor(i / G)
      ctx2.fillRect(px, py, 1, 1)
      // hatch the refusals so they read as "declined", not as a colour
      if (cls === 'UNKNOWN' && (px + py) % 2) ctx2.clearRect(px, py, 1, 1)
    }
  }

  groundLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.SingleTileImageryProvider({
      url: canvas.toDataURL(),
      rectangle: Cesium.Rectangle.fromDegrees(x0 * RES - 180, 90 - (y0 + rows) * RES, (x0 + cols) * RES - 180, 90 - y0 * RES),
      tileWidth: canvas.width,
      tileHeight: canvas.height,
    }),
  )
  groundLayer.alpha = 1.0
  groundActive.value = true
}

function clearDeorbit() {
  for (const e of deorbitEntities) viewer.entities.remove(e)
  deorbitEntities.length = 0
  descentEntity = null
  descentAt = null
  hasDescent.value = false
  if (following.value) stopFollowing()
  clearGroundLayer()
}

/**
 * The descending stage, animated down the corridor.
 *
 * Everything else on this globe is a static conclusion. This is the event the
 * conclusions are about: a marker enters at the interface, loses altitude down
 * the whole track, and goes out at the far end — then again, on a loop. A
 * short glowing trail sells the motion; the loop period is long enough to read
 * and short enough that nobody waits for it.
 */
// ---------------------------------------------------------------------------
// THE CONJUNCTION MOMENT — the close approach, replayed as an event.
//
// Screening reduces a near-miss to one number in a list. This plays the number
// back as what it is: two objects, propagated with the same SGP4 used for
// screening, converging over four minutes of simulated time to their real
// closest approach — range ticking down live, and the gate's verdict landing
// at TCA. Time is compressed ~15x; the trajectories are not.
// ---------------------------------------------------------------------------
const approach = ref(null)         // { aName, bName, range_km, t_to_tca_s, verdict, done }
let apPlay = null                  // { conj, t0, span, entities: [] }

function playApproach(conj) {
  stopApproach()
  if (!conj || !conj.tca_ms) return
  const a = conj.sat1_id, b = conj.sat2_id
  if (!hasRealOrbit(a) || !hasRealOrbit(b)) {
    approach.value = { error: 'orbit data for one of the objects is not loaded' }
    return
  }
  const WALL_MS = 24000                     // one pass of wall-clock time
  const SIM_BEFORE = 240e3, SIM_AFTER = 90e3
  apPlay = { conj, t0: performance.now(), wall: WALL_MS, before: SIM_BEFORE, span: SIM_BEFORE + SIM_AFTER, entities: [] }

  const posAt = (norad, simMs) => {
    const e = ecefAt(norad, new Date(simMs))
    return e ? new Cesium.Cartesian3(e.x, e.y, e.z) : null
  }
  const simNow = () => {
    const f = Math.min(1, (performance.now() - apPlay.t0) / WALL_MS)
    return conj.tca_ms - SIM_BEFORE + f * apPlay.span
  }

  const mk = (norad, name, colour) => viewer.entities.add({
    name,
    position: new Cesium.CallbackProperty(() => posAt(norad, simNow()), false),
    point: { pixelSize: 12, color: Cesium.Color.fromCssColorString(colour),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: shortName(name), font: '600 12px "JetBrains Mono", monospace',
      fillColor: Cesium.Color.fromCssColorString(colour),
      pixelOffset: new Cesium.Cartesian2(0, -20), showBackground: true,
      backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
      disableDepthTestDistance: Number.POSITIVE_INFINITY },
  })
  apPlay.entities.push(mk(a, conj.sat1_name, '#ff5f56'))
  apPlay.entities.push(mk(b, conj.sat2_name, '#ffb347'))
  // the shrinking range line between them
  apPlay.entities.push(viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => {
        const t = simNow()
        const pa = posAt(a, t), pb = posAt(b, t)
        return pa && pb ? [pa, pb] : []
      }, false),
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.WHITE.withAlpha(0.85), dashLength: 10 }),
    },
  }))

  // camera: hold on the midpoint, range scaled to the geometry
  apPlay.camTick = () => {
    const t = simNow()
    const pa = posAt(a, t), pb = posAt(b, t)
    if (!pa || !pb) return
    const mid = Cesium.Cartesian3.midpoint(pa, pb, new Cesium.Cartesian3())
    const sep = Cesium.Cartesian3.distance(pa, pb)
    // The raw range shrinks by orders of magnitude in seconds, and feeding it
    // straight to the camera made the zoom lurch. Exponentially smooth it, and
    // let the heading drift slowly instead of sitting welded to one bearing.
    const target = Math.max(sep * 3.0, 90000)
    apPlay.smooth = apPlay.smooth ? apPlay.smooth + (target - apPlay.smooth) * 0.045 : target
    const heading = 0.5 + ((performance.now() - apPlay.t0) / 1000) * 0.02
    viewer.camera.lookAt(mid, new Cesium.HeadingPitchRange(heading, -0.4, apPlay.smooth))
    const range = sep / 1000
    const toTca = (conj.tca_ms - t) / 1000
    const done = (performance.now() - apPlay.t0) >= WALL_MS
    approach.value = {
      aName: shortName(conj.sat1_name), bName: shortName(conj.sat2_name),
      range_km: range < 100 ? range.toFixed(2) : Math.round(range).toLocaleString(),
      t_to_tca_s: Math.round(toTca),
      min_range_km: conj.min_range_km,
      verdict: done && conj.constraint ? conj.constraint.signal : null,
      pc: conj.probability,
      done,
    }
  }
}

function stopApproach() {
  if (!apPlay) { approach.value = null; return }
  for (const e of apPlay.entities) viewer.entities.remove(e)
  apPlay = null
  approach.value = null
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  viewer.camera.flyHome(1.2)
}

let descentStart = 0
let descentEntity = null
let descentFp = null
let descentAt = null   // frac -> Cartesian3, kept for the chase camera
let descentMeta = null // the replay's real parameters, for the HUD
// Playback is integrated, not wall-clocked, so it can be slowed, paused and
// fast-forwarded without the marker jumping.
const DESCENT_BASE_MS = 48000          // one pass at 1x — slow enough to watch
const descentSpeed = ref(1)            // 0 = paused, 0.5, 1, 4
let descentProgress = 0
let descentLastTick = 0
const following = ref(false)
const hasDescent = ref(false)   // reactive gate for the follow button — a bare
                                // `let` entity ref is invisible to the template
const descentHud = ref(null)   // { alt_km, downrange_km, span_km, pct }
let hudTimer = null

/**
 * Ride down with the stage.
 *
 * A marker crossing a globe seen from 20,000 km is a screensaver. Tracking it
 * turns the same data into an event: the camera falls with the stage, the
 * ground rises, and the HUD counts the altitude down. Cesium's trackedEntity
 * does the camera work; we just keep a live readout beside it.
 */
function followDescent() {
  if (!viewer || !descentAt) return
  following.value = true
  // Drive the camera by hand every frame. trackedEntity has its own ideas
  // about framing and gave an unreliable follow; lookAt from a fixed chase
  // offset is boring and therefore correct.
  viewer.trackedEntity = undefined
  if (hudTimer) clearInterval(hudTimer)
  hudTimer = setInterval(() => {
    if (!descentFp || !following.value) return
    const t = descentProgress
    const span = descentFp.span_km || 1
    // Flight-path angle from the trajectory's own geometry: the angle between
    // where it is going and the local horizontal. Steepens as it comes down.
    const dAlt = -120 * 1.6 * Math.pow(Math.max(1e-6, 1 - t), 0.6)   // km / unit t
    const fpa = Math.atan2(dAlt, span) * 180 / Math.PI
    descentHud.value = {
      alt_km: (120 * Math.pow(1 - t, 1.6) + 4).toFixed(0),
      fpa_deg: fpa.toFixed(1),
      downrange_km: Math.round(t * span).toLocaleString(),
      span_km: Math.round(span).toLocaleString(),
      pct: Math.round(t * 100),
      entry: descentMeta ? `${descentMeta.entry_lat ?? '—'}, ${descentMeta.entry_lon ?? '—'}` : null,
      incl: descentMeta && descentMeta.inclination_deg,
      bc: descentMeta && descentMeta.ballistic_coefficient,
    }
  }, 120)
}

function stopFollowing() {
  following.value = false
  descentHud.value = null
  if (hudTimer) { clearInterval(hudTimer); hudTimer = null }
  if (viewer) {
    // release the lookAt transform or the camera stays welded to the last frame
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    viewer.trackedEntity = undefined
    viewer.camera.flyHome(1.4)
  }
}
function addDescentAnimation(fp, base) {
  const line = fp.centreline
  if (!Array.isArray(line) || line.length < 2) return
  const ENTRY_ALT = 120000                   // entry interface, ~120 km
  descentProgress = 0
  descentLastTick = performance.now()

  const at = (frac) => {
    const t = Math.min(0.9999, Math.max(0, frac))
    const i = Math.min(line.length - 2, Math.floor(t * (line.length - 1)))
    const f = t * (line.length - 1) - i
    const lat = line[i].lat + (line[i + 1].lat - line[i].lat) * f
    const lon = line[i].lon + (line[i + 1].lon - line[i].lon) * f
    // altitude falls off steeply late in the track, like a decaying entry
    const alt = ENTRY_ALT * Math.pow(1 - t, 1.6) + 4000
    return Cesium.Cartesian3.fromDegrees(lon, lat, alt)
  }
  const phase = () => descentProgress
  descentAt = at

  descentFp = fp
  hasDescent.value = true
  descentEntity = viewer.entities.add({
    name: 'Descending stage (animated)',
    description: 'The re-entry the corridor describes — entry interface to impact, looped.',
    position: new Cesium.CallbackProperty(() => at(phase()), false),
    point: {
      pixelSize: 11,
      color: Cesium.Color.fromCssColorString('#ffb347'),
      outlineColor: Cesium.Color.fromCssColorString('#ff5f56'),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    // The actual stage: the rocket-body model that was sitting unused in
    // public/models. Oriented along its own velocity, so it flies nose-first.
    model: {
      uri: '/models/types/rocket_body.glb',
      minimumPixelSize: 56,
      maximumScale: 30000,
    },
    orientation: new Cesium.VelocityOrientationProperty(
      new Cesium.CallbackProperty(() => at(phase()), false),
    ),
  })
  deorbitEntities.push(descentEntity)
  // the trail — a short streak behind the marker
  deorbitEntities.push(viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => {
        const now = phase()
        const pts = []
        for (let k = 0; k <= 10; k++) pts.push(at(now - k * 0.012))
        return pts
      }, false),
      width: 7,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.35,
        color: Cesium.Color.fromCssColorString('#ffb347').withAlpha(0.85),
      }),
    },
  }))
}

function drawDeorbit(d) {
  descentMeta = d
  drawGroundUnder(d && d.footprint)
  if (!viewer) return
  clearDeorbit()
  if (!d || !d.footprint || d.footprint.unresolved) return
  const fp = d.footprint
  const pts = fp.points || []
  if (!pts.length) return

  // Colour by outcome: red once the casualty limit is exceeded.
  const over = d.casualty && d.casualty.ec >= 0.0001
  const base = over ? cssVar('--color-red') : cssVar('--accent-blue')

  // A DISTRIBUTION IS NOT A PATH.
  //
  // This previously drew a polyline through `fp.points`, which are Monte Carlo
  // samples in SAMPLE ORDER — i.e. random. The result crossed itself hundreds
  // of times and read as a flight path the object might take, when it is
  // really a cloud of possible impact points. Three separate things are drawn
  // instead, each of which is honest on its own terms:
  //
  //   1. the +/-2 sigma corridor, as a translucent ribbon
  //   2. the nominal ground track, as a single clean line
  //   3. the samples, as a scatter — the correct way to draw a distribution

  // 1. dispersion corridor
  if (Array.isArray(fp.corridor) && fp.corridor.length > 3) {
    deorbitEntities.push(viewer.entities.add({
      name: `${d.name} — 2σ dispersion corridor`,
      description: `${fp.samples.toLocaleString()} Monte Carlo samples · span ${fp.span_km} km · cross-track 1σ ${fp.cross_track_sigma_km} km · driven by ${fp.dispersion.driven_by}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          fp.corridor.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat)),
        ),
        material: Cesium.Color.fromCssColorString(base).withAlpha(0.16),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString(base).withAlpha(0.9),
        height: 0,
      },
    }))
  }

  // 1b. name the thing. An unlabelled red ribbon across three continents
  // reads as a rendering artefact, not a result.
  if (Array.isArray(fp.centreline) && fp.centreline.length > 2) {
    const mid = fp.centreline[Math.floor(fp.centreline.length / 2)]
    const ecTxt = d.casualty && Number.isFinite(d.casualty.ec)
      ? `Ec ${d.casualty.ec.toExponential(1)} — ${d.casualty.within_limit ? 'within' : (d.casualty.ec / 1e-4).toFixed(0) + '× over'} the legal limit`
      : 'casualty risk unresolved'
    deorbitEntities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(mid.lon, mid.lat, 120000),
      label: {
        text: `${d.name || 'RE-ENTRY'} — dispersion corridor\n${ecTxt}`,
        font: '600 13px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.72),
        backgroundPadding: new Cesium.Cartesian2(10, 6),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }))
  }

  addDescentAnimation(fp, base)

  // 2. nominal ground track
  if (Array.isArray(fp.centreline) && fp.centreline.length > 1) {
    deorbitEntities.push(viewer.entities.add({
      name: `${d.name} — nominal ground track`,
      polyline: {
        positions: fp.centreline.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 40000)),
        width: 5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#ffb347'),
          gapColor: Cesium.Color.fromCssColorString('#ff5f56').withAlpha(0.35),
          dashLength: 16,
        }),
      },
    }))
  }

  // 3. the samples themselves
  for (let i = 0; i < pts.length; i += 2) {
    deorbitEntities.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(pts[i].lon, pts[i].lat, 20000),
      point: {
        pixelSize: 3,
        color: Cesium.Color.fromCssColorString(base).withAlpha(0.5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }))
  }

  // Entry interface — where it starts coming apart.
  if (d.entry_interface) {
    deorbitEntities.push(viewer.entities.add({
      name: 'Entry interface',
      description: `${d.entry_interface.alt_km} km · ${d.entry_interface.time}`,
      position: Cesium.Cartesian3.fromDegrees(d.entry_interface.lon, d.entry_interface.lat, d.entry_interface.alt_km * 1000),
      point: { pixelSize: 11, color: Cesium.Color.fromCssColorString(cssVar('--color-amber')), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: {
        text: `ENTRY INTERFACE ${d.entry_interface.alt_km} km`,
        font: '600 11px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString(cssVar('--color-amber')),
        pixelOffset: new Cesium.Cartesian2(0, -20),
        showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
      },
    }))
  }

  // Frame the corridor.
  const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon)
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(
      Math.min(...lons) - 3, Math.min(...lats) - 3,
      Math.max(...lons) + 3, Math.max(...lats) + 3,
    ),
    duration: 1.6,
  })
}

watch(() => props.deorbit, (d) => { if (viewer) (d ? drawDeorbit(d) : clearDeorbit()) }, { deep: true })

// --- Launch trajectory drawing + rocket animation ---
const launchEntities = []
let launchTimer = null, launchRocket = null
const launchHud = reactive({ active: false, phase: '', speed: '0', alt: '0', eta: '', orbits: 0 })
const launchActive = ref(false)
function clearLaunch() {
  if (launchTimer) { clearInterval(launchTimer); launchTimer = null }
  for (const e of launchEntities) viewer.entities.remove(e)
  launchEntities.length = 0; launchRocket = null
  launchHud.active = false; launchActive.value = false
}
function exitLaunch() { clearLaunch(); currentLaunch = null; emit('launch-clear'); if (viewer) viewer.camera.flyHome(1.2) }
let currentLaunch = null
function drawLaunch(p) {
  clearLaunch()
  if (!p || !p.ascent_path) return
  currentLaunch = p
  const cart = (o) => new Cesium.Cartesian3(o.x, o.y, o.z)
  const ascent = p.ascent_path.map(cart), ring = p.orbit_ring.map(cart)
  // launch site
  launchEntities.push(viewer.entities.add({
    position: cart(p.launch_site_ecef),
    point: { pixelSize: 12, color: Cesium.Color.fromCssColorString(cssVar('--accent-blue')), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: 'LAUNCH SITE', font: '700 11px ui-monospace, monospace', fillColor: Cesium.Color.fromCssColorString(cssVar('--accent-blue')),
      showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#050a12').withAlpha(0.9), pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY },
  }))
  // ascent (orange) + target orbit (cyan)
  launchEntities.push(viewer.entities.add({ polyline: { positions: ascent, width: 3.5, arcType: Cesium.ArcType.NONE, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: Cesium.Color.fromCssColorString(cssVar('--color-amber')) }) } }))
  launchEntities.push(viewer.entities.add({ polyline: { positions: ring, width: 2.5, arcType: Cesium.ArcType.NONE, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: Cesium.Color.fromCssColorString(cssVar('--accent-blue')) }) } }))
  // animated rocket
  launchRocket = viewer.entities.add({
    position: ascent[0],
    point: { pixelSize: 11, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString(cssVar('--color-amber')), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: '▲ VEHICLE', font: '700 10px ui-monospace, monospace', fillColor: Cesium.Color.WHITE, showBackground: true, backgroundColor: Cesium.Color.fromCssColorString(cssVar('--color-amber')).withAlpha(0.9), pixelOffset: new Cesium.Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY },
  })
  launchEntities.push(launchRocket)
  launchActive.value = true
  if (viewer) viewer.flyTo(launchEntities, { duration: 1.6 }).catch(() => {})
}
// Run the real-physics ascent simulation (separate, optional step after PLAN).
function simulateLaunch() {
  const p = currentLaunch
  if (!p || launchTimer) return
  const cart = (o) => new Cesium.Cartesian3(o.x, o.y, o.z)
  const ascent = p.ascent_path.map(cart), ring = p.orbit_ring.map(cart)
  const vOrb = p.orbit_velocity_kms || 7.6, altKm = p.target_alt_km || 550, periodMin = p.period_min || 95
  const ASCENT_REAL = 510, ASCENT_SIM = 14, ORBIT_SIM = 9   // slow climb → orbit (compressed for viewing)
  launchHud.active = true
  const t0 = performance.now()
  launchTimer = setInterval(() => {
    const wall = (performance.now() - t0) / 1000
    if (wall < ASCENT_SIM) {
      const u = wall / ASCENT_SIM
      launchRocket.position = ascent[Math.min(ascent.length - 1, Math.floor(u * (ascent.length - 1)))]
      launchHud.phase = u < 0.15 ? 'LIFTOFF' : u < 0.6 ? 'ASCENT · GRAVITY TURN' : 'INSERTION BURN'
      launchHud.speed = (vOrb * Math.pow(u, 0.6)).toFixed(2)
      launchHud.alt = (altKm * Math.pow(u, 0.8)).toFixed(0)
      launchHud.eta = `orbit in T-${Math.ceil(ASCENT_REAL * (1 - u))}s`
      launchHud.orbits = 0
    } else {
      const orbWall = wall - ASCENT_SIM
      launchRocket.position = ring[Math.floor(((orbWall % ORBIT_SIM) / ORBIT_SIM) * (ring.length - 1))]
      launchHud.phase = 'IN ORBIT ✓'; launchHud.speed = vOrb.toFixed(2); launchHud.alt = String(altKm)
      launchHud.orbits = Math.floor(orbWall / ORBIT_SIM) + 1
      launchHud.eta = `orbit ${launchHud.orbits} · period ${periodMin.toFixed(0)} min`
    }
  }, 40)
}
watch(() => props.launchPlan, (p) => { if (viewer) (p ? drawLaunch(p) : (currentLaunch = null, clearLaunch())) })
defineExpose({ agentShowConjunction, agentReroute, simulateLaunch, agentTrack, agentZoom, playApproach, stopApproach, showGlobalGround, hideGlobalGround })

// --- Reroute planning from the left "predicted close approaches" panel ---
const selectedConj = ref(null)
const planResult = ref(null)
const planning = ref(false)
function selectConj(c) {
  selectedConj.value = c
  planResult.value = null
  clearPlan()
  isolateConjunction(c)        // hide other conjunctions + satellites, ring the selection
  flyToConjunction(c)
}
async function planReroute() {
  if (!selectedConj.value || planning.value) return
  planning.value = true
  try {
    const res = await fetch('/api/maneuver/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conjunction_id: selectedConj.value.id }),
    })
    const data = await res.json()
    if (res.ok && !data.error) { planResult.value = data; drawPlan(data); emit('reroute-planned', data) }
  } catch { /* ignore */ }
  planning.value = false
}
function clearReroute() {
  planResult.value = null
  selectedConj.value = null
  clearPlan()
  restoreAll()                              // un-hide other conjunctions + satellites
  if (viewer) viewer.camera.flyHome(1.2)   // return to the normal globe view
}

// --- AI-agent driven controls (called from the chat) ---
async function agentShowConjunction(a, b) {
  if (!conjList.value.length) await runConjunctionScan()
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const A = norm(a), B = norm(b)
  const c = conjList.value.find((x) => {
    const n1 = norm(x.aName), n2 = norm(x.bName)
    return (n1.includes(A) && n2.includes(B)) || (n1.includes(B) && n2.includes(A))
  }) || conjList.value[0]
  if (c) selectConj(c)
  return !!c
}
async function agentReroute() { if (selectedConj.value) await planReroute() }
// Track any object in the full catalogue by name/NORAD (camera flies + follows).
async function agentTrack(query) {
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(query))
    const data = await res.json()
    const hit = (data.matches || [])[0]
    if (hit) { trackCatalogueObject(hit.norad, hit.name); return hit }
  } catch { /* ignore */ }
  return null
}
function agentZoom(dir) {
  if (!viewer) return
  const cam = viewer.camera
  if (dir === 'reset' || dir === 'home') { cam.flyHome(1.4); return }
  // Smooth animated zoom (zoomIn/zoomOut are instant → looked abrupt). Fly to the
  // same ground point at a new height, preserving the current view angle.
  const carto = cam.positionCartographic.clone()
  const h = carto.height
  const nh = dir === 'out'
    ? Math.min(h * 2.0 + 1e6, 4.5e7)        // wider view (capped near whole-Earth)
    : Math.max(h * 0.45, 4e5)               // closer view (capped ~400 km)
  cam.flyTo({
    destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, nh),
    orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll },
    duration: 1.1,
  })
}
/**
 * How many conjunctions carry a printed range label.
 *
 * Cesium has no decluttering for entity labels, so labelling all of them
 * meant a dozen "6.3 km" chips stacked on top of each other wherever the
 * events happened to cluster — which is most of the time, because debris
 * conjunctions cluster in the same shells. Every dot is still hoverable
 * and clickable; only the tightest few get a permanent label, and the
 * selected one always does.
 */
const CONJ_LABEL_LIMIT = 4

function drawConjunctions(list) {
  clearConjunctions()
  // Tightest miss distance first — those are the ones worth naming on sight.
  const labelOrder = [...list].filter((c) => c.p1 && c.p2)
    .sort((a, b) => (a.missKm ?? 1e9) - (b.missKm ?? 1e9))
    .slice(0, CONJ_LABEL_LIMIT)
  const labelled = new Map(labelOrder.map((c, i) => [c, i]))
  // Alternate above / below the dot. Four labels all sitting 20px above their
  // marker still collide when two events are close together on screen; sending
  // every other one below the dot doubles the effective spacing for free.
  const OFFSETS = [-22, 26, -22, 26]
  for (const c of list) {
    if (!c.p1 || !c.p2) continue                   // ECEF positions at TCA from the gateway
    const pa = new Cesium.Cartesian3(c.p1.x, c.p1.y, c.p1.z)
    const pb = new Cesium.Cartesian3(c.p2.x, c.p2.y, c.p2.z)
    const mid = Cesium.Cartesian3.midpoint(pa, pb, new Cesium.Cartesian3())
    const col = Cesium.Color.fromCssColorString(conjColor(c.missKm))
    const lineEnt = viewer.entities.add({
      polyline: { positions: [pa, pb], width: 2, arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: col }) },
    })
    const dotEnt = viewer.entities.add({
      position: mid,
      point: { pixelSize: 13, color: col.withAlpha(0.85), outlineColor: Cesium.Color.WHITE, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: labelled.has(c) ? {
        text: c.missKm.toFixed(1) + ' km',
        // SYSTEM font only — never a webfont. Cesium rasterises labels onto a
        // canvas using measured glyph advances; if the webfont has not finished
        // loading at raster time the advances come back wrong and the glyphs
        // draw on top of each other ("5.2 km" rendered as overlapping mush).
        // A system stack is always resolvable, so the metrics are always right.
        font: 'bold 12px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace',
        fillColor: col,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString(cssVar('--bg-deep')).withAlpha(0.88),
        backgroundPadding: new Cesium.Cartesian2(7, 5),
        pixelOffset: new Cesium.Cartesian2(0, OFFSETS[labelled.get(c) % OFFSETS.length]),
        verticalOrigin: OFFSETS[labelled.get(c) % OFFSETS.length] < 0
          ? Cesium.VerticalOrigin.BOTTOM
          : Cesium.VerticalOrigin.TOP,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
    })
    dotEnt._conjMeta = c                       // clickable / hoverable conjunction dot
    conjEntities.push(lineEnt, dotEnt)
    c._mid = mid
    c._ents = [lineEnt, dotEnt]
  }
}

// Isolate one conjunction: hide the others + all satellites, ring the selection.
const selectionEnts = []
let isolatingConj = false
function clearSelectionVisual() { for (const e of selectionEnts) viewer.entities.remove(e); selectionEnts.length = 0 }
function isolateConjunction(c) {
  for (const e of conjEntities) e.show = !!(c._ents && c._ents.includes(e))
  isolatingConj = true
  for (const e of satEntities.values()) e.show = false
  if (cataloguePoints) cataloguePoints.show = false
  clearSelectionVisual()
  for (const p of [c.p1, c.p2]) {
    if (!p) continue
    selectionEnts.push(viewer.entities.add({
      position: new Cesium.Cartesian3(p.x, p.y, p.z),
      point: { pixelSize: 28, color: Cesium.Color.TRANSPARENT, outlineColor: Cesium.Color.fromCssColorString(cssVar('--color-purple')), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }))
  }
}
function restoreAll() {
  for (const e of conjEntities) e.show = true
  clearSelectionVisual()
  isolatingConj = false
  applyFilters()
  if (showAll.value && cataloguePoints) cataloguePoints.show = true
}
function flyToConjunction(c) {
  if (!c._mid) return
  const out = Cesium.Cartesian3.multiplyByScalar(Cesium.Cartesian3.normalize(c._mid, new Cesium.Cartesian3()), 1_400_000, new Cesium.Cartesian3())
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.add(c._mid, out, new Cesium.Cartesian3()), duration: 2 })
}
// "in 4h 12m" countdown to TCA.
function tcaCountdown(tcaMs) {
  let s = Math.round((tcaMs - Date.now()) / 1000)
  const past = s < 0; s = Math.abs(s)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return (past ? '-' : '') + (h ? h + 'h ' : '') + m + 'm'
}
const nowTick = ref(0)            // ticks each second so countdowns re-render
let nowTickTimer = null
function shortName(n) { return (n || '').replace(/\s+/g, ' ').trim().slice(0, 17) }
function fmtPc(pc) {
  if (!pc || pc <= 0) return 'negligible'
  const inv = 1 / pc
  if (inv > 1e8) return 'negligible'                 // far miss → effectively zero
  return '1 in ' + Math.round(inv).toLocaleString()
}

// Classify a satellite into one of the filter groups.
function groupOf(sat) {
  const op = (sat.operator || '').toUpperCase()
  const nm = (sat.name || '').toUpperCase()
  if (op === 'DEBRIS' || nm.includes('DEB') || nm.includes('R/B')) return 'debris'
  if (op === 'SPACEX' || nm.includes('STARLINK')) return 'starlink'
  if (op === 'ONEWEB' || nm.includes('ONEWEB')) return 'oneweb'
  if (op.includes('NASA') || op === 'STATION' || nm.includes('ISS') || nm.includes('CSS') || nm.includes('TIANHE')) return 'stations'
  return 'other'
}
const groupCounts = computed(() => {
  const c = { stations: 0, starlink: 0, oneweb: 0, debris: 0, other: 0 }
  for (const sat of [...(props.satellites || []), ...extraSats.value]) c[groupOf(sat)]++
  return c
})

// Show/hide each satellite entity per the active filters.
function applyFilters() {
  if (isolatingConj) { for (const entity of satEntities.values()) entity.show = false; return }
  for (const entity of satEntities.values()) {
    const sat = entity._satData
    if (!sat) continue
    const inGroup = enabled[groupOf(sat)]
    const danger = !dangerousOnly.value || (sat.risk_score ?? 0) >= 70
    entity.show = inGroup && danger
  }
}
watch([enabled, dangerousOnly], applyFilters, { deep: true })
function selectResult(sat) {
  searchQuery.value = ''
  ensureSatEntity(sat)
  trackSat(sat)
}
// Click any object in the full cloud → make it a trackable entity and follow it.
function trackCatalogueObject(norad, name) {
  const sat = {
    id: 100000 + norad,
    norad_id: norad,
    name: name || ('NORAD ' + norad),
    operator: 'CATALOGUED',
    risk_score: 0,
    _catalogue: true,
  }
  ensureSatEntity(sat)
  trackSat(sat)
}
// Fetch ANY catalogued object by NORAD id (one CATNR request), then track it.
async function searchByNorad() {
  const nid = parseInt(searchQuery.value.trim())
  if (!nid) return
  searchBusy.value = true
  const rec = await loadByNorad(nid)
  searchBusy.value = false
  if (!rec) return
  if (!extraSats.value.find(s => s.norad_id === nid)) extraSats.value = [...extraSats.value, rec]
  searchQuery.value = ''
  ensureSatEntity(rec)
  trackSat(rec)
}

// ── Orbit path line ──────────────────────────────────────────────────────────
// A glowing cyan polyline tracing one full orbital period of the selected
// satellite, refreshed every 15 s so the satellite never drifts off its line.
const RE = 6371            // Earth radius (km)
const MU = 398600.4418     // standard gravitational parameter (km^3/s^2)
let orbitEntity = null
let orbitTimer = null

function clearOrbit() {
  if (orbitTimer) { clearInterval(orbitTimer); orbitTimer = null }
  if (orbitEntity) { viewer.entities.remove(orbitEntity); orbitEntity = null }
}

function showOrbit(sat) {
  drawOrbit(sat)
  if (orbitTimer) clearInterval(orbitTimer)
  orbitTimer = setInterval(() => { if (trackedSat.value) drawOrbit(sat) }, 30000)
}

function drawOrbit(sat) {
  if (orbitEntity) { viewer.entities.remove(orbitEntity); orbitEntity = null }
  if (!hasRealOrbit(sat.norad_id)) return     // need a real orbit to trace
  // Sample the INERTIAL orbit ellipse once; render it rotated into the current
  // Earth-fixed frame each frame. Proper ring for ANY orbit (GEO = circle), and
  // the satellite always sits on it (no Earth-rotation warp / figure-8).
  const jsDate = Cesium.JulianDate.toDate(viewer.clock.currentTime)
  const eci = orbitEciKm(sat.norad_id, jsDate, 240)
  if (eci.length < 2) return
  orbitEntity = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty((time) => {
        const gmst = gmstOf(Cesium.JulianDate.toDate(time))
        const arr = []
        for (const p of eci) {
          const e = eciKmToEcefMeters(p, gmst)
          arr.push(new Cesium.Cartesian3(e.x, e.y, e.z))
        }
        return arr
      }, false),
      width: 1.8,
      arcType: Cesium.ArcType.NONE,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.85),
      }),
    },
  })
}

// Live details readout for the tracked satellite, refreshed 4×/s.
function startInfoUpdates(sat) {
  const update = () => {
    const entity = satEntities.get(sat.id)
    const pos = entity && entity.position.getValue(viewer.clock.currentTime)
    if (!pos) return
    const c = Cesium.Cartographic.fromCartesian(pos)
    const altKm = c.height / 1000
    trackInfo.value = {
      name: sat.name,
      norad: sat.norad_id,
      operator: sat.operator || '—',
      risk: sat.risk_score ?? null,
      lat: Cesium.Math.toDegrees(c.latitude),
      lon: Cesium.Math.toDegrees(c.longitude),
      alt: altKm,
      speed: Math.sqrt(MU / (RE + altKm)),   // circular-orbit speed (km/s)
    }
  }
  update()
  if (infoTimer) clearInterval(infoTimer)
  infoTimer = setInterval(update, 250)
}
function stopInfoUpdates() {
  if (infoTimer) { clearInterval(infoTimer); infoTimer = null }
  trackInfo.value = null
}

// Fly in to a satellite and follow it as it orbits. Cesium's trackedEntity
// smoothly flies the camera in (no snap) and then keeps it locked on.
// Current Earth-fixed position of a satellite via the proven ecefAt path
// (same one that moves the cloud); falls back to the entity's own position.
function livePos(sat) {
  const nid = sat && sat.norad_id
  if (nid && hasRealOrbit(nid)) {
    const e = ecefAt(nid, Cesium.JulianDate.toDate(viewer.clock.currentTime))
    if (e) return new Cesium.Cartesian3(e.x, e.y, e.z)
  }
  const ent = satEntities.get(sat.id)
  return ent ? ent.position.getValue(viewer.clock.currentTime) : undefined
}

let trackedModelEnt = null
function restoreModelVis(e) {
  if (!e) return
  if (e.model) e.model.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(0, 2_500_000)
  if (e.point) e.point.show = true
}
function trackSat(sat) {
  const entity = satEntities.get(sat.id)
  if (!entity) return
  emit('satellite-click', sat)
  trackedSat.value = sat
  // Keep the SELECTED model visible at ANY zoom (don't collapse to a dot).
  restoreModelVis(trackedModelEnt)
  trackedModelEnt = entity
  if (entity.model) entity.model.distanceDisplayCondition = undefined
  if (entity.point) entity.point.show = false
  showOrbit(sat)                    // trace the satellite's orbit path
  startInfoUpdates(sat)            // live lat/lon/alt/speed readout

  // Start from a clean world frame (drop any leftover tracking transform).
  viewer.trackedEntity = undefined
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)

  const p0 = livePos(sat) || entity.position.getValue(viewer.clock.currentTime)
  smoothPos = p0 ? p0.clone() : null
  trackedReal = entity

  // Build the SAME interpolated property the tracker will use, and compute the
  // fly-in target FROM it — so the camera ends exactly where tracking begins
  // (identical position AND interpolation) → perfectly smooth handoff.
  const nid = sat.norad_id
  const vf = viewFromFor(nid)          // closer for small objects
  const sampled = (nid && hasRealOrbit(nid)) ? buildSampledOrbit(nid) : null
  const attach = () => {
    if (!viewer || viewer.isDestroyed() || trackedSat.value?.id !== sat.id) return
    camTargetEntity.position = sampled || camFallbackPos
    camTargetEntity.viewFrom = vf
    viewer.trackedEntity = camTargetEntity
  }

  const FLY_MS = 1800
  let pose = sampled ? poseFromProp(sampled, FLY_MS, vf) : null
  // Fallback: if the velocity-frame pose couldn't be built (no sampled orbit), still
  // fly in smoothly — offset radially-back from the object and look at it.
  if (!pose && smoothPos) {
    const radial = Cesium.Cartesian3.normalize(smoothPos, new Cesium.Cartesian3())
    const dist = Cesium.Cartesian3.magnitude(vf) || 600000
    const dest = Cesium.Cartesian3.add(smoothPos, Cesium.Cartesian3.multiplyByScalar(radial, dist, new Cesium.Cartesian3()), new Cesium.Cartesian3())
    const dir = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(smoothPos, dest, new Cesium.Cartesian3()), new Cesium.Cartesian3())
    pose = { dest, dir, up: radial }
  }
  if (!smoothPos || !pose) { attach(); return }
  viewer.camera.flyTo({
    destination: pose.dest,
    orientation: { direction: pose.dir, up: pose.up },
    duration: FLY_MS / 1000,
    complete: attach,
    cancel: attach,   // attach even if interrupted
  })
}

// Return button: release the lock and fly back to the full-Earth overview.
function stopTracking() {
  clearOrbit()
  stopInfoUpdates()
  restoreModelVis(trackedModelEnt)   // let it collapse back to a dot when far again
  trackedModelEnt = null
  if (camFallbackPos) camTargetEntity.position = camFallbackPos   // reset for next track
  viewer.trackedEntity = undefined
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  trackedReal = null
  smoothPos = null
  trackedSat.value = null
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(20, 20, 22_000_000),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 1.5,
  })
}

onUnmounted(() => {
  if (cloudTimer) clearInterval(cloudTimer)
  if (orbitTimer) clearInterval(orbitTimer)
  if (infoTimer) clearInterval(infoTimer)
  if (catalogueTimer) clearInterval(catalogueTimer)
  if (nowTickTimer) clearInterval(nowTickTimer)
  if (clickHandler && !clickHandler.isDestroyed()) clickHandler.destroy()
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
  viewer = null
})
</script>

<style scoped>
.globe-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
/* =====================================================================
   HUD ZONES

   Every floating element on the globe belongs to exactly ONE of these
   containers. Nothing on the globe is positioned by a hand-picked pixel
   offset any more, which is the only reason the old HUD overlapped:
   six elements each choosing their own `top` and `bottom` will always
   eventually choose the same one.
   ================================================================== */
.hud-top,
.hud-bottom {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-globe-hud);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s3);
  width: min(460px, calc(100% - var(--s7)));
  /* The zone itself must not eat globe drags — only its contents. */
  pointer-events: none;
}
.hud-top { top: var(--s4); }
.hud-bottom { bottom: var(--s5); align-items: center; }
.hud-top > *,
.hud-bottom > * { pointer-events: auto; }

/* ---------------- search ---------------- */
.sat-search {
  position: relative;
  /* Above the launch HUD below it, so the results dropdown lands ON the
     HUD rather than being painted under it by source order. */
  z-index: 2;
  width: 100%;
  max-width: 380px;
  font-family: var(--font-mono);
  font-size: var(--t-body);
}
.sat-search-icon {
  position: absolute;
  left: 13px;
  top: 12px;
  display: flex;
  color: var(--text-dim);
  pointer-events: none;
}
.sat-search-input {
  width: 100%;
  height: 38px;
  padding: 0 34px 0 34px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-radius: var(--r1);
  color: var(--text-primary);
  font: 400 var(--t-body)/1 var(--font-mono);
  outline: none;
  box-shadow: var(--e2);
  transition: border-color var(--dur-1);
}
.sat-search-input::placeholder { color: var(--text-dim); }
.sat-search-input:focus { border-color: var(--accent-blue); }
.sat-search:focus-within .sat-search-icon { color: var(--accent-blue); }
.sat-search-clear {
  position: absolute;
  right: 6px;
  top: 6px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: var(--r1);
  background: none;
  color: var(--text-dim);
  font-size: 16px;
  line-height: 1;
}
.sat-search-clear:hover { color: var(--text-primary); background: var(--hover-wash); }

.sat-search-results {
  position: absolute;
  top: calc(100% + var(--s2));
  left: 0;
  right: 0;
  max-height: 46vh;
  overflow-y: auto;
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-radius: var(--r1);
  box-shadow: var(--e3);
}
.sat-search-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.sat-search-row:last-child { border-bottom: none; }
.sat-search-row:hover { background: var(--hover-wash); }
.ssr-name { color: var(--text-primary); font-size: var(--t-body); font-weight: 500; }
.ssr-meta { color: var(--text-dim); font-size: var(--t-label); }
.sat-search-row.fetch { color: var(--accent-blue); font-weight: 600; }
/* Left-edge tab for the conjunctions sidebar */
.conj-tab {
  position: absolute;
  top: 120px;
  left: 0;
  z-index: 7;
  width: 40px;
  height: 132px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(220,38,38,0.18), rgba(220,38,38,0.07));
  border: 1px solid rgba(239,68,68,0.5);
  border-left: none;
  border-radius: 0 8px 8px 0;
  color: #ffd9d4;
  cursor: pointer;
  box-shadow: 0 0 18px rgba(239,68,68,0.22), 2px 0 12px rgba(0,0,0,0.4);
  transition: transform 0.28s ease, background 0.15s;
}
.conj-tab { display: none; }   /* superseded by the dock's Risk Monitor */
.conj-tab.shifted { transform: translateX(300px); }
.conj-tab:hover { background: rgba(239,68,68,0.28); }
.conj-tab-label { writing-mode: vertical-rl; text-orientation: mixed; transform: rotate(180deg); font: 700 10px/1 ui-monospace, monospace; letter-spacing: 0.14em; }

.conj-panel {
  position: absolute;
  top: 0;
  left: 0;
  width: 300px;
  height: 100%;
  box-sizing: border-box;
  padding: 14px 12px;
  z-index: 6;
  background: rgba(6, 12, 22, 0.94);
  border-right: 1px solid rgba(239,68,68,0.3);
  backdrop-filter: blur(6px);
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.28s ease;
  font: 12px/1.3 ui-monospace, monospace;
}
.conj-panel.open { transform: translateX(0); }
.conj-refresh { float: right; background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 13px; }
.conj-refresh:hover { color: var(--text-primary); }
.conj-refresh.spin { animation: cspin 1s linear infinite; display: inline-block; }
@keyframes cspin { to { transform: rotate(360deg); } }
.conj-empty { color: var(--text-dim); font-size: 11px; padding: 12px 4px; }
.conj-list { overflow-y: auto; flex: 1; min-height: 0; }
.conj-scan {
  width: 100%;
  padding: 9px 12px;
  background: rgba(40, 12, 12, 0.88);
  border: 1px solid #b0413b;
  border-radius: 6px;
  color: #ffd0c4;
  font: 700 12px/1 ui-monospace, monospace;
  letter-spacing: 0.06em;
  cursor: pointer;
  backdrop-filter: blur(4px);
}
.conj-scan:disabled { cursor: default; opacity: 0.85; }
.conj-scan:not(:disabled):hover { background: rgba(70, 20, 20, 0.95); border-color: var(--color-red); }
.conj-bar { height: 3px; margin-top: 4px; background: rgba(176, 65, 59, 0.25); border-radius: 2px; overflow: hidden; }
.conj-bar-fill { height: 100%; background: var(--color-red); transition: width 0.2s; }
.conj-list {
  margin-top: 8px;
  /* was max-height: calc(100vh - 210px) — a viewport measurement inside a
     flex child, which overflowed its own parent whenever the two
     disagreed. The flex rule above already sizes it correctly. */
  overflow-y: auto;
  background: var(--glass-strong);
  border: 1px solid var(--border);
  border-radius: var(--r1);
}
.conj-list::-webkit-scrollbar { width: 6px; }
.conj-list::-webkit-scrollbar-thumb { background: var(--border-bright); border-radius: 3px; }
.conj-head { padding: 7px 12px; color: var(--text-secondary); font-size: 10px; letter-spacing: 0.08em; border-bottom: 1px solid var(--bg-panel-2); }
.conj-row { padding: 7px 12px; cursor: pointer; border-bottom: 1px solid rgba(30, 58, 95, 0.5); }
.conj-row:hover { background: rgba(30, 60, 100, 0.5); }
.conj-row.selected { background: rgba(201, 162, 39, 0.22); box-shadow: inset 3px 0 0 var(--accent-blue); }
.conj-names { color: var(--text-primary); font-weight: 600; }
.conj-names .x { color: var(--color-red); }
.conj-meta { display: flex; gap: 10px; margin-top: 2px; color: #8fb0d0; font-size: 11px; }
.conj-miss { font-weight: 700; }
.conj-pc { color: var(--text-dim); font-size: 10px; margin-top: 1px; }
.conj-foot { padding: 6px 12px; color: var(--text-dim); font-size: 9px; font-style: italic; }

/* ---------------- bottom-stack actions ---------------- */
.reroute-actions {
  display: flex;
  gap: var(--s2);
  flex-wrap: wrap;
  justify-content: center;
}
.reroute-btn2 {
  height: 40px;
  padding: 0 var(--s5);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-radius: var(--r1);
  color: var(--text-primary);
  font: 600 11px/40px var(--font-mono);
  letter-spacing: 0.14em;
  cursor: pointer;
  box-shadow: var(--e2);
  transition: background var(--dur-1), border-color var(--dur-1), color var(--dur-1);
}
.reroute-btn2:hover { background: var(--bg-panel-2); border-color: var(--text-dim); }
.reroute-btn2:disabled { opacity: 0.6; cursor: wait; }
/* Exactly one button in the group is the primary action, and it is the
   only one carrying the accent. Everything used to glow at once. */
.reroute-btn2.primary { border-color: var(--accent-blue); color: var(--accent-blue); }
.reroute-btn2.primary:not(:disabled):hover { background: var(--accent-blue-dim); }
.reroute-btn2.back { color: var(--text-secondary); }
.reroute-btn2.launch { border-color: var(--color-amber); color: var(--color-amber); }
.reroute-btn2.launch:hover { background: var(--color-amber-dim); }

/* ---------------- reroute result card ----------------
   Anchored INSIDE the globe column (absolute, not fixed), so it can no
   longer be laid over the dock on a narrow window; and it steps aside
   when the filter drawer opens instead of sitting underneath it. */
.reroute-card {
  position: absolute;
  top: var(--s4);
  right: var(--s5);
  width: 320px;
  max-height: calc(100% - var(--s7));
  overflow-y: auto;
  z-index: var(--z-globe-hud);
  padding: var(--s4);
  border: 1px solid var(--border-bright);
  border-radius: var(--r2);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  box-shadow: var(--e3);
  font-family: var(--font-mono);
  font-size: var(--t-body);
  line-height: 1.5;
  transition: right var(--dur-3) var(--ease);
}
.reroute-card.shifted { right: calc(240px + var(--s5)); }
.rc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--s3); }
.rc-title { color: var(--color-green); font-weight: 700; font-size: var(--t-label); letter-spacing: 0.14em; }
.rc-close { background: none; color: var(--text-dim); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; }
.rc-close:hover { color: var(--text-primary); }
.rc-stats { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); margin-bottom: var(--s3); }
.rc-stats > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.rc-stats span { color: var(--text-dim); font-size: var(--t-micro); letter-spacing: 0.14em; }
.rc-stats b { color: var(--text-primary); font-size: var(--t-body); font-weight: 600; }
.rc-stats b.ok { color: var(--color-green); }
.rc-stats b.bad { color: var(--color-red); }
.rc-mans { display: flex; flex-direction: column; gap: var(--s2); }
.rc-man { border-left: 2px solid var(--border-bright); padding-left: var(--s3); display: flex; flex-direction: column; gap: 2px; }
.rc-sat { color: var(--text-primary); font-weight: 700; font-size: var(--t-label); letter-spacing: 0.06em; }
.rc-act { color: var(--text-secondary); font-size: var(--t-body); }
.rc-act b { color: var(--text-primary); }
.rc-deb { color: var(--text-dim); font-size: var(--t-label); font-style: italic; }
.rc-legend { display: flex; gap: var(--s4); flex-wrap: wrap; margin-top: var(--s3); padding-top: var(--s3); border-top: 1px solid var(--border); font-size: var(--t-micro); }

/* ---------------- launch telemetry ---------------- */
.launch-hud {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  padding: var(--s3) var(--s5);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-left: 2px solid var(--color-amber);
  border-radius: var(--r1);
  box-shadow: var(--e2);
  width: 100%;
}
.lh-phase {
  font: 600 var(--t-label)/1 var(--font-mono);
  letter-spacing: 0.18em;
  color: var(--color-amber);
  text-align: center;
  text-transform: uppercase;
}
.lh-stats { display: flex; justify-content: space-around; gap: var(--s4); }
.lh-stats > div { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.lh-stats span { font: var(--t-micro)/1 var(--font-mono); letter-spacing: 0.16em; color: var(--text-dim); }
.lh-stats b {
  font: 600 var(--t-num)/1 var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  display: flex; align-items: baseline; gap: 3px;
}
.lh-stats b i { font: 400 var(--t-label)/1 var(--font-mono); color: var(--text-dim); font-style: normal; }
.lh-eta { font-size: var(--t-body) !important; color: var(--color-green) !important; }

/* ---------------- route tooltip + detail ---------------- */
.route-tip {
  position: absolute;
  z-index: var(--z-float);
  pointer-events: none;
  padding: 6px 10px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-radius: var(--r1);
  box-shadow: var(--e2);
  font: 600 var(--t-body)/1.3 var(--font-mono);
}
.rt-sat { font-weight: 700; }
.rt-type { color: var(--text-dim); font-size: var(--t-micro); margin-top: 3px; letter-spacing: 0.14em; }

.route-sel {
  position: relative;
  width: 100%;
  padding: var(--s3) var(--s7) var(--s3) var(--s4);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-left-width: 2px;
  border-radius: var(--r1);
  box-shadow: var(--e2);
  font-family: var(--font-mono);
  font-size: var(--t-body);
  line-height: 1.45;
}
.rs-close {
  position: absolute; top: 6px; right: 6px;
  width: 26px; height: 26px; display: grid; place-items: center;
  border-radius: var(--r1); background: none;
  color: var(--text-dim); font-size: 16px; cursor: pointer;
}
.rs-close:hover { color: var(--text-primary); background: var(--hover-wash); }
.rs-sat { font-weight: 700; font-size: var(--t-read); letter-spacing: 0.06em; }
.rs-type { color: var(--text-dim); font-size: var(--t-micro); letter-spacing: 0.16em; margin: 3px 0 6px; }
.rs-sub { color: var(--text-secondary); font-size: var(--t-body); }

/* ---------------- tracking ---------------- */
.return-btn {
  position: absolute;
  top: var(--s4);
  left: var(--s4);
  z-index: var(--z-globe-hud);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: var(--s2) var(--s4);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-radius: var(--r1);
  box-shadow: var(--e2);
  color: var(--text-primary);
  font: 600 var(--t-body)/1.1 var(--font-mono);
  letter-spacing: 0.12em;
  cursor: pointer;
  transition: background var(--dur-1), border-color var(--dur-1);
}
.return-btn:hover { background: var(--bg-panel-2); border-color: var(--text-dim); }
.return-sub {
  font-weight: 400;
  font-size: var(--t-label);
  color: var(--text-dim);
  text-transform: none;
  letter-spacing: 0.04em;
}
.sat-info {
  position: absolute;
  left: var(--s4);
  bottom: var(--s4);
  width: 236px;
  padding: var(--s4);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-left: 2px solid var(--accent-blue);
  border-radius: var(--r1);
  box-shadow: var(--e2);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--t-body);
  line-height: 1.4;
  z-index: var(--z-globe-hud);
}
.si-name { font-size: var(--t-read); font-weight: 700; letter-spacing: 0.04em; }
.si-sub { color: var(--text-dim); font-size: var(--t-label); margin-bottom: var(--s3); }
.si-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s2) var(--s3);
}
.si-grid div { display: flex; flex-direction: column; gap: 3px; font-variant-numeric: tabular-nums; }
.si-grid span { color: var(--text-dim); font-size: var(--t-micro); letter-spacing: 0.14em; }
.si-risk {
  margin-top: var(--s3);
  padding: 5px 8px;
  border-radius: 4px;
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-align: center;
}
/* These three used to read `1px solid var(--color-red)55` — a var()
   followed by a bare `55`, which is not a colour, so the whole border
   declaration was dropped and the badges rendered borderless. */
.risk-high { background: var(--color-red-dim); color: var(--color-red); border: 1px solid rgba(255, 95, 86, 0.4); }
.risk-med  { background: var(--color-amber-dim); color: var(--color-amber); border: 1px solid rgba(224, 163, 46, 0.4); }
.risk-low  { background: var(--color-green-dim); color: var(--color-green); border: 1px solid rgba(76, 199, 106, 0.4); }

/* ---------------- filter drawer ----------------
   The trigger is a PILL. It was a 40px circle containing the 46px word
   "FILTERS", so the label hung out of both sides of its own button. */
.filter-tab {
  position: absolute;
  right: var(--s5);
  /* clears the AI tab (40px tall, --s5 from the bottom) with a gap */
  bottom: calc(var(--s5) + 40px + var(--s2));
  z-index: var(--z-globe-hud);
  height: 36px;
  padding: 0 var(--s4);
  display: flex;
  align-items: center;
  gap: var(--s2);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border);
  border-radius: 99px;
  box-shadow: var(--e2);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--dur-1), background var(--dur-1), border-color var(--dur-1), right var(--dur-3) var(--ease);
}
.filter-tab-icon { display: flex; }
.filter-tab-label {
  font: 600 var(--t-label)/1 var(--font-mono);
  letter-spacing: 0.16em;
}
.filter-tab.shifted { right: calc(240px + var(--s5)); }
.filter-tab:hover { background: var(--bg-panel-2); border-color: var(--border-bright); color: var(--text-primary); }
.filter-tab[aria-expanded='true'] { color: var(--text-primary); border-color: var(--border-bright); }

.filter-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 240px;
  height: 100%;
  overflow-y: auto;
  padding: var(--s5) var(--s4);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border-left: 1px solid var(--border);
  transform: translateX(100%);
  transition: transform var(--dur-3) var(--ease);
  z-index: var(--z-globe-panel);
  font-family: var(--font-mono);
  font-size: var(--t-body);
  line-height: 1.4;
}
.filter-panel.open { transform: translateX(0); }
.fp-title {
  color: var(--text-dim);
  font-size: var(--t-micro);
  letter-spacing: 0.22em;
  margin-bottom: var(--s4);
}
.fp-row {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-height: 32px;
  padding: 5px 6px;
  margin: 0 -6px;
  border-radius: var(--r1);
  cursor: pointer;
  color: var(--text-primary);
  transition: background var(--dur-1);
}
.fp-row:hover { background: var(--hover-wash); }
.fp-row input { accent-color: var(--accent-blue); cursor: pointer; flex: none; }
.fp-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.fp-label { flex: 1; min-width: 0; font-size: var(--t-body); }
.fp-count { color: var(--text-dim); font-size: var(--t-label); font-variant-numeric: tabular-nums; }
.fp-sep { height: 1px; background: var(--border); margin: var(--s3) 0; }
.fp-row.danger { color: var(--color-amber); }
.fp-row.allobj { color: var(--text-secondary); }
.fp-hint { color: var(--text-dim); font-size: var(--t-label); line-height: 1.45; margin: 4px 0 var(--s2); }
.fp-row.models { color: var(--text-primary); }
.fp-num {
  width: 68px;
  padding: 5px 7px;
  background: var(--bg-panel-3);
  border: 1px solid var(--border-bright);
  border-radius: 4px;
  color: var(--text-primary);
  font: var(--t-body) var(--font-mono);
}
.fp-num:focus { outline: none; border-color: var(--accent-blue); }

/* On a narrow frame the drawer takes the whole globe column rather than
   leaving a 40px slot the planet cannot be seen through. */
@media (max-width: 900px) {
  .filter-panel { width: min(280px, 80%); }
  .filter-tab.shifted { right: calc(min(280px, 80%) + var(--s5)); }
  .reroute-card { width: min(320px, calc(100% - var(--s6))); }
  .reroute-card.shifted { right: var(--s5); }
}

.map-key {
  position: absolute;
  left: var(--s5);
  bottom: var(--s5);
  z-index: 30;
  max-width: 300px;
  padding: 12px 14px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border);
  border-radius: var(--r1);
  pointer-events: none;
}
.mk-title { font: 600 9px/1 var(--font-mono); letter-spacing: .2em; color: var(--text-dim); margin-bottom: 8px; }
.mk-sec { font: 600 9.5px/1.4 var(--font-display); letter-spacing: .08em; color: var(--text-secondary); margin: 8px 0 5px; }
.mk-row { display: flex; align-items: center; gap: 8px; font: 400 10.5px/1.6 var(--font-display); color: var(--text-primary); }
.mk-swatch { width: 14px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.mk-hatch { background: repeating-linear-gradient(45deg, rgba(160,160,170,.7), rgba(160,160,170,.7) 2px, transparent 2px, transparent 4px); border: 1px dashed #6b7280; }
.mk-src { font: 400 9px/1.5 var(--font-mono); color: var(--text-dim); margin-top: 5px; }

.follow-btn {
  position: absolute;
  top: 74px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 35;
  padding: 11px 22px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--color-amber);
  border-radius: 999px;
  color: var(--color-amber);
  font: 600 12px/1 var(--font-mono);
  letter-spacing: .12em;
  cursor: pointer;
}
.follow-btn:hover { background: rgba(224, 163, 46, 0.18); }
.follow-btn.on { border-color: var(--color-red); color: var(--color-red); }

.descent-hud {
  position: absolute;
  top: 126px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 35;
  min-width: 260px;
  padding: 10px 14px;
  background: var(--glass-strong);
  border: 1px solid var(--border);
  border-radius: var(--r1);
}
.dh-row { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); padding: 2px 0; }
.dh-row b { color: var(--text-primary); }
.dh-bar { height: 3px; margin-top: 6px; background: var(--bg-panel-2); border-radius: 2px; overflow: hidden; }
.dh-bar i { display: block; height: 100%; background: var(--color-amber); transition: width .12s linear; }
.dh-controls { display: flex; gap: 6px; margin-top: 8px; justify-content: center; }
.dh-controls button {
  min-width: 34px; padding: 5px 8px;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  border-radius: var(--r1); color: var(--text-secondary);
  font: 600 10px/1 var(--font-mono); cursor: pointer;
}
.dh-controls button:hover { border-color: var(--border-bright); color: var(--text-primary); }
.dh-controls button.on { border-color: var(--color-amber); color: var(--color-amber); }
.dh-note { margin-top: 7px; font-size: 8.5px; color: var(--text-dim); text-align: center; }

.approach-hud {
  position: absolute;
  top: 74px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 36;
  min-width: 300px;
  padding: 14px 18px;
  text-align: center;
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-bright);
  border-radius: var(--r2);
}
.ah-pair { font-size: 11px; color: var(--text-secondary); letter-spacing: .06em; }
.ah-pair .a { color: #ff5f56; } .ah-pair .b { color: #ffb347; }
.ah-range { font: 300 34px/1.1 var(--font-display); color: var(--text-primary); margin: 6px 0 2px; transition: color .2s; }
.ah-range.close { color: var(--color-red); }
.ah-sub { font-size: 10px; color: var(--text-dim); }
.ah-verdict { margin-top: 9px; padding: 7px 0; border-radius: var(--r1); font: 700 13px/1 var(--font-mono); letter-spacing: .14em; }
.ah-verdict.v-blocked { background: rgba(255,95,86,.16); color: var(--color-red); border: 1px solid var(--color-red); }
.ah-verdict.v-complete { background: rgba(76,199,106,.14); color: var(--color-green); border: 1px solid var(--color-green); }
.ah-verdict.v-partial { background: rgba(224,163,46,.14); color: var(--color-amber); border: 1px solid var(--color-amber); }
.ah-verdict.v-unresolved { background: rgba(139,147,161,.12); color: var(--color-purple); border: 1.5px dashed var(--color-purple); }
.ah-err { font-size: 11px; color: var(--color-amber); }
.ah-x { position: absolute; top: 8px; right: 10px; background: none; border: 0; color: var(--text-dim); cursor: pointer; font-size: 13px; }
.ah-x:hover { color: var(--text-primary); }

.fp-gpu {
  display: block; width: 100%; margin: 4px 0;
  padding: 10px 0;
  background: var(--accent-blue-dim);
  border: 1px solid var(--accent-blue);
  border-radius: var(--r1);
  color: var(--text-primary);
  font: 600 10px/1 var(--font-mono); letter-spacing: .08em;
  cursor: pointer;
}
.fp-gpu:hover:not(:disabled) { background: var(--accent-blue-glow); }
.fp-gpu:disabled { opacity: .6; cursor: wait; }
.fp-gpu-out { font-size: 9.5px; line-height: 1.7; color: var(--text-secondary); padding: 6px 2px; }
.fp-gpu-out b { color: var(--text-primary); }
.fp-gpu-out .bad { color: var(--color-amber); }
.fp-gpu-note { margin-top: 4px; font-size: 8.5px; color: var(--text-dim); }
</style>

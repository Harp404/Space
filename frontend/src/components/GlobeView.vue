<template>
  <div class="globe-wrap">
    <div ref="cesiumContainer" class="cesium-container"></div>

    <div class="sat-search">
      <input
        class="sat-search-input"
        v-model="searchQuery"
        placeholder="Search satellite name or NORAD ID…"
        @keydown.enter="searchIsNorad && searchByNorad()"
      />
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

    <!-- Filter tab + sliding panel (right edge) -->
    <button class="filter-tab" :class="{ shifted: filterOpen }" @click="filterOpen = !filterOpen">
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

    <!-- Reroute action + result (outside the sliding panel → fixed positioning intact) -->
    <template v-if="!trackedSat">
      <div v-if="selectedConj" class="reroute-actions">
        <button v-if="!planResult" class="reroute-btn2" :disabled="planning" @click="planReroute">
          {{ planning ? 'PLANNING… screening 33k objects' : '⟳ PLAN OPTIMAL REROUTE' }}
        </button>
        <button class="reroute-btn2 back" @click="clearReroute">↩ BACK TO GLOBE</button>
      </div>

      <div v-if="planResult" class="reroute-card">
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
          <span style="color:#ef4444">━ {{ shortName(planResult.sat1_name) }}</span>
          <span style="color:#f59e0b">━ {{ shortName(planResult.sat2_name) }}</span>
          <span style="color:#cbd5e1">┄ safer (dashed)</span>
        </div>
      </div>
    </template>

    <!-- Launch telemetry HUD -->
    <div v-if="launchHud.active" class="launch-hud">
      <div class="lh-phase">🚀 {{ launchHud.phase }}</div>
      <div class="lh-stats">
        <div><span>SPEED</span><b>{{ launchHud.speed }}<i>km/s</i></b></div>
        <div><span>ALTITUDE</span><b>{{ launchHud.alt }}<i>km</i></b></div>
        <div><span>STATUS</span><b class="lh-eta">{{ launchHud.eta }}</b></div>
      </div>
    </div>

    <!-- Launch on-globe controls -->
    <div v-if="launchActive" class="reroute-actions">
      <button class="reroute-btn2 launch" @click="simulateLaunch">▶ SIMULATE LAUNCH</button>
      <button class="reroute-btn2 back" @click="exitLaunch">↩ EXIT LAUNCH</button>
    </div>

    <!-- Hover tooltip over a route line -->
    <div v-if="routeTip" class="route-tip" :style="{ left: routeTip.x + 14 + 'px', top: routeTip.y + 14 + 'px', borderColor: routeTip.css }">
      <div class="rt-sat" :style="{ color: routeTip.css }">{{ shortName(routeTip.sat) }}</div>
      <div class="rt-type">{{ routeTip.type }}</div>
    </div>

    <!-- Clicked route detail -->
    <div v-if="selectedRoute" class="route-sel" :style="{ borderColor: selectedRoute.css }">
      <button class="rs-close" @click="clearRouteSelection">×</button>
      <div class="rs-sat" :style="{ color: selectedRoute.css }">{{ shortName(selectedRoute.sat) }}</div>
      <div class="rs-type">{{ selectedRoute.type }}</div>
      <div class="rs-sub">{{ selectedRoute.sub }}</div>
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
import { loadGroupForNorads, loadByNorad, hasRealOrbit, realLatLng, loadCatalogue, loadFullCatalogue, ecefAt, gmstOf, periodMinutes, orbitEciKm, eciKmToEcefMeters } from '../lib/realOrbit.js'

// Same props/emits as the old component so App.vue needs no changes.
const props = defineProps({
  satellites: { type: Array, default: () => [] },
  conjunctions: { type: Array, default: () => [] },
  plan: { type: Object, default: null },   // active avoidance plan (orbits to draw)
  launchPlan: { type: Object, default: null },  // active launch trajectory to draw + animate
})

const emit = defineEmits(['satellite-click', 'reroute-planned', 'launch-clear', 'ready'])
const cesiumContainer = ref(null)
const trackedSat = ref(null)   // the satellite the camera is currently following
const trackInfo = ref(null)    // live readout (lat/lon/alt/speed) for the tracked sat
let viewer = null
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
  scene.skyAtmosphere.atmosphereLightIntensity = 12.0   // brighter limb glow

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

  // NASA "Earth at Night" (Black Marble, Ion asset 3812) shown ONLY on the
  // dark side: dayAlpha 0 = invisible in daylight, nightAlpha 1 = full city
  // lights at night. Google satellite imagery still shows on the lit side.
  const nightLayer = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.IonImageryProvider.fromAssetId(3812)
  )
  // Set day/night blend directly on the layer (reliable across the async load).
  nightLayer.dayAlpha = 0.0     // FULLY invisible on the daylit side
  nightLayer.nightAlpha = 1.0   // full city lights on the dark side
  nightLayer.brightness = 2.4   // lights pop without bleeding into day
  nightLayer.contrast = 1.5     // darker gaps so cities stand out
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
  bloom.uniforms.contrast = 255
  bloom.uniforms.brightness = -0.85
  bloom.uniforms.delta = 1.0
  bloom.uniforms.sigma = 3.0
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
  viewer.imageryLayers.add(labels)

  // ── Idle auto-spin ──────────────────────────────────────────────────────
  // Slowly rotate the globe when the user isn't touching it. Pauses for 3 s
  // after any interaction (drag / zoom), and stays paused while zoomed in
  // closer than MIN_SPIN_HEIGHT so it never fights you up close.
  // Only ZOOM (scroll wheel) pauses the spin for a moment. Dragging to rotate
  // is in the same spirit as the auto-spin, so we let it keep spinning.
  const markInteract = () => { lastInteract = performance.now() }
  scene.canvas.addEventListener('wheel', markInteract, { passive: true })
  scene.postRender.addEventListener(() => {
    // Never spin while following a satellite — checked from the click instant
    // (trackedSat) AND during fly-in, so the spin can't fight the flyTo camera.
    if (trackedSat.value || viewer.trackedEntity) return
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
    else if (idp && idp._conjMeta) { const c = idp._conjMeta; routeTip.value = { x: m.endPosition.x, y: m.endPosition.y, sat: `${shortName(c.aName)} × ${shortName(c.bName)}`, type: 'CONJUNCTION', sub: `${c.missKm.toFixed(2)} km`, css: '#a855f7' }; scene.canvas.style.cursor = 'pointer' }
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
  if (score >= 70) return Cesium.Color.fromCssColorString('#ff3b3b')   // high
  if (score >= 40) return Cesium.Color.fromCssColorString('#ffb302')   // medium
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
  const wanted = props.satellites.map(s => s.norad_id).filter(Boolean)
  for (const group of SEED_GROUPS) {
    await loadGroupForNorads(group, wanted)   // sequential = gentle on CelesTrak
  }
  // Any seed sat the groups didn't cover (e.g. early Starlink not in the curated
  // group feed, debris/rocket bodies) → fetch its TLE individually so it too
  // gets a real SGP4 orbit and moves smoothly instead of jumping on gateway polls.
  for (const sat of props.satellites) {
    if (sat.norad_id && !hasRealOrbit(sat.norad_id)) await loadByNorad(sat.norad_id)
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
  { key: 'stations', label: 'Space Stations', color: '#4a9eff' },
  { key: 'starlink', label: 'Starlink',       color: '#39d98a' },
  { key: 'oneweb',   label: 'OneWeb',          color: '#a78bfa' },
  { key: 'debris',   label: 'Debris / R/B',    color: '#ff6b6b' },
  { key: 'other',    label: 'Other Payloads',  color: '#ffc94d' },
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
  const active = Cesium.Color.fromCssColorString('#9fd4ff').withAlpha(0.9)
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
  return missKm < 1 ? '#ff3b3b' : missKm < 5 ? '#ffb302' : '#9fd4ff'
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
  const C1 = '#ef4444', C1R = '#fca5a5', C2 = '#f59e0b', C2R = '#fcd34d'
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
    point: { pixelSize: 12, color: Cesium.Color.fromCssColorString('#22d3ee'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: 'LAUNCH SITE', font: '700 11px ui-monospace, monospace', fillColor: Cesium.Color.fromCssColorString('#22d3ee'),
      showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#050a12').withAlpha(0.9), pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY },
  }))
  // ascent (orange) + target orbit (cyan)
  launchEntities.push(viewer.entities.add({ polyline: { positions: ascent, width: 3.5, arcType: Cesium.ArcType.NONE, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: Cesium.Color.fromCssColorString('#f59e0b') }) } }))
  launchEntities.push(viewer.entities.add({ polyline: { positions: ring, width: 2.5, arcType: Cesium.ArcType.NONE, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: Cesium.Color.fromCssColorString('#22d3ee') }) } }))
  // animated rocket
  launchRocket = viewer.entities.add({
    position: ascent[0],
    point: { pixelSize: 11, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString('#f59e0b'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: '▲ VEHICLE', font: '700 10px ui-monospace, monospace', fillColor: Cesium.Color.WHITE, showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.9), pixelOffset: new Cesium.Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY },
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
defineExpose({ agentShowConjunction, agentReroute, simulateLaunch, agentTrack, agentZoom })

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
  if (dir === 'reset' || dir === 'home') cam.flyHome(1.2)
  else if (dir === 'out') cam.zoomOut(cam.positionCartographic.height * 0.6 + 1e6)
  else cam.zoomIn(cam.positionCartographic.height * 0.4 + 5e5)   // 'in'
}
function drawConjunctions(list) {
  clearConjunctions()
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
      label: { text: c.missKm.toFixed(1) + ' km', font: '11px ui-monospace, monospace', fillColor: col,
        showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#0a1018').withAlpha(0.85),
        pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY },
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
      point: { pixelSize: 28, color: Cesium.Color.TRANSPARENT, outlineColor: Cesium.Color.fromCssColorString('#a855f7'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
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
  const pose = sampled ? poseFromProp(sampled, FLY_MS, vf) : null
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
.sat-search {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: 340px;
  z-index: 5;
  font: 13px/1.3 ui-monospace, monospace;
}
.sat-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 14px;
  background: rgba(8, 14, 24, 0.85);
  border: 1px solid #2b6cb0;
  border-radius: 6px;
  color: #e8f1ff;
  outline: none;
  backdrop-filter: blur(4px);
}
.sat-search-input::placeholder { color: rgba(148, 163, 184, 0.55); }
.sat-search-input:focus { border-color: #4a9eff; }
.sat-search-results {
  margin-top: 6px;
  background: rgba(8, 14, 24, 0.95);
  border: 1px solid #1e3a5f;
  border-radius: 6px;
  overflow: hidden;
  backdrop-filter: blur(4px);
}
.sat-search-row {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 7px 14px;
  cursor: pointer;
  border-bottom: 1px solid rgba(30, 58, 95, 0.5);
}
.sat-search-row:last-child { border-bottom: none; }
.sat-search-row:hover { background: rgba(30, 60, 100, 0.6); }
.ssr-name { color: #e8f1ff; font-weight: 600; }
.ssr-meta { color: #7fa8d0; font-size: 11px; }
.sat-search-row.fetch { color: #4a9eff; font-weight: 600; }
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
.conj-refresh { float: right; background: none; border: none; color: #6f8eae; cursor: pointer; font-size: 13px; }
.conj-refresh:hover { color: #fff; }
.conj-refresh.spin { animation: cspin 1s linear infinite; display: inline-block; }
@keyframes cspin { to { transform: rotate(360deg); } }
.conj-empty { color: #5f7e9f; font-size: 11px; padding: 12px 4px; }
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
.conj-scan:not(:disabled):hover { background: rgba(70, 20, 20, 0.95); border-color: #ff5b4f; }
.conj-bar { height: 3px; margin-top: 4px; background: rgba(176, 65, 59, 0.25); border-radius: 2px; overflow: hidden; }
.conj-bar-fill { height: 100%; background: #ff5b4f; transition: width 0.2s; }
.conj-list {
  margin-top: 8px;
  max-height: calc(100vh - 210px);
  overflow-y: auto;
  background: rgba(8, 14, 24, 0.9);
  border: 1px solid #1e3a5f;
  border-radius: 6px;
  backdrop-filter: blur(4px);
}
.conj-list::-webkit-scrollbar { width: 6px; }
.conj-list::-webkit-scrollbar-thumb { background: #2b6cb0; border-radius: 3px; }
.conj-head { padding: 7px 12px; color: #7fa8d0; font-size: 10px; letter-spacing: 0.08em; border-bottom: 1px solid #1e3a5f; }
.conj-row { padding: 7px 12px; cursor: pointer; border-bottom: 1px solid rgba(30, 58, 95, 0.5); }
.conj-row:hover { background: rgba(30, 60, 100, 0.5); }
.conj-row.selected { background: rgba(59, 130, 246, 0.22); box-shadow: inset 3px 0 0 #3b82f6; }
.conj-names { color: #e8f1ff; font-weight: 600; }
.conj-names .x { color: #ff6b6b; }
.conj-meta { display: flex; gap: 10px; margin-top: 2px; color: #8fb0d0; font-size: 11px; }
.conj-miss { font-weight: 700; }
.conj-pc { color: #5f7e9f; font-size: 10px; margin-top: 1px; }
.conj-foot { padding: 6px 12px; color: #5f7e9f; font-size: 9px; font-style: italic; }

/* Reroute action + result */
.reroute-actions {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  gap: 10px;
}
.reroute-btn2 {
  padding: 13px 26px;
  background: rgba(5, 10, 18, 0.96);
  border: 1.5px solid #3b82f6;
  border-radius: 8px;
  color: #dce9ff;
  font: 700 13px/1 ui-monospace, monospace;
  letter-spacing: 0.1em;
  cursor: pointer;
  box-shadow: 0 0 20px rgba(59,130,246,0.5), 0 8px 24px rgba(0,0,0,0.7);
  transition: all 0.15s;
}
.reroute-btn2:not(:disabled):hover { background: rgba(16, 32, 58, 0.98); box-shadow: 0 0 30px rgba(59,130,246,0.8), 0 8px 24px rgba(0,0,0,0.7); }
.reroute-btn2:disabled { opacity: 0.85; cursor: wait; }
.reroute-btn2.back { border-color: #5f7e9f; color: #cdd9e6; box-shadow: 0 8px 24px rgba(0,0,0,0.7); }
.reroute-btn2.back:hover { background: rgba(30, 42, 60, 0.98); border-color: #9fb6d0; }
.reroute-btn2.launch { border-color: #f59e0b; color: #ffe6bd; box-shadow: 0 0 20px rgba(245,158,11,0.5), 0 8px 24px rgba(0,0,0,0.7); }
.reroute-btn2.launch:hover { background: rgba(58, 40, 12, 0.98); box-shadow: 0 0 30px rgba(245,158,11,0.8), 0 8px 24px rgba(0,0,0,0.7); }

.reroute-card {
  position: fixed;
  top: 64px;
  right: 60px;
  width: 330px;
  z-index: 200;
  padding: 12px;
  border: 1.5px solid rgba(59,130,246,0.55);
  border-radius: 8px;
  background: rgba(6, 12, 22, 0.96);
  box-shadow: 0 0 22px rgba(59,130,246,0.4), 0 8px 24px rgba(0,0,0,0.7);
  font: 12px/1.4 ui-monospace, monospace;
}
.rc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.rc-title { color: #60a5fa; font-weight: 700; font-size: 11px; letter-spacing: 0.08em; }
.rc-close { color: #5f7e9f; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; }
.rc-close:hover { color: #fff; }
.rc-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin-bottom: 9px; }
.rc-stats > div { display: flex; flex-direction: column; gap: 1px; }
.rc-stats span { color: #5f7e9f; font-size: 8px; letter-spacing: 0.08em; }
.rc-stats b { color: #e8f1ff; font-size: 12px; }
.rc-stats b.ok { color: #34d399; }
.rc-stats b.bad { color: #f87171; }
.rc-mans { display: flex; flex-direction: column; gap: 6px; }
.rc-man { border-left: 2px solid rgba(59,130,246,0.5); padding-left: 8px; display: flex; flex-direction: column; gap: 1px; }
.rc-sat { color: #cfe0ff; font-weight: 700; font-size: 10px; }
.rc-act { color: #9fc0e0; font-size: 11px; }
.rc-act b { color: #60a5fa; }
.rc-deb { color: #6f8eae; font-size: 10px; font-style: italic; }
.rc-legend { display: flex; gap: 14px; margin-top: 9px; font-size: 9px; }
.rc-legend .lg-red { color: #ef4444; }
.rc-legend .lg-blue { color: #3b82f6; }

/* Launch telemetry HUD (top-center) */
.launch-hud {
  position: absolute;
  top: 58px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 16px;
  background: rgba(5, 10, 18, 0.92);
  border: 1px solid rgba(245, 158, 11, 0.5);
  border-radius: 8px;
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.25), 0 6px 18px rgba(0,0,0,0.6);
  min-width: 420px;
}
.lh-phase { font: 700 11px/1 ui-monospace, monospace; letter-spacing: 0.12em; color: #f59e0b; text-align: center; }
.lh-stats { display: flex; gap: 22px; justify-content: center; }
.lh-stats > div { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.lh-stats span { font: 8px/1 ui-monospace, monospace; letter-spacing: 0.1em; color: #6f8eae; }
.lh-stats b { font: 700 16px/1 ui-monospace, monospace; color: #e8f1ff; display: flex; align-items: baseline; gap: 3px; }
.lh-stats b i { font: 400 9px/1 ui-monospace, monospace; color: #6f8eae; font-style: normal; }
.lh-eta { font-size: 11px !important; color: #34d399 !important; }

/* Route hover tooltip */
.route-tip {
  position: absolute;
  z-index: 300;
  pointer-events: none;
  padding: 5px 9px;
  background: rgba(5, 10, 18, 0.95);
  border: 1px solid #3b82f6;
  border-radius: 5px;
  font: 600 11px/1.3 ui-monospace, monospace;
}
.rt-sat { font-weight: 700; }
.rt-type { color: #9fb6d0; font-size: 9px; margin-top: 2px; letter-spacing: 0.06em; }

/* Clicked route detail */
.route-sel {
  position: absolute;
  left: 50%;
  bottom: 150px;
  transform: translateX(-50%);
  z-index: 250;
  min-width: 280px;
  padding: 11px 14px;
  background: rgba(5, 10, 18, 0.97);
  border: 1.5px solid #3b82f6;
  border-radius: 8px;
  box-shadow: 0 0 20px rgba(0,0,0,0.6);
  font: 12px/1.45 ui-monospace, monospace;
}
.rs-close { position: absolute; top: 6px; right: 9px; color: #5f7e9f; font-size: 16px; cursor: pointer; }
.rs-close:hover { color: #fff; }
.rs-sat { font-weight: 700; font-size: 13px; letter-spacing: 0.04em; }
.rs-type { color: #9fb6d0; font-size: 9px; letter-spacing: 0.1em; margin: 2px 0 5px; }
.rs-sub { color: #cfe0ff; font-size: 11px; }
.return-btn {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 14px;
  background: rgba(8, 14, 24, 0.82);
  border: 1px solid #2b6cb0;
  border-radius: 6px;
  color: #cfe6ff;
  font: 600 12px/1.1 ui-monospace, monospace;
  letter-spacing: 0.06em;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.15s, border-color 0.15s;
}
.return-btn:hover {
  background: rgba(20, 40, 70, 0.95);
  border-color: #4a9eff;
}
.return-sub {
  font-weight: 400;
  font-size: 10px;
  color: #7fa8d0;
  text-transform: none;
  letter-spacing: 0.02em;
}
.sat-info {
  position: absolute;
  left: 16px;
  bottom: 16px;
  width: 230px;
  padding: 12px 14px;
  background: rgba(8, 14, 24, 0.86);
  border: 1px solid #1e3a5f;
  border-left: 3px solid #38bdf8;
  border-radius: 6px;
  color: #e8f1ff;
  font: 12px/1.4 ui-monospace, monospace;
  backdrop-filter: blur(4px);
  z-index: 5;
}
.si-name { font-size: 14px; font-weight: 700; letter-spacing: 0.03em; }
.si-sub { color: #7fa8d0; font-size: 11px; margin-bottom: 8px; }
.si-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}
.si-grid div { display: flex; flex-direction: column; }
.si-grid span { color: #5f7e9f; font-size: 9px; letter-spacing: 0.08em; }
.si-risk {
  margin-top: 10px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}
.risk-high { background: rgba(255, 59, 59, 0.18); color: #ff6b6b; border: 1px solid #ff3b3b55; }
.risk-med  { background: rgba(255, 179, 2, 0.16); color: #ffc94d; border: 1px solid #ffb30255; }
.risk-low  { background: rgba(57, 217, 138, 0.15); color: #4fe0a0; border: 1px solid #39d98a55; }

/* Filter tab + panel (right edge) */
.filter-tab {
  position: fixed;
  top: 250px;
  right: 0;
  z-index: 1400;
  width: 40px;
  height: 132px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.18), rgba(59, 130, 246, 0.07));
  border: 1px solid rgba(59, 130, 246, 0.5);
  border-right: none;
  border-radius: 8px 0 0 8px;
  color: #cfe6ff;
  cursor: pointer;
  box-shadow: 0 0 18px rgba(59, 130, 246, 0.22), -2px 0 12px rgba(0, 0, 0, 0.4);
  transition: all 0.18s;
}
.filter-tab-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font: 700 10px/1 ui-monospace, monospace;
  letter-spacing: 0.16em;
}
.filter-tab.shifted { transform: translateX(-240px); }
.filter-tab:hover { width: 46px; background: rgba(59, 130, 246, 0.28); }
.filter-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 240px;
  height: 100%;
  box-sizing: border-box;
  padding: 18px 16px;
  background: rgba(8, 14, 24, 0.92);
  border-left: 1px solid #1e3a5f;
  backdrop-filter: blur(6px);
  transform: translateX(100%);
  transition: transform 0.28s ease;
  z-index: 5;
  font: 13px/1.4 ui-monospace, monospace;
}
.filter-panel.open { transform: translateX(0); }
.fp-title {
  color: #7fa8d0;
  font-size: 11px;
  letter-spacing: 0.12em;
  margin-bottom: 14px;
}
.fp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  cursor: pointer;
  color: #e8f1ff;
}
.fp-row input { accent-color: #4a9eff; cursor: pointer; }
.fp-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.fp-label { flex: 1; }
.fp-count { color: #5f7e9f; font-size: 11px; }
.fp-sep { height: 1px; background: #1e3a5f; margin: 10px 0; }
.fp-row.danger { color: #ffb86b; }
.fp-row.allobj { color: #9fd4ff; }
.fp-hint { color: #5f7e9f; font-size: 10px; line-height: 1.3; margin-top: 4px; }
.fp-row.models { color: #cfe6ff; }
.fp-num {
  width: 64px;
  padding: 3px 6px;
  background: rgba(8, 14, 24, 0.9);
  border: 1px solid #2b6cb0;
  border-radius: 4px;
  color: #e8f1ff;
  font: 12px ui-monospace, monospace;
}
</style>

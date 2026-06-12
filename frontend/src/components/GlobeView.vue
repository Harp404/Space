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
      {{ filterOpen ? '▸' : '◂' }} FILTERS
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
})

const emit = defineEmits(['satellite-click'])
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
    if (id && id._satData) { trackSat(id._satData); return }       // curated satellite
    if (id && id._catNorad) { trackCatalogueObject(id._catNorad, id._catName); return }  // a cloud MODEL
    if (id && id._catalogue) { trackCatalogueObject(id.norad, id.name); return }  // a cloud point
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // Hidden camera-target point: the camera tracks THIS (a clean centred point at
  // a damped position), not the model — so the handoff has no off-centre snap and
  // per-frame satellite jitter is filtered out of the camera.
  camFallbackPos = new Cesium.CallbackPositionProperty(
    () => (smoothPos ? smoothPos.clone() : CAM_TARGET_FALLBACK), false)
  camTargetEntity = viewer.entities.add({
    position: camFallbackPos,
    point: { pixelSize: 1, color: Cesium.Color.TRANSPARENT },
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
const TRACK_VIEW_FROM = new Cesium.Cartesian3(0, -600_000, 320_000)

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
  if (hasRealOrbit(sat.norad_id)) {
    const ll = realLatLng(sat.norad_id, Cesium.JulianDate.toDate(time))
    if (ll) return Cesium.Cartesian3.fromDegrees(ll.lng, ll.lat, ll.altitude)
  }
  const s = liveSat.get(sat.id) || sat
  if (typeof s.lat === 'number' && typeof s.lon === 'number') {
    return Cesium.Cartesian3.fromDegrees(s.lon, s.lat, (s.alt_km || 500) * 1000)
  }
  return undefined
}

// Pick the 3D model for a satellite by its type. Falls back to the existing
// generic payload model (which also serves imaging/EO sats).
const GENERIC_MODEL = '/models/satellite_pbr_v3.glb'
function modelForSat(sat) {
  switch (groupOf(sat)) {
    case 'stations': return '/models/types/station.glb'
    case 'starlink':
    case 'oneweb':   return '/models/types/comms.glb'
    case 'debris':   return '/models/types/debris.glb'
    default:         return GENERIC_MODEL   // imaging / other payloads
  }
}

function makeSatEntity(sat) {
  const posProp = new Cesium.CallbackPositionProperty(
    (time) => satPosition(sat, time), false)
  const isAlert = sat.risk_score >= 70
  const entity = viewer.entities.add({
    position: posProp,
    // Real 3D satellite model, chosen by type — shown only within ~2500 km.
    // Catalogue objects match the cloud model size so clicking doesn't resize it.
    model: {
      uri: modelForSat(sat),
      minimumPixelSize: sat._catalogue ? 13 : (isAlert ? 26 : 22),
      maximumScale: sat._catalogue ? 5000 : 16000,
      scale: sat._catalogue ? 350 : 1500,
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

// How many of the nearest-to-camera objects get a real 3D model (rest = points).
// Crank this up to "try" more models — past a few hundred it WILL choke (which
// is the whole reason the cloud is points, not models).
const NEAREST_MODELS = ref(25)
const modelCloud = new Map()   // norad → Cesium.Entity (the nearest-N models)

async function ensureCatalogue() {
  if (catalogueLoaded || catalogueLoading.value) return
  catalogueLoading.value = true
  // Full ~31k catalogue via the gateway (Space-Track); fall back to CelesTrak.
  let list = await loadFullCatalogue()
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
        model: {
          uri: it.debris ? '/models/types/debris.glb' : GENERIC_MODEL,
          // Smaller world-scale so dense objects don't visibly cross through each
          // other up close; minimumPixelSize keeps them visible when zoomed out.
          minimumPixelSize: 13,
          maximumScale: 5000,
          scale: 350,
        },
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

function trackSat(sat) {
  const entity = satEntities.get(sat.id)
  if (!entity) return
  emit('satellite-click', sat)
  trackedSat.value = sat
  showOrbit(sat)                    // trace the satellite's orbit path
  startInfoUpdates(sat)            // live lat/lon/alt/speed readout

  // Start from a clean world frame (drop any leftover tracking transform).
  viewer.trackedEntity = undefined
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)

  const p0 = livePos(sat) || entity.position.getValue(viewer.clock.currentTime)
  smoothPos = p0 ? p0.clone() : null
  trackedReal = entity

  // Attach native tracking of the clean point via an interpolated
  // SampledPositionProperty (steady, FPS-independent). Reliable for ANY object.
  const attach = () => {
    if (!viewer || viewer.isDestroyed() || trackedSat.value?.id !== sat.id) return
    const nid = sat.norad_id
    camTargetEntity.position = (nid && hasRealOrbit(nid)) ? buildSampledOrbit(nid) : camFallbackPos
    camTargetEntity.viewFrom = TRACK_VIEW_FROM
    viewer.trackedEntity = camTargetEntity
  }

  // Fly the camera to the EXACT pose the tracker will impose at the moment the
  // fly-in ends (lead-time predicted), THEN attach — seamless, no snap.
  const FLY_MS = 1800
  const pose = trackingPose(sat, FLY_MS)
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
  position: absolute;
  top: 80px;
  right: 0;
  z-index: 6;
  padding: 8px 10px;
  background: rgba(8, 14, 24, 0.88);
  border: 1px solid #2b6cb0;
  border-right: none;
  border-radius: 6px 0 0 6px;
  color: #cfe6ff;
  font: 600 11px/1 ui-monospace, monospace;
  letter-spacing: 0.08em;
  cursor: pointer;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: translateX(0);
  transition: transform 0.28s ease;
  backdrop-filter: blur(4px);
}
.filter-tab.shifted { transform: translateX(-240px); }
.filter-tab:hover { background: rgba(20, 40, 70, 0.95); }
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

<template>
  <div class="globe-wrapper" ref="wrapperEl" @click.self="tooltip.visible = false">
    <div class="hud-overlay">
      <div class="hud-tl">
        <div class="hud-title">ORBITAL SURVEILLANCE</div>
        <div class="hud-sub">
          {{ totalSats }} OBJECTS &nbsp;·&nbsp;
          <span v-if="realCount" style="color:rgba(16,185,129,0.9)">{{ realCount }} LIVE CELESTRAK/SGP4</span>
          <span v-else>LIVE PROPAGATION</span>
        </div>
      </div>
      <div class="hud-tr">
        <div class="legend-row"><span class="ldot" style="background:#10b981;box-shadow:0 0 5px #10b981"></span>NOMINAL</div>
        <div class="legend-row"><span class="ldot" style="background:#f59e0b;box-shadow:0 0 5px #f59e0b"></span>WATCH</div>
        <div class="legend-row"><span class="ldot" style="background:#ef4444;box-shadow:0 0 5px #ef4444"></span>CRITICAL</div>
        <div class="legend-row"><span class="ldot" style="background:#8b5cf6;box-shadow:0 0 5px #8b5cf6"></span>MANEUVERING</div>
      </div>
      <div class="hud-bl">
        <div v-if="critCount > 0" class="threat-pill">
          <span class="pulse-dot"></span>
          {{ critCount }} HIGH-RISK CONJUNCTION{{ critCount !== 1 ? 'S' : '' }}
        </div>
      </div>
      <div class="hud-bm">
        <button v-if="tracking" class="release-btn" @click.stop="releaseTracking" title="Release lock (Esc)">
          ↩ RETURN
        </button>
      </div>
      <div class="hud-br">LEO · MEO · GEO · DEBRIS</div>

      <!-- Search → track -->
      <div class="search-panel">
        <input class="search-input" v-model="searchQuery"
               placeholder="Search NORAD ID or name…"
               @keydown.enter="searchByNorad" @click.stop />
        <div v-if="searchQuery && (searchResults.length || searchIsNorad)" class="search-results">
          <div v-for="r in searchResults" :key="r.id" class="search-row" @click.stop="selectResult(r)">
            <span class="sr-name">{{ r.name }}</span>
            <span class="sr-norad">{{ r.norad_id }}</span>
          </div>
          <div v-if="searchIsNorad && !searchResults.some(r => String(r.norad_id) === searchQuery.trim())"
               class="search-row fetch" @click.stop="searchByNorad">
            {{ searchBusy ? 'fetching…' : `↗ fetch & track NORAD ${searchQuery.trim()}` }}
          </div>
        </div>
      </div>

      <!-- Filter panel -->
      <div class="filter-panel">
        <div class="filter-title">VIEW FILTER</div>
        <label v-for="g in GROUPS" :key="g.key" class="filter-row" @click.stop>
          <input type="checkbox" :checked="filterOn[g.key]" @change="toggleGroup(g.key)" />
          <span :style="{ color: g.color }">{{ g.label }}</span>
        </label>
      </div>

      <!-- Blender-style nav toolbar -->
      <div class="nav-toolbar">
        <button class="nav-btn" @click.stop="camZoom(0.4)"  title="Zoom in">+</button>
        <button class="nav-btn" @click.stop="camZoom(-0.4)" title="Zoom out">−</button>
        <div class="nav-sep"></div>
        <button class="nav-btn" @click.stop="camTilt(-8)" title="Tilt up">▲</button>
        <button class="nav-btn" @click.stop="camTilt(8)"  title="Tilt down">▼</button>
        <button class="nav-btn" @click.stop="camSpin(-8)" title="Rotate left">◀</button>
        <button class="nav-btn" @click.stop="camSpin(8)"  title="Rotate right">▶</button>
        <div class="nav-sep"></div>
        <button class="nav-btn home" @click.stop="camHome" title="Reset view">⌂</button>
      </div>
    </div>

    <div ref="cesiumContainer" class="cesium-container"></div>

    <div class="corner tl"></div><div class="corner tr"></div>
    <div class="corner bl"></div><div class="corner br"></div>

    <div v-if="tooltip.visible" class="sat-tooltip"
         :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
      <div class="tt-name">{{ tooltip.name }}</div>
      <div class="tt-row"><span>NORAD ID</span><span>{{ tooltip.norad || '—' }}</span></div>
      <div class="tt-row"><span>OPERATOR</span><span>{{ tooltip.operator }}</span></div>
      <div class="tt-row"><span>LAT</span><span>{{ tooltip.lat }}°</span></div>
      <div class="tt-row"><span>LON</span><span>{{ tooltip.lon }}°</span></div>
      <div class="tt-row"><span>ALT</span><span>{{ tooltip.alt }} km</span></div>
      <div class="tt-row"><span>RISK</span>
        <span :style="{ color: riskColor(tooltip.risk) }">{{ tooltip.risk.toFixed(1) }}</span>
      </div>
      <a v-if="tooltip.norad" class="tt-verify"
         :href="`https://satellitemap.space/?norad=${tooltip.norad}`" target="_blank"
         @click.stop>↗ verify on satellitemap.space</a>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { loadRealTLEs, loadGroup, loadByNorad, hasRealOrbit, realLatLng } from '../lib/realOrbit.js'

// ── Three.js overlay (renders the satellite 3D MODELS over the Cesium globe) ──
// Cesium draws the earth; a transparent Three.js canvas on top draws the glTF
// models with Three's renderer (works on every GPU — no Cesium log-depth/IBL bug).
// The Three camera is synced to Cesium's camera each frame; positions are ECEF.
let three = null   // { renderer, scene, camera, models:Map, template }
let threeResize = null
const RE_M = 6378137  // WGS84 equatorial radius (m) for the depth-occluder sphere

function setupThree(container) {
  const canvas = document.createElement('canvas')
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2' })
  container.appendChild(canvas)
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(container.clientWidth, container.clientHeight, false)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 1, 1e9)
  // lighting so the model isn't flat
  scene.add(new THREE.AmbientLight(0xffffff, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1, 1, 1); scene.add(sun)
  // invisible earth sphere — writes depth only, so satellites BEHIND the earth are
  // correctly occluded while near-side ones render on top
  const occluder = new THREE.Mesh(
    new THREE.SphereGeometry(RE_M, 64, 48),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true })
  )
  scene.add(occluder)
  three = { renderer, scene, camera, models: new Map(), template: null, occluder }

  // load the satellite glTF once; clone it per satellite
  new GLTFLoader().load('/models/satellite_pbr_v3.glb', (gltf) => {
    three.template = gltf.scene
    // build models for any satellites already created
    entityMap.forEach((e, id) => ensureThreeModel(id, e))
  })
}

function ensureThreeModel(id, entity) {
  if (!three || !three.template || three.models.has(id)) return
  const obj = three.template.clone(true)
  obj.scale.setScalar(6000)   // ~170 km visual size — visible at orbital distance, not huge
  three.scene.add(obj)
  three.models.set(id, { obj, entity })
}

function removeThreeModel(id) {
  if (!three) return
  const m = three.models.get(id)
  if (m) { three.scene.remove(m.obj); three.models.delete(id) }
}

function renderThree() {
  if (!three || !viewer || viewer.isDestroyed()) return
  const cam = viewer.camera
  const c = three.camera
  // sync FOV + aspect from Cesium
  const fovy = cam.frustum.fovy
  if (fovy) { c.fov = THREE.MathUtils.radToDeg(fovy); c.aspect = three.renderer.domElement.clientWidth / three.renderer.domElement.clientHeight; c.updateProjectionMatrix() }
  // sync position + orientation (Cesium ECEF → Three world)
  const p = cam.positionWC, d = cam.directionWC, u = cam.upWC
  c.position.set(p.x, p.y, p.z)
  c.up.set(u.x, u.y, u.z)
  c.lookAt(p.x + d.x, p.y + d.y, p.z + d.z)
  // update each model's ECEF position + orient away from earth centre
  const t = viewer.clock.currentTime
  three.models.forEach((m) => {
    const pos = m.entity.position && m.entity.position.getValue(t)
    if (!pos) { m.obj.visible = false; return }
    m.obj.visible = true
    m.obj.position.set(pos.x, pos.y, pos.z)
    m.obj.up.set(pos.x, pos.y, pos.z)         // local up = away from centre
    m.obj.lookAt(p.x, p.y, p.z)               // face the camera-ish (readable)
  })
  three.renderer.render(three.scene, c)
}

// Force satellite models to render UNLIT → Cesium skips the PBR/image-based-lighting
// shader path, so there's no empty spherical-harmonic uniform array that strict GPU
// drivers reject with "uniform1fv: no array".
const UNLIT_SHADER = new Cesium.CustomShader({ lightingModel: Cesium.LightingModel.UNLIT })

const props = defineProps({
  satellites:   { type: Array, default: () => [] },
  conjunctions: { type: Array, default: () => [] },
})
const emit = defineEmits(['satelliteClick'])

const cesiumContainer = ref(null)
const wrapperEl       = ref(null)
const tooltip         = ref({ visible: false, x: 0, y: 0, name: '', norad: null, operator: '', lat: '0.00', lon: '0.00', alt: 0, risk: 0 })

// live geodetic position of an entity at the current clock time → {lat, lon}
function entityLatLon(entity) {
  try {
    const c = entity.position.getValue(viewer.clock.currentTime)
    if (!c) return { lat: '—', lon: '—' }
    const carto = Cesium.Cartographic.fromCartesian(c)
    return {
      lat: Cesium.Math.toDegrees(carto.latitude).toFixed(2),
      lon: Cesium.Math.toDegrees(carto.longitude).toFixed(2),
    }
  } catch { return { lat: '—', lon: '—' } }
}

// ── Filterable real-satellite groups (loaded on demand from CelesTrak) ──
const GROUPS = [
  { key: 'starlink', group: 'starlink',          label: 'Starlink',          limit: 70, color: '#10b981' },
  { key: 'oneweb',   group: 'oneweb',            label: 'OneWeb',            limit: 30, color: '#10b981' },
  { key: 'stations', group: 'stations',          label: 'Stations (ISS/CSS)',limit: 10, color: '#38bdf8' },
  { key: 'cos2251',  group: 'cosmos-2251-debris',label: 'Cosmos-2251 debris',limit: 20, color: '#ef4444' },
  { key: 'irid33',   group: 'iridium-33-debris', label: 'Iridium-33 debris', limit: 18, color: '#ef4444' },
  { key: 'fy1c',     group: 'fengyun-1c-debris', label: 'Fengyun-1C debris', limit: 20, color: '#ef4444' },
  { key: 'cos1408',  group: 'cosmos-1408-debris',label: 'Cosmos-1408 debris',limit: 18, color: '#ef4444' },
]
// default-on groups (keep total a few hundred for smooth perf)
const filterOn  = reactive({ starlink: true, oneweb: false, stations: true, cos2251: true, irid33: false, fy1c: false, cos1408: false })
const loadedGroups = new Set()   // group keys already fetched
const extraSats = ref([])        // all loaded context sats (any group + on-demand search)

const allSats = computed(() => {
  const real   = props.satellites || []
  const ids    = new Set(real.map(s => s.id))
  const norads = new Set(real.map(s => s.norad_id))
  const extras = extraSats.value.filter(s =>
    (s._group === 'search' || filterOn[s._group]) &&
    !ids.has(s.id) && !norads.has(s.norad_id))
  return [...real, ...extras]
})

// ── Search-to-track state ──
const searchQuery = ref('')
const searchBusy  = ref(false)
const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  const pool = [...(props.satellites || []), ...extraSats.value]
  const seen = new Set()
  return pool.filter(s => {
    if (seen.has(s.norad_id)) return false
    const m = s.name.toLowerCase().includes(q) || String(s.norad_id || '').includes(q)
    if (m) seen.add(s.norad_id)
    return m
  }).slice(0, 10)
})
const searchIsNorad = computed(() => /^\d{1,6}$/.test(searchQuery.value.trim()))
const totalSats = computed(() => allSats.value.length)
const critCount = computed(() =>
  (props.conjunctions || []).filter(c => c.risk_index > 70 && c.status !== 'RESOLVED').length)

function riskColor(r) { return r >= 70 ? '#ef4444' : r >= 30 ? '#f59e0b' : '#10b981' }
function satColor(sat) {
  if (sat.status === 'MANEUVERING' || sat.status === 'EMERGENCY') return '#8b5cf6'
  if (sat.risk_score >= 70) return '#ef4444'
  if (sat.risk_score >= 30) return '#f59e0b'
  return '#10b981'
}

// ── Keplerian orbital mechanics ───────────────────────────────────────────────
const MU = 398600, RE = 6371
const orbitMap  = new Map()
const startTime = Date.now()

function initOrbit(sat) {
  const a = sat.alt_km || 550
  const r = RE + a
  const period = 2 * Math.PI * Math.sqrt(r * r * r / MU)
  orbitMap.set(sat.id, {
    incl:  sat._incl ?? Math.abs(sat.lat || 20) * (Math.PI / 180),
    raan:  sat._raan ?? ((sat.lon || 0) * (Math.PI / 180)),
    omega: (2 * Math.PI) / period,
    altKm: a,
    phase: ((sat.id * 137.508) % 360) * (Math.PI / 180),
  })
}

function propagate(satId, nowMs) {
  const o = orbitMap.get(satId); if (!o) return null
  const theta = o.phase + o.omega * ((nowMs - startTime) / 1000)
  const R  = 1 + o.altKm / RE
  const px = Math.cos(theta), py = Math.sin(theta)
  const qy = py * Math.cos(o.incl), qz = py * Math.sin(o.incl)
  const ex = px * Math.cos(o.raan) - qy * Math.sin(o.raan)
  const ey = px * Math.sin(o.raan) + qy * Math.cos(o.raan)
  return { x: ex * R, y: qz * R, z: ey * R, r: R }
}

function toLatLng(pos) {
  const { x, y, z, r } = pos
  return {
    lat:      Math.asin(Math.max(-1, Math.min(1, y / r))) * 180 / Math.PI,
    lng:      Math.atan2(z, x) * 180 / Math.PI,
    altitude: (r - 1) * RE * 1000,
  }
}

// ── CesiumJS scene ────────────────────────────────────────────────────────────
let viewer          = null
let evtHandler      = null
let lastInteract    = 0
let clockStartJulian = null
let camTargetEntity = null       // hidden point the camera tracks (smoothed, centered)
let smoothPos       = null       // damped position trailing the real satellite
let trackedReal     = null       // the real satellite entity being followed
const entityMap     = new Map()  // satId → entity
const conjMap       = new Map()  // conjId → entity
const tracking      = ref(false) // true while camera is locked onto a satellite

// EXACT position property — computes SGP4 every frame at the precise clock time
// (no interpolation error → matches real trackers exactly). CallbackPositionProperty
// is a true PositionProperty, so unlike a plain CallbackProperty it renders models
// correctly AND auto-upgrades to real orbits the moment the TLE finishes loading.
function buildPositionProperty(sat) {
  return new Cesium.CallbackPositionProperty((time) => {
    const jsDate = Cesium.JulianDate.toDate(time)
    let ll = null
    if (sat.norad_id && hasRealOrbit(sat.norad_id)) {
      ll = realLatLng(sat.norad_id, jsDate)          // exact SGP4
    } else {
      const pos = propagate(sat.id, jsDate.getTime()) // fallback until TLE loads
      ll = pos ? toLatLng(pos) : null
    }
    if (!ll) return undefined
    // CORRECT absolute altitude (meters above the fixed WGS84 ellipsoid)
    return Cesium.Cartesian3.fromDegrees(ll.lng, ll.lat, ll.altitude)
  }, false)
}

// ── Fly-to + TRACK: cycle satellites by risk, camera locks on natively ──
let flyIdx = 0
function flyToNext() {
  if (!viewer) return
  const sorted = [...allSats.value].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
  if (!sorted.length) return
  const sat = sorted[flyIdx % sorted.length]
  flyIdx++

  const entity = entityMap.get(sat.id)
  if (!entity) return

  // Native trackedEntity: Cesium locks the camera to the satellite and keeps it
  // centered. Zoom/drag now orbit AROUND the satellite (no snap-back).
  viewer.trackedEntity = entity
  tracking.value = true

  const ll = entityLatLon(entity)
  tooltip.value = {
    visible:  true,
    x: 60, y: 60,
    name:     sat.name,
    norad:    sat.norad_id || null,
    operator: sat.operator || '—',
    lat:      ll.lat,
    lon:      ll.lon,
    alt:      Math.round(sat.alt_km || 550),
    risk:     sat.risk_score || 0,
  }
}

// RETURN: release the satellite lock and fly back to the full-Earth overview
function releaseTracking() {
  if (!viewer) return
  viewer.trackedEntity = undefined
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)  // back to world frame
  trackedReal = null
  smoothPos = null
  tracking.value = false
  tooltip.value.visible = false
  clearOrbit()
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(20, 20, 22000000),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 1.5,
    complete: () => { lastInteract = Date.now() },
  })
  lastInteract = Date.now() + 2000
}

// ── Blender-style nav controls ──
function camZoom(factor) {
  if (!viewer) return
  const h = viewer.camera.positionCartographic.height
  viewer.camera.zoomIn(h * factor)
  lastInteract = Date.now()
}
function camTilt(deg) {
  if (!viewer) return
  viewer.camera.rotate(viewer.camera.right, Cesium.Math.toRadians(deg))
  lastInteract = Date.now()
}
function camSpin(deg) {
  if (!viewer) return
  viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(deg))
  lastInteract = Date.now()
}
function camHome() {
  if (tracking.value) { releaseTracking(); return }
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(20, 20, 22000000),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 1.2,
  })
  lastInteract = Date.now()
}

async function buildScene() {
  Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN

  viewer = new Cesium.Viewer(cesiumContainer.value, {
    animation:             false,
    timeline:              false,
    baseLayerPicker:       false,
    geocoder:              false,
    homeButton:            false,
    sceneModePicker:       false,
    navigationHelpButton:  false,
    fullscreenButton:      false,
    infoBox:               false,
    selectionIndicator:    false,
    shouldAnimate:         false,
    baseLayer:             false,   // we add imagery manually below
    msaaSamples:           1,       // disable MSAA (strict-GPU driver issue)
    contextOptions: {
      webgl: { powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false },
    },
  })

  // Three.js overlay for the satellite 3D models (renders on top of the Cesium globe)
  setupThree(cesiumContainer.value)
  threeResize = () => {
    if (!three) return
    const el = cesiumContainer.value
    three.renderer.setSize(el.clientWidth, el.clientHeight, false)
  }
  window.addEventListener('resize', threeResize)

  // Build imagery stack: Google Maps satellite base + NASA Black Marble city lights on top
  let nightLayer = null
  try {
    // Bing Maps Aerial (asset 2) — tuned for Cesium globe, sharp at orbital distance
    const dayProv = await Cesium.IonImageryProvider.fromAssetId(2)
    viewer.imageryLayers.addImageryProvider(dayProv)
  } catch {
    try {
      const bing = await Cesium.IonImageryProvider.fromAssetId(2)
      viewer.imageryLayers.addImageryProvider(bing)
    } catch {
      viewer.imageryLayers.add(new Cesium.ImageryLayer(
        new Cesium.TileMapServiceImageryProvider({
          url: Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
          fileExtension: 'jpg',
          maximumLevel: 5,
        })
      ))
    }
  }
  // NASA Black Marble city lights — visible on dark side at ALL zoom distances
  try {
    const nightProv = await Cesium.IonImageryProvider.fromAssetId(3812)
    nightLayer = viewer.imageryLayers.addImageryProvider(nightProv)
    nightLayer.dayAlpha    = 0.0
    nightLayer.nightAlpha  = 1.0
    nightLayer.alpha       = 1.0
    nightLayer.brightness  = 4.0
    nightLayer.contrast    = 1.8
    nightLayer.gamma       = 0.3
    nightLayer.minificationFilter  = Cesium.TextureMinificationFilter.LINEAR
    nightLayer.magnificationFilter = Cesium.TextureMagnificationFilter.LINEAR
  } catch {
    // city lights unavailable — day/night shading still works
  }

  // Google Maps labels overlay — country names, city labels, borders (transparent, no imagery change)
  try {
    const labelsProv  = await Cesium.IonImageryProvider.fromAssetId(3830185)
    const labelsLayer = viewer.imageryLayers.addImageryProvider(labelsProv)
    labelsLayer.alpha = 0.85   // slightly transparent so labels don't overwhelm the globe
  } catch {
    // labels optional
  }

  // Prevent night shading from fading out at orbital distance
  viewer.scene.globe.nightFadeOutDistance = 0
  viewer.scene.globe.nightFadeInDistance  = 0

  // Real sun lighting — terminator moves in real time
  viewer.scene.globe.enableLighting = true
  clockStartJulian = Cesium.JulianDate.now()
  viewer.clock.startTime   = clockStartJulian.clone()
  viewer.clock.currentTime = clockStartJulian.clone()
  viewer.clock.stopTime    = Cesium.JulianDate.addSeconds(clockStartJulian, 3 * 3600, new Cesium.JulianDate())
  viewer.clock.clockRange  = Cesium.ClockRange.LOOP_STOP  // loop the 3 h orbit window
  viewer.clock.multiplier  = 1          // real-time: 1 second = 1 second
  viewer.clock.shouldAnimate = true    // clock ticks → sun + satellites move

  // Atmosphere and stars
  viewer.scene.skyAtmosphere.show = true
  viewer.scene.globe.showGroundAtmosphere = true
  viewer.scene.globe.depthTestAgainstTerrain = false
  // DISABLE log depth → Cesium uses multi-frustum depth instead. Multi-frustum gives
  // good precision on ALL GPUs and avoids the AMD log-depth shader bug ("uniform1fv:
  // no array") that fires when zoomed in / tracking and makes the model vanish.
  viewer.scene.logarithmicDepthBuffer = false

  // Google-style progressive loading: load detail MATCHED to the current zoom
  // (coarse + instant when far, fine only when you zoom in) — not max-everywhere.
  viewer.scene.globe.maximumScreenSpaceError = 2.0   // default; ~4x fewer tiles when zoomed out
  viewer.scene.globe.tileCacheSize = 3000            // keep many loaded tiles cached
  viewer.scene.globe.preloadAncestors = true         // coarse tiles ready first (instant low-res)
  viewer.scene.globe.preloadSiblings  = false        // don't pull neighbours we aren't looking at
  // more parallel downloads so tiles arrive fast — but KEEP throttling on so we
  // don't fire 25 CelesTrak requests at once and get rate-limited (500s)
  Cesium.RequestScheduler.maximumRequests = 24
  Cesium.RequestScheduler.maximumRequestsPerServer = 12

  // Initial camera: full-Earth overview
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(20, 20, 22000000),
    orientation: { heading: 0, pitch: -1.5708, roll: 0 },
  })

  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 40000000

  // Hidden camera-target point: the camera tracks THIS (a clean centered point with
  // a smoothed/damped position), not the model — so the handoff has no off-center
  // snap and the slight per-frame satellite jitter is filtered out of the camera.
  const CAM_TARGET_FALLBACK = Cesium.Cartesian3.fromDegrees(0, 0, 40_000_000)
  camTargetEntity = viewer.entities.add({
    // ALWAYS return a valid position (never undefined — that can break the shared
    // point/model render batch and make every satellite vanish after one frame)
    position: new Cesium.CallbackPositionProperty(() => (smoothPos ? smoothPos.clone() : CAM_TARGET_FALLBACK), false),
    // invisible point, only "shown" while tracking — gives flyTo a bounding sphere
    point: {
      pixelSize: 1,
      color: Cesium.Color.TRANSPARENT,
      show: new Cesium.CallbackProperty(() => tracking.value, false),
    },
  })

  allSats.value.forEach(initOrbit)

  // Build the satellites only AFTER the globe has finished loading its textures
  // (the globe rewrites the depth buffer as it settles; building models before that
  // can leave them depth-occluded / mis-rendered on some GPUs).
  let satsBuilt = false
  const buildSatsOnce = () => {
    if (satsBuilt || !viewer || viewer.isDestroyed()) return
    satsBuilt = true
    buildSatEntities()
    buildConjEntities()
    loadRealOrbits()
  }
  const buildListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued) => {
    if (queued === 0) { buildListener(); buildSatsOnce() }
  })
  // safety net: build after 8 s even if the globe never reports fully loaded
  setTimeout(buildSatsOnce, 8000)

  // (Removed fixModelsIBL — the UNLIT shader means models don't use image-based
  // lighting, and that routine's shader-rebuild was what made models vanish a few
  // seconds after load on AMD.)

  // ── DIAGNOSTICS ──
  window.__viewer = viewer
  window.__clockInfo = () => ({
    shouldAnimate: viewer.clock.shouldAnimate,
    multiplier: viewer.clock.multiplier,
    day: viewer.clock.currentTime.dayNumber,
    sec: Math.round(viewer.clock.currentTime.secondsOfDay),
  })
  window.__posCheck = () => {
    const out = []
    let i = 0
    for (const [id, e] of entityMap) {
      if (i++ >= 5) break
      let pos = null, err = null
      try { pos = e.position.getValue(viewer.clock.currentTime) } catch (ex) { err = ex.message }
      let heightKm = null
      if (pos) {
        try { heightKm = Math.round(Cesium.Cartographic.fromCartesian(pos).height / 1000) } catch {}
      }
      out.push({ name: e._satData?.name, real: !!(e._satData?.norad_id && hasRealOrbit(e._satData.norad_id)), defined: !!pos, heightKm, err })
    }
    return out
  }
  try {
    const gl = viewer.scene.context._gl
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    console.log('[AstroMesh] GPU:', dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?',
      '| WebGL:', gl.getParameter(gl.VERSION))
  } catch {}
  // __globe(false) hides the whole earth surface; __imagery(false) drops just the
  // imagery layers; __nightoff() removes only the bright-lights layer. Use these in
  // the console to isolate whether the earth textures are what kills the satellites.
  window.__globe   = (on = false) => { viewer.scene.globe.show = on; return 'globe.show=' + on }
  window.__imagery = (on = false) => { viewer.imageryLayers._layers.forEach(l => l.show = on); return 'imagery=' + on }
  window.__nightoff = () => { if (nightLayer) nightLayer.show = false; return 'night layer hidden' }
  window.__zoomToSat = () => {
    const e = entityMap.values().next().value; if (!e) return 'no entity'
    const p = e.position.getValue(viewer.clock.currentTime); if (!p) return 'no pos'
    const c = Cesium.Cartographic.fromCartesian(p)
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + 250000) })
    return 'zoomed'
  }
  viewer.scene.canvas.addEventListener('webglcontextlost', (e) => {
    console.error('[AstroMesh] ⚠️ WEBGL CONTEXT LOST — this is why everything vanishes', e)
  })
  // Walk the scene graph and report every glTF Model primitive's state.
  // Run __models() in the console to see if the satellite models actually loaded/render.
  window.__models = () => {
    const found = []
    const seen = new Set()
    const visit = (p) => {
      if (!p || seen.has(p)) return
      seen.add(p)
      if (typeof p.get === 'function' && typeof p.length === 'number') {
        for (let i = 0; i < p.length; i++) visit(p.get(i))
        return
      }
      if (('boundingSphere' in p) && ('activeAnimations' in p)) {
        found.push({ ready: p.ready, show: p.show })
      }
      if (p._primitives) visit(p._primitives)
    }
    visit(viewer.scene.primitives)
    return { totalPrimitives: viewer.scene.primitives.length, models: found.length, sample: found.slice(0, 5) }
  }
  let loggedFull = false
  viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued) => {
    if (queued === 0 && !loggedFull) {
      loggedFull = true
      const t = viewer.clock.currentTime
      const withPos = [...entityMap.values()].filter(en => en.position?.getValue(t)).length
      console.log('[AstroMesh] 🌍 GLOBE FULLY LOADED — entityMap:', entityMap.size,
        '| viewerEntities:', viewer.entities.values.length,
        '| withValidPos:', withPos,
        '| imageryLayers:', viewer.imageryLayers.length,
        '| modelShow(sample):', [...entityMap.values()].slice(0,1).map(en => en.model?.show?.getValue?.(t) ?? en.show))
    }
  })

  // Pause auto-spin on user interaction (tracking stays — drag orbits the satellite)
  const pauseSpin = () => { lastInteract = Date.now() }
  viewer.scene.canvas.addEventListener('mousedown', pauseSpin)
  viewer.scene.canvas.addEventListener('wheel', pauseSpin)
  viewer.scene.canvas.addEventListener('touchstart', pauseSpin)

  // Per-frame: damp the camera target toward the real satellite + live tooltip + idle spin
  viewer.scene.postRender.addEventListener(() => {
    renderThree()   // draw the Three.js satellite models synced to Cesium's camera
    if (trackedReal && smoothPos) {
      const real = trackedReal.position.getValue(viewer.clock.currentTime)
      if (real) Cesium.Cartesian3.lerp(smoothPos, real, 0.12, smoothPos)  // 0.12 = gentle smoothing
      if (tooltip.value.visible) {
        const ll = entityLatLon(trackedReal)
        tooltip.value.lat = ll.lat
        tooltip.value.lon = ll.lon
      }
    }
    if (viewer.trackedEntity || tracking.value) return
    // only auto-spin at the far overview — never when zoomed into the surface
    // (otherwise leaving it 3 s drifts you off to somewhere else entirely)
    const camHeight = viewer.camera.positionCartographic?.height ?? 0
    if (camHeight < 9_000_000) return
    if (Date.now() - lastInteract > 3000) {
      viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -Cesium.Math.toRadians(0.015))
    }
  })

  // Click-to-tooltip
  evtHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  evtHandler.setInputAction(click => {
    const picked = viewer.scene.pick(click.position)
    if (Cesium.defined(picked) && picked.id?._satData) {
      // clicking a satellite → same animated fly-in + lock-track as search
      trackSat(picked.id._satData)
    } else if (!tracking.value) {
      tooltip.value.visible = false
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function makeSatEntity(sat) {
  const color    = satColor(sat)
  const isAlert  = sat.risk_score >= 70 || sat.status === 'MANEUVERING' || sat.status === 'EMERGENCY'
  const isDebris = sat.operator === 'DEBRIS'
  const cesColor = Cesium.Color.fromCssColorString(color)

  // exact per-frame SGP4 position (auto-upgrades to real orbit when TLE loads)
  const posProp = buildPositionProperty(sat)

  // NO Cesium model — the visible 3D model is rendered by the Three.js overlay
  // (renderThree). The Cesium entity holds the position, a pickable dot, and the
  // orientation. The dot also serves as an always-visible marker.
  const entity = viewer.entities.add({
    position:    posProp,
    point: {
      pixelSize:    isAlert ? 6 : 4,
      color:        cesColor,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(1_000_000, 0.3, 20_000_000, 1.0),
    },
  })
  entity._satData = sat
  ensureThreeModel(sat.id, entity)   // create the Three.js 3D model for this satellite
  return entity
}

// 1) Fetch real TLEs for the gateway's tracked satellites → live SGP4 positions.
// 2) Pull extra REAL satellites from CelesTrak groups for density (no fakes).
const realCount = ref(0)
async function loadRealOrbits() {
  // --- gateway tracked sats: just load TLEs; entities auto-upgrade via callback ---
  const reals = (props.satellites || []).filter(s => s.norad_id)
  const ok = await loadRealTLEs(reals.map(s => s.norad_id))
  if (!viewer || viewer.isDestroyed()) return
  realCount.value = ok.size

  // --- load whichever context groups are enabled by default ---
  for (const cfg of GROUPS) {
    if (filterOn[cfg.key]) await ensureGroupLoaded(cfg.key)
  }
  if (!viewer || viewer.isDestroyed()) return
  syncSatEntities()
}

// Fetch a group's real satellites once and merge into extraSats.
async function ensureGroupLoaded(key) {
  if (loadedGroups.has(key)) return
  const cfg = GROUPS.find(g => g.key === key)
  if (!cfg) return
  loadedGroups.add(key)
  const recs = await loadGroup(cfg.group, cfg.limit, 100000, cfg.key)
  if (!recs.length) { loadedGroups.delete(key); return }
  extraSats.value = [...extraSats.value, ...recs]
  realCount.value += recs.length
}

// Toggle a filter group on/off (loads on first enable).
async function toggleGroup(key) {
  filterOn[key] = !filterOn[key]
  if (filterOn[key]) await ensureGroupLoaded(key)
  if (viewer && !viewer.isDestroyed()) syncSatEntities()
}

// ── Orbit path (one full revolution) — only for the selected satellite ──
let orbitEntity = null
let orbitTimer  = null
function clearOrbit() {
  if (orbitTimer) { clearInterval(orbitTimer); orbitTimer = null }
  if (orbitEntity) { viewer.entities.remove(orbitEntity); orbitEntity = null }
}
function showOrbit(sat) {
  // (re)draw the orbit and keep it refreshed so the satellite never drifts off it
  drawOrbit(sat)
  if (orbitTimer) clearInterval(orbitTimer)
  orbitTimer = setInterval(() => { if (tracking.value) drawOrbit(sat) }, 15000)
}
function drawOrbit(sat) {
  if (orbitEntity) { viewer.entities.remove(orbitEntity); orbitEntity = null }
  const alt = sat.alt_km || 550
  const periodS = 2 * Math.PI * Math.sqrt(Math.pow(RE + alt, 3) / MU)
  const pts = []
  // start a little BEFORE now so the satellite sits ~10% into the drawn arc, not at its end
  const baseMs = Date.now() - 0.1 * periodS * 1000
  const N = 240
  for (let i = 0; i <= N; i++) {
    const tms = baseMs + (i / N) * periodS * 1000
    let ll = null
    if (sat.norad_id && hasRealOrbit(sat.norad_id)) ll = realLatLng(sat.norad_id, new Date(tms))
    else { const p = propagate(sat.id, tms); ll = p ? toLatLng(p) : null }
    if (ll) pts.push(Cesium.Cartesian3.fromDegrees(ll.lng, ll.lat, ll.altitude))
  }
  if (pts.length < 2) return
  orbitEntity = viewer.entities.add({
    polyline: {
      positions: pts,
      width: 1.6,
      arcType: Cesium.ArcType.NONE,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.85),
      }),
    },
  })
}

// ── Search → animated fly + continuous track ──
async function selectResult(sat) {
  searchQuery.value = ''
  await trackSat(sat)
}
async function searchByNorad() {
  const nid = parseInt(searchQuery.value.trim())
  if (!nid) return
  searchBusy.value = true
  const rec = await loadByNorad(nid)
  searchBusy.value = false
  if (!rec) return
  if (!extraSats.value.find(s => s.norad_id === nid)) extraSats.value = [...extraSats.value, rec]
  syncSatEntities()
  searchQuery.value = ''
  await trackSat(rec)
}
function trackSat(sat) {
  if (!viewer) return
  let entity = entityMap.get(sat.id)
  if (!entity) { initOrbit(sat); entity = makeSatEntity(sat); entityMap.set(sat.id, entity) }
  showOrbit(sat)
  tracking.value = true
  const ll = entityLatLon(entity)
  tooltip.value = {
    visible: true, x: 60, y: 60, name: sat.name, norad: sat.norad_id || null,
    operator: sat.operator || '—', lat: ll.lat, lon: ll.lon,
    alt: Math.round(sat.alt_km || 550), risk: sat.risk_score || 0,
  }
  // make sure we start from a clean world frame (no leftover tracking transform)
  viewer.trackedEntity = undefined
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)

  // Seed the smoothed camera target at the satellite, then fly the camera to the
  // TARGET (a clean centered point) and hand off to trackedEntity. No off-center
  // model → no orientation snap; the damped target removes jitter from the camera.
  const p0 = entity.position.getValue(viewer.clock.currentTime)
  smoothPos = p0 ? p0.clone() : null
  trackedReal = entity
  viewer.flyTo(camTargetEntity, {
    duration: 3.0,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-28), 240_000),
  }).then(() => {
    if (!viewer || viewer.isDestroyed() || !smoothPos) return
    // Bridge animation: smoothly rotate the camera from its fly-in-end pose to the
    // EXACT pose trackedEntity will impose (same position, looking at the target with
    // local up), THEN attach tracking — so the handoff has no sudden orientation jump.
    const enu    = Cesium.Transforms.eastNorthUpToFixedFrame(smoothPos)
    const invEnu = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4())
    const camPos = viewer.camera.positionWC.clone()
    const local  = Cesium.Matrix4.multiplyByPoint(invEnu, camPos, new Cesium.Cartesian3())
    const viewFrom = (Cesium.Cartesian3.magnitude(local) > 50_000)
      ? local : new Cesium.Cartesian3(0, -240_000, 130_000)

    const dir = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(smoothPos, camPos, new Cesium.Cartesian3()), new Cesium.Cartesian3())
    // start from the local UP axis, then orthogonalise it against dir so the
    // orientation is always valid (parallel dir/up would crash the renderer)
    const upCol = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian4())
    let up = new Cesium.Cartesian3(upCol.x, upCol.y, upCol.z)
    const proj = Cesium.Cartesian3.multiplyByScalar(dir, Cesium.Cartesian3.dot(up, dir), new Cesium.Cartesian3())
    up = Cesium.Cartesian3.subtract(up, proj, new Cesium.Cartesian3())

    const attach = () => {
      if (!viewer || viewer.isDestroyed()) return
      camTargetEntity.viewFrom = viewFrom
      viewer.trackedEntity = camTargetEntity
    }
    // only animate the bridge if the orientation is well-defined; else attach directly
    if (Cesium.Cartesian3.magnitude(up) > 1e-3 && Cesium.Cartesian3.magnitude(dir) > 1e-6) {
      up = Cesium.Cartesian3.normalize(up, new Cesium.Cartesian3())
      viewer.camera.flyTo({
        destination: camPos,
        orientation: { direction: dir, up },
        duration: 0.7,
        complete: attach,
      })
    } else {
      attach()
    }
  }).catch(() => {})
  emit('satelliteClick', sat.id)
}

// Full (re)build — only on first mount
function buildSatEntities() {
  entityMap.forEach((e, id) => { viewer.entities.remove(e); removeThreeModel(id) })
  entityMap.clear()
  for (const sat of allSats.value) {
    initOrbit(sat)
    entityMap.set(sat.id, makeSatEntity(sat))
  }
  console.log('[AstroMesh] buildSatEntities →', entityMap.size, 'entities for allSats=', allSats.value.length)
  // debug helper: run __sats() in the console
  window.__sats = () => {
    const t = viewer.clock.currentTime
    const sample = [...entityMap.values()].slice(0, 3).map(e => {
      const p = e.position && e.position.getValue(t)
      return { name: e._satData?.name, hasPos: !!p, posMag: p ? Math.round(Cesium.Cartesian3.magnitude(p) / 1000) + 'km' : null }
    })
    return {
      entityMapSize: entityMap.size,
      viewerEntities: viewer.entities.values.length,
      allSats: allSats.value.length,
      gatewaySats: (props.satellites || []).length,
      extraSats: extraSats.value.length,
      realOrbitsLoaded: realCount.value,
      cameraHeightKm: Math.round((viewer.camera.positionCartographic?.height || 0) / 1000),
      sample,
    }
  }
}

// INCREMENTAL update — called on every gateway poll. Never recreates existing
// models (that caused the flicker). Only adds new sats, removes gone ones,
// and updates colour/size in place for risk changes.
function syncSatEntities() {
  const liveIds = new Set()
  for (const sat of allSats.value) {
    liveIds.add(sat.id)
    const existing = entityMap.get(sat.id)
    if (!existing) {
      initOrbit(sat)
      entityMap.set(sat.id, makeSatEntity(sat))
      continue
    }
    // update appearance only
    const isAlert  = sat.risk_score >= 70 || sat.status === 'MANEUVERING' || sat.status === 'EMERGENCY'
    existing.model.minimumPixelSize = isAlert ? 26 : 20
    existing._satData = sat
  }
  // remove satellites that disappeared — but NEVER the one being tracked
  // (so a filtered-off satellite you searched/clicked stays visible while locked)
  let removed = 0
  for (const [id, ent] of entityMap) {
    if (!liveIds.has(id) && ent !== trackedReal) { viewer.entities.remove(ent); removeThreeModel(id); entityMap.delete(id); removed++ }
  }
  if (removed) console.warn('[AstroMesh] syncSatEntities REMOVED', removed, 'entities; now', entityMap.size, '| allSats=', allSats.value.length)
}

// Conjunction lines removed from the 3D view (the straight lines crossing Earth
// looked wrong). Conjunctions still drive the side-panel risk monitor. The 3D view
// now shows real ORBIT PATHS for the selected satellite instead.
function buildConjEntities() {
  conjMap.forEach(e => viewer.entities.remove(e))
  conjMap.clear()
}

// Only react when the SET of satellite IDs changes (not on every risk tick),
// and update incrementally — never rebuild existing models.
watch(() => (props.satellites || []).map(s => s.id).sort().join(','), () => {
  if (viewer && !viewer.isDestroyed()) { syncSatEntities(); buildConjEntities() }
})

// Risk/status changes → update colours in place (cheap, no model reload)
watch(() => (props.satellites || []).map(s => `${s.id}:${s.risk_score}:${s.status}`).join(','), () => {
  if (viewer && !viewer.isDestroyed()) syncSatEntities()
})

watch(() => props.conjunctions, () => {
  if (viewer && !viewer.isDestroyed()) buildConjEntities()
}, { deep: true })

// Esc / Enter releases satellite lock
function onKey(e) {
  if ((e.key === 'Escape' || e.key === 'Enter') && tracking.value) releaseTracking()
}

onMounted(() => {
  buildScene()
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  if (threeResize) window.removeEventListener('resize', threeResize)
  if (orbitTimer) clearInterval(orbitTimer)
  if (evtHandler) evtHandler.destroy()
  if (three) { try { three.renderer.dispose(); three.renderer.domElement.remove() } catch {} ; three = null }
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
  orbitMap.clear()
  entityMap.clear()
  conjMap.clear()
})
</script>

<style scoped>
.globe-wrapper  { position:relative; width:100%; height:100%; background:#000; overflow:hidden; border-radius:6px; }
.cesium-container { position:absolute; inset:0; width:100%; height:100%; }

/* Strip Cesium's default chrome so only the globe shows */
.cesium-container :deep(.cesium-viewer-bottom)        { display:none !important; }
.cesium-container :deep(.cesium-widget-credits)       { display:none !important; }
.cesium-container :deep(.cesium-viewer-toolbar)       { display:none !important; }
.cesium-container :deep(.cesium-performanceDisplay)   { display:none !important; }
.cesium-container :deep(.cesium-widget)               { background:#000 !important; }
.cesium-container :deep(.cesium-credit-logoContainer) { display:none !important; }
.cesium-container :deep(canvas.cesium-widget-errorPanel) { display:none !important; }

.hud-overlay   { position:absolute; inset:0; pointer-events:none; z-index:10; }
.hud-tl { position:absolute; top:14px; left:14px; }
.hud-title {
  font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:700;
  letter-spacing:0.2em; color:rgba(59,130,246,0.9); text-transform:uppercase;
}
.hud-sub {
  font-family:'JetBrains Mono',monospace; font-size:9px;
  letter-spacing:0.08em; color:rgba(148,163,184,0.55); margin-top:3px;
}
.hud-tr { position:absolute; top:14px; right:14px; display:flex; flex-direction:column; gap:5px; align-items:flex-end; }
.legend-row {
  display:flex; align-items:center; gap:6px; font-family:'JetBrains Mono',monospace;
  font-size:9px; letter-spacing:0.08em; color:rgba(148,163,184,0.65);
}
.ldot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
.hud-bl  { position:absolute; bottom:14px; left:14px; }
.hud-bm  { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); pointer-events:all; display:flex; gap:8px; }
.hud-br  { position:absolute; bottom:14px; right:14px; font-family:'JetBrains Mono',monospace; font-size:9px; color:rgba(148,163,184,0.4); letter-spacing:0.1em; }
.locate-btn, .release-btn {
  font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:600;
  letter-spacing:0.12em; color:rgba(59,130,246,0.9);
  background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.35);
  padding:5px 14px; border-radius:4px; cursor:pointer; transition:all 0.2s;
}
.locate-btn:hover { background:rgba(59,130,246,0.18); border-color:rgba(59,130,246,0.7); color:#fff; }
.release-btn { color:rgba(245,158,11,0.95); background:rgba(245,158,11,0.1); border-color:rgba(245,158,11,0.4); }
.release-btn:hover { background:rgba(245,158,11,0.22); border-color:rgba(245,158,11,0.8); color:#fff; }

/* Blender-style nav toolbar */
.nav-toolbar {
  position:absolute; right:14px; top:50%; transform:translateY(-50%);
  display:flex; flex-direction:column; gap:4px; pointer-events:all;
  background:rgba(8,11,18,0.55); border:1px solid rgba(59,130,246,0.2);
  border-radius:8px; padding:6px; backdrop-filter:blur(6px);
}
.nav-btn {
  width:30px; height:30px; display:flex; align-items:center; justify-content:center;
  font-family:'JetBrains Mono',monospace; font-size:14px; font-weight:700;
  color:rgba(148,163,184,0.85); background:rgba(59,130,246,0.06);
  border:1px solid rgba(59,130,246,0.25); border-radius:5px; cursor:pointer; transition:all 0.15s;
}
.nav-btn:hover  { background:rgba(59,130,246,0.25); border-color:rgba(59,130,246,0.7); color:#fff; }
.nav-btn:active { transform:scale(0.92); }
.nav-btn.home   { color:rgba(16,185,129,0.9); border-color:rgba(16,185,129,0.35); }
.nav-btn.home:hover { background:rgba(16,185,129,0.2); border-color:rgba(16,185,129,0.7); color:#fff; }
.nav-sep { height:1px; background:rgba(59,130,246,0.2); margin:2px 2px; }

/* Search panel (top-center) */
.search-panel { position:absolute; top:14px; left:50%; transform:translateX(-50%); width:300px; pointer-events:all; z-index:15; }
.search-input {
  width:100%; font-family:'JetBrains Mono',monospace; font-size:11px; color:#e2e8f0;
  background:rgba(8,11,18,0.8); border:1px solid rgba(59,130,246,0.4); border-radius:6px;
  padding:7px 12px; outline:none; backdrop-filter:blur(8px); letter-spacing:0.04em;
}
.search-input:focus { border-color:rgba(59,130,246,0.8); }
.search-input::placeholder { color:rgba(148,163,184,0.5); }
.search-results {
  margin-top:4px; background:rgba(8,11,18,0.92); border:1px solid rgba(59,130,246,0.3);
  border-radius:6px; overflow:hidden; backdrop-filter:blur(8px);
}
.search-row {
  display:flex; justify-content:space-between; align-items:center; gap:12px;
  padding:6px 12px; cursor:pointer; font-family:'JetBrains Mono',monospace; font-size:10px;
  border-bottom:1px solid rgba(59,130,246,0.08);
}
.search-row:hover { background:rgba(59,130,246,0.18); }
.sr-name  { color:#e2e8f0; }
.sr-norad { color:rgba(148,163,184,0.6); }
.search-row.fetch { color:rgba(59,130,246,0.9); justify-content:center; }

/* Filter panel (left side, below title) */
.filter-panel {
  position:absolute; top:70px; left:14px; pointer-events:all; z-index:12;
  background:rgba(8,11,18,0.55); border:1px solid rgba(59,130,246,0.2);
  border-radius:8px; padding:8px 10px; backdrop-filter:blur(6px);
}
.filter-title { font-family:'JetBrains Mono',monospace; font-size:8px; font-weight:700; letter-spacing:0.18em; color:rgba(59,130,246,0.8); margin-bottom:6px; }
.filter-row { display:flex; align-items:center; gap:7px; font-family:'JetBrains Mono',monospace; font-size:9px; color:rgba(148,163,184,0.85); cursor:pointer; padding:2px 0; }
.filter-row input { accent-color:#3b82f6; cursor:pointer; width:11px; height:11px; }
.threat-pill {
  display:flex; align-items:center; gap:8px; font-family:'JetBrains Mono',monospace;
  font-size:10px; font-weight:600; letter-spacing:0.1em; color:#ef4444;
  background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); padding:5px 12px; border-radius:4px;
}
.pulse-dot {
  width:6px; height:6px; border-radius:50%; background:#ef4444;
  box-shadow:0 0 8px #ef4444; animation:pulse 1s ease-in-out infinite; flex-shrink:0;
}
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.2} }
.corner { position:absolute; width:22px; height:22px; pointer-events:none; z-index:10; }
.corner.tl { top:0;left:0;    border-top:2px solid rgba(59,130,246,0.5); border-left:2px solid rgba(59,130,246,0.5); }
.corner.tr { top:0;right:0;   border-top:2px solid rgba(59,130,246,0.5); border-right:2px solid rgba(59,130,246,0.5); }
.corner.bl { bottom:0;left:0; border-bottom:2px solid rgba(59,130,246,0.5); border-left:2px solid rgba(59,130,246,0.5); }
.corner.br { bottom:0;right:0;border-bottom:2px solid rgba(59,130,246,0.5); border-right:2px solid rgba(59,130,246,0.5); }
.sat-tooltip {
  position:absolute; pointer-events:none; z-index:20;
  background:rgba(8,11,18,0.92); border:1px solid rgba(59,130,246,0.4);
  border-radius:6px; padding:8px 12px; min-width:160px; backdrop-filter:blur(8px);
}
.tt-name { font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:700; color:#e2e8f0; margin-bottom:6px; letter-spacing:0.05em; }
.tt-row  { display:flex; justify-content:space-between; gap:16px; font-family:'JetBrains Mono',monospace; font-size:10px; color:rgba(148,163,184,0.7); margin-top:3px; }
.tt-row span:last-child { color:#e2e8f0; }
.tt-verify {
  display:block; margin-top:8px; padding-top:7px; border-top:1px solid rgba(59,130,246,0.2);
  font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:0.06em;
  color:rgba(59,130,246,0.85); text-decoration:none; pointer-events:all;
}
.tt-verify:hover { color:#60a5fa; }
</style>

<template>
  <div class="gc">
    <!-- ============ SPACE WEATHER + REPLAY ============ -->
    <div class="gc-block">
      <div class="gc-head">
        <span class="gc-title">SPACE WEATHER</span>
        <span v-if="sw && sw.conditions" class="gc-scale" :class="stormClass">
          Kp {{ sw.conditions.kp }} · {{ sw.conditions.scale_g }}
        </span>
        <span v-else class="gc-scale gc-down">FEED DOWN</span>
      </div>

      <div v-if="sw && sw.conditions && sw.ground_segment" class="gc-sw">
        <span class="gc-stations" :class="{ degraded: sw.ground_segment.stations_available < sw.ground_segment.stations_assigned }">
          {{ sw.ground_segment.stations_available }}/{{ sw.ground_segment.stations_assigned }} ground stations reachable
        </span>
        <span v-if="sw.ground_segment.blackout_reason" class="gc-blackout">{{ sw.ground_segment.blackout_reason }}</span>
        <span class="gc-src">{{ sw.conditions.source }}</span>
      </div>
      <div v-else class="gc-note">
        Feed unavailable — FR-19 and FR-21 report <b>UNRESOLVED</b> rather than assuming a quiet Sun.
      </div>

      <div class="gc-row">
        <button class="gc-btn" :class="{ on: !replay }" @click="$emit('replay', null)">LIVE</button>
        <button class="gc-btn gc-storm" :class="{ on: replay && replay.id === 'gannon' }" @click="$emit('replay', 'gannon')">
          ⚡ REPLAY GANNON — 10 MAY 2024
        </button>
      </div>
      <div v-if="replay" class="gc-replay">
        Replaying a recorded event. During this storm about half of ~10,000 LEO payloads manoeuvred —
        the largest satellite migration on record — and a peer-reviewed assessment called it a serious
        challenge for existing conjunction assessment infrastructure.
      </div>
    </div>

    <!-- ============ THE RETURN LEG ============ -->
    <div class="gc-block">
      <div class="gc-head">
        <span class="gc-title">RETURN LEG — CONTROLLED DEORBIT</span>
      </div>

      <div class="gc-row">
        <input v-model="norad" class="gc-in" placeholder="NORAD id" @keyup.enter="$emit('deorbit', Number(norad))" />
        <button class="gc-btn" :disabled="!norad" @click="$emit('deorbit', Number(norad))">PLAN DEORBIT</button>
        <button v-if="deorbit" class="gc-btn gc-fix" @click="$emit('retarget')">WHAT WOULD FIX IT</button>
      </div>
      <div class="gc-hint">
        <span v-for="s in SUGGEST" :key="s.norad" class="gc-chip" @click="norad = String(s.norad); $emit('deorbit', s.norad)">
          {{ s.label }}
        </span>
      </div>

      <div v-if="deorbit" class="gc-deorbit">
        <!-- An UNRESOLVED footprint carries only {unresolved, reason}. Rendering
             the normal grid against it throws — and it is precisely the state we
             enter whenever the space-weather feed is unavailable, so it has to
             render correctly rather than crash. -->
        <div v-if="deorbit.footprint && deorbit.footprint.unresolved" class="gc-unres">
          <b>FOOTPRINT UNRESOLVED</b>
          <div class="ar-line">{{ deorbit.footprint.reason }}</div>
          <div class="ar-line">
            The corridor cannot be characterised, so FR-17a reports UNEVALUATED and the
            deorbit is not authorised. Not knowing is not permission.
          </div>
        </div>

        <template v-else>
        <div class="gc-grid">
          <div><span class="k">OBJECT</span><span class="v">{{ deorbit.name }}</span></div>
          <div><span class="k">ENTRY</span><span class="v mono">{{ deorbit.entry_interface.lat }}, {{ deorbit.entry_interface.lon }}</span></div>
          <div>
            <span class="k">FOOTPRINT</span>
            <span class="v mono">{{ deorbit.footprint.span_km }} km span · 1σ {{ deorbit.footprint.sigma_km }} km</span>
          </div>
          <div v-if="deorbit.casualty">
            <span class="k">CASUALTY Ec</span>
            <span class="v mono" :class="deorbit.casualty.within_limit ? 'ok' : 'bad'">
              {{ deorbit.casualty.ec.toExponential(2) }} / limit 1e-4
            </span>
          </div>
          <div v-if="deorbit.consequence && deorbit.consequence.worst">
            <span class="k">GROUND</span>
            <span class="v" :class="deorbit.consequence.worst.critical ? 'bad' : ''">{{ deorbit.consequence.worst.label }}</span>
          </div>
          <div v-if="deorbit.descent && deorbit.descent.conjunctions">
            <span class="k">DESCENT COLA</span>
            <span class="v mono" :class="deorbit.descent.conjunctions.length ? 'bad' : 'ok'">
              {{ deorbit.descent.conjunctions.length }} hits / {{ deorbit.descent.screened }} screened
            </span>
          </div>
          <div v-else>
            <span class="k">DESCENT COLA</span>
            <span class="v mono">not screened — FR-22 UNEVALUATED</span>
          </div>
        </div>
        <div class="gc-disp" v-if="deorbit.footprint.dispersion">
          dispersion driven by <b>{{ deorbit.footprint.dispersion.driven_by }}</b> ·
          {{ (deorbit.footprint.samples || 0).toLocaleString() }} Monte Carlo samples
          <span v-if="deorbit.footprint.dispersion.density_basis" class="gc-basis">
            · density {{ deorbit.footprint.dispersion.density_basis }}
          </span>
        </div>
        <div class="gc-honesty">
          Ec is computed exactly per NASA-STD-8719.14 and reported unmodified, so it stays comparable
          to the figures the FAA and SpaceX publish. The consequence class is a separate second number.
        </div>
        </template>
      </div>
    </div>

    <!-- ============ THEME INDEPENDENCE ============ -->
    <div class="gc-block">
      <div class="gc-head">
        <span class="gc-title">THEME INDEPENDENCE</span>
        <button class="gc-btn gc-sm" @click="$emit('portability')">{{ portability ? 'HIDE' : 'PROVE IT' }}</button>
      </div>
      <div v-if="!portability" class="gc-note">
        The engine takes a rulebook and a context. It has never heard of a satellite.
      </div>
      <div v-else class="gc-port">
        <div class="gc-claim">{{ portability.claim }}</div>
        <div class="gc-engine">engine changes required: <b>{{ portability.engine_changes_required }}</b></div>
        <div v-for="sc in portability.scenarios" :key="sc.id" class="gc-scen">
          <span class="sc-label">{{ sc.label }}</span>
          <span class="sc-sig" :class="'sig-' + sc.signal.toLowerCase()">{{ sc.signal }}</span>
          <span class="sc-pct mono">{{ sc.progress }}%</span>
        </div>
      </div>
    </div>

    <!-- ============ AUTHOR A RULE ============ -->
    <div class="gc-block">
      <div class="gc-head">
        <span class="gc-title">WRITE A NEW RULE, IN ENGLISH</span>
      </div>
      <div class="gc-row">
        <input
          v-model="ruleText"
          class="gc-in wide"
          placeholder="e.g. Never manoeuvre within 2 hours of closest approach"
          @keyup.enter="submitRule"
        />
        <button class="gc-btn gc-auth" :disabled="!ruleText || authoring" @click="submitRule">
          {{ authoring ? '…' : 'COMPILE' }}
        </button>
      </div>
      <div v-if="authorResult" class="gc-author" :class="authorResult.error ? 'bad-box' : 'ok-box'">
        <template v-if="authorResult.error">
          <b>REFUSED — {{ authorResult.error }}</b>
          <div v-if="authorResult.reason" class="ar-line">{{ authorResult.reason }}</div>
          <div v-if="authorResult.compiled_as" class="ar-line mono">compiled as: {{ authorResult.compiled_as }}</div>
          <div v-if="authorResult.probe" class="ar-probe">
            <span v-for="(p, i) in authorResult.probe" :key="i">{{ p.value }}{{ p.unit }} → {{ p.result }}</span>
          </div>
          <div v-if="authorResult.errors" class="ar-line">{{ authorResult.errors.join('; ') }}</div>
        </template>
        <template v-else>
          <b>{{ authorResult.rule.id }} — {{ authorResult.rule.title }}</b>
          <div class="ar-line">{{ authorResult.rule.requirement }}</div>
          <div class="ar-line">
            {{ authorResult.rule.class }}<template v-if="!authorResult.rule.waivable"> · NON-NEGOTIABLE</template>
            · {{ authorResult.rule.authority }}
          </div>
          <div v-if="authorResult.probe" class="ar-probe">
            <span v-for="(p, i) in authorResult.probe" :key="i">{{ p.value }}{{ p.unit }} → {{ p.result }}</span>
          </div>
          <div class="ar-verify">✓ {{ authorResult.verification }}</div>
          <pre class="ar-tla">{{ authorResult.tla_invariant }}</pre>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  sw: { type: Object, default: null },
  replay: { type: Object, default: null },
  deorbit: { type: Object, default: null },
  portability: { type: Object, default: null },
})
const emit = defineEmits(['replay', 'deorbit', 'retarget', 'portability', 'author'])

const norad = ref('')
const ruleText = ref('')
const authoring = ref(false)
const authorResult = ref(null)

// Real objects with real NORAD ids, so the demo is never typing into a void.
const SUGGEST = [
  { norad: 44714, label: 'STARLINK-1008' },
  { norad: 25544, label: 'ISS' },
  { norad: 40697, label: 'SENTINEL-2A' },
]

const stormClass = computed(() => {
  if (!props.sw) return ''
  const kp = props.sw.conditions.kp
  return kp >= 7 ? 'severe' : kp >= 5 ? 'storm' : 'quiet'
})

async function submitRule() {
  if (!ruleText.value) return
  authoring.value = true
  authorResult.value = null
  try {
    const res = await fetch('/api/constraints/author', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ruleText.value }),
    })
    authorResult.value = await res.json()
    if (res.ok) {
      ruleText.value = ''
      emit('author', authorResult.value)
    }
  } catch (e) {
    authorResult.value = { error: 'request failed', reason: e.message }
  }
  authoring.value = false
}
</script>

<style scoped>
.gc { display: flex; flex-direction: column; gap: 9px; font-family: var(--font-display); }
.gc-block { background: var(--bg-panel-3); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.gc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.gc-title { font-size: 9.5px; letter-spacing: 1.3px; color: var(--text-secondary); font-weight: 700; }

.gc-scale { font-family: var(--font-mono); font-size: 9.5px; font-weight: 700; padding: 2px 7px; border-radius: 3px; }
.gc-scale.quiet { color: var(--color-green); background: var(--color-green-dim); border: 1px solid var(--color-green); }
.gc-scale.storm { color: var(--color-amber); background: var(--color-amber-dim); border: 1px solid var(--color-amber); }
.gc-scale.severe { color: var(--color-red); background: var(--color-red-dim); border: 1px solid var(--color-red); }
.gc-scale.gc-down { color: var(--color-purple); background: var(--color-purple-dim); border: 1px solid var(--color-purple); }

.gc-sw { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.gc-stations { font-size: var(--t-label); color: var(--color-green); }
.gc-stations.degraded { color: var(--color-red); font-weight: 600; }
.gc-blackout { font-size: 10px; color: var(--color-red); }
.gc-src { font-size: var(--t-micro); color: var(--text-dim); }
.gc-note { font-size: 10px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 7px; }

.gc-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.gc-btn {
  background: var(--bg-panel-2); border: 1px solid var(--border-bright); color: var(--text-secondary);
  font-family: var(--font-mono); font-size: var(--t-micro); font-weight: 700; letter-spacing: 0.6px;
  padding: 6px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap;
}
.gc-btn:hover { border-color: var(--accent-blue); color: var(--text-primary); }
.gc-btn.on { background: var(--accent-blue-dim); border-color: var(--accent-blue); color: var(--accent-blue); }
.gc-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.gc-btn.gc-storm.on { background: var(--color-red-dim); border-color: var(--color-red); color: var(--color-red); }
.gc-btn.gc-fix { border-color: var(--color-green); color: var(--color-green); }
.gc-btn.gc-auth { border-color: var(--color-purple); color: var(--color-purple); }
.gc-btn.gc-sm { padding: 3px 8px; font-size: 8.5px; }

.gc-replay { margin-top: 7px; font-size: 10px; color: var(--color-amber); line-height: 1.5; }

.gc-in {
  background: var(--bg-panel-2); border: 1px solid var(--border); border-radius: 4px;
  color: var(--text-primary); font-family: var(--font-mono); font-size: var(--t-label); padding: 6px 8px; width: 110px;
}
.gc-in.wide { flex: 1; width: auto; }
.gc-in:focus { outline: none; border-color: var(--accent-blue); }

.gc-hint { display: flex; gap: 5px; margin-top: 6px; flex-wrap: wrap; }
.gc-chip {
  font-size: var(--t-micro); font-family: var(--font-mono); color: var(--text-dim);
  border: 1px dashed var(--border-bright); border-radius: 3px; padding: 2px 6px; cursor: pointer;
}
.gc-chip:hover { color: var(--accent-blue); border-color: var(--accent-blue); }

.gc-deorbit { margin-top: 9px; }
.gc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 14px; }
.gc-grid > div { display: flex; flex-direction: column; gap: 1px; }
.k { font-size: 8.5px; letter-spacing: 0.9px; color: var(--text-dim); font-weight: 700; }
.v { font-size: var(--t-label); color: var(--text-primary); }
.v.ok { color: var(--color-green); }
.v.bad { color: var(--color-red); font-weight: 600; }
.gc-disp { margin-top: 7px; font-size: 10px; color: var(--text-secondary); }
.gc-unres { padding: 9px 10px; border-radius: 5px; background: var(--color-purple-dim); border: 1px solid var(--color-purple); color: var(--color-purple); font-size: var(--t-label); line-height: 1.5; }
.gc-unres .ar-line { color: var(--text-secondary); margin-top: 4px; }
.gc-basis { color: var(--text-dim); }
.gc-honesty { margin-top: 6px; font-size: 9.5px; color: var(--text-dim); line-height: 1.5; font-style: italic; }

.gc-port { margin-top: 4px; }
.gc-claim { font-size: var(--t-label); color: var(--text-primary); line-height: 1.5; }
.gc-engine { font-size: 10px; color: var(--color-green); margin: 5px 0 7px; }
.gc-scen { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.sc-label { flex: 1; font-size: var(--t-label); color: var(--text-secondary); }
.sc-sig { font-family: var(--font-mono); font-size: 8.5px; font-weight: 700; padding: 1px 6px; border-radius: 3px; }
.sc-pct { font-size: 9.5px; color: var(--text-dim); width: 34px; text-align: right; }
.sig-complete { background: var(--color-green-dim); color: var(--color-green); }
.sig-partial { background: var(--color-amber-dim); color: var(--color-amber); }
.sig-blocked { background: var(--color-red-dim); color: var(--color-red); }
.sig-unresolved { background: var(--color-purple-dim); color: var(--color-purple); }

.gc-author { margin-top: 8px; padding: 8px 10px; border-radius: 5px; font-size: var(--t-label); line-height: 1.5; }
.gc-author.ok-box { background: rgba(139, 92, 246, 0.08); border: 1px solid var(--color-purple); }
.gc-author.bad-box { background: var(--color-red-dim); border: 1px solid var(--color-red); }
.ar-line { color: var(--text-secondary); margin-top: 3px; }
.ar-probe { display: flex; gap: 10px; margin-top: 5px; font-family: var(--font-mono); font-size: 9.5px; color: var(--text-dim); flex-wrap: wrap; }
.ar-verify { margin-top: 5px; font-size: 9.5px; color: var(--color-green); }
.ar-tla {
  margin-top: 7px; padding: 7px 9px; background: var(--bg-panel-3); border-radius: 4px;
  font-family: var(--font-mono); font-size: var(--t-micro); color: var(--accent-blue);
  white-space: pre-wrap; overflow-x: auto;
}
.mono { font-family: var(--font-mono); }
</style>

<template>
  <div class="ov" :class="{ flow: docked || part !== 'all' }">
    <!-- ===================== SIGNAL CARD — top left, compact =====================
         Deliberately NOT a full-width bar. The globe is the hero; this sits on
         it like an instrument, and leaves the planet visible edge to edge. -->
    <!-- COMPACT: one row. Always visible, never dominant. -->
    <button
      v-if="compact && part !== 'panel'"
      class="sig-row" :class="'s-' + sig.toLowerCase()"
      :title="`${sig} — open the constraint detail`"
      @click="$emit('open-detail')"
    >
      <span class="sig-lamp" :class="'s-' + sig.toLowerCase()"></span>
      <span class="sig-word">{{ sig }}</span>
      <span v-if="fleet" class="sig-pct mono">{{ fleet.progress }}%</span>
      <span class="sig-bar">
        <i v-for="s in ORDER" :key="s" :class="'b-' + s.toLowerCase()"
           :style="{ flexGrow: count(s) }"></i>
      </span>
      <span class="sig-chev">›</span>
    </button>

    <section v-if="!compact && part !== 'panel'" class="card signal" :class="['s-' + sig.toLowerCase(), { docked }]">
      <header class="signal-top">
        <span class="lamp" :class="'s-' + sig.toLowerCase()"></span>
        <div class="signal-words">
          <h1 class="signal-word">{{ sig }}</h1>
          <p class="signal-sub">CONSTRAINT WORK</p>
        </div>
        <div v-if="fleet" class="signal-pct mono">{{ fleet.progress }}<i>%</i></div>
      </header>

      <div class="burn">
        <span
          v-for="s in ORDER" :key="s"
          class="burn-seg" :class="'b-' + s.toLowerCase()"
          :style="{ flexGrow: count(s) }"
          :title="`${count(s)} ${s.toLowerCase()}`"
        ></span>
      </div>

      <div class="legend">
        <span v-for="s in ORDER" :key="s" class="lg" :class="{ off: !count(s) }">
          <i :class="'d-' + s.toLowerCase()"></i>
          <b class="mono">{{ count(s) }}</b> {{ s.toLowerCase() }}
        </span>
      </div>

      <p v-if="fleet" class="signal-meta mono">
        {{ fleet.rules_closed }} of {{ fleet.rules_applicable }} rules closed
      </p>

      <div v-if="!docked && fleet && fleet.next_deadline" class="strip strip-clock">
        <span class="strip-k">SELF-BLOCKS IN</span>
        <span class="strip-v mono">{{ fmtDur(fleet.next_deadline.in_ms) }}</span>
        <span class="strip-s mono">{{ fleet.next_deadline.rule_id }}</span>
      </div>

      <div v-if="!docked && fleet && fleet.best_next_evidence" class="strip strip-voi">
        <span class="strip-k">BEST NEXT ACTION</span>
        <span class="strip-v">{{ fleet.best_next_evidence.label }}</span>
        <span class="strip-s">
          closes {{ fleet.best_next_evidence.rules }} rules across {{ fleet.best_next_evidence.events }} events
        </span>
      </div>
      <!-- The rest of the capability, ON SCREEN. Everything below was
           previously hidden behind a collapsed drawer, which meant the only
           visible feature was the signal itself. -->
      <div v-if="!docked" class="caps">
        <button class="cap" :class="{ on: replay && replay.id === 'gannon' }" @click="$emit('replay', replay ? null : 'gannon')">
          <span class="cap-t">{{ replay ? 'RETURN TO LIVE' : 'REPLAY GANNON STORM' }}</span>
          <span class="cap-s">10 May 2024 · half of all LEO payloads manoeuvred</span>
        </button>
        <button class="cap" @click="$emit('deorbit')">
          <span class="cap-t">PLAN A DEORBIT</span>
          <span class="cap-s">the return leg — footprint, casualty risk, airspace</span>
        </button>
        <button class="cap" @click="$emit('longmarch')">
          <span class="cap-t">REPLAY LONG MARCH 5B</span>
          <span class="cap-s">4 Nov 2022 · 46 airports closed</span>
        </button>
        <button class="cap" @click="$emit('portability')">
          <span class="cap-t">PROVE THEME INDEPENDENCE</span>
          <span class="cap-s">same engine, a software release gate, zero changes</span>
        </button>
        <button class="cap" :class="{ on: zonesOn }" @click="$emit('toggleZones')">
          <span class="cap-t">{{ zonesOn ? 'HIDE SPACE-WEATHER ZONES' : 'SHOW SPACE-WEATHER ZONES' }}</span>
          <span class="cap-s">HF blackout boundary, auroral oval, scintillation belt</span>
        </button>
        <button class="cap" @click="$emit('author')">
          <span class="cap-t">WRITE A RULE IN ENGLISH</span>
          <span class="cap-s">compiled, probed, and proved in TLA+</span>
        </button>
      </div>
    </section>

    <!-- ===================== ONE RIGHT PANEL =====================
         Either the event list, or the rulebook for the selected event.
         One surface, never two — so the globe keeps the whole left side. -->
    <section v-if="part !== 'card'" class="card panel" :class="{ docked: part === 'panel' }">
      <!-- What the compressed header had to give up. These are live,
           quantitative and actionable, so they lead the detail panel rather
           than permanently occupying the sidebar above it. -->
      <div v-if="part === 'panel'" class="detail-lead">
        <div v-if="fleet && fleet.next_deadline" class="strip strip-clock">
          <span class="strip-k">SELF-BLOCKS IN</span>
          <span class="strip-v mono">{{ fmtDur(fleet.next_deadline.in_ms) }}</span>
          <span class="strip-s mono">{{ fleet.next_deadline.rule_id }}</span>
        </div>
        <div v-if="fleet && fleet.best_next_evidence" class="strip strip-voi">
          <span class="strip-k">BEST NEXT ACTION</span>
          <span class="strip-v">{{ fleet.best_next_evidence.label }}</span>
        </div>
      </div>

      <nav class="tabs">
        <button class="tab" :class="{ on: !report }" @click="$emit('close')">
          EVENTS <b class="mono">{{ events.length }}</b>
        </button>
        <button class="tab" :class="{ on: !!report }" :disabled="!report">
          RULEBOOK <b v-if="report" class="mono">{{ report.rules.length }}</b>
        </button>
      </nav>

      <!-- ---------- event list ---------- -->
      <div v-if="!report" class="scroll stagger">
        <button
          v-for="e in events" :key="e.id"
          class="ev" @click="$emit('select', e.id)"
        >
          <span class="ev-edge" :class="'b-' + sigOf(e).toLowerCase()"></span>
          <span class="ev-main">
            <span class="ev-pair">{{ e.sat1_name }} <i>×</i> {{ e.sat2_name }}</span>
            <span class="ev-meta mono">
              miss {{ fmtKm(e.min_range_km) }}
              <template v-if="e.constraint"> · {{ e.constraint.progress }}% closed</template>
              <template v-if="e.constraint && e.constraint.first"> · {{ e.constraint.first }}</template>
            </span>
          </span>
          <StateBadge class="ev-sig" :state="sigOf(e)" size="sm" :label="SHORT[sigOf(e)]" />
        </button>
        <p v-if="!events.length" class="empty">screening the catalogue…</p>
      </div>

      <!-- ---------- rulebook ---------- -->
      <div v-else class="scroll">
        <header class="rep-head">
          <h2 class="rep-pair">{{ report.pair || 'EVENT ' + report.conjunction_id }}</h2>
          <p class="rep-headline">{{ report.headline }}</p>
          <div class="rep-track"><span class="rep-fill" :class="'b-' + report.signal.toLowerCase()" :style="{ width: report.progress + '%' }"></span></div>
          <div class="rep-counts mono">
            <span class="c-ok">{{ report.counts.satisfied }} satisfied</span>
            <span v-if="report.counts.blocking" class="c-bad">{{ report.counts.blocking }} blocking</span>
            <span v-if="report.counts.unevaluated" class="c-unk">{{ report.counts.unevaluated }} unevaluated</span>
            <span v-if="report.counts.advisory" class="c-adv">{{ report.counts.advisory }} advisory</span>
            <span v-if="report.counts.waived" class="c-wv">{{ report.counts.waived }} waived</span>
          </div>
        </header>

        <div v-if="outstanding.length" class="block">
          <p class="label">OUTSTANDING</p>
          <div v-for="(a, i) in outstanding" :key="i" class="act" :class="'a-' + a.severity.toLowerCase()">
            <span class="act-sev mono">{{ a.severity }}</span>
            <span>{{ a.action }}</span>
          </div>
        </div>

        <div class="block actions">
          <button class="btn" :disabled="planning" @click="$emit('plan', report.conjunction_id)">
            {{ planning ? 'PLANNING…' : 'PLAN AVOIDANCE MANEUVER' }}
          </button>
          <button class="btn vote" :class="{ gated: !report.authorised }" @click="$emit('vote', report.conjunction_id)">
            {{ report.authorised ? 'PUT TO THE OPERATOR VOTE' : 'VOTE — THE GATE WILL REFUSE' }}
          </button>
        </div>

        <p class="label">THE RULEBOOK</p>
        <div class="rules">
          <div
            v-for="r in sortedRules" :key="r.id"
            class="rule" :class="['st-' + r.state.toLowerCase(), { open: expanded === r.id }]"
            @click="expanded = expanded === r.id ? null : r.id"
          >
            <div class="r-row">
              <span class="r-icon" :class="'f-' + r.state.toLowerCase()">{{ ICON[r.state] }}</span>
              <span class="r-id mono">{{ r.id }}</span>
              <span class="r-title">{{ r.title }}</span>
              <span v-if="r.waivable === false" class="r-nn mono">NO OVERRIDE</span>
              <span class="r-actual mono">{{ r.actual || '—' }}</span>
            </div>

            <div v-if="expanded === r.id" class="r-detail" @click.stop>
              <div class="kv"><span class="k">ACTUAL</span><span class="mono">{{ r.actual || '—' }}</span></div>
              <div class="kv"><span class="k">LIMIT</span><span class="mono">{{ r.limit || '—' }}</span></div>
              <p class="d-line">{{ r.detail }}</p>
              <p class="d-line strong">{{ r.requirement }}</p>
              <p class="d-line auth mono">{{ r.authority }}</p>
              <p class="d-line why">{{ r.rationale }}</p>

              <div v-if="r.waiver" class="note amber">WAIVED by <b>{{ r.waiver.party }}</b> — “{{ r.waiver.reason }}”</div>
              <div v-if="r.waiver_rejected" class="note red">WAIVER REFUSED — {{ r.waiver_rejected }}</div>

              <div v-if="r.state === 'VIOLATED' && r.waivable !== false" class="waive">
                <input v-model="wParty" class="in" placeholder="operator" />
                <input v-model="wReason" class="in wide" placeholder="reason — recorded permanently" />
                <button class="in-go" :disabled="!wParty || !wReason" @click="fileWaiver(r.id)">FILE</button>
              </div>
              <div v-else-if="r.state === 'VIOLATED'" class="note slate">
                No override path exists. Not for an emergency, not for the leader, not for anyone.
              </div>
              <div v-else-if="r.state === 'UNEVALUATED'" class="note slate">
                Cannot be waived — it was never evaluated. Not knowing is not permission.
                <template v-if="r.resolved_by && r.resolved_by.length">
                  <br /><b>Resolved by:</b> {{ r.resolved_by.map(x => x.label || x).join(' · ') }}
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import StateBadge from './StateBadge.vue'
import { ref, computed } from 'vue'

const props = defineProps({
  fleet: { type: Object, default: null },
  events: { type: Array, default: () => [] },
  report: { type: Object, default: null },
  selectedId: { type: [Number, String], default: null },
  planning: { type: Boolean, default: false },
  replay: { type: Object, default: null },
  zonesOn: { type: Boolean, default: false },
  // Which surface to render. The signal card floats on the globe; the detail
  // panel now lives inside the dock, so it can never overlap anything.
  part: { type: String, default: 'all' },   // 'all' | 'card' | 'panel'
  // Docked surfaces are laid out by the dock, so they drop their own
  // positioning, borders and background entirely. Exactly one element owns
  // the geometry — which is why nothing can overlap any more.
  docked: { type: Boolean, default: false },
  // Compact renders the signal as a single clickable row rather than a card.
  //
  // Safety-critical convention says the current state must never be hidden
  // behind a click — but "always visible" does not have to mean "occupies a
  // third of the sidebar". One row keeps the state permanently on screen and
  // gives the detail its own panel, which is where detail belongs.
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['open-detail', 'select', 'close', 'plan', 'vote', 'waive', 'replay', 'deorbit', 'longmarch', 'portability', 'author', 'toggleZones'])

const ORDER = ['COMPLETE', 'PARTIAL', 'BLOCKED', 'UNRESOLVED']
const SHORT = { COMPLETE: 'DONE', PARTIAL: 'PART', BLOCKED: 'BLOCK', UNRESOLVED: 'UNKN' }
const ICON = { SATISFIED: '●', VIOLATED: '✕', UNEVALUATED: '○', WAIVED: '~', NOT_APPLICABLE: '–' }
// What stops me, what I don't know, what I should note, then everything closed.
const RANK = { VIOLATED: 0, UNEVALUATED: 1, WAIVED: 2, SATISFIED: 3, NOT_APPLICABLE: 4 }

const expanded = ref(null)
const wParty = ref('')
const wReason = ref('')

const sig = computed(() => (props.fleet && props.fleet.signal) || 'UNRESOLVED')
const count = (s) => (props.fleet && props.fleet.by[s]) || 0
const sigOf = (e) => (e.constraint && e.constraint.signal) || 'UNRESOLVED'
const outstanding = computed(() => (props.report ? props.report.next_actions.filter((a) => a.severity !== 'NONE').slice(0, 4) : []))

const sortedRules = computed(() => {
  if (!props.report) return []
  return [...props.report.rules].sort((a, b) => {
    const s = RANK[a.state] - RANK[b.state]
    if (s) return s
    if (a.class !== b.class) return a.class === 'HARD' ? -1 : 1
    return a.id.localeCompare(b.id)
  })
})

function fileWaiver(ruleId) {
  emit('waive', { rule_id: ruleId, party: wParty.value, reason: wReason.value })
  wReason.value = ''
}
function fmtDur(ms) {
  if (ms == null) return '—'
  const m = ms / 60000
  if (m < 60) return `${Math.round(m)}m`
  if (m < 1440) return `${(m / 60).toFixed(1)}h`
  return `${(m / 1440).toFixed(1)}d`
}
function fmtKm(k) {
  if (k == null) return '—'
  return k < 1 ? `${(k * 1000).toFixed(0)} m` : `${Number(k).toFixed(2)} km`
}
</script>

<style scoped>
/* ============================================================================
   Composition: TWO surfaces, not three. A compact signal card top-left and one
   panel on the right. The globe keeps the entire centre and left of the frame.
   Nothing is smaller than 10px. Nothing glows.
   ========================================================================= */

.ov.flow { position: static; inset: auto; pointer-events: auto; height: 100%; }
.ov { position: absolute; inset: 0; pointer-events: none; z-index: 900; font-family: var(--font-display); }
.ov > * { pointer-events: auto; }

.card {
  background: var(--glass);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border);
  border-radius: var(--r2);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
}

/* ---------------- signal card ---------------- */
.signal { position: absolute; top: var(--s5); left: var(--s5); width: 340px; padding: var(--s5) var(--s5) var(--s4); }
.signal.docked {
  position: static;
  width: auto;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: none;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  padding: var(--s4) var(--s5) var(--s3);
}

.signal-top { display: flex; align-items: center; gap: 14px; }
.lamp { width: 3px; height: 46px; flex-shrink: 0; border-radius: 2px; }
.lamp.s-complete { background: var(--color-green); }
.lamp.s-partial { background: var(--color-amber); }
.lamp.s-blocked { background: var(--color-red); }
/* UNLIT — hollow, no fill. "No reading" should look like no reading. */
.lamp.s-unresolved { background: transparent; border: 1px solid var(--color-purple); }

.signal-words { flex: 1; min-width: 0; }
.signal-word { font-family: var(--font-display); font-size: 34px; font-weight: 300; letter-spacing: 0.02em; line-height: 1; margin: 0; }
.signal-sub { font-size: 9px; font-weight: 500; letter-spacing: 0.24em; color: var(--text-dim); margin: 9px 0 0; text-transform: uppercase; }
.s-complete .signal-word { color: var(--color-green); }
.s-partial .signal-word { color: var(--color-amber); }
.s-blocked .signal-word { color: var(--color-red); }
.s-unresolved .signal-word { color: var(--color-purple); }
.signal-pct { font-size: 24px; font-weight: 700; color: var(--text-primary); line-height: 1; }
.signal-pct i { font-size: 12px; font-style: normal; color: var(--text-dim); margin-left: 1px; }

.burn { display: flex; height: 8px; gap: 2px; margin-top: 16px; background: #000; }
.burn-seg { min-width: 0; transition: flex-grow 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
.b-complete { background: var(--color-green); }
.b-partial { background: var(--color-amber); }
.b-blocked { background: var(--color-red); }
.b-unresolved { background: repeating-linear-gradient(135deg, var(--color-purple) 0 2px, transparent 2px 6px); }

.legend { display: flex; gap: 16px; margin-top: 11px; flex-wrap: wrap; }
.lg { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); }
.lg.off { opacity: 0.32; }
.lg b { color: var(--text-primary); font-weight: 700; }
.lg i { width: 8px; height: 8px; flex-shrink: 0; }
.d-complete { background: var(--color-green); }
.d-partial { background: var(--color-amber); }
.d-blocked { background: var(--color-red); }
.d-unresolved { border: 1px solid var(--color-purple); }

.signal-meta { font-size: 11px; color: var(--text-dim); margin: 11px 0 0; }

.strip { display: flex; flex-direction: column; gap: 2px; margin-top: 12px; padding: 10px 12px; background: var(--bg-panel-3); border-left: 3px solid var(--border-bright); }
.strip-k { font-size: 10px; letter-spacing: 1.6px; color: var(--text-dim); }
.strip-v { font-size: 14px; color: var(--text-primary); }
.strip-s { font-size: 11px; color: var(--text-secondary); }
.strip-clock { border-left-color: var(--color-amber); }
.strip-clock .strip-v { color: var(--color-amber); font-weight: 700; }
.strip-voi { border-left-color: var(--accent-blue); }

/* ---------------- capability bar ---------------- */
.caps { display: flex; flex-direction: column; gap: 1px; margin-top: 14px; border-top: 1px solid var(--border); padding-top: 14px; }
.cap {
  display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer;
  background: var(--bg-panel-3); border: none; border-left: 3px solid var(--border-bright);
  padding: 10px 13px; transition: border-color 0.15s, background 0.15s;
}
.cap:hover { background: var(--bg-panel-2); border-left-color: var(--accent-blue); }
.cap.on { border-left-color: var(--color-red); background: var(--color-red-dim); }
.cap-t { font-size: 12px; letter-spacing: 0.9px; color: var(--text-primary); }
.cap.on .cap-t { color: var(--color-red); }
.cap-s { font-size: 11px; color: var(--text-dim); line-height: 1.4; }

/* ---------------- compact signal row ---------------- */
.sig-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px var(--s5);
  background: none;
  border: 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  text-align: left;
  transition: background .12s;
}
.sig-row:hover { background: rgba(255, 255, 255, 0.04); }

.sig-lamp { width: 3px; height: 20px; border-radius: 2px; flex-shrink: 0; }
.sig-word {
  font: 500 13px/1 var(--font-display);
  letter-spacing: .06em;
  flex-shrink: 0;
}
.s-complete   .sig-word, .sig-row.s-complete   .sig-word { color: var(--color-green); }
.s-partial    .sig-word, .sig-row.s-partial    .sig-word { color: var(--color-amber); }
.s-blocked    .sig-word, .sig-row.s-blocked    .sig-word { color: var(--color-red); }
.s-unresolved .sig-word, .sig-row.s-unresolved .sig-word { color: var(--color-purple); }
.sig-row.s-complete   .sig-lamp { background: var(--color-green); }
.sig-row.s-partial    .sig-lamp { background: var(--color-amber); }
.sig-row.s-blocked    .sig-lamp { background: var(--color-red); }
.sig-row.s-unresolved .sig-lamp { background: none; border: 1.5px dashed var(--color-purple); }

.sig-pct { font-size: 11px; color: var(--text-dim); flex-shrink: 0; }
.sig-bar { display: flex; flex: 1; height: 3px; gap: 1px; min-width: 30px; border-radius: 2px; overflow: hidden; }
.sig-bar i { min-width: 0; transition: flex-grow .5s cubic-bezier(.4,0,.2,1); }
.sig-chev { color: var(--text-dim); font-size: 15px; flex-shrink: 0; }

/* ---------------- right panel ---------------- */
.panel {
  position: absolute; top: 18px; right: 18px; bottom: 18px; width: 440px;
  display: flex; flex-direction: column;
}
/* Docked: the SideDock owns the geometry, so drop the floating position
   entirely. This is why the two surfaces can no longer overlap — only one of
   them is ever absolutely positioned. */
.panel.docked {
  position: static;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}
.detail-lead { flex: 0 0 auto; padding: var(--s4) var(--s5) 0; display: flex; flex-direction: column; gap: var(--s2); }
.tabs { display: flex; border-bottom: 1px solid var(--border-bright); flex-shrink: 0; }
.tab {
  flex: 1; background: var(--bg-panel-3); border: none; border-right: 1px solid var(--border);
  color: var(--text-dim); font-family: var(--font-display); font-size: 11px; letter-spacing: 1.6px;
  padding: 13px 10px; cursor: pointer;
}
.tab:last-child { border-right: none; }
.tab b { color: var(--text-secondary); margin-left: 6px; font-weight: 700; }
.tab.on { background: var(--bg-panel); color: var(--text-primary); box-shadow: inset 0 -2px 0 var(--accent-blue); }
.tab:disabled { opacity: 0.35; cursor: default; }
.scroll { flex: 1; overflow-y: auto; }
.empty { padding: 28px; text-align: center; font-size: 12px; color: var(--text-dim); }

.ev { display: flex; align-items: stretch; gap: var(--s4); width: 100%; padding: 0; cursor: pointer; background: none; border: none; border-bottom: 1px solid var(--border); text-align: left; }
.ev:hover { background: var(--bg-panel-2); }
.ev-edge { width: 2px; flex-shrink: 0; }
.ev-main { flex: 1; min-width: 0; padding: var(--s4) 0; display: flex; flex-direction: column; gap: 5px; }
.ev-pair { font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ev-pair i { color: var(--text-dim); font-style: normal; padding: 0 3px; }
.ev-meta { font-size: 11px; color: var(--text-secondary); }
.ev-sig {
  align-self: center; margin-right: var(--s4); flex-shrink: 0;
  font-size: 9px; font-weight: 600; letter-spacing: 0.14em;
  padding: 0; border: 0; background: none;
  opacity: 0.55;                 /* present, not shouting */
}
.ev:hover .ev-sig, .ev.on .ev-sig { opacity: 1; }
.s-complete { color: var(--color-green); border-color: var(--color-green); }
.s-partial { color: var(--color-amber); border-color: var(--color-amber); }
.s-blocked { color: var(--color-red); border-color: var(--color-red); }
.s-unresolved { color: var(--color-purple); border-color: var(--color-purple); }

/* ---------------- report ---------------- */
.rep-head { padding: 18px 20px 16px; border-bottom: 1px solid var(--border); }
.rep-pair { font-size: 16px; font-weight: 500; color: var(--text-primary); margin: 0; line-height: 1.35; }
.rep-headline { font-size: 12px; color: var(--text-secondary); line-height: 1.6; margin: 9px 0 0; }
.rep-track { height: 5px; background: #000; margin-top: 14px; }
.rep-fill { display: block; height: 100%; transition: width 0.5s ease; }
.rep-counts { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; font-size: 11px; }
.c-ok { color: var(--color-green); } .c-bad { color: var(--color-red); }
.c-unk { color: var(--color-purple); } .c-adv { color: var(--color-amber); } .c-wv { color: var(--text-secondary); }

.block { padding: 16px 20px 0; }
.label { font-size: 10px; letter-spacing: 2.2px; color: var(--text-dim); margin: 18px 20px 9px; }
.act { display: flex; gap: 11px; padding: 11px 13px; margin-bottom: 5px; background: var(--bg-panel-3); border-left: 3px solid; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
.a-blocking { border-left-color: var(--color-red); }
.a-unknown { border-left-color: var(--color-purple); }
.a-advisory { border-left-color: var(--color-amber); }
.act-sev { font-size: 10px; font-weight: 700; letter-spacing: 1px; flex-shrink: 0; padding-top: 1px; }
.a-blocking .act-sev { color: var(--color-red); }
.a-unknown .act-sev { color: var(--color-purple); }
.a-advisory .act-sev { color: var(--color-amber); }

.actions { display: flex; flex-direction: column; gap: 6px; }
.btn {
  background: var(--bg-panel-2); border: 1px solid var(--border-bright); color: var(--text-secondary);
  font-family: var(--font-display); font-size: 11px; font-weight: 500; letter-spacing: 1.5px;
  padding: 13px; cursor: pointer;
}
.btn:hover { border-color: var(--accent-blue); color: var(--text-primary); }
.btn:disabled { opacity: 0.35; cursor: not-allowed; }
.vote { border-color: var(--color-green); color: var(--color-green); }
.vote.gated { border-color: var(--color-red); color: var(--color-red); border-style: dashed; }

.rules { border-top: 1px solid var(--border); }
.rule { border-bottom: 1px solid var(--border); cursor: pointer; }
.rule:hover { background: var(--bg-panel-2); }
.r-row { display: flex; align-items: center; gap: 11px; padding: 11px 20px; }
.r-icon { width: 13px; text-align: center; font-size: 11px; flex-shrink: 0; }
.f-satisfied { color: var(--color-green); } .f-violated { color: var(--color-red); }
.f-unevaluated { color: var(--color-purple); } .f-waived { color: var(--color-amber); } .f-not_applicable { color: var(--text-dim); }
.r-id { font-size: 11px; color: var(--text-secondary); width: 46px; flex-shrink: 0; }
.r-title { flex: 1; font-size: 12px; color: var(--text-primary); }
.st-not_applicable { opacity: 0.4; }
.r-nn { font-size: 9px; font-weight: 700; letter-spacing: 0.8px; color: var(--color-red); border: 1px solid var(--color-red); padding: 2px 5px; flex-shrink: 0; }
.r-actual { font-size: 10.5px; color: var(--text-secondary); max-width: 130px; text-align: right; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.r-detail { padding: 15px 20px 17px; background: var(--bg-panel-3); cursor: default; border-top: 1px solid var(--border); }
.kv { display: flex; gap: 12px; font-size: 12px; color: var(--text-primary); margin-bottom: 6px; }
.k { font-size: 10px; letter-spacing: 1.4px; color: var(--text-dim); width: 54px; flex-shrink: 0; padding-top: 2px; }
.d-line { font-size: 12px; color: var(--text-secondary); line-height: 1.65; margin: 10px 0 0; }
.d-line.strong { color: var(--text-primary); }
.d-line.auth { font-size: 11px; color: var(--accent-blue); }
.d-line.why { font-style: italic; color: var(--text-dim); }

.note { margin-top: 12px; padding: 11px 13px; font-size: 12px; line-height: 1.55; border-left: 3px solid; }
.note.amber { border-left-color: var(--color-amber); background: var(--color-amber-dim); color: var(--color-amber); }
.note.red { border-left-color: var(--color-red); background: var(--color-red-dim); color: var(--color-red); }
.note.slate { border-left-color: var(--color-purple); background: var(--color-purple-dim); color: var(--text-secondary); }

.waive { display: flex; gap: 6px; margin-top: 13px; }
.in { background: var(--bg-panel-2); border: 1px solid var(--border-bright); color: var(--text-primary); font-family: var(--font-mono); font-size: 12px; padding: 9px 10px; width: 96px; }
.in.wide { flex: 1; width: auto; }
.in:focus { outline: none; border-color: var(--accent-blue); }
.in-go { background: transparent; border: 1px solid var(--color-amber); color: var(--color-amber); font-size: 11px; font-weight: 700; letter-spacing: 1px; padding: 9px 14px; cursor: pointer; }
.in-go:disabled { opacity: 0.3; cursor: not-allowed; }

.mono { font-family: var(--font-mono); }
.scroll::-webkit-scrollbar { width: 8px; }
.scroll::-webkit-scrollbar-track { background: var(--bg-panel-3); }
.scroll::-webkit-scrollbar-thumb { background: var(--border-bright); }

@media (max-width: 1400px) { .panel { width: 390px; } .signal { width: 340px; } }
@media (max-width: 1100px) { .panel { width: 340px; } }
</style>

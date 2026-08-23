<!--
  SideDock — a single left sidebar. The planet gets everything else.
  ============================================================================
  Three surfaces became one:

    [ 56px rail ][ 360px panel ][ ————————— the Earth ————————— ]

  * ONE side. Panels used to bracket the globe left and right, squeezing it
    into a letterbox. Everything now lives on the left and the planet owns the
    remaining width edge to edge.
  * ALWAYS-ON HEADER. The completion signal sits above the tabs and never
    moves — it is the answer the product exists to give, so it is never behind
    a click and never scrolls away.
  * COLLAPSIBLE. The panel closes to a 56px rail, so the globe can go
    full-bleed for a demo. Collapsed, the rail still carries the state colour.
  * ONE PANEL AT A TIME. They cannot overlap because only one exists.
  ============================================================================
-->
<template>
  <aside class="dock" :class="{ collapsed: !active }">
    <nav class="rail">
      <div class="rail-mark" :title="signal || ''">
        <span class="rail-dot" :class="(signal || '').toLowerCase()"></span>
      </div>

      <button
        v-for="t in tabs"
        :key="t.key"
        class="rail-btn"
        :class="{ on: active === t.key, flagged: t.flag }"
        :title="t.label"
        @click="toggle(t.key)"
      >
        <svg class="glyph" width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            v-for="(d, i) in (ICONS[t.icon] || [])" :key="i"
            :d="d" stroke="currentColor" stroke-width="1.3"
            stroke-linecap="round" stroke-linejoin="round"
          />
        </svg>
        <span class="cap">{{ t.cap || shortCap(t) }}</span>
        <span v-if="t.badge" class="badge">{{ t.badge }}</span>
        <span class="tip">{{ t.label }}</span>
      </button>

      <div class="rail-spacer"></div>

      <button class="rail-btn muted" :title="active ? 'Collapse panel' : 'Expand panel'" @click="toggle(active || tabs[0].key)">
        <svg class="glyph" width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path :d="active ? 'M9.5 4.5 6 8l3.5 3.5' : 'M6.5 4.5 10 8l-3.5 3.5'"
            stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </nav>

    <section v-if="active" class="panel">
      <div class="panel-header"><slot name="header"></slot></div>

      <header class="panel-head">
        <span class="panel-title">{{ current.label }}</span>
        <span v-if="current.sub" class="panel-sub">{{ current.sub }}</span>
        <button class="panel-x" title="Close" @click="active = null">×</button>
      </header>

      <div class="panel-body"><slot :name="active"></slot></div>
    </section>
  </aside>
</template>

<script setup>
import { ref, computed } from 'vue'
const props = defineProps({
  tabs: { type: Array, required: true },
  initial: { type: String, default: null },
  signal: { type: String, default: '' },
})
/**
 * The rail's icons, drawn rather than typed.
 *
 * Each entry is a list of path `d` strings on a 16×16 grid, stroked at
 * 1.3 with round joins — one weight for the whole rail, so the icons read
 * as a set instead of as seven different fonts' idea of a symbol.
 */
const ICONS = {
  // completion gauge — the constraint signal
  gauge: ['M2.4 12a5.6 5.6 0 1 1 11.2 0', 'M8 12 10.6 8.2'],
  // close-approach warning
  alert: ['M8 1.7 14.3 8 8 14.3 1.7 8Z', 'M8 5.5v3.2', 'M8 11v.4'],
  // the flight-rules gate
  shield: ['M8 1.9 13.1 4.1v4.1c0 3-2.1 4.9-5.1 5.9-3-1-5.1-2.9-5.1-5.9V4.1Z'],
  // the node fleet
  hex: ['M8 1.8 13.4 5v6L8 14.2 2.6 11V5Z'],
  // mission feed
  feed: ['M2.6 4.6h10.8', 'M2.6 8h10.8', 'M2.6 11.4h6.8'],
  // launch
  launch: ['M8 13.4V2.9', 'M4.2 6.7 8 2.9l3.8 3.8'],
  // the decision chain — numbered steps read top to bottom
  chain: ['M3.2 4.3h9.6', 'M3.2 8h9.6', 'M3.2 11.7h9.6', 'M6 2.6v10.8'],
  // history
  clock: ['M8 2.3a5.7 5.7 0 1 1 0 11.4 5.7 5.7 0 0 1 0-11.4Z', 'M8 5.1v3.2l2.3 1.4'],
}

/** First word of the label — enough to know what a tab is without hovering. */
function shortCap(t) {
  return (t.label || '').split(/[\s&]+/)[0].slice(0, 7)
}

const active = ref(props.initial)
const current = computed(() => props.tabs.find((t) => t.key === active.value) || {})
const emit = defineEmits(['change'])
function toggle(k) {
  const next = active.value === k ? null : k
  const prev = active.value
  active.value = next
  // A tab can paint on the globe (the story draws a corridor and the whole
  // land-cover layer). Leaving it must undo that, or the globe stays stuck on
  // the last tab's scene while a different panel is open.
  emit('change', { from: prev, to: next })
}
defineExpose({
  open: (k) => { const p = active.value; active.value = k; emit('change', { from: p, to: k }) },
  close: () => { const p = active.value; active.value = null; emit('change', { from: p, to: null }) },
})
</script>

<style scoped>
.dock {
  display: flex;
  flex: 0 0 auto;
  height: 100%;
  min-height: 0;
  z-index: var(--z-dock);
}

/* ---------------- rail ---------------- */
.rail {
  width: 64px;
  flex: 0 0 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--s3) 0 var(--s3);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border-right: 1px solid var(--border);
}
.rail-spacer { flex: 1; }

/* the state lamp — visible even when everything is collapsed */
.rail-mark { display: grid; place-items: center; height: 34px; margin-bottom: var(--s3); }
.rail-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-dim); }
/* Straight off :root, so the lamp is the SAME green as every other
   COMPLETE in the product. It used to be #4ade80 against the palette's
   #4cc76a — close enough to look like a rendering bug, far enough to
   read as a different state. */
.rail-dot.complete   { background: var(--color-green); }
.rail-dot.partial    { background: var(--color-amber); }
/* Only BLOCKED breathes. Motion that stops when the problem does. */
.rail-dot.blocked    { background: var(--color-red); animation: lamp-breathe 2.4s ease-out infinite; }
.rail-dot.unresolved { background: none; border: 1.5px dashed var(--color-purple); }

.rail-btn {
  position: relative;
  width: 56px; height: 46px;
  border: 0; border-radius: var(--r1);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  transition: color var(--dur-1), background var(--dur-1);
}
.rail-btn:hover { color: var(--text-primary); background: var(--hover-wash); }
.rail-btn.on { color: var(--text-primary); background: var(--active-wash); }
/* -8px lands the marker exactly on the rail's left edge (56px rail,
   40px button, 8px either side). Centred vertically rather than pinned
   to a top offset, so it stays aligned if the button size changes. */
.cap {
  display: block;
  margin-top: 2px;
  font: 500 7px/1 var(--font-mono);
  letter-spacing: .08em;
  text-transform: uppercase;
  color: inherit;
  opacity: .8;
}
.rail-btn.on::before {
  content: ''; position: absolute; left: -8px; top: 50%;
  transform: translateY(-50%);
  width: 2px; height: 20px; border-radius: 1px; background: var(--accent-blue);
}
.rail-btn.flagged { color: var(--color-amber); }
.rail-btn.flagged:hover { color: var(--color-amber); }
.rail-btn.muted { color: var(--text-dim); opacity: .6; }
.glyph { display: block; }

.badge {
  position: absolute; top: 3px; right: 3px;
  min-width: 15px; height: 15px; padding: 0 3px;
  border-radius: 8px; background: var(--color-red); color: #0b0b0c;
  font: 600 9px/15px var(--font-mono); text-align: center;
}

/* hover label, so a 56px rail is still readable */
.tip {
  position: absolute; left: 48px; top: 50%;
  transform: translateY(-50%) translateX(-4px);
  padding: 5px 9px; border-radius: var(--r1);
  background: var(--glass-strong);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font: 500 10px/1 var(--font-display);
  letter-spacing: .1em; text-transform: uppercase;
  white-space: nowrap; opacity: 0; pointer-events: none;
  transition: opacity .12s, transform .12s;
  z-index: 5;
}
.rail-btn:hover .tip { opacity: 1; transform: translateY(-50%) translateX(0); }

/* ---------------- panel ---------------- */
.panel {
  /* 360px was too narrow for the Risk Monitor's rows; 384 buys the
     satellite names enough room to stop ellipsing to two characters. */
  width: 384px;
  flex: 0 0 384px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--glass);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border-right: 1px solid var(--border);
  box-shadow: var(--e2);
  animation: reveal var(--dur-2) var(--ease);
}
@keyframes reveal { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }

.panel-header { flex: 0 0 auto; }

.panel-head {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: var(--s3);
  min-height: 42px;
  padding: var(--s3) var(--s3) var(--s3) var(--s5);
  border-bottom: 1px solid var(--border);
}
.panel-title {
  font: 500 var(--t-label)/1 var(--font-display);
  letter-spacing: .22em; text-transform: uppercase;
  color: var(--text-secondary);
  white-space: nowrap;
}
.panel-sub {
  font: 400 var(--t-label)/1 var(--font-mono);
  color: var(--text-dim); margin-left: auto;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.panel-x {
  flex: none;
  width: 26px; height: 26px;
  display: grid; place-items: center;
  border: 0; border-radius: var(--r1); background: none; color: var(--text-dim);
  font-size: 17px; line-height: 1; cursor: pointer; padding: 0;
}
.panel-x:hover { color: var(--text-primary); background: var(--hover-wash); }

.panel-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }

@media (max-width: 1280px) {
  .panel { width: 340px; flex-basis: 340px; }
}
@media (max-width: 1100px) {
  .panel { width: 300px; flex-basis: 300px; }
}
</style>

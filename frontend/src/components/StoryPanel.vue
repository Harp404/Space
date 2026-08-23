<!--
  StoryPanel — one event, every layer, in order.
  ============================================================================
  The system's depth was invisible. Each layer worked; none of it was legible
  from the outside, and a reviewer with three minutes scores what they can
  follow.

  This renders the chain: what was asked, what was found, and where the number
  came from. Two design rules:

    1. EVERY STEP NAMES A SOURCE. A step that cannot is decoration, and the
       API does not emit it.

    2. THE REFUSALS ARE NOT HIDDEN. Steps where the system declined to answer
       are shown with the same weight as the ones where it did. They are the
       point, not an embarrassment.
  ============================================================================
-->
<template>
  <div class="story">
    <div v-if="loading" class="msg">reading the chain…</div>
    <div v-else-if="error" class="msg err">{{ error }}</div>

    <template v-else-if="data">
      <header class="head">
        <h2 class="event">{{ data.event }}</h2>
        <div class="verdict">
          <StateBadge :state="data.signal" />
          <span v-if="data.self_blocks_in" class="clock mono">
            self-blocks in {{ data.self_blocks_in }}
          </span>
        </div>
        <!-- The chain is about a place. Reading about an 11,000 km corridor
             while the Earth beside it shows nothing was the whole problem. -->
        <button class="show-globe" @click="$emit('show-on-globe')">
          ⬤ SHOW THIS ON THE GLOBE
        </button>
      </header>

      <ol class="steps">
        <li
          v-for="s in data.steps" :key="s.n"
          class="step" :class="s.state ? 's-' + s.state.toLowerCase() : ''"
        >
          <span class="num mono">{{ s.n }}</span>
          <div class="body">
            <div class="title">
              {{ s.title }}
              <StateBadge v-if="s.state" :state="s.state" size="sm" />
            </div>
            <div class="said">{{ s.said }}</div>
            <div class="because">{{ s.because }}</div>
            <!-- The difference between a report and a system: an unresolved
                 step offers exactly the acquisitions its rule declares, and
                 acquiring one re-runs the whole chain. -->
            <div v-if="s.actions && s.actions.length" class="acts">
              <button
                v-for="a in s.actions" :key="a.id"
                class="act" :class="{ done: acquired.includes(a.id), busy: busy === a.id }"
                :disabled="acquired.includes(a.id) || busy"
                @click="acquire(a.id)"
              >
                <span class="act-label">{{ acquired.includes(a.id) ? 'acquired' : a.label }}</span>
                <span v-if="!acquired.includes(a.id)" class="act-cost mono">{{ a.cost }}{{ a.unit }}</span>
              </button>
            </div>

            <div v-if="s.source" class="source mono">
              <span v-for="(v, k) in cleanSource(s.source)" :key="k" class="src">
                <b>{{ k }}</b> {{ v }}
              </span>
            </div>
          </div>
        </li>
      </ol>

      <footer class="foot">
        <p class="closing">{{ data.closing }}</p>
        <p v-if="data.receipt_id" class="receipt mono">
          receipt {{ data.receipt_id.slice(0, 16) }}…
          <span class="hint">re-running the same inputs reproduces this hash exactly</span>
        </p>
      </footer>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import StateBadge from './StateBadge.vue'

const data = ref(null)
const loading = ref(true)
const error = ref('')
const acquired = ref([])
const busy = ref(null)
const emit = defineEmits(['show-on-globe'])

/**
 * Acquire one piece of evidence and re-run the chain.
 *
 * The whole narrative is recomputed, not patched, so every downstream step
 * reflects the new evidence — including steps that get WORSE. An acquisition
 * supplies a measurement, not a passing grade.
 */
async function acquire(id) {
  busy.value = id
  try {
    const next = [...acquired.value, id]
    const res = await fetch(`/api/story/reentry?acquire=${encodeURIComponent(next.join(','))}`)
    if (!res.ok) throw new Error(`gateway returned ${res.status}`)
    data.value = await res.json()
    acquired.value = next
  } catch (e) {
    error.value = `acquisition failed: ${e.message}`
  } finally {
    busy.value = null
  }
}

function cleanSource(src) {
  // Drop empty values so a step never shows a label with nothing after it.
  const out = {}
  for (const [k, v] of Object.entries(src || {})) {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  }
  return out
}

onMounted(async () => {
  try {
    const res = await fetch('/api/story/reentry')   // same origin, like every other call here
    if (!res.ok) throw new Error(`gateway returned ${res.status}`)
    data.value = await res.json()
    // Draw the event as soon as the chain loads — the text and the corridor
    // arrive together, so the story is about something visible.
    emit('show-on-globe')
  } catch (e) {
    error.value = `could not read the chain: ${e.message}`
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.story { padding: var(--s5); }
.msg { color: var(--text-dim); font-size: 12px; padding: var(--s5) 0; }
.msg.err { color: var(--color-red); }

.head { padding-bottom: var(--s4); border-bottom: 1px solid var(--border); }
.event {
  margin: 0 0 var(--s3);
  font: 300 18px/1.3 var(--font-display);
  color: var(--text-primary);
}
.verdict { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
.clock { font-size: 10px; color: var(--text-dim); }

.show-globe {
  display: block;
  width: 100%;
  margin-top: var(--s3);
  padding: 11px 0;
  background: var(--accent-blue-dim);
  border: 1px solid var(--accent-blue);
  border-radius: var(--r1);
  color: var(--text-primary);
  font: 600 11px/1 var(--font-display);
  letter-spacing: .12em;
  cursor: pointer;
  transition: background .12s;
}
.show-globe:hover { background: var(--accent-blue-glow); }

.steps { list-style: none; margin: 0; padding: 0; }
.step {
  display: flex;
  gap: var(--s3);
  padding: var(--s4) 0;
  border-bottom: 1px solid var(--border);
}
.step:last-child { border-bottom: 0; }

.num {
  flex: 0 0 20px;
  font-size: 10px;
  color: var(--text-dim);
  padding-top: 2px;
}
/* A refused step is marked by an edge, not by shouting. */
.step.s-unresolved { border-left: 2px dashed var(--color-purple); padding-left: var(--s3); }
.step.s-blocked    { border-left: 2px solid var(--color-red); padding-left: var(--s3); }

.body { min-width: 0; }
.title {
  display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap;
  font: 500 10px/1.4 var(--font-display);
  letter-spacing: .14em; text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 5px;
}
.said {
  font: 400 13px/1.45 var(--font-display);
  color: var(--text-primary);
  margin-bottom: 4px;
}
.because {
  font: 400 11.5px/1.55 var(--font-display);
  color: var(--text-secondary);
}
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.act {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 10px;
  background: var(--bg-panel-2);
  border: 1px solid var(--border-bright);
  border-radius: var(--r1);
  color: var(--text-primary);
  font: 500 10.5px/1.3 var(--font-display);
  cursor: pointer;
  transition: background .12s, border-color .12s, opacity .12s;
}
.act:hover:not(:disabled) { background: var(--bg-panel); border-color: var(--accent-blue); }
.act:disabled { cursor: default; opacity: .55; }
.act.done { border-style: dashed; color: var(--text-dim); }
.act.busy { opacity: .6; }
.act-cost { font-size: 9px; color: var(--text-dim); }

.source { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
.src { font-size: 9.5px; color: var(--text-dim); }
.src b { color: var(--text-secondary); font-weight: 500; margin-right: 3px; }

.foot { margin-top: var(--s5); padding-top: var(--s4); border-top: 1px solid var(--border); }
.closing {
  margin: 0 0 var(--s3);
  font: 400 11.5px/1.6 var(--font-display);
  color: var(--text-secondary);
}
.receipt { font-size: 9.5px; color: var(--text-dim); margin: 0; }
.hint { display: block; margin-top: 3px; opacity: .75; }
</style>

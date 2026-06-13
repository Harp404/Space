<template>
  <div class="hp">
    <div class="hp-tabs">
      <button :class="{ active: cat === 'reroute' }" @click="cat = 'reroute'">↻ REROUTES <span>{{ counts.reroute }}</span></button>
      <button :class="{ active: cat === 'launch' }" @click="cat = 'launch'">🚀 LAUNCHES <span>{{ counts.launch }}</span></button>
    </div>

    <div class="hp-list">
      <div v-if="!filtered.length" class="hp-empty">No {{ cat === 'reroute' ? 'reroute' : 'launch' }} history yet.<br />{{ cat === 'reroute' ? 'Plan a reroute' : 'Plan a launch' }} and it'll be saved here.</div>
      <div v-for="e in filtered" :key="e.id" class="hp-item" @click="$emit('open', e)">
        <div class="hp-main">
          <input
            v-if="editId === e.id"
            ref="renameInput"
            v-model="editName"
            class="hp-rename"
            @click.stop
            @keyup.enter="commit(e)"
            @blur="commit(e)"
          />
          <div v-else class="hp-name">{{ e.name }}</div>
          <div class="hp-sum">{{ e.summary }}</div>
          <div class="hp-time">{{ fmt(e.time) }}</div>
        </div>
        <div class="hp-acts">
          <button title="Rename" @click.stop="startRename(e)">✎</button>
          <button title="Delete" @click.stop="$emit('delete', e.id)">🗑</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
const props = defineProps({ entries: { type: Array, default: () => [] } })
const emit = defineEmits(['open', 'delete', 'rename'])

const cat = ref('reroute')
const filtered = computed(() => props.entries.filter((e) => e.type === cat.value))
const counts = computed(() => ({
  reroute: props.entries.filter((e) => e.type === 'reroute').length,
  launch: props.entries.filter((e) => e.type === 'launch').length,
}))

const editId = ref(null)
const editName = ref('')
function startRename(e) { editId.value = e.id; editName.value = e.name; nextTick(() => { const el = document.querySelector('.hp-rename'); if (el) el.focus() }) }
function commit(e) {
  if (editId.value !== e.id) return
  const name = editName.value.trim()
  if (name) emit('rename', { id: e.id, name })
  editId.value = null
}
function fmt(t) { try { return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
</script>

<style scoped>
.hp { display: flex; flex-direction: column; height: 100%; font: 12px/1.4 ui-monospace, monospace; }
.hp-tabs { display: flex; gap: 6px; padding: 10px; flex-shrink: 0; }
.hp-tabs button { flex: 1; padding: 8px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 6px; color: var(--text-dim); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; cursor: pointer; transition: all 0.15s; }
.hp-tabs button.active { background: rgba(168,85,247,0.16); border-color: #a855f7; color: #d8b4fe; }
.hp-tabs button span { opacity: 0.6; margin-left: 3px; }
.hp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 10px; display: flex; flex-direction: column; gap: 7px; }
.hp-empty { color: var(--text-dim); font-size: 11px; line-height: 1.6; padding: 16px 6px; text-align: center; }
.hp-item { display: flex; align-items: flex-start; gap: 6px; padding: 9px 10px; background: rgba(255,255,255,0.025); border: 1px solid var(--border); border-radius: 7px; cursor: pointer; transition: all 0.15s; }
.hp-item:hover { background: rgba(168,85,247,0.08); border-color: rgba(168,85,247,0.4); }
.hp-main { flex: 1; min-width: 0; }
.hp-name { font-size: 12px; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hp-rename { width: 100%; background: var(--bg-panel-3); border: 1px solid #a855f7; border-radius: 4px; padding: 3px 5px; color: var(--text-primary); font: 700 12px ui-monospace, monospace; outline: none; }
.hp-sum { font-size: 10px; color: var(--text-secondary); margin-top: 2px; }
.hp-time { font-size: 9px; color: var(--text-dim); margin-top: 3px; }
.hp-acts { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
.hp-acts button { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 12px; padding: 1px 3px; border-radius: 3px; }
.hp-acts button:hover { color: #fff; background: rgba(255,255,255,0.08); }
</style>

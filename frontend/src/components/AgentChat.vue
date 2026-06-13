<template>
  <teleport to="body">
    <!-- Edge trigger tab — the only thing visible when closed -->
    <button v-show="!open" class="ai-tab" @click="open = true" title="Ask Mission Control AI">
      <span class="ai-tab-label">ASK&nbsp;AI</span>
    </button>

    <!-- Backdrop -->
    <!-- Slide-out drawer (non-modal: no backdrop, globe stays interactive) -->
    <transition name="slide">
      <aside v-if="open" class="ai-drawer">
        <header class="ai-head">
          <div class="ai-title">
            <span class="ai-dot"></span>
            MISSION CONTROL AI
            <span class="ai-model">gpt-oss-120b</span>
          </div>
          <button class="ai-close" @click="open = false" title="Close">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </header>

        <div ref="chatLog" class="ai-log">
          <div v-if="chat.length === 0" class="ai-welcome">
            <div class="ai-welcome-title">Autonomous Space Traffic Coordinator</div>
            <p>Reasoning live over ~31,000 tracked objects, real conjunctions &amp; US Space Force CDMs.</p>
            <div class="ai-suggests">
              <button v-for="s in suggestions" :key="s" class="ai-chip" @click="quick(s)">{{ s }}</button>
            </div>
          </div>
          <div v-for="(m, i) in chat" :key="i" class="ai-msg" :class="'msg-' + m.role">
            <span class="ai-who">{{ m.role === 'user' ? 'YOU' : 'AI' }}</span>
            <div class="ai-text" v-html="render(m.content)"></div>
          </div>
          <div v-if="sending" class="ai-msg msg-assistant">
            <span class="ai-who">AI</span>
            <div class="ai-text typing"><span></span><span></span><span></span></div>
          </div>
        </div>

        <form class="ai-input-row" @submit.prevent="send">
          <input v-model="draft" class="ai-input" type="text" placeholder="Ask anything about the orbital picture…" :disabled="sending" />
          <button class="ai-send" type="submit" :disabled="sending || !draft.trim()">
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M1 6h9M6.5 2.5L10 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </form>
      </aside>
    </transition>
  </teleport>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { marked } from 'marked'
marked.setOptions({ breaks: true })

const emit = defineEmits(['action'])
const open = ref(false)
const chat = ref([])

// Pull <<SHOW|a|b>> / <<REROUTE>> / <<LAUNCH|lat|lon|alt|inc>> directives out of the
// reply, dispatch them to the globe, and strip them from the visible text.
function extractActions(text) {
  const re = /<<\s*(SHOW|REROUTE|LAUNCH|TRACK|ZOOM)\s*((?:\|[^>]*)*)>>/gi
  let m
  while ((m = re.exec(text)) !== null) {
    const type = m[1].toUpperCase()
    const args = m[2].split('|').map((s) => s.trim()).filter(Boolean)
    emit('action', { type, args })
  }
  return text.replace(re, '').trim()
}
const draft = ref('')
const sending = ref(false)
const chatLog = ref(null)

const suggestions = [
  'Highest-risk conjunction right now?',
  'Plan avoidance for the top threat',
  'Anything threatening the ISS?',
  'Explain the riskiest CDM',
]

function quick(s) { draft.value = s; send() }

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  chat.value.push({ role: 'user', content: text })
  draft.value = ''
  sending.value = true
  scrollDown()
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chat.value.slice(-8) }),
    })
    const data = await res.json()
    let reply = data.reply || data.error || '(no response)'
    reply = extractActions(reply)   // pull out <<...>> directives, dispatch, strip from text
    chat.value.push({ role: 'assistant', content: reply })
  } catch (e) {
    chat.value.push({ role: 'assistant', content: 'Connection error: ' + e.message })
  }
  sending.value = false
  scrollDown()
}

function scrollDown() {
  nextTick(() => { if (chatLog.value) chatLog.value.scrollTop = chatLog.value.scrollHeight })
}

function render(t) { return marked.parse(String(t || '')) }
</script>

<style scoped>
/* Edge tab */
.ai-tab {
  position: fixed;
  right: 0;
  top: 542px;
  z-index: 1400;
  width: 40px;
  height: 132px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: linear-gradient(180deg, rgba(34, 211, 238, 0.18), rgba(34, 211, 238, 0.07));
  border: 1px solid rgba(34, 211, 238, 0.45);
  border-right: none;
  border-radius: 8px 0 0 8px;
  color: #22d3ee;
  cursor: pointer;
  box-shadow: 0 0 18px rgba(34, 211, 238, 0.22), -2px 0 12px rgba(0,0,0,0.4);
  transition: all 0.18s;
  animation: tab-glow 2.4s ease-in-out infinite;
}
.ai-tab:hover { background: rgba(34, 211, 238, 0.28); width: 46px; }
.ai-tab-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
}
@keyframes tab-glow {
  0%, 100% { box-shadow: 0 0 16px rgba(34,211,238,0.2), -2px 0 12px rgba(0,0,0,0.4); }
  50% { box-shadow: 0 0 28px rgba(34,211,238,0.45), -2px 0 12px rgba(0,0,0,0.4); }
}

.ai-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1450;
  background: rgba(2, 6, 16, 0.45);
  backdrop-filter: blur(1.5px);
}

/* Drawer */
.ai-drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: 420px;
  max-width: 92vw;
  z-index: 1500;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #0a1018 0%, #070b12 100%);
  border-left: 1px solid rgba(34, 211, 238, 0.35);
  box-shadow: -10px 0 40px rgba(0, 0, 0, 0.6);
}

.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ai-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-primary);
}
.ai-dot { width: 7px; height: 7px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 8px #22d3ee; animation: blink-dot 1.6s infinite; }
.ai-model {
  font-size: 8px; color: #22d3ee; background: rgba(34,211,238,0.1);
  border: 1px solid rgba(34,211,238,0.3); border-radius: 3px; padding: 2px 5px; letter-spacing: 0.04em;
}
.ai-close {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 5px; color: var(--text-dim);
  border: 1px solid var(--border); transition: all 0.15s;
}
.ai-close:hover { color: var(--text-primary); border-color: var(--border-bright); background: rgba(255,255,255,0.04); }

.ai-log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ai-welcome { color: var(--text-dim); }
.ai-welcome-title { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #22d3ee; letter-spacing: 0.08em; margin-bottom: 6px; }
.ai-welcome p { font-size: 12px; line-height: 1.6; margin-bottom: 14px; }
.ai-suggests { display: flex; flex-direction: column; gap: 7px; }
.ai-chip {
  text-align: left;
  font-size: 11.5px;
  color: var(--text-secondary);
  background: rgba(34, 211, 238, 0.06);
  border: 1px solid rgba(34, 211, 238, 0.22);
  border-radius: 7px;
  padding: 9px 11px;
  transition: all 0.15s;
}
.ai-chip:hover { background: rgba(34, 211, 238, 0.15); border-color: rgba(34, 211, 238, 0.5); color: var(--text-primary); }

.ai-msg { display: flex; gap: 9px; align-items: flex-start; }
.ai-who {
  font-family: var(--font-mono); font-size: 8px; font-weight: 700; letter-spacing: 0.06em;
  padding: 3px 5px; border-radius: 3px; flex-shrink: 0; margin-top: 2px;
}
.msg-user .ai-who { color: var(--accent-blue); background: var(--accent-blue-dim); }
.msg-assistant .ai-who { color: #22d3ee; background: rgba(34, 211, 238, 0.12); }
.ai-text { font-size: 13px; line-height: 1.6; color: var(--text-secondary); word-break: break-word; }
.msg-user .ai-text { color: var(--text-primary); }
.ai-text :deep(b), .ai-text :deep(strong) { color: var(--text-primary); font-weight: 700; }
.ai-text :deep(code) { font-family: var(--font-mono); font-size: 11px; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; color: #22d3ee; }
.ai-text :deep(p) { margin: 0 0 6px; }
.ai-text :deep(ul), .ai-text :deep(ol) { margin: 4px 0; padding-left: 18px; }
.ai-text :deep(li) { margin: 2px 0; }
.ai-text :deep(h1), .ai-text :deep(h2), .ai-text :deep(h3) { font-size: 12px; color: #22d3ee; margin: 8px 0 4px; letter-spacing: 0.03em; }
.ai-text :deep(table) { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 10.5px; }
.ai-text :deep(th), .ai-text :deep(td) { border: 1px solid var(--border); padding: 4px 7px; text-align: left; }
.ai-text :deep(th) { background: rgba(34,211,238,0.12); color: #22d3ee; font-weight: 700; }
.ai-text :deep(tr:nth-child(even) td) { background: rgba(255,255,255,0.02); }
.ai-text :deep(a) { color: #60a5fa; }

.typing { display: flex; gap: 4px; padding: 5px 0; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: #22d3ee; opacity: 0.5; animation: typing-bounce 1s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: 0.15s; }
.typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes typing-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-5px); opacity: 1; } }

.ai-input-row { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); flex-shrink: 0; }
.ai-input {
  flex: 1; background: var(--bg-panel-3); border: 1px solid var(--border); border-radius: 7px;
  padding: 11px 13px; font-size: 13px; color: var(--text-primary); font-family: inherit; outline: none; transition: border-color 0.15s;
}
.ai-input:focus { border-color: #22d3ee; }
.ai-input::placeholder { color: var(--text-dim); }
.ai-send {
  display: flex; align-items: center; justify-content: center; width: 42px;
  background: rgba(34, 211, 238, 0.14); border: 1px solid rgba(34, 211, 238, 0.4); border-radius: 7px; color: #22d3ee; transition: all 0.15s;
}
.ai-send:hover:not(:disabled) { background: rgba(34, 211, 238, 0.28); box-shadow: 0 0 10px rgba(34, 211, 238, 0.35); }
.ai-send:disabled { opacity: 0.35; cursor: not-allowed; }

/* Transitions */
.slide-enter-active, .slide-leave-active { transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

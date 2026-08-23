<template>
  <teleport to="body">
    <!-- Edge tab — the only thing visible when closed -->
    <button
      v-show="!open"
      class="sd-tab"
      :class="`sd-tab-${side}`"
      :style="side === 'bottom' ? { '--accent': accent } : { top: top + 'px', '--accent': accent }"
      @click="open = true"
    >
      <span class="sd-tab-label">{{ label }}</span>
    </button>

    <transition name="sd-fade">
      <div v-if="open" class="sd-backdrop" @click="open = false"></div>
    </transition>

    <transition :name="side === 'bottom' ? 'sd-up' : side === 'left' ? 'sd-slide-left' : 'sd-slide'">
      <aside
        v-if="open"
        class="sd-drawer"
        :class="`sd-drawer-${side}`"
        :style="side === 'bottom' ? { height: height + 'px', '--accent': accent } : { width: width + 'px', '--accent': accent }"
      >
        <div class="sd-grip">
          <span class="sd-grip-label">{{ label }}</span>
          <button class="sd-close" @click="open = false" title="Close">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="sd-body">
          <slot />
        </div>
      </aside>
    </transition>
  </teleport>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  label: { type: String, required: true },
  side: { type: String, default: 'right' },     // 'right' | 'bottom'
  top: { type: Number, default: 120 },
  width: { type: Number, default: 420 },
  height: { type: Number, default: 240 },
  accent: { type: String, default: 'var(--accent-blue)' },
})

const open = ref(false)
</script>

<style scoped>
.sd-tab {
  /* Was a glowing gradient pill with vertical rotated text — five of them
     stacked down the right edge read as clutter, not navigation. Now a flat
     tab that states what it opens. */
  position: fixed;
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border-bright);
  border-right: none;
  color: var(--text-secondary);
  cursor: pointer;
  box-shadow: -6px 0 20px rgba(0, 0, 0, 0.55);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.sd-tab:hover {
  background: var(--bg-panel-2);
  color: var(--text-primary);
  border-color: var(--accent);
}
/* the accent shows as a single edge stripe, not a glow around everything */
.sd-tab::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 2px;
  background: var(--accent);
}
.sd-tab-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

/* Right-edge tab */
.sd-tab-right {
  right: 0;
  width: 40px;
  height: 132px;
  border-right: none;
  border-radius: 8px 0 0 8px;
}
.sd-tab-right .sd-tab-label { writing-mode: vertical-rl; text-orientation: mixed; font-size: 11px; letter-spacing: 1.6px; padding: 14px 0; }
.sd-tab-right:hover { width: 46px; background: color-mix(in srgb, var(--accent) 28%, transparent); }

/* Left-edge tab */
.sd-tab-left {
  left: 0;
  width: 40px;
  height: 132px;
  border-left: none;
  border-radius: 0 8px 8px 0;
  box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 22%, transparent), 2px 0 12px rgba(0,0,0,0.4);
}
.sd-tab-left .sd-tab-label { writing-mode: vertical-rl; text-orientation: mixed; transform: rotate(180deg); }
.sd-tab-left:hover { width: 46px; background: color-mix(in srgb, var(--accent) 28%, transparent); }

/* Bottom-edge tab — pinned to the bottom-right corner */
.sd-tab-bottom {
  bottom: 0;
  right: 0;
  height: 30px;
  padding: 0 22px;
  border-right: none;
  border-bottom: none;
  border-radius: 8px 0 0 0;
}
.sd-tab-bottom:hover { height: 36px; background: color-mix(in srgb, var(--accent) 28%, transparent); }

.sd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1450;
  background: rgba(8, 9, 11, 0.45);
  backdrop-filter: blur(1.5px);
}

.sd-drawer {
  position: fixed;
  z-index: 1500;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--bg-deep) 0%, #070b12 100%);
  box-shadow: -10px 0 40px rgba(0, 0, 0, 0.6);
}
.sd-drawer-right {
  top: 0;
  right: 0;
  height: 100vh;
  max-width: 94vw;
  border-left: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}
.sd-drawer-bottom {
  bottom: 0;
  left: 0;
  width: 100vw;
  border-top: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.6);
}
.sd-drawer-left {
  top: 0;
  left: 0;
  height: 100vh;
  max-width: 94vw;
  border-right: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  box-shadow: 10px 0 40px rgba(0, 0, 0, 0.6);
}

.sd-grip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.sd-grip-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--accent);
}
.sd-close {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 5px; color: var(--text-dim);
  border: 1px solid var(--border); transition: all 0.15s;
}
.sd-close:hover { color: var(--text-primary); border-color: var(--border-bright); background: rgba(255,255,255,0.04); }

.sd-body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }

.sd-slide-enter-active, .sd-slide-leave-active { transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
.sd-slide-enter-from, .sd-slide-leave-to { transform: translateX(100%); }
.sd-slide-left-enter-active, .sd-slide-left-leave-active { transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
.sd-slide-left-enter-from, .sd-slide-left-leave-to { transform: translateX(-100%); }
.sd-up-enter-active, .sd-up-leave-active { transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
.sd-up-enter-from, .sd-up-leave-to { transform: translateY(100%); }
.sd-fade-enter-active, .sd-fade-leave-active { transition: opacity 0.2s; }
.sd-fade-enter-from, .sd-fade-leave-to { opacity: 0; }
</style>

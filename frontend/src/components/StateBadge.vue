<!--
  StateBadge — the four completion states, encoded four ways.
  ============================================================================
  WHY IT LOOKS LIKE THIS

  Every safety-critical domain separates two orthogonal questions: what did the
  system DECIDE, and can the data behind that decision be TRUSTED. Our first
  three states answer the first question. UNRESOLVED answers the second.

  So UNRESOLVED is not a fourth severity. It is a different KIND of thing, and
  the established convention is to strip it of alert colour entirely:

    aviation      invalid / removed — the value is X-ed out, never amber
    NASA GSFC     stale data must be indicated (Display Standard F.4.3.1)
    GitHub Checks `neutral` and `stale` — ran, declines to judge
    Kubernetes    condition status "Unknown"; absent == Unknown
    XACML 3.0     Indeterminate — "unable to evaluate… missing attributes"

  FOUR REDUNDANT CHANNELS, because colour alone fails WCAG 1.4.1 and fails
  anyone colour-blind reading a console at 3am:

              hue         shape        fill        border
    COMPLETE  green       circle       solid       1px solid
    PARTIAL   amber       triangle     solid       1px solid
    BLOCKED   red         octagon      solid       2px solid
    UNRESOLVED  none      dashed circle  HATCHED   1.5px dashed

  UNRESOLVED is the only state that is achromatic AND hatched AND dashed AND
  question-marked. Four simultaneous differences means it can never be mistaken
  for COMPLETE at a glance — which matters, because mistaking "we don't know"
  for "it's fine" is the exact failure this whole system exists to prevent.

  Nothing animates. A pulsing badge claims urgency; absence of data is not an
  emergency, it is an absence.
  ============================================================================
-->
<template>
  <span class="sb" :class="[state.toLowerCase(), size]" :title="title">
    <span class="sb-glyph" aria-hidden="true">{{ GLYPH[state] || '·' }}</span>
    <span v-if="!iconOnly" class="sb-word">{{ label || state }}</span>
  </span>
</template>

<script setup>
const GLYPH = {
  COMPLETE: '✓',
  PARTIAL: '!',
  BLOCKED: '✕',
  UNRESOLVED: '?',
}
defineProps({
  state: { type: String, required: true },
  label: { type: String, default: '' },
  size: { type: String, default: 'md' },     // sm | md
  iconOnly: { type: Boolean, default: false },
  title: { type: String, default: '' },
})
</script>

<style scoped>
.sb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px 3px 7px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  font-weight: 600;
  letter-spacing: 0.1em;
  line-height: 1.6;
  white-space: nowrap;
}
.sb.sm { font-size: var(--t-micro); padding: 2px 7px 2px 5px; gap: 4px; }

.sb-glyph {
  display: grid;
  place-items: center;
  width: 13px;
  height: 13px;
  font-size: var(--t-micro);
  line-height: 1;
  flex-shrink: 0;
}
.sb.sm .sb-glyph { width: 11px; height: 11px; font-size: var(--t-micro); }

/* ---- COMPLETE — deliberately quiet. A satisfied constraint is not an
       achievement to celebrate, it is the expected condition. Dark-cockpit. -- */
.sb.complete {
  background: var(--color-green-dim);
  border: 1px solid rgba(76, 199, 106, 0.5);
  color: var(--color-green);
}
.sb.complete .sb-glyph { border-radius: 50%; background: rgba(76, 199, 106, 0.18); }

/* ---- PARTIAL — caution amber, per 14 CFR 25.1322 ---- */
.sb.partial {
  background: var(--color-amber-dim);
  border: 1px solid rgba(224, 163, 46, 0.55);
  color: var(--color-amber);
}
.sb.partial .sb-glyph {
  background: rgba(224, 163, 46, 0.18);
  clip-path: polygon(50% 0%, 100% 100%, 0% 100%);   /* triangle */
}

/* ---- BLOCKED — warning red, heaviest border in the system ---- */
.sb.blocked {
  background: var(--color-red-dim);
  border: 2px solid var(--color-red);
  color: var(--color-red);
  padding: 2px 8px 2px 6px;
}
.sb.blocked .sb-glyph {
  background: rgba(255, 95, 86, 0.18);
  /* octagon — the stop-sign silhouette, legible in monochrome */
  clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%,
                     30% 100%, 0% 70%, 0% 30%);
}

/* ---- UNRESOLVED — no hue, hatched, dashed. A different kind of answer. ---- */
.sb.unresolved {
  background: repeating-linear-gradient(
    45deg,
    transparent, transparent 3px,
    rgba(139, 147, 161, 0.16) 3px, rgba(139, 147, 161, 0.16) 6px
  );
  border: 1.5px dashed var(--color-purple);
  color: var(--color-purple);
}
.sb.unresolved .sb-glyph {
  border: 1px dashed var(--color-purple);
  border-radius: 50%;
}
</style>

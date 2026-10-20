<template>
  <v-tooltip v-if="armed" v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </v-tooltip>
  <!-- Until the card is reached: only what the tooltip is attached to -->
  <slot v-else name="activator" :props="{}" :is-active="false" />
</template>

<script setup lang="ts">
import { TOOLTIPS_ARMED } from '~/composables/useLazyTooltips'

/** A v-tooltip that is built once its card (see useLazyTooltips) is hovered or focused */
defineOptions({ inheritAttrs: false })
const armed = inject(TOOLTIPS_ARMED, ref(true))
</script>

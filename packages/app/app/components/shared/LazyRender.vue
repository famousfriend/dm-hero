<template>
  <div ref="root" class="h-100" :style="shown ? undefined : { minHeight: `${minHeight}px` }">
    <slot v-if="shown" />
  </div>
</template>

<script setup lang="ts">
import { unwatch, watchNear } from '~/utils/lazyRender'

/**
 * Draws its content once it comes near the screen (and keeps it after).
 * Long card lists use it so a campaign with hundreds of NPCs opens at once
 * instead of building every card up front. Cards up to a few screens ahead
 * are built while the app is idle, so scrolling down doesn't have to build
 * them mid-scroll.
 */
const props = withDefaults(defineProps<{
  /** Height to reserve until the content is drawn */
  minHeight?: number
  /** Draw straight away, e.g. the card a link jumps to */
  eager?: boolean
}>(), { minHeight: 240, eager: false })

const root = ref<HTMLElement | null>(null)
const visible = ref(false)
const shown = computed(() => visible.value || props.eager)
const show = () => (visible.value = true)

onMounted(() => {
  if (shown.value || typeof IntersectionObserver === 'undefined') return show()
  watchNear(root.value!, show)
})

onBeforeUnmount(() => root.value && unwatch(root.value))
</script>

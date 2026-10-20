<template>
  <div ref="root" class="h-100" :style="shown ? undefined : { minHeight: `${minHeight}px` }">
    <slot v-if="shown" />
  </div>
</template>

<script setup lang="ts">
/**
 * Draws its content only once it scrolls near the screen (and keeps it after).
 * Long card lists use it so a campaign with hundreds of NPCs opens at once
 * instead of building every card, with all its menus and tooltips, up front.
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
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (shown.value || typeof IntersectionObserver === 'undefined') {
    visible.value = true
    return
  }
  observer = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) {
      visible.value = true
      observer?.disconnect()
      observer = null
    }
  }, { rootMargin: '400px 0px' })
  observer.observe(root.value!)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

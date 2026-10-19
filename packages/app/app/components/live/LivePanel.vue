<template>
  <v-card variant="outlined" class="live-panel mb-4">
    <div class="d-flex align-center px-3 py-2 panel-header" @click="emit('update:collapsed', !collapsed)">
      <v-icon :icon="icon" size="small" class="mr-2" :color="color" />
      <span class="text-title-small font-weight-medium flex-grow-1">{{ title }}</span>
      <div class="d-flex align-center ga-1" @click.stop>
        <slot name="actions" />
      </div>
      <v-btn
        :icon="collapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
        size="x-small"
        variant="text"
        :title="collapsed ? $t('live.expand') : $t('live.collapse')"
        @click.stop="emit('update:collapsed', !collapsed)"
      />
    </div>
    <v-expand-transition>
      <div v-show="!collapsed" class="px-3 pb-3">
        <slot />
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  icon: string
  color?: string
  collapsed: boolean
}>()

const emit = defineEmits<{ 'update:collapsed': [value: boolean] }>()
</script>

<style scoped>
.panel-header {
  cursor: pointer;
  user-select: none;
}
</style>

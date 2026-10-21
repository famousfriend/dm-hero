<template>
  <v-card class="mt-6">
    <v-card-text>
      <div class="mb-4">
        <h2 class="text-headline-small mb-2">{{ $t('settings.speedTest.title') }}</h2>
        <p class="text-medium-emphasis text-body-medium mb-0">{{ $t('settings.speedTest.subtitle') }}</p>
      </div>

      <v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-speedometer"
        :loading="speedTest.running"
        @click="start"
      >
        {{ $t('settings.speedTest.start') }}
      </v-btn>

      <template v-if="speedTest.report">
        <v-textarea
          :model-value="speedTest.report"
          readonly
          auto-grow
          variant="outlined"
          class="speed-report mt-4"
          hide-details
        />
        <v-btn class="mt-2" variant="tonal" prepend-icon="mdi-content-copy" @click="copy">
          {{ copied ? $t('settings.speedTest.copied') : $t('settings.speedTest.copy') }}
        </v-btn>
      </template>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { runSpeedTest, speedTest } from '~/utils/speedTest'

const { t } = useI18n()
const router = useRouter()
const config = useRuntimeConfig()
const copied = ref(false)

function start() {
  copied.value = false
  runSpeedTest(router, t, String(config.public.appVersion ?? ''))
}

async function copy() {
  await navigator.clipboard.writeText(speedTest.report)
  copied.value = true
}
</script>

<style scoped>
.speed-report :deep(textarea) {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
}
</style>

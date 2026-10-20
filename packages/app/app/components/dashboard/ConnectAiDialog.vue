<template>
  <v-dialog v-model="dialog" max-width="720" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <v-icon icon="mdi-robot-happy-outline" color="primary" />
        {{ $t('connectAi.title') }}
      </v-card-title>

      <v-card-text style="max-height: 70vh">
        <p class="text-body-medium text-medium-emphasis mb-4">
          {{ $t('connectAi.intro') }}
        </p>

        <v-alert
          v-if="fetchFailed"
          type="error"
          variant="tonal"
          density="comfortable"
        >
          {{ $t('connectAi.loadFailed') }}
        </v-alert>

        <template v-else-if="info">
          <v-alert
            v-if="!info.mcpAvailable"
            type="warning"
            variant="tonal"
            density="comfortable"
            class="mb-4"
          >
            {{ $t('connectAi.notBuilt') }}
            <pre class="connect-cmd mt-2">pnpm --filter @dm-hero/mcp build</pre>
          </v-alert>

          <v-tabs v-model="tab" density="comfortable" class="mb-3">
            <v-tab value="claude-code">Claude Code</v-tab>
            <v-tab value="claude-desktop">Claude Desktop</v-tab>
            <v-tab value="cursor">Cursor</v-tab>
          </v-tabs>

          <v-window v-model="tab">
            <v-window-item value="claude-code">
              <p class="text-body-small mb-2">{{ $t('connectAi.claudeCode') }}</p>
              <DashboardConnectCopyBlock :text="claudeCodeCmd" />
            </v-window-item>

            <v-window-item value="claude-desktop">
              <!-- Step by step for people who never edited a config file -->
              <ol class="connect-steps text-body-medium mb-3">
                <li v-for="n in 6" :key="n">
                  {{ $t(`connectAi.desktopSteps.s${n}`) }}
                  <DashboardConnectCopyBlock v-if="n === 2" :text="jsonConfig" class="mt-2" />
                </li>
              </ol>
            </v-window-item>

            <v-window-item value="cursor">
              <p class="text-body-small mb-2">
                {{ $t('connectAi.cursor') }} <code>.cursor/mcp.json</code>
              </p>
              <DashboardConnectCopyBlock :text="jsonConfig" />
            </v-window-item>
          </v-window>

          <div class="text-body-small text-medium-emphasis mt-3">
            <strong>{{ $t('connectAi.appUrl') }}:</strong> <code>{{ appUrl }}</code>
          </div>

          <!-- What to do once connected: hand Claude your own notes -->
          <div class="text-title-medium mt-6 mb-2">{{ $t('connectAi.importNotes.title') }}</div>
          <ol class="connect-steps text-body-medium mb-3">
            <li v-for="n in 4" :key="n">{{ $t(`connectAi.importNotes.s${n}`) }}</li>
          </ol>
          <p class="text-body-small mb-2">{{ $t('connectAi.importNotes.example') }}</p>
          <DashboardConnectCopyBlock :text="examplePrompt" wrap />

          <v-alert
            type="info"
            variant="tonal"
            prominent
            icon="mdi-restart"
            class="mt-4"
          >
            <div class="font-weight-medium">{{ $t('connectAi.afterConnectTitle') }}</div>
            <div class="text-body-small mt-1">{{ $t('connectAi.afterConnect') }}</div>
          </v-alert>
        </template>

        <div v-else class="text-center py-8">
          <v-progress-circular indeterminate color="primary" />
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog = false">{{ $t('common.close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
interface McpInfo {
  appUrl: string
  mcpPath: string | null
  mcpAvailable: boolean
  isElectron: boolean
  /** The desktop app runs the MCP with its own executable, so no Node.js install is needed */
  runtime?: { command: string, env: Record<string, string> }
}

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()

const dialog = computed({
  get: () => props.show,
  set: v => emit('update:show', v),
})

const tab = ref('claude-code')
const { t } = useI18n()
const campaignName = useCookie<string | null>('activeCampaignName')
const examplePrompt = computed(() => t('connectAi.importNotes.prompt', { campaign: campaignName.value || 'My campaign' }))
const info = ref<McpInfo | null>(null)
const fetchFailed = ref(false)

const appUrl = computed(() => info.value?.appUrl ?? 'http://127.0.0.1:3456')
const mcpPath = computed(() => info.value?.mcpPath ?? '/path/to/dm-hero/packages/mcp/dist/mcp.mjs')

const runtime = computed(() => info.value?.runtime ?? { command: 'node', env: {} })
// Paths with spaces (C:\Users\...\DM Hero.exe) need quotes on the command line
const quote = (value: string) => (/\s/.test(value) ? `"${value}"` : value)

const claudeCodeCmd = computed(() => {
  const env = Object.entries(runtime.value.env).map(([key, value]) => `-e ${key}=${value} `).join('')
  return `claude mcp add --transport stdio ${env}dm-hero -- ${quote(runtime.value.command)} ${quote(mcpPath.value)} ${appUrl.value}`
})
const jsonConfig = computed(() => JSON.stringify({
  mcpServers: {
    'dm-hero': {
      command: runtime.value.command,
      args: [mcpPath.value, appUrl.value],
      ...(Object.keys(runtime.value.env).length ? { env: runtime.value.env } : {}),
    },
  },
}, null, 2))

watch(() => props.show, async (open) => {
  if (open && !info.value) {
    try {
      info.value = await $fetch<McpInfo>('/api/import/mcp-info')
      fetchFailed.value = false
      // Desktop app users most likely use the Claude desktop app
      if (info.value.isElectron) tab.value = 'claude-desktop'
    }
    catch {
      // Don't fall back to placeholder commands (they'd be copyable but wrong) —
      // show an explicit error state instead.
      fetchFailed.value = true
    }
  }
})
</script>

<style scoped>
.connect-steps {
  padding-left: 20px;
}
.connect-steps li {
  margin-bottom: 6px;
}

/* The one-line build hint inside the "not built" alert. */
.connect-cmd {
  background: #11151f;
  color: #d7e0ea;
  border-radius: 6px;
  padding: 8px 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  margin: 0;
}
</style>

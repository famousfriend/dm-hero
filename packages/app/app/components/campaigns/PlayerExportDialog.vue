<template>
  <v-dialog v-model="dialogVisible" max-width="760" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-file-document-outline</v-icon>
        {{ $t('campaigns.playerExport.title') }}
      </v-card-title>

      <v-card-text>
        <p class="text-body-medium text-medium-emphasis mb-4">{{ $t('campaigns.playerExport.hint') }}</p>
        <v-text-field
          v-model="title"
          :label="$t('campaigns.playerExport.fileTitle')"
          density="compact"
          variant="outlined"
          class="mb-2"
        />

        <div v-if="loading" class="d-flex justify-center py-8">
          <v-progress-circular indeterminate />
        </div>
        <v-alert v-else-if="!candidates.length" type="info" variant="tonal">
          {{ $t('campaigns.playerExport.empty') }}
        </v-alert>
        <v-expansion-panels v-else v-model="expanded" variant="accordion">
          <v-expansion-panel v-for="type in typesWithEntries" :key="type" :value="type">
            <v-expansion-panel-title>
              <div class="d-flex align-center flex-grow-1">
                <v-icon :icon="SHARE_TYPE_CONFIG[type].icon" size="small" class="mr-2" />
                <span>{{ $t(`${SHARE_TYPE_CONFIG[type].i18n}.title`) }}</span>
                <v-chip size="x-small" variant="tonal" class="ml-2" :color="pickedCount(type) ? 'primary' : undefined">
                  {{ pickedCount(type) }}/{{ entriesOf(type).length }}
                </v-chip>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="text-label-large mb-1">{{ $t('campaigns.playerExport.fields') }}</div>
              <v-chip-group v-model="fields[type]" multiple column class="mb-2">
                <v-chip
                  v-for="field in shareFields.shareKinds[type] ?? []"
                  :key="field"
                  :value="field"
                  filter
                  size="small"
                  variant="outlined"
                >
                  {{ fieldLabel(type, field) }}
                </v-chip>
              </v-chip-group>
              <div class="d-flex align-center">
                <div class="text-label-large">{{ $t('campaigns.playerExport.entries') }}</div>
                <v-spacer />
                <v-btn variant="text" size="x-small" @click="toggleAll(type)">
                  {{ allPicked(type) ? $t('common.deselectAll') : $t('common.selectAll') }}
                </v-btn>
              </div>
              <v-checkbox
                v-for="entry in entriesOf(type)"
                :key="entry.id"
                v-model="picked"
                :value="key(entry)"
                density="compact"
                hide-details
              >
                <template #label>
                  <span>{{ entry.alias ?? entry.name }}</span>
                  <span v-if="entry.alias" class="text-medium-emphasis ml-1">({{ entry.name }})</span>
                  <v-chip v-if="entry.shared" size="x-small" variant="tonal" color="success" class="ml-2">
                    {{ $t('campaigns.playerExport.shared') }}
                  </v-chip>
                </template>
              </v-checkbox>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <v-alert type="info" variant="tonal" density="compact" class="mt-4">
          {{ $t('campaigns.playerExport.safety') }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <span class="text-body-medium text-medium-emphasis ml-2">
          {{ $t('campaigns.playerExport.count', { n: picked.length }) }}
        </span>
        <v-spacer />
        <v-btn variant="text" @click="dialogVisible = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-download" :disabled="!picked.length" :loading="exporting" @click="doExport">
          {{ $t('campaigns.playerExport.download') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { SHARE_TYPE_CONFIG, SHARE_TYPES, type ShareType } from '~~/types/share'

interface Candidate {
  type: ShareType
  id: number
  name: string
  alias: string | null
  shared: boolean
}

const props = defineProps<{ campaignId: number, campaignName?: string | null }>()
const dialogVisible = defineModel<boolean>({ default: false })

const { t, locale } = useI18n()
const shareFields = useShareFieldsStore()
const snackbar = useSnackbarStore()
const { saveFile } = useElectron()

const loading = ref(false)
const exporting = ref(false)
const candidates = ref<Candidate[]>([])
const picked = ref<string[]>([])
const fields = reactive<Partial<Record<ShareType, string[]>>>({})
const title = ref('')
const expanded = ref<ShareType | undefined>()

const key = (entry: Candidate) => `${entry.type}:${entry.id}`
const entriesOf = (type: ShareType) => candidates.value.filter(c => c.type === type)
const typesWithEntries = computed(() => SHARE_TYPES.filter(type => entriesOf(type).length))
const pickedCount = (type: ShareType) => entriesOf(type).filter(e => picked.value.includes(key(e))).length
const allPicked = (type: ShareType) => pickedCount(type) === entriesOf(type).length

// i18n keys are camelCase (armor_class -> armorClass), same as the share dialog
const fieldLabel = (type: ShareType, field: string) =>
  t(`${SHARE_TYPE_CONFIG[type].i18n}.${field.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}`, 1)

function toggleAll(type: ShareType) {
  const keys = entriesOf(type).map(key)
  picked.value = allPicked(type)
    ? picked.value.filter(k => !keys.includes(k))
    : [...new Set([...picked.value, ...keys])]
}

// Opening: what the game table already shares is ticked, fields start from the remembered share ticks
watch(dialogVisible, async (open) => {
  if (!open) return
  title.value = props.campaignName ?? ''
  loading.value = true
  try {
    const [list] = await Promise.all([
      $fetch<Candidate[]>(`/api/campaigns/${props.campaignId}/player-export`),
      shareFields.ensureShareKinds(),
    ])
    candidates.value = list
    picked.value = list.filter(c => c.shared).map(key)
    for (const type of SHARE_TYPES) {
      const offered = shareFields.shareKinds[type] ?? []
      fields[type] = [...(shareFields.shareDefaults[type] ?? offered)].filter(f => offered.includes(f))
    }
    expanded.value = typesWithEntries.value[0]
  }
  catch {
    snackbar.error(t('campaigns.playerExport.failed'))
  }
  finally {
    loading.value = false
  }
})

async function doExport() {
  exporting.value = true
  try {
    const html = await $fetch<string>(`/api/campaigns/${props.campaignId}/player-export`, {
      method: 'POST',
      body: {
        title: title.value,
        locale: locale.value,
        items: picked.value.map((k) => {
          const [type, id] = k.split(':')
          return { type, id: Number(id) }
        }),
        fields,
      },
      responseType: 'text',
    })
    const name = (title.value.trim() || props.campaignName || 'handout').replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().replace(/\s+/g, '-') || 'handout'
    const result = await saveFile(new Blob([html], { type: 'text/html' }), `${name}.html`, [
      { name: 'HTML', extensions: ['html'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (result.success) {
      snackbar.success(t('campaigns.playerExport.done'))
      dialogVisible.value = false
    }
    else if (result.error) snackbar.error(t('campaigns.playerExport.failed'))
  }
  catch {
    snackbar.error(t('campaigns.playerExport.failed'))
  }
  finally {
    exporting.value = false
  }
}
</script>

<template>
  <!-- Above the reference panel (z-index 3000), which can open it -->
  <v-dialog v-model="open" max-width="640" :z-index="3100" scrollable>
    <v-card>
      <v-card-title>{{ title }}</v-card-title>
      <v-card-text>
        <p class="text-body-medium text-medium-emphasis mb-4">{{ hint }}</p>
        <v-row dense>
          <v-col :cols="isNew ? 8 : 12">
            <v-text-field v-model="form.name" :label="$t('codex.edit.name')" density="compact" variant="outlined" autofocus />
          </v-col>
          <v-col v-if="isNew" cols="4">
            <v-select v-model="form.kind" :items="kindItems" :label="$t('codex.bookmarkKind')" density="compact" variant="outlined" />
          </v-col>
          <v-col cols="12">
            <v-text-field
              v-model="form.summary"
              :label="$t('codex.edit.summary')"
              :placeholder="$t('codex.edit.summaryPlaceholder')"
              density="compact"
              variant="outlined"
            />
          </v-col>
          <template v-if="kind === 'monster'">
            <v-col cols="4">
              <v-text-field v-model="form.hp" :label="$t('codex.edit.hp')" type="number" min="0" density="compact" variant="outlined" />
            </v-col>
            <v-col cols="4">
              <v-text-field v-model="form.ac" :label="$t('codex.edit.ac')" type="number" min="0" density="compact" variant="outlined" />
            </v-col>
            <v-col cols="4">
              <v-text-field v-model="form.cr" :label="$t('codex.edit.cr')" type="number" min="0" step="0.125" density="compact" variant="outlined" />
            </v-col>
          </template>
          <v-col cols="12">
            <v-textarea
              v-model="form.body"
              :label="$t('codex.edit.body')"
              :hint="$t('codex.edit.bodyHint')"
              persistent-hint
              rows="10"
              auto-grow
              variant="outlined"
              class="codex-edit-body"
            />
          </v-col>
        </v-row>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="!form.name.trim()" @click="save">
          {{ $t('common.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { CODEX_KINDS, type CodexEntry } from '~~/types/codex'

/**
 * Homebrew entry (new or existing) or this campaign's version of any
 * reference entry. Same fields either way; monsters also get HP/AC/CR,
 * which the fight tracker uses.
 */
const props = defineProps<{
  mode: 'homebrew' | 'campaign'
  /** Entry to edit; none = new homebrew entry */
  entry?: CodexEntry | null
  initialName?: string
  initialKind?: string
}>()

const emit = defineEmits<{ saved: [entry: CodexEntry] }>()
const open = defineModel<boolean>({ default: false })

const { t } = useI18n()
const campaignStore = useCampaignStore()

const form = reactive({ name: '', kind: 'spell', summary: '', body: '', hp: '', ac: '', cr: '' })
const saving = ref(false)
const error = ref('')

const isNew = computed(() => props.mode === 'homebrew' && !props.entry)
const kind = computed(() => (isNew.value ? form.kind : props.entry?.kind))
const title = computed(() => {
  if (props.mode === 'campaign') return t('codex.edit.campaignTitle')
  return isNew.value ? t('codex.edit.newTitle') : t('codex.edit.homebrewTitle')
})
const hint = computed(() => (props.mode === 'campaign' ? t('codex.edit.campaignHint') : t('codex.edit.homebrewHint')))

const kindItems = computed(() =>
  CODEX_KINDS.map((value) => {
    const key = `codex.kinds.${value}`
    const label = t(key)
    return { value, title: label === key ? value : label }
  }),
)

const asText = (value: unknown) => (value === undefined || value === null ? '' : String(value))

watch(open, (isOpen) => {
  if (!isOpen) return
  const entry = props.entry
  Object.assign(form, {
    name: entry?.name ?? props.initialName ?? '',
    kind: entry?.kind ?? props.initialKind ?? 'spell',
    summary: entry?.summary ?? '',
    body: entry?.body ?? '',
    hp: asText(entry?.data?.hp),
    ac: asText(entry?.data?.ac),
    cr: asText(entry?.data?.cr),
  })
  error.value = ''
}, { immediate: true })

async function save() {
  error.value = ''
  saving.value = true
  const fields = { name: form.name, summary: form.summary, body: form.body, hp: form.hp, ac: form.ac, cr: form.cr }
  try {
    const saved = props.mode === 'campaign'
      ? await $fetch<CodexEntry>('/api/codex/campaign-edit', {
          method: 'PUT',
          body: { ...fields, uid: props.entry!.uid, campaignId: campaignStore.activeCampaignIdNumber },
        })
      : await $fetch<CodexEntry>('/api/codex/homebrew', {
          method: 'POST',
          body: { ...fields, uid: props.entry?.uid, kind: form.kind },
        })
    open.value = false
    emit('saved', saved)
  }
  catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    error.value = status === 409 ? t('codex.edit.exists') : t('codex.edit.failed')
  }
  finally {
    saving.value = false
  }
}
</script>

<style scoped>
.codex-edit-body :deep(textarea) {
  font-family: ui-monospace, monospace;
  font-size: 0.875rem;
}
</style>

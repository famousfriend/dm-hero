<template>
  <v-dialog :model-value="!!member" max-width="640" scrollable @update:model-value="!$event && emit('close')">
    <v-card v-if="member">
      <v-card-title class="d-flex align-center">
        <v-icon start>mdi-account-edit</v-icon>
        {{ member.effective.name }}
      </v-card-title>
      <v-divider />

      <v-card-text>
        <!-- D&D Beyond link -->
        <div class="text-title-small mb-2">{{ $t('party.ddbSection') }}</div>
        <div class="d-flex ga-2 align-start">
          <v-text-field
            v-model="link"
            :label="$t('party.ddbLink')"
            :placeholder="'https://www.dndbeyond.com/characters/12345678'"
            :hint="$t('party.ddbLinkHint')"
            persistent-hint
            :error-messages="linkError"
            density="compact"
            variant="outlined"
            class="flex-grow-1"
          />
          <v-btn :loading="savingLink" variant="tonal" @click="saveLink">{{ $t('common.save') }}</v-btn>
        </div>
        <div class="d-flex align-center ga-2 mt-3">
          <v-btn size="small" variant="text" prepend-icon="mdi-file-upload-outline" @click="fileInput?.click()">
            {{ $t('party.importFile') }}
          </v-btn>
          <span class="text-caption text-medium-emphasis">{{ $t('party.importFileHint') }}</span>
          <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importFile" />
        </div>
        <v-alert v-if="member?.ddbError" type="warning" variant="tonal" density="compact" class="mt-3">
          {{ member?.ddbError }}
        </v-alert>

        <v-divider class="my-4" />

        <!-- Manual values -->
        <div class="text-title-small mb-1">{{ $t('party.manualSection') }}</div>
        <p class="text-caption text-medium-emphasis mb-3">{{ $t('party.manualHint') }}</p>
        <v-row dense>
          <v-col v-for="field in textFields" :key="field" :cols="field === 'name' || field === 'classLabel' ? 12 : 6" :sm="field === 'name' || field === 'classLabel' ? 6 : 4">
            <v-text-field
              v-model="draft[field]"
              :label="$t(`party.fields.${field}`)"
              :type="numberFields.includes(field) ? 'number' : 'text'"
              density="compact"
              variant="outlined"
              hide-details
              :class="{ 'manual-field': isManual(field) }"
            >
              <template v-if="isManual(field) && member?.ddb" #append-inner>
                <v-icon size="small" :title="$t('party.revertField', { value: ddbValue(field) })" @click="revert(field)">
                  mdi-cloud-download-outline
                </v-icon>
              </template>
            </v-text-field>
          </v-col>
          <v-col cols="12">
            <v-combobox
              v-model="draftConditions"
              :items="conditionItems"
              :label="$t('party.fields.conditions')"
              multiple
              chips
              closable-chips
              density="compact"
              variant="outlined"
              hide-details
            />
          </v-col>
          <v-col cols="12">
            <v-checkbox v-model="draftInspiration" :label="$t('party.inspiration')" density="compact" hide-details />
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />
      <v-card-actions>
        <v-btn
          v-if="hasManual && member?.ddb"
          variant="text"
          prepend-icon="mdi-cloud-download-outline"
          @click="revertAll"
        >
          {{ $t('party.useDdbValues') }}
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="emit('close')">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" @click="saveManual">{{ $t('common.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { PARTY_CONDITIONS, type PartyField, type PartyMember } from '~~/types/party'

const props = defineProps<{ member: PartyMember | null }>()
const emit = defineEmits<{
  close: []
  updated: [member: PartyMember]
}>()

const { t } = useI18n()
const snackbar = useSnackbarStore()

const textFields: PartyField[] = [
  'name',
  'classLabel',
  'level',
  'hpMax',
  'hpCurrent',
  'hpTemp',
  'ac',
  'spellSaveDc',
  'passivePerception',
  'passiveInsight',
  'passiveInvestigation',
  'deathSaveSuccesses',
  'deathSaveFailures',
]
const numberFields: PartyField[] = textFields.filter(f => f !== 'name' && f !== 'classLabel')
const conditionItems = [...PARTY_CONDITIONS]

const link = ref('')
const linkError = ref('')
const savingLink = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const draft = reactive<Record<string, string | number | null>>({})
const draftConditions = ref<string[]>([])
const draftInspiration = ref(false)

const hasManual = computed(() => !!props.member && Object.keys(props.member.manual).length > 0)

function resetDraft(member: PartyMember) {
  link.value = member.ddbCharacterId ? `https://www.dndbeyond.com/characters/${member.ddbCharacterId}` : ''
  linkError.value = ''
  for (const field of textFields) draft[field] = (member.effective[field] as string | number | null) ?? ''
  draftConditions.value = [...member.effective.conditions]
  draftInspiration.value = member.effective.inspiration
}

watch(
  () => props.member,
  (member) => {
    if (member) resetDraft(member)
  },
  { immediate: true },
)

function isManual(field: PartyField) {
  return props.member?.manual[field] !== undefined
}

function ddbValue(field: PartyField) {
  return String(props.member?.ddb?.[field] ?? '')
}

async function patch(body: Record<string, unknown>) {
  const updated = await $fetch<PartyMember>(`/api/party/${props.member!.entityId}`, { method: 'PATCH', body })
  emit('updated', updated)
  resetDraft(updated)
  return updated
}

async function saveLink() {
  linkError.value = ''
  savingLink.value = true
  try {
    const updated = await patch({ ddbLink: link.value })
    if (updated.ddbCharacterId) {
      const refreshed = await $fetch<PartyMember>(`/api/party/${updated.entityId}/refresh`, { method: 'POST' })
      emit('updated', refreshed)
      resetDraft(refreshed)
    }
  }
  catch {
    linkError.value = t('party.invalidLink')
  }
  finally {
    savingLink.value = false
  }
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const json = JSON.parse(await file.text())
    const updated = await $fetch<PartyMember>(`/api/party/${props.member!.entityId}/import`, { method: 'POST', body: json })
    emit('updated', updated)
    resetDraft(updated)
    snackbar.success(t('party.importDone'))
  }
  catch {
    snackbar.error(t('party.importFailed'))
  }
}

// Only fields the DM actually changed become manual values
async function saveManual() {
  const member = props.member!
  const manual: Record<string, unknown> = {}
  for (const field of textFields) {
    const value = draft[field]
    const current = member.effective[field]
    const normalized = numberFields.includes(field) ? (value === '' || value === null ? null : Number(value)) : String(value ?? '')
    if (normalized !== current && !(normalized === null && current === null)) manual[field] = normalized
  }
  if (JSON.stringify(draftConditions.value) !== JSON.stringify(member.effective.conditions)) {
    manual.conditions = draftConditions.value
  }
  if (draftInspiration.value !== member.effective.inspiration) manual.inspiration = draftInspiration.value
  if (Object.keys(manual).length) await patch({ manual })
  emit('close')
}

async function revert(field: PartyField) {
  await patch({ manual: { [field]: null } })
}

async function revertAll() {
  const manual: Record<string, null> = {}
  for (const key of Object.keys(props.member!.manual)) manual[key] = null
  await patch({ manual })
}
</script>

<style scoped>
.manual-field :deep(.v-field) {
  border-left: 3px solid rgb(var(--v-theme-warning));
}
</style>

import { MAX_RECAP_FILE_BYTES, isAllowedRecapFile, isRecapTextFile } from '~~/types/recaps'

function readAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    // "data:<type>;base64,<data>" -> "<data>"
    reader.onload = () => resolve(String(reader.result ?? '').replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Recap notes dropped on a session: .txt/.md files are added to the recap text
 * (the caller saves it), everything else is attached to the session right away.
 */
export function useRecapUpload() {
  const { t } = useI18n()
  const snackbar = useSnackbarStore()

  async function uploadRecapFiles(sessionId: number, files: File[], currentRecap: string) {
    let recap = currentRecap
    let added = 0
    let uploaded = 0
    const problems: string[] = []

    for (const file of files) {
      if (!isAllowedRecapFile(file.name)) {
        problems.push(t('recaps.unsupported', { name: file.name }))
        continue
      }
      if (file.size > MAX_RECAP_FILE_BYTES) {
        problems.push(t('recaps.tooLarge', { name: file.name }))
        continue
      }
      try {
        if (isRecapTextFile(file.name)) {
          const text = (await readAsText(file)).trim()
          if (text) {
            recap = recap.trim() ? `${recap.trimEnd()}\n\n${text}` : text
            added++
          }
        }
        else {
          await $fetch(`/api/quests/recaps/${sessionId}/files`, {
            method: 'POST',
            body: { fileName: file.name, data: await readAsBase64(file) },
          })
          uploaded++
        }
      }
      catch (error) {
        console.error('Recap upload failed:', error)
        problems.push(t('recaps.uploadFailed', { name: file.name }))
      }
    }

    if (problems.length) snackbar.error(problems.join(' · '))
    else if (added || uploaded) snackbar.success(t('recaps.uploadDone', { added, uploaded }))
    return { recap, added, uploaded }
  }

  return { uploadRecapFiles }
}

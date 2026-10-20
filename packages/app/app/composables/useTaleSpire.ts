import { taleSpireDiceUrl, type TaleSpireRoll } from '~/utils/taleSpire'

/**
 * "I use TaleSpire": shows buttons that send rolls to the TaleSpire dice tray.
 * Remembered on this device, like physical dice.
 */
const STORAGE_KEY = 'dmcc-talespire'
const enabled = ref(false)
let loaded = false

export function useTaleSpire() {
  if (import.meta.client && !loaded) {
    loaded = true
    try {
      enabled.value = localStorage.getItem(STORAGE_KEY) === '1'
    }
    catch {
      // storage blocked: stays off
    }
    watch(enabled, (on) => {
      try {
        localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
      }
      catch {
        // not remembered, still works for now
      }
    })
  }

  /** Opens TaleSpire with these dice in the tray; false if there was nothing to send or it failed */
  async function sendRolls(rolls: TaleSpireRoll[]): Promise<boolean> {
    const url = taleSpireDiceUrl(rolls)
    if (!url) return false
    const api = import.meta.client ? window.electronAPI : undefined
    if (api?.openTaleSpireDice) {
      const result = await api.openTaleSpireDice(url)
      return result.success
    }
    // Browser: the OS hands the link to TaleSpire
    window.location.href = url
    return true
  }

  return { enabled, sendRolls }
}

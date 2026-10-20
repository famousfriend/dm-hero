/**
 * "Physical dice" mode: the DM rolls real dice and types the results in,
 * instead of the app rolling. Remembered on this device.
 */
const STORAGE_KEY = 'dmcc-physical-dice'
const physicalDice = ref(false)
let loaded = false

export function usePhysicalDice() {
  if (import.meta.client && !loaded) {
    loaded = true
    try {
      physicalDice.value = localStorage.getItem(STORAGE_KEY) === '1'
    }
    catch {
      // storage blocked: stays off
    }
    watch(physicalDice, (on) => {
      try {
        localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
      }
      catch {
        // not remembered, still works for now
      }
    })
  }
  return physicalDice
}

/** A d6 recharge roll succeeds on recharge_min or higher (e.g. 5 for "Recharge 5-6") */
export function rechargeSucceeds(roll: number, rechargeMin: number | null) {
  return roll >= (rechargeMin ?? 6)
}

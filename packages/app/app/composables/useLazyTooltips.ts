import type { InjectionKey, Ref } from 'vue'

/*
 * A card in a long list has a dozen tooltips, and each Vuetify tooltip is a
 * full overlay (about eight components). SharedLazyTooltip only builds the
 * real tooltip once the mouse or keyboard reaches its card, so a page of cards
 * draws and scrolls without carrying hundreds of hidden overlays.
 */
export const TOOLTIPS_ARMED: InjectionKey<Ref<boolean>> = Symbol('tooltipsArmed')

/** Call in a card; bind `armTooltips` to the card's mouseenter and focusin */
export function useLazyTooltips() {
  const armed = ref(false)
  provide(TOOLTIPS_ARMED, armed)
  return { armTooltips: () => (armed.value = true) }
}

/** Entry types that can be duplicated and saved as templates */
export type CopyableEntityType = 'npc' | 'item' | 'faction' | 'lore' | 'location'

export interface EntityTemplate {
  id: number
  type: CopyableEntityType
  name: string
  description: string | null
  metadata: Record<string, unknown> | null
  /** Fills the empty fields of every new entry of its type */
  isDefault: boolean
  hasStats: boolean
  tagCount: number
  createdAt: string
}

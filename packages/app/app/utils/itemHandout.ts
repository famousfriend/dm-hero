// Item handouts for The Homebrewery (homebrewery.naturalcrit.com): we build the page text,
// the DM pastes it there and saves it as a PDF for the players.
// Base items and properties are SRD 5.1 (CC-BY-4.0). The page text stays English like the rules.

export const HANDOUT_CATEGORIES = ['weapon', 'armor', 'potion', 'ring', 'rod', 'scroll', 'staff', 'wand', 'wondrous'] as const
export type HandoutCategory = (typeof HANDOUT_CATEGORIES)[number]

const CATEGORY_LABELS: Record<HandoutCategory, string> = {
  weapon: 'Weapon',
  armor: 'Armor',
  potion: 'Potion',
  ring: 'Ring',
  rod: 'Rod',
  scroll: 'Scroll',
  staff: 'Staff',
  wand: 'Wand',
  wondrous: 'Wondrous item',
}

export const HANDOUT_RARITIES = ['common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact', 'varies'] as const
export type HandoutRarity = (typeof HANDOUT_RARITIES)[number]

export const WEAPON_PROPERTIES = [
  'Ammunition',
  'Finesse',
  'Heavy',
  'Light',
  'Loading',
  'Reach',
  'Special',
  'Thrown',
  'Two-handed',
  'Versatile',
  'Silvered',
  'Adamantine',
]

export const ATTUNEMENT_SUGGESTIONS = [
  'a bard',
  'a cleric',
  'a druid',
  'a paladin',
  'a sorcerer',
  'a warlock',
  'a wizard',
  'a spellcaster',
  'a creature of good alignment',
  'a creature of evil alignment',
]

export interface BaseWeapon { name: string, damage: string, properties: string[], weight: string }
export interface BaseArmor { name: string, ac: string, notes: string[], weight: string }

export const SRD_WEAPONS: BaseWeapon[] = [
  { name: 'Club', damage: '1d4 bludgeoning', properties: ['Light'], weight: '2 lb.' },
  { name: 'Dagger', damage: '1d4 piercing', properties: ['Finesse', 'Light', 'Thrown (20/60)'], weight: '1 lb.' },
  { name: 'Greatclub', damage: '1d8 bludgeoning', properties: ['Two-handed'], weight: '10 lb.' },
  { name: 'Handaxe', damage: '1d6 slashing', properties: ['Light', 'Thrown (20/60)'], weight: '2 lb.' },
  { name: 'Javelin', damage: '1d6 piercing', properties: ['Thrown (30/120)'], weight: '2 lb.' },
  { name: 'Light hammer', damage: '1d4 bludgeoning', properties: ['Light', 'Thrown (20/60)'], weight: '2 lb.' },
  { name: 'Mace', damage: '1d6 bludgeoning', properties: [], weight: '4 lb.' },
  { name: 'Quarterstaff', damage: '1d6 bludgeoning', properties: ['Versatile (1d8)'], weight: '4 lb.' },
  { name: 'Sickle', damage: '1d4 slashing', properties: ['Light'], weight: '2 lb.' },
  { name: 'Spear', damage: '1d6 piercing', properties: ['Thrown (20/60)', 'Versatile (1d8)'], weight: '3 lb.' },
  { name: 'Light crossbow', damage: '1d8 piercing', properties: ['Ammunition (80/320)', 'Loading', 'Two-handed'], weight: '5 lb.' },
  { name: 'Dart', damage: '1d4 piercing', properties: ['Finesse', 'Thrown (20/60)'], weight: '1/4 lb.' },
  { name: 'Shortbow', damage: '1d6 piercing', properties: ['Ammunition (80/320)', 'Two-handed'], weight: '2 lb.' },
  { name: 'Sling', damage: '1d4 bludgeoning', properties: ['Ammunition (30/120)'], weight: '' },
  { name: 'Battleaxe', damage: '1d8 slashing', properties: ['Versatile (1d10)'], weight: '4 lb.' },
  { name: 'Flail', damage: '1d8 bludgeoning', properties: [], weight: '2 lb.' },
  { name: 'Glaive', damage: '1d10 slashing', properties: ['Heavy', 'Reach', 'Two-handed'], weight: '6 lb.' },
  { name: 'Greataxe', damage: '1d12 slashing', properties: ['Heavy', 'Two-handed'], weight: '7 lb.' },
  { name: 'Greatsword', damage: '2d6 slashing', properties: ['Heavy', 'Two-handed'], weight: '6 lb.' },
  { name: 'Halberd', damage: '1d10 slashing', properties: ['Heavy', 'Reach', 'Two-handed'], weight: '6 lb.' },
  { name: 'Lance', damage: '1d12 piercing', properties: ['Reach', 'Special'], weight: '6 lb.' },
  { name: 'Longsword', damage: '1d8 slashing', properties: ['Versatile (1d10)'], weight: '3 lb.' },
  { name: 'Maul', damage: '2d6 bludgeoning', properties: ['Heavy', 'Two-handed'], weight: '10 lb.' },
  { name: 'Morningstar', damage: '1d8 piercing', properties: [], weight: '4 lb.' },
  { name: 'Pike', damage: '1d10 piercing', properties: ['Heavy', 'Reach', 'Two-handed'], weight: '18 lb.' },
  { name: 'Rapier', damage: '1d8 piercing', properties: ['Finesse'], weight: '2 lb.' },
  { name: 'Scimitar', damage: '1d6 slashing', properties: ['Finesse', 'Light'], weight: '3 lb.' },
  { name: 'Shortsword', damage: '1d6 piercing', properties: ['Finesse', 'Light'], weight: '2 lb.' },
  { name: 'Trident', damage: '1d6 piercing', properties: ['Thrown (20/60)', 'Versatile (1d8)'], weight: '4 lb.' },
  { name: 'War pick', damage: '1d8 piercing', properties: [], weight: '2 lb.' },
  { name: 'Warhammer', damage: '1d8 bludgeoning', properties: ['Versatile (1d10)'], weight: '2 lb.' },
  { name: 'Whip', damage: '1d4 slashing', properties: ['Finesse', 'Reach'], weight: '3 lb.' },
  { name: 'Blowgun', damage: '1 piercing', properties: ['Ammunition (25/100)', 'Loading'], weight: '1 lb.' },
  { name: 'Hand crossbow', damage: '1d6 piercing', properties: ['Ammunition (30/120)', 'Light', 'Loading'], weight: '3 lb.' },
  { name: 'Heavy crossbow', damage: '1d10 piercing', properties: ['Ammunition (100/400)', 'Heavy', 'Loading', 'Two-handed'], weight: '18 lb.' },
  { name: 'Longbow', damage: '1d8 piercing', properties: ['Ammunition (150/600)', 'Heavy', 'Two-handed'], weight: '2 lb.' },
  { name: 'Net', damage: '', properties: ['Special', 'Thrown (5/15)'], weight: '3 lb.' },
]

export const SRD_ARMOR: BaseArmor[] = [
  { name: 'Padded', ac: '11 + Dex modifier', notes: ['Stealth disadvantage'], weight: '8 lb.' },
  { name: 'Leather', ac: '11 + Dex modifier', notes: [], weight: '10 lb.' },
  { name: 'Studded leather', ac: '12 + Dex modifier', notes: [], weight: '13 lb.' },
  { name: 'Hide', ac: '12 + Dex modifier (max 2)', notes: [], weight: '12 lb.' },
  { name: 'Chain shirt', ac: '13 + Dex modifier (max 2)', notes: [], weight: '20 lb.' },
  { name: 'Scale mail', ac: '14 + Dex modifier (max 2)', notes: ['Stealth disadvantage'], weight: '45 lb.' },
  { name: 'Breastplate', ac: '14 + Dex modifier (max 2)', notes: [], weight: '20 lb.' },
  { name: 'Half plate', ac: '15 + Dex modifier (max 2)', notes: ['Stealth disadvantage'], weight: '40 lb.' },
  { name: 'Ring mail', ac: '14', notes: ['Stealth disadvantage'], weight: '40 lb.' },
  { name: 'Chain mail', ac: '16', notes: ['Strength 13', 'Stealth disadvantage'], weight: '55 lb.' },
  { name: 'Splint', ac: '17', notes: ['Strength 15', 'Stealth disadvantage'], weight: '60 lb.' },
  { name: 'Plate', ac: '18', notes: ['Strength 15', 'Stealth disadvantage'], weight: '65 lb.' },
  { name: 'Shield', ac: '+2', notes: [], weight: '6 lb.' },
]

export interface HandoutForm {
  name: string
  category: HandoutCategory
  baseItem: string
  rarity: HandoutRarity
  attunement: boolean
  attunementBy: string
  bonus: number
  damage: string
  properties: string[]
  armorClass: string
  charges: string
  weight: string
  value: string
  description: string
  imageUrl: string
}

export function emptyHandoutForm(): HandoutForm {
  return {
    name: '',
    category: 'wondrous',
    baseItem: '',
    rarity: 'uncommon',
    attunement: false,
    attunementBy: '',
    bonus: 0,
    damage: '',
    properties: [],
    armorClass: '',
    charges: '',
    weight: '',
    value: '',
    description: '',
    imageUrl: '',
  }
}

// App item type -> Homebrewery category (anything else is a wondrous item)
const TYPE_TO_CATEGORY: Partial<Record<string, HandoutCategory>> = {
  weapon: 'weapon',
  ammunition: 'weapon',
  armor: 'armor',
  potion: 'potion',
  poison: 'potion',
  scroll: 'scroll',
  jewelry: 'ring',
}

export interface HandoutSourceItem {
  name: string
  description: string | null
  metadata: Record<string, unknown> | null
}

export function handoutFormFromItem(item: HandoutSourceItem): HandoutForm {
  const meta = item.metadata ?? {}
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  const rarity = HANDOUT_RARITIES.includes(meta.rarity as HandoutRarity) ? meta.rarity as HandoutRarity : 'uncommon'
  const properties = str(meta.properties).split(',').map(p => p.trim()).filter(Boolean)
  return {
    ...emptyHandoutForm(),
    name: item.name,
    category: TYPE_TO_CATEGORY[str(meta.type)] ?? 'wondrous',
    rarity,
    attunement: meta.attunement === true,
    damage: str(meta.damage),
    properties,
    armorClass: str(meta.armor_class),
    charges: str(meta.charges),
    weight: meta.weight ? `${meta.weight} lb.` : '',
    description: item.description ?? '',
  }
}

/** Fills damage/properties/AC/weight from an SRD base item (only if it is one) */
export function applyBaseItem(form: HandoutForm, baseName: string): HandoutForm {
  const weapon = SRD_WEAPONS.find(w => w.name.toLowerCase() === baseName.toLowerCase())
  if (weapon) return { ...form, baseItem: weapon.name, damage: weapon.damage, properties: [...weapon.properties], weight: weapon.weight }
  const armor = SRD_ARMOR.find(a => a.name.toLowerCase() === baseName.toLowerCase())
  if (armor) return { ...form, baseItem: armor.name, armorClass: armor.ac, properties: [...armor.notes], weight: armor.weight }
  return { ...form, baseItem: baseName }
}

function subtitle(form: HandoutForm): string {
  const base = form.baseItem.trim().toLowerCase()
  const category = CATEGORY_LABELS[form.category] + (base && (form.category === 'weapon' || form.category === 'armor') ? ` (${base})` : '')
  const rarity = form.rarity === 'varies' ? 'rarity varies' : form.rarity.replace('_', ' ')
  let attune = ''
  if (form.attunement) attune = form.attunementBy.trim() ? ` (requires attunement by ${form.attunementBy.trim()})` : ' (requires attunement)'
  return `${category}, ${rarity}${attune}`
}

function bonusSentence(form: HandoutForm): string {
  if (!form.bonus) return ''
  if (form.category === 'armor') return `You have a +${form.bonus} bonus to AC while wearing this armor.`
  if (form.category === 'weapon') return `You have a +${form.bonus} bonus to attack and damage rolls made with this magic weapon.`
  return ''
}

/** Homebrewery V3 page text for one item */
export function buildHandoutMarkdown(form: HandoutForm): string {
  const lines: string[] = [`## ${form.name.trim() || 'Unnamed item'}`, `*${subtitle(form)}*`]

  const stats: string[] = []
  if (form.damage.trim()) stats.push(`**Damage** ${form.damage.trim()}`)
  if (form.armorClass.trim()) stats.push(`**Armor Class** ${form.armorClass.trim()}`)
  if (form.properties.length) stats.push(`**Properties** ${form.properties.join(', ')}`)
  if (form.charges.trim()) stats.push(`**Charges** ${form.charges.trim()}`)
  if (form.weight.trim()) stats.push(`**Weight** ${form.weight.trim()}`)
  if (form.value.trim()) stats.push(`**Value** ${form.value.trim()}`)
  if (stats.length) lines.push('', '___', stats.join('  \n'), '___')

  const bonus = bonusSentence(form)
  if (bonus) lines.push('', bonus)
  if (form.description.trim()) lines.push('', form.description.trim())

  if (form.imageUrl.trim()) {
    lines.push('', `![${form.name.trim()}](${form.imageUrl.trim()}){width:60%;display:block;margin:1em auto;mix-blend-mode:multiply}`)
  }
  return `${lines.join('\n')}\n`
}

export const HOMEBREWERY_NEW_URL = 'https://homebrewery.naturalcrit.com/new'

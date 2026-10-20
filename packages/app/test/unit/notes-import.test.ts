import { describe, it, expect } from 'vitest'
import { docxHeadingStyles, docxToMarkdown, guessKind, linkMentions, splitNotes } from '../../app/utils/notesImport'

const NOTES = `Some intro about the campaign.

# Lost Mine

## NPCs

### Sildar Hallwinter
A human fighter, member of the Lords' Alliance. Captured by Klarg.

### Klarg
Bugbear boss of the Cragmaw hideout.

## Places
- **Cragmaw Hideout**: a cave north of Phandalin.
- **Phandalin**: small frontier town.

## Plot hooks

**Find Gundren**
Gundren went missing on the road. Sildar Hallwinter knows more.

## Session 1
The party met Sildar Hallwinter at Phandalin and fought goblins.

## The Black Spider
A mysterious villain.
`

describe('splitting notes', () => {
  const sections = splitNotes(NOTES)
  const byTitle = (title: string) => sections.find(s => s.title === title)!

  it('splits at headings, bold lines and bold list items', () => {
    expect(sections.map(s => s.title)).toEqual(['', 'Lost Mine', 'NPCs', 'Sildar Hallwinter', 'Klarg', 'Places', 'Cragmaw Hideout', 'Phandalin', 'Plot hooks', 'Find Gundren', 'Session 1', 'The Black Spider'])
    expect(byTitle('Klarg').body).toBe('Bugbear boss of the Cragmaw hideout.')
    expect(byTitle('Cragmaw Hideout').body).toBe('a cave north of Phandalin.')
    expect(byTitle('Find Gundren').path).toEqual(['Lost Mine', 'Plot hooks'])
  })

  it('guesses types from the group heading above', () => {
    const kinds = Object.fromEntries(sections.map(s => [s.title, s.kind]))
    expect(kinds).toEqual({
      '': 'skip',
      'Lost Mine': 'skip',
      'NPCs': 'skip',
      'Sildar Hallwinter': 'NPC',
      'Klarg': 'NPC',
      'Places': 'skip',
      'Cragmaw Hideout': 'Location',
      'Phandalin': 'Location',
      'Plot hooks': 'skip',
      'Find Gundren': 'Quest',
      'Session 1': 'Session',
      'The Black Spider': 'Lore',
    })
    expect(byTitle('Session 1').sessionNumber).toBe(1)
  })

  it('knows German group headings and session titles', () => {
    expect(guessKind({ title: 'Brom', path: ['Personen'], body: 'Wirt', hasChildren: false })).toBe('NPC')
    expect(guessKind({ title: 'Sitzung 12', path: [], body: 'x', hasChildren: false })).toBe('Session')
    expect(guessKind({ title: 'Schwert', path: ['Schätze'], body: 'x', hasChildren: false })).toBe('Item')
  })
})

describe('Word files', () => {
  it('turns headings, lists and text into Markdown', () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/></w:style></w:styles>'
    const doc = '<w:document><w:body>'
      + '<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>NPCs</w:t></w:r></w:p>'
      + '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">Sildar </w:t></w:r><w:r><w:t>&amp; Co</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>A fighter.</w:t><w:tab/><w:t>Brave.</w:t></w:r></w:p>'
      + '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Owes the party</w:t></w:r></w:p>'
      + '</w:body></w:document>'
    expect(docxToMarkdown(doc, docxHeadingStyles(styles))).toBe('# NPCs\n\n## Sildar & Co\n\nA fighter. Brave.\n\n- Owes the party')
  })
})

describe('linking mentions', () => {
  const targets = [
    { name: 'Sildar Hallwinter', token: '{{ref:n1}}' },
    { name: 'Sildar', token: '{{ref:n9}}' },
    { name: 'Phandalin', token: '{{location:4}}' },
    { name: 'Gundren', token: '{{npc:7}}' },
  ]

  it('links the first mention of each name, longest first', () => {
    expect(linkMentions('Sildar Hallwinter rode to Phandalin. Phandalin is small.', targets))
      .toBe('{{ref:n1}} rode to {{location:4}}. Phandalin is small.')
  })

  it('leaves its own name, partial words and existing links alone', () => {
    expect(linkMentions('Gundrens map. [Gundren](https://x.y) and {{npc:7}} Gundren', targets, 'Phandalin'))
      .toBe('Gundrens map. [Gundren](https://x.y) and {{npc:7}} {{npc:7}}')
    expect(linkMentions('Phandalin is home.', targets, 'Phandalin')).toBe('Phandalin is home.')
  })
})

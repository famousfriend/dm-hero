/* global TS -- TaleSpire's symbiote API */
/*
 * DM Command Center panel for TaleSpire. Reads the running fight from the app
 * on this computer, puts attack dice in the TaleSpire dice tray and writes the
 * results into the fight's action log. Plain JS: TaleSpire loads these files as they are.
 */
const config = window.DMCC_CONFIG || {}
const POLL_MS = 3000

let state = null
let lastJson = ''
const expanded = new Set()
/** rollId -> what was rolled */
const tracked = {}

const $ = id => document.getElementById(id)
const signed = n => (n >= 0 ? `+${n}` : `${n}`)
const hasTS = () => typeof TS !== 'undefined'

function el(tag, attrs, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') node.className = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else node.setAttribute(key, value)
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue
    node.append(child instanceof Node ? child : String(child))
  }
  return node
}

async function api(path, options = {}) {
  const response = await fetch(`${config.url}/talespire-api/${path}`, {
    ...options,
    headers: { 'x-dmcc-key': config.key, ...(options.body ? { 'content-type': 'application/json' } : {}) },
  })
  if (!response.ok) throw new Error(String(response.status))
  return response.json()
}

function showMessage(text) {
  $('message').textContent = text || ''
  $('message').style.display = text ? 'block' : 'none'
}

async function refresh() {
  try {
    const next = await api('state')
    const json = JSON.stringify(next)
    showMessage(next.encounter ? '' : 'No fight is running. Start one in DM Command Center.')
    if (json !== lastJson) {
      lastJson = json
      state = next
      render()
    }
  }
  catch (error) {
    showMessage(error.message === '401'
      ? 'This panel is out of date. Install it again from DM Command Center: Settings, TaleSpire.'
      : 'Can\'t reach DM Command Center. Is it open on this computer?')
  }
}

function render() {
  const list = $('turns')
  list.replaceChildren()
  const encounter = state && state.encounter
  $('subtitle').textContent = encounter ? `${encounter.name} · Round ${encounter.round}` : ''
  if (!encounter) return

  encounter.participants.forEach((p, index) => {
    const current = index === encounter.currentIndex
    const open = expanded.has(p.id) || (current && !expanded.has(-p.id))
    const hpText = p.maxHp ? `${p.hp}/${p.maxHp}${p.tempHp ? ` +${p.tempHp}` : ''}` : ''
    const pct = p.maxHp ? Math.max(0, Math.min(100, Math.round((p.hp / p.maxHp) * 100))) : 0
    const canAct = p.actions.some(a => a.toHit !== null || a.damageDice) || p.spellAttack !== null

    const row = el('li', { class: `turn ${current ? 'current' : ''} ${p.ko ? 'ko' : ''} ${p.kind}` },
      el('div', { class: 'turn-head', onclick: () => toggle(p.id, open, current) },
        el('span', { class: 'init' }, p.initiative ?? '–'),
        el('span', { class: 'name' }, p.name),
        p.ko ? el('span', { class: 'tag' }, 'KO') : null,
        p.ac !== null ? el('span', { class: 'ac', title: 'Armor class' }, `AC ${p.ac}`) : null,
        hpText ? el('span', { class: 'hp' }, hpText) : null,
        canAct ? el('span', { class: 'chevron' }, open ? '▾' : '▸') : null,
      ),
      p.maxHp ? el('div', { class: 'bar' }, el('div', { class: 'fill', style: `width:${pct}%` })) : null,
      p.conditions.length ? el('div', { class: 'conditions muted' }, p.conditions.join(', ')) : null,
    )
    if (open && canAct) {
      const actions = el('div', { class: 'actions' })
      for (const action of p.actions) {
        if (action.toHit === null && !action.damageDice) continue
        const parts = [action.toHit !== null ? `${signed(action.toHit)} to hit` : '', action.save ? `${action.save} save` : '', action.damageDice || '']
        actions.append(el('button', { onclick: () => rollAction(encounter.id, p, action) },
          el('span', { class: 'action-name' }, action.name),
          el('span', { class: 'muted' }, parts.filter(Boolean).join(' · ')),
        ))
      }
      if (p.spellAttack !== null) {
        actions.append(el('button', { onclick: () => rollAction(encounter.id, p, { name: 'Spell attack', toHit: p.spellAttack, damageDice: null, save: null }) },
          el('span', { class: 'action-name' }, 'Spell attack'),
          el('span', { class: 'muted' }, `${signed(p.spellAttack)} to hit`),
        ))
      }
      row.append(actions)
    }
    list.append(row)
  })
}

/** Open/close a row; the current turn is open unless it was closed on purpose */
function toggle(id, open, current) {
  expanded.delete(id)
  expanded.delete(-id)
  if (open && current) expanded.add(-id)
  else if (!open) expanded.add(id)
  render()
}

async function rollAction(encounterId, participant, action) {
  if (!hasTS()) return showMessage('Rolling works inside TaleSpire.')
  const dice = []
  if (action.toHit !== null) dice.push({ name: action.name, roll: `1d20${signed(action.toHit)}` })
  if (action.damageDice) dice.push({ name: 'Damage', roll: action.damageDice.replace(/\s+/g, '') })
  try {
    const rollId = await TS.dice.putDiceInTray(dice, false)
    tracked[rollId] = { encounterId, participant, action }
  }
  catch {
    showMessage('TaleSpire did not take the dice. Are you on a board?')
  }
}

/** The natural d20 inside a results group */
function naturalD20(result) {
  if (!result) return null
  if (result.kind && /20$/.test(result.kind) && Array.isArray(result.results)) return result.results[0] ?? null
  for (const operand of result.operands || []) {
    const found = naturalD20(operand)
    if (found !== null) return found
  }
  return null
}

// Named in manifest.json
async function handleRollResult(event) {
  const payload = event.payload || {}
  const roll = tracked[payload.rollId]
  if (!roll) return
  if (event.kind === 'rollRemoved') {
    delete tracked[payload.rollId]
    return
  }
  if (event.kind !== 'rollResults') return
  delete tracked[payload.rollId]

  const { encounterId, participant, action } = roll
  const groups = payload.resultsGroups || []
  let toHit = null
  let natural = null
  let damage = null
  for (const group of groups) {
    const sum = await TS.dice.evaluateDiceResultsGroup(group)
    if (typeof sum !== 'number') continue
    if (group.name === 'Damage' && action.toHit !== null) damage = sum
    else if (action.toHit !== null && toHit === null) {
      toHit = sum
      natural = naturalD20(group.result)
    }
    else damage = sum
  }

  const parts = []
  if (toHit !== null) {
    if (natural === 1) parts.push('natural 1, a miss')
    else parts.push(`${toHit} to hit${natural === 20 ? ' (critical hit!)' : ''}`)
  }
  if (action.save) parts.push(`${action.save} save`)
  if (damage !== null && natural !== 1) parts.push(`${damage} damage${natural === 20 ? ', roll the damage dice again for the crit' : ''}`)
  const text = parts.join(' · ')
  $('last').textContent = `${participant.name}: ${action.name} – ${text}`

  try {
    await api('roll', {
      method: 'POST',
      body: JSON.stringify({
        encounterId,
        participantId: participant.id,
        label: action.name,
        total: toHit ?? damage ?? 0,
        detail: text,
      }),
    })
  }
  catch {
    showMessage('The roll could not be saved in DM Command Center.')
  }
  if ($('post-chat').checked) {
    Promise.resolve(TS.chat.send(`${participant.name}: ${action.name} – ${text}`, 'board')).catch(() => {})
  }
}

function start() {
  try {
    $('post-chat').checked = window.localStorage.getItem('dmcc-post-chat') === '1'
  }
  catch { /* not remembered */ }
  $('post-chat').addEventListener('change', (e) => {
    try {
      window.localStorage.setItem('dmcc-post-chat', e.target.checked ? '1' : '0')
    }
    catch { /* not remembered */ }
  })
  refresh()
  setInterval(refresh, POLL_MS)
}

window.handleRollResult = handleRollResult
document.addEventListener('DOMContentLoaded', start)

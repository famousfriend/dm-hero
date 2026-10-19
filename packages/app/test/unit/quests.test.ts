import { describe, it, expect, beforeAll } from 'vitest'
import type Database from 'better-sqlite3'
import { getTestDb } from '../utils/test-db'
import {
  QuestInputError,
  createContinuityItem,
  createQuest,
  deleteContinuityItem,
  deleteQuest,
  getQuest,
  listContinuity,
  listLastMet,
  listLinkable,
  listQuests,
  updateContinuityItem,
  updateQuest,
} from '../../server/utils/quests'
import { QuestRouteError, handleQuestRequest } from '../../server/utils/quest-route'

describe('quests and continuity', () => {
  let db: Database.Database
  let campaignId: number
  let otherCampaignId: number
  const ids: Record<string, number> = {}

  beforeAll(() => {
    db = getTestDb()
    const campaign = (name: string) => Number(db.prepare('INSERT INTO campaigns (name) VALUES (?)').run(name).lastInsertRowid)
    campaignId = campaign('Phandelver')
    otherCampaignId = campaign('Other')
    const typeId = (name: string) => (db.prepare('SELECT id FROM entity_types WHERE name = ?').get(name) as { id: number }).id
    const entity = (type: string, name: string, campaign = campaignId) =>
      Number(
        db.prepare('INSERT INTO entities (type_id, campaign_id, name) VALUES (?, ?, ?)').run(typeId(type), campaign, name)
          .lastInsertRowid,
      )
    ids.gundren = entity('NPC', 'Gundren')
    ids.sildar = entity('NPC', 'Sildar')
    ids.klarg = entity('NPC', 'Klarg')
    ids.cragmaw = entity('Location', 'Cragmaw Hideout')
    ids.stranger = entity('NPC', 'Stranger', otherCampaignId)
    const session = (n: number, title: string, date: string) =>
      Number(
        db.prepare('INSERT INTO sessions (campaign_id, title, session_number, date) VALUES (?, ?, ?, ?)').run(campaignId, title, n, date)
          .lastInsertRowid,
      )
    ids.s1 = session(1, 'Goblin Arrows', '2026-09-01')
    ids.s2 = session(2, 'Cragmaw', '2026-09-08')
    ids.s3 = session(3, 'Phandalin', '2026-09-15')
  })

  it('creates a quest with giver and involved entities', () => {
    const quest = createQuest(db, campaignId, {
      name: '  Find Gundren  ',
      description: 'He was taken to Cragmaw Castle.',
      reward: '10 gp each',
      giverId: ids.sildar,
      involvedIds: [ids.gundren!, ids.cragmaw!, ids.stranger!, 999999],
    })
    ids.quest = quest.id
    expect(quest).toMatchObject({
      name: 'Find Gundren',
      status: 'open',
      reward: '10 gp each',
      giver: { id: ids.sildar, name: 'Sildar', type: 'NPC' },
    })
    // Entities from other campaigns and unknown ids are dropped
    expect(quest.involved.map(e => e.name)).toEqual(['Cragmaw Hideout', 'Gundren'])
  })

  it('updates status and involved entities, keeping other fields', () => {
    const quest = updateQuest(db, ids.quest!, { status: 'active', involvedIds: [ids.gundren!] })
    expect(quest.status).toBe('active')
    expect(quest.reward).toBe('10 gp each')
    expect(quest.involved.map(e => e.name)).toEqual(['Gundren'])
    expect(() => updateQuest(db, ids.quest!, { status: 'nope' as never })).toThrow(QuestInputError)
    expect(() => updateQuest(db, ids.quest!, { name: '  ' })).toThrow(QuestInputError)
  })

  it('lists quests of a campaign only, and soft-deletes', () => {
    const second = createQuest(db, campaignId, { name: 'Redbrand trouble' })
    expect(listQuests(db, campaignId).map(q => q.name).sort()).toEqual(['Find Gundren', 'Redbrand trouble'])
    expect(listQuests(db, otherCampaignId)).toEqual([])
    expect(deleteQuest(db, second.id)).toBe(true)
    expect(getQuest(db, second.id)).toBeNull()
    // Only quests can be deleted through this
    expect(deleteQuest(db, ids.gundren!)).toBe(false)
  })

  it('offers linkable entities including quests', () => {
    const names = listLinkable(db, campaignId).map(e => `${e.type}:${e.name}`)
    expect(names).toContain('NPC:Gundren')
    expect(names).toContain('Quest:Find Gundren')
    expect(names).not.toContain('NPC:Stranger')
  })

  it('records continuity items on sessions and resolves them', () => {
    const promise = createContinuityItem(db, campaignId, {
      sessionId: ids.s2,
      kind: 'promise',
      text: 'Promised Sildar to escort him to Phandalin',
      nextSession: true,
      entityIds: [ids.sildar!],
    })
    expect(promise).toMatchObject({
      sessionTitle: 'Cragmaw',
      kind: 'promise',
      status: 'open',
      nextSession: true,
      entities: [{ id: ids.sildar, name: 'Sildar', type: 'NPC' }],
    })
    const death = createContinuityItem(db, campaignId, { sessionId: ids.s2, kind: 'consequence', text: 'Klarg is dead', entityIds: [ids.klarg!] })

    expect(listContinuity(db, campaignId, { sessionId: ids.s2 })).toHaveLength(2)
    expect(listContinuity(db, campaignId, { status: 'open' })[0]?.id).toBe(promise.id) // next-session items first
    expect(listContinuity(db, campaignId, { entityId: ids.klarg }).map(i => i.id)).toEqual([death.id])

    const resolved = updateContinuityItem(db, promise.id, { status: 'resolved' })
    expect(resolved).toMatchObject({ status: 'resolved', nextSession: false })
    expect(resolved.resolvedAt).not.toBeNull()
    expect(listContinuity(db, campaignId, { status: 'open' }).map(i => i.id)).toEqual([death.id])

    const reopened = updateContinuityItem(db, promise.id, { status: 'open', text: 'Escort Sildar', entityIds: [] })
    expect(reopened).toMatchObject({ status: 'open', text: 'Escort Sildar', entities: [], resolvedAt: null })

    expect(deleteContinuityItem(db, death.id)).toBe(true)
    expect(deleteContinuityItem(db, death.id)).toBe(false)
  })

  it('validates continuity input', () => {
    expect(() => createContinuityItem(db, campaignId, { kind: 'thread', text: ' ' })).toThrow(QuestInputError)
    expect(() => createContinuityItem(db, campaignId, { kind: 'gossip' as never, text: 'x' })).toThrow(QuestInputError)
    // A session from another campaign is refused
    const foreign = Number(
      db.prepare('INSERT INTO sessions (campaign_id, title) VALUES (?, ?)').run(otherCampaignId, 'Elsewhere').lastInsertRowid,
    )
    expect(() => createContinuityItem(db, campaignId, { text: 'x', sessionId: foreign })).toThrow('Session not found')
  })

  it('finds the last session each NPC appeared in, oldest first', () => {
    const mention = db.prepare('INSERT INTO session_mentions (session_id, entity_id) VALUES (?, ?)')
    mention.run(ids.s1, ids.gundren)
    mention.run(ids.s1, ids.sildar)
    mention.run(ids.s3, ids.sildar)
    mention.run(ids.s2, ids.klarg)
    mention.run(ids.s2, ids.cragmaw) // not an NPC
    expect(listLastMet(db, campaignId).map(r => [r.entity.name, r.sessionTitle, r.sessionsAgo])).toEqual([
      ['Gundren', 'Goblin Arrows', 2],
      ['Klarg', 'Cragmaw', 1],
      ['Sildar', 'Phandalin', 0],
    ])
  })

  it('routes all endpoints through one handler', () => {
    const call = (method: string, path: string, query: Record<string, unknown> = {}, body: Record<string, unknown> | null = null) =>
      handleQuestRequest(db, { method, segments: path.split('/').filter(Boolean), query, body })
    const created = call('POST', '', {}, { campaignId, name: 'Rescue Sildar' }) as { id: number, name: string }
    expect(created.name).toBe('Rescue Sildar')
    expect(call('GET', `${created.id}`)).toMatchObject({ name: 'Rescue Sildar' })
    expect(call('PATCH', `${created.id}`, {}, { status: 'done' })).toMatchObject({ status: 'done' })
    expect((call('GET', '', { campaignId }) as unknown[]).length).toBeGreaterThan(0)
    expect((call('GET', 'linkable', { campaignId }) as unknown[]).length).toBeGreaterThan(0)
    expect(call('GET', 'last-met', { campaignId })).toHaveLength(3)

    const item = call('POST', 'continuity', {}, { campaignId, sessionId: ids.s3, kind: 'debt', text: 'Owe Halia a favour' }) as { id: number }
    expect(call('GET', 'continuity', { campaignId, sessionId: ids.s3 })).toHaveLength(1)
    expect(call('PATCH', `continuity/${item.id}`, {}, { status: 'resolved' })).toMatchObject({ status: 'resolved' })
    expect(call('DELETE', `continuity/${item.id}`)).toEqual({ success: true })

    const status = (fn: () => unknown) => {
      try {
        fn()
      }
      catch (error) {
        return error instanceof QuestRouteError ? error.statusCode : 'other'
      }
      return 'ok'
    }
    expect(status(() => call('GET', ''))).toBe(400) // campaignId missing
    expect(status(() => call('PATCH', `${created.id}`, {}, { status: 'nope' }))).toBe(400)
    expect(status(() => call('GET', '999999'))).toBe(404)
    expect(status(() => call('DELETE', `continuity/${item.id}`))).toBe(404)
    expect(status(() => call('GET', 'nope/at/all'))).toBe(404)
    expect(status(() => call('PUT', ''))).toBe(404)
  })
})

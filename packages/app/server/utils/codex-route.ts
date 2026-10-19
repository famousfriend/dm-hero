import type { H3Event } from 'h3'
import { getDb } from './db'
import { getLinkOwnerCampaign, type CodexLinkOwnerType } from './codex'

const OWNER_TYPES: CodexLinkOwnerType[] = ['entity', 'encounter']

/** Owner of a /api/codex/links request (query or body); 404 when it does not exist. */
export function requireLinkOwner(event: H3Event, input: Record<string, unknown>) {
  const ownerType = input.ownerType as CodexLinkOwnerType
  const ownerId = Number(input.ownerId)
  if (!OWNER_TYPES.includes(ownerType) || !Number.isInteger(ownerId) || ownerId <= 0) {
    throw createError({ statusCode: 400, message: 'ownerType and ownerId are required' })
  }
  const campaignId = getLinkOwnerCampaign(getDb(), ownerType, ownerId)
  if (campaignId === null) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }
  return { ownerType, ownerId, campaignId }
}

import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../../app/utils/escapeHtml'

describe('escapeHtml', () => {
  it('escapes markup in entity names', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(escapeHtml('Tom & Jerry\'s')).toBe('Tom &amp; Jerry&#39;s')
  })

  it('turns null into an empty string', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import { isCrossSiteWrite } from '../../server/utils/origin-check'

describe('isCrossSiteWrite', () => {
  const host = '127.0.0.1:3456'

  it.each([
    ['GET from another site', { method: 'GET', origin: 'https://evil.example', host }, false],
    ['POST from the app itself', { method: 'POST', origin: 'http://127.0.0.1:3456', host }, false],
    ['POST without Origin (MCP server, Electron main, curl)', { method: 'POST', host }, false],
    ['POST form from another site', { method: 'POST', origin: 'https://evil.example', host }, true],
    ['DELETE from another site', { method: 'DELETE', origin: 'https://evil.example', host }, true],
    ['POST flagged cross-site by the browser', { method: 'POST', secFetchSite: 'cross-site', host }, true],
    ['POST from a sandboxed frame (Origin: null)', { method: 'POST', origin: 'null', host }, true],
    ['POST from same host on another port', { method: 'POST', origin: 'http://127.0.0.1:3000', host }, true],
    ['POST behind a reverse proxy', { method: 'POST', origin: 'https://dm.example.com', host: 'localhost:3000', forwardedHost: 'dm.example.com' }, false],
    ['POST from an explicitly allowed origin', { method: 'POST', origin: 'https://other.example', host, allowedOrigins: ['https://other.example'] }, false],
  ])('%s', (_label, input, expected) => {
    expect(isCrossSiteWrite(input)).toBe(expected)
  })
})

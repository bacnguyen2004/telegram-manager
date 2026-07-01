import { describe, expect, it } from 'vitest'
import { parseTelegramLink } from './telegramLink'

describe('parseTelegramLink', () => {
  it('parses public post links', () => {
    const parsed = parseTelegramLink('https://t.me/cexalerts/12345')
    expect(parsed.kind).toBe('post')
    expect(parsed.peerId).toBe('@cexalerts')
    expect(parsed.messageId).toBe(12345)
    expect(parsed.supportedActions).toContain('react')
  })

  it('parses private channel post links', () => {
    const parsed = parseTelegramLink('https://t.me/c/1234567890/42')
    expect(parsed.kind).toBe('post')
    expect(parsed.peerId).toBe('-1001234567890')
    expect(parsed.messageId).toBe(42)
  })

  it('parses invite links', () => {
    const parsed = parseTelegramLink('https://t.me/+AbCdEfGh')
    expect(parsed.kind).toBe('invite')
    expect(parsed.supportedActions).toEqual(['join'])
  })

  it('parses group username links', () => {
    const parsed = parseTelegramLink('https://t.me/example_group')
    expect(parsed.kind).toBe('group')
    expect(parsed.peerId).toBe('@example_group')
    expect(parsed.supportedActions).toContain('join')
    expect(parsed.supportedActions).toContain('send')
  })
})
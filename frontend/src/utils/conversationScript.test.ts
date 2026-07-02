import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_TEMPLATE,
  effectiveConversationScript,
  isDefaultConversationTemplate,
  pickUnusedPhoneFromList,
  sessionOptionsForSpeaker,
} from './conversationScript'

describe('sessionOptionsForSpeaker', () => {
  const sessions = ['+84111', '+84222', '+84333']

  it('hides phones used by other speakers', () => {
    expect(sessionOptionsForSpeaker(sessions, ['+84111'], '')).toEqual(['+84222', '+84333'])
  })

  it('keeps current phone visible for the active row', () => {
    expect(sessionOptionsForSpeaker(sessions, ['+84111'], '+84222')).toEqual([
      '+84222',
      '+84333',
    ])
  })
})

describe('effectiveConversationScript', () => {
  it('falls back to template when script text is empty', () => {
    expect(effectiveConversationScript('')).toBe(CONVERSATION_TEMPLATE)
    expect(effectiveConversationScript('   ')).toBe(CONVERSATION_TEMPLATE)
  })

  it('keeps user pasted content', () => {
    expect(effectiveConversationScript('Person A: hello')).toBe('Person A: hello')
  })
})

describe('isDefaultConversationTemplate', () => {
  it('detects saved default template', () => {
    expect(isDefaultConversationTemplate(CONVERSATION_TEMPLATE)).toBe(true)
    expect(isDefaultConversationTemplate(`  ${CONVERSATION_TEMPLATE}  `)).toBe(true)
    expect(isDefaultConversationTemplate('Person A: custom')).toBe(false)
  })
})

describe('pickUnusedPhoneFromList', () => {
  it('returns first unused session phone', () => {
    expect(pickUnusedPhoneFromList(['+84111', '+84222'], ['+84111'])).toBe('+84222')
  })
})
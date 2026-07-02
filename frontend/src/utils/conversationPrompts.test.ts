import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_PROMPT_MULTI_CRYPTO,
  analyzeConversationPrompt,
  applyPromptVariables,
  buildConversationPrompt,
  buildDefaultCryptoPrompt,
  buildFormatExamples,
  buildSpeakerBlock,
  resolveConversationPrompt,
} from './conversationPrompts'

describe('applyPromptVariables', () => {
  it('replaces placeholders in crypto template', () => {
    const rendered = applyPromptVariables(CONVERSATION_PROMPT_MULTI_CRYPTO, {
      messageCount: 150,
      speakerCount: 4,
      mode: 'multi',
    })
    expect(rendered).toContain('Exactly 150 messages total')
    expect(rendered).toContain('Use exactly 4 speakers total')
    expect(rendered).toContain('Person A\nPerson B\nPerson C\nPerson D')
    expect(rendered).not.toContain('{{message_count}}')
  })

  it('syncs hardcoded counts in pasted custom prompt', () => {
    const pasted = `Exactly 120 messages total.
Use exactly 3 speakers total.
Use speaker names exactly:
Person A
Person B
Person C

Do not use speakers outside Person A, Person B, Person C.`

    const updated = applyPromptVariables(pasted, {
      messageCount: 200,
      speakerCount: 5,
      mode: 'multi',
    })

    expect(updated).toContain('Exactly 200 messages total')
    expect(updated).toContain('Use exactly 5 speakers total')
    expect(updated).toContain('Person E')
    expect(updated).toContain('Person A, Person B, Person C, Person D, Person E')
  })

  it('buildSpeakerBlock scales with count', () => {
    expect(buildSpeakerBlock(4)).toContain('Person D')
    expect(buildSpeakerBlock(6)).toContain('Person F')
  })

  it('buildFormatExamples includes all speakers for count 4', () => {
    const examples = buildFormatExamples(4)
    expect(examples).toContain('#1 Person A: message')
    expect(examples).toContain('#2 Person B: message')
    expect(examples).toContain('#3 Person C reply_to #1: message')
    expect(examples).toContain('#4 Person D: message')
  })
})

describe('buildDefaultCryptoPrompt', () => {
  it('returns crypto multi prompt with defaults', () => {
    const prompt = buildDefaultCryptoPrompt()
    expect(prompt).toContain('Search the web')
    expect(prompt).toContain('Exactly 120 messages total')
    expect(prompt).toContain('Use exactly 4 speakers total')
  })

  it('returns two-person prompt when mode is two', () => {
    const prompt = buildDefaultCryptoPrompt({ mode: 'two', messageCount: 80 })
    expect(prompt).not.toContain('Search the web')
    expect(prompt).toContain('Speakers only: Person A, Person B')
    expect(prompt).toContain('Exactly 80 messages total')
    expect(prompt).toContain('#1 Person A: message')
    expect(prompt).toContain('#2 Person B: message')
    expect(prompt).not.toContain('Person C')
  })
})

describe('resolveConversationPrompt', () => {
  it('uses placeholder when prompt text is empty', () => {
    const placeholder = buildDefaultCryptoPrompt({ messageCount: 90, speakerCount: 3 })
    const resolved = resolveConversationPrompt({
      promptText: '',
      placeholder,
      messageCount: 90,
      speakerCount: 3,
      mode: 'multi',
    })
    expect(resolved).toBe(placeholder)
    expect(resolved).toContain('Exactly 90 messages total')
  })

  it('syncs override prompt with updated counts', () => {
    const override = `Exactly 120 messages total.
Use exactly 4 speakers total.
Search the web for crypto news.`
    const resolved = resolveConversationPrompt({
      promptText: override,
      placeholder: buildDefaultCryptoPrompt(),
      messageCount: 150,
      speakerCount: 5,
      mode: 'multi',
    })
    expect(resolved).toContain('Exactly 150 messages total')
    expect(resolved).toContain('Use exactly 5 speakers total')
  })
})

describe('analyzeConversationPrompt', () => {
  it('detects crypto prompt traits', () => {
    const prompt = buildDefaultCryptoPrompt({ messageCount: 100, speakerCount: 4 })
    const analysis = analyzeConversationPrompt(prompt, {
      messageCount: 100,
      speakerCount: 4,
      usesPlaceholder: true,
    })
    expect(analysis.usesWebSearch).toBe(true)
    expect(analysis.speakerNames).toEqual([
      'Person A',
      'Person B',
      'Person C',
      'Person D',
    ])
    expect(analysis.formatExamples).toContain('#4 Person D: message')
    expect(analysis.hasConsecutiveLimit).toBe(true)
  })
})

describe('buildConversationPrompt', () => {
  it('renders multi crypto variant with requested counts', () => {
    const prompt = buildConversationPrompt({
      mode: 'multi',
      style: 'flexible',
      messageCount: 80,
      speakerCount: 4,
      variant: 'crypto',
    })
    expect(prompt).toContain('Exactly 80 messages total')
    expect(prompt).toContain('Use exactly 4 speakers total')
    expect(prompt).toContain('Search the web')
    expect(prompt).toContain('#4 Person D: message')
  })
})
export type ConversationPromptStyle = 'fixed' | 'flexible'

export const PROMPT_PLACEHOLDER_MESSAGE_COUNT = '{{message_count}}'
export const PROMPT_PLACEHOLDER_SPEAKER_COUNT = '{{speaker_count}}'
export const PROMPT_PLACEHOLDER_SPEAKER_NAMES = '{{speaker_names}}'
export const PROMPT_PLACEHOLDER_SPEAKER_BLOCK = '{{speaker_block}}'
export const PROMPT_PLACEHOLDER_FORMAT_EXAMPLES = '{{format_examples}}'

export const CONVERSATION_PROMPT_TWO_FLEXIBLE = `Create a natural two-person crypto chat conversation.

Speakers only: Person A, Person B
Exactly ${PROMPT_PLACEHOLDER_MESSAGE_COUNT} messages total. Number every line.

Format:
${PROMPT_PLACEHOLDER_FORMAT_EXAMPLES}

Rules:
- Casual Telegram chat, natural human behavior
- Maximum 4 consecutive messages from one speaker
- 1 to 18 words per message
- Use reply_to only when appropriate
- No emojis, hashtags, markdown, or links`

export const CONVERSATION_PROMPT_TWO_FIXED = `Create a natural two-person crypto chat conversation.

Speakers only: Person A, Person B
Exactly ${PROMPT_PLACEHOLDER_MESSAGE_COUNT} messages total (15 rounds, 4 messages per speaker per round).

Format:
Round 1
Person A: ...
Person A: ...
Person A: ...
Person A: ...
Person B: ...
`

export const CONVERSATION_PROMPT_MULTI_CRYPTO = `Create a natural multi-person crypto group chat conversation.

Before generating the conversation:

* Search the web for the latest crypto market information available right now
* Use only information published within the last 24 hours whenever possible
* Verify current BTC, ETH, SOL, major altcoin, ETF, liquidity, macro, regulatory, and sentiment context before writing
* Do not invent prices, news, ETF flows, market moves, or regulatory events
* If exact live prices are unavailable, use approximate wording:

  * BTC around current levels
  * ETH near current range
  * SOL near recent levels

* Only mention prices, ETF activity, support, resistance, or news if supported by the latest available data
* News references should feel casual and conversational, not like headlines

Speakers:

${PROMPT_PLACEHOLDER_SPEAKER_BLOCK}

Style:

* Casual Telegram group chat
* Natural human behavior
* Some people talk more than others
* Some people barely appear
* Sometimes agree
* Sometimes disagree
* Sometimes confused
* Sometimes complain
* Sometimes joke lightly
* Sometimes change topic abruptly
* Sometimes overreact
* Sometimes say random observations
* Not every message needs useful information
* Each speaker should feel like a different real group member
* Do not make all speakers have the same tone
* Give speakers different natural habits, but do not label those habits
* One speaker can be impatient, emotional, or dramatic sometimes
* One speaker can be skeptical, quiet, or dry sometimes
* One speaker can joke, complain, or disappear for many lines
* One speaker can enter late or only react briefly
* Let people ignore some messages or answer only part of what was said
* Some lines can be blunt, incomplete, confused, or slightly off-topic
* Small human filler is okay when natural: yeah, maybe, idk, same, wait
* Do not sound like analysts, journalists, educators, researchers, or AI assistants
* No motivational tone
* No trading advice

Message rules:

* Exactly ${PROMPT_PLACEHOLDER_MESSAGE_COUNT} messages total
* Number every line
* Format:

${PROMPT_PLACEHOLDER_FORMAT_EXAMPLES}

* Use reply_to only when appropriate
* Not every message should be a reply
* Sometimes reply to older messages instead of the latest one
* Sometimes continue without reply_to

Flow rules:

* Uneven participation
* One speaker may send:

  * 1 message
  * 2 messages
  * 3 messages
  * 4 messages
    before another speaker talks
* Maximum 4 consecutive messages from one speaker
* Never output 5 or more consecutive messages from the same speaker
* Count consecutive speaker lines carefully before finalizing
* Mix 1-message turns, 2-message turns, 3-message bursts, and 4-message bursts
* Avoid predictable rotation like A-B-C-A-B-C
* Avoid clean ping-pong for long stretches
* Let the group feel random and organic
* Do not force every speaker into every topic
* Do not make every message perfectly answer the previous one
* Let some messages feel like someone typing thoughts in pieces
* Let a speaker sometimes reply late to something older

Message length:

* 1 to 18 words
* Normal casual English
* Slight imperfect grammar allowed
* Start every message with an uppercase letter
* Keep crypto tickers uppercase, like BTC, ETH, SOL, BNB, XRP, USDT
* No emojis
* No hashtags
* No markdown
* No links
* No promotional language
* No full stop at the end of messages

Important:

Use real crypto market context verified immediately before generation.

Never use stale market narratives.

Never generate fictional news, fictional ETF flows, fictional prices, or fictional market conditions.`

export function defaultMultiSpeakerNames(count: number): string[] {
  return Array.from({ length: Math.max(2, Math.min(count, 10)) }, (_, index) => {
    const letter = String.fromCharCode(65 + index)
    return `Person ${letter}`
  })
}

export function buildFormatExamples(speakerCount: number): string {
  const names = defaultMultiSpeakerNames(Math.max(2, Math.min(speakerCount, 10)))
  const third = names[2] ?? names[0]
  const fourth = names[3] ?? names[1] ?? names[0]
  return [
    `#1 ${names[0]}: message`,
    `#2 ${names[1] ?? names[0]}: message`,
    `#3 ${third} reply_to #1: message`,
    `#4 ${fourth}: message`,
  ].join('\n')
}

export function buildSpeakerBlock(speakerCount: number): string {
  const names = defaultMultiSpeakerNames(speakerCount)
  const namesCsv = names.join(', ')
  return [
    `Use exactly ${speakerCount} speakers total.`,
    'Use speaker names exactly:',
    ...names,
    '',
    `Do not use speakers outside ${namesCsv}.`,
    'Always write speaker names with a space.',
    'Never write PersonA or PersonB.',
  ].join('\n')
}

export function applyPromptVariables(
  text: string,
  options: {
    messageCount: number
    speakerCount: number
    mode: 'two' | 'multi'
  },
): string {
  const speakerCount = options.mode === 'two' ? 2 : options.speakerCount
  const names = defaultMultiSpeakerNames(speakerCount)
  const namesCsv = names.join(', ')
  const formatExamples = buildFormatExamples(speakerCount)

  let result = text
    .replaceAll(PROMPT_PLACEHOLDER_MESSAGE_COUNT, String(options.messageCount))
    .replaceAll(PROMPT_PLACEHOLDER_SPEAKER_COUNT, String(speakerCount))
    .replaceAll(PROMPT_PLACEHOLDER_SPEAKER_NAMES, namesCsv)
    .replaceAll(PROMPT_PLACEHOLDER_SPEAKER_BLOCK, buildSpeakerBlock(speakerCount))
    .replaceAll(PROMPT_PLACEHOLDER_FORMAT_EXAMPLES, formatExamples)

  result = result.replace(
    /Exactly\s+\d+\s+messages?\s+total/gi,
    `Exactly ${options.messageCount} messages total`,
  )
  result = result.replace(
    /Use exactly\s+\d+\s+speakers?\s+total/gi,
    `Use exactly ${speakerCount} speakers total`,
  )
  result = result.replace(
    /Do not use speakers outside [^\n.]+/gi,
    `Do not use speakers outside ${namesCsv}`,
  )

  const speakerLinesPattern = /(Use speaker names exactly:\s*\n)((?:Person [A-Z]\s*\n)+)/
  if (speakerLinesPattern.test(result)) {
    result = result.replace(
      speakerLinesPattern,
      `$1${names.map((name) => `${name}\n`).join('')}`,
    )
  }

  if (options.mode === 'two') {
    result = result.replace(
      /Speakers only:\s*[^\n]+/i,
      'Speakers only: Person A, Person B',
    )
  } else {
    result = result.replace(/Speakers only:\s*[^\n]+/i, `Speakers only: ${namesCsv}`)
  }

  const formatBlockPattern =
    /#1\s+Person\s+[A-Z]:\s+message\s*\n#2\s+Person\s+[A-Z]:\s+message\s*\n#3\s+Person\s+[A-Z](?:\s+reply_to\s+#\d+)?:\s+message(?:\s*\n#4\s+Person\s+[A-Z]:\s+message)?/g
  if (formatBlockPattern.test(result)) {
    result = result.replace(formatBlockPattern, formatExamples)
  }

  return result
}

export function buildConversationPrompt(options: {
  mode: 'two' | 'multi'
  style: ConversationPromptStyle
  messageCount: number
  speakerCount: number
  variant?: 'simple' | 'crypto'
}): string {
  const template =
    options.mode === 'multi' && options.variant === 'crypto'
      ? CONVERSATION_PROMPT_MULTI_CRYPTO
      : options.mode === 'multi'
        ? `Create a natural multi-person group chat conversation.

Speakers only: ${PROMPT_PLACEHOLDER_SPEAKER_NAMES}
Exactly ${PROMPT_PLACEHOLDER_MESSAGE_COUNT} messages total. Number every line.

Format:
${PROMPT_PLACEHOLDER_FORMAT_EXAMPLES}

Rules:
- Casual Telegram chat
- Maximum 4 consecutive messages from one speaker
- Use reply_to markers when appropriate`
        : options.style === 'fixed'
          ? CONVERSATION_PROMPT_TWO_FIXED
          : CONVERSATION_PROMPT_TWO_FLEXIBLE

  return applyPromptVariables(template, {
    messageCount: options.messageCount,
    speakerCount: options.speakerCount,
    mode: options.mode,
  })
}

export function buildDefaultCryptoPrompt(
  options: {
    messageCount?: number
    speakerCount?: number
    mode?: 'two' | 'multi'
  } = {},
): string {
  const mode = options.mode ?? 'multi'
  const speakerCount = mode === 'two' ? 2 : (options.speakerCount ?? 4)
  return buildConversationPrompt({
    mode,
    style: 'flexible',
    messageCount: options.messageCount ?? 120,
    speakerCount,
    variant: mode === 'multi' ? 'crypto' : undefined,
  })
}

export interface ConversationPromptAnalysis {
  messageCount: number
  speakerCount: number
  speakerNames: string[]
  formatExamples: string
  usesWebSearch: boolean
  usesPlaceholder: boolean
  charCount: number
  lineCount: number
  hasReplyRules: boolean
  hasConsecutiveLimit: boolean
}

export function resolveConversationPrompt(options: {
  promptText: string
  placeholder: string
  messageCount: number
  speakerCount: number
  mode: 'two' | 'multi'
}): string {
  const trimmed = options.promptText.trim()
  if (!trimmed) return options.placeholder
  return applyPromptVariables(trimmed, {
    messageCount: options.messageCount,
    speakerCount: options.speakerCount,
    mode: options.mode,
  })
}

export function analyzeConversationPrompt(
  prompt: string,
  options: {
    messageCount: number
    speakerCount: number
    usesPlaceholder: boolean
  },
): ConversationPromptAnalysis {
  const speakerCount = Math.max(2, Math.min(options.speakerCount, 10))
  return {
    messageCount: options.messageCount,
    speakerCount,
    speakerNames: defaultMultiSpeakerNames(speakerCount),
    formatExamples: buildFormatExamples(speakerCount),
    usesWebSearch: /search the web/i.test(prompt),
    usesPlaceholder: options.usesPlaceholder,
    charCount: prompt.length,
    lineCount: prompt.split(/\r?\n/).length,
    hasReplyRules: /reply_to/i.test(prompt),
    hasConsecutiveLimit: /maximum\s+4\s+consecutive/i.test(prompt),
  }
}
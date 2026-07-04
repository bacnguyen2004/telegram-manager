import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_TEMPLATE,
  buildMultiSpeakersFromDetected,
  effectiveConversationScript,
  isDefaultConversationTemplate,
  pickUnusedPhoneFromList,
  sessionOptionsForSpeaker,
  speakersMissingFromConfig,
  summarizeParseIssueMessages,
  summarizeParseIssues,
  summarizePreviewLineStats,
  deckLogShowMeta,
  formatDeckLogMeta,
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

describe('speakersMissingFromConfig', () => {
  it('finds speakers present in script but not configured', () => {
    const script = '#1 Person A: hi\n#2 Person D: wait'
    const speakers = [
      { id: 'a', label: 'Person A', phone: '+84111' },
      { id: 'b', label: 'Person B', phone: '+84222' },
      { id: 'c', label: 'Person C', phone: '+84333' },
    ]
    expect(speakersMissingFromConfig(script, speakers)).toEqual(['Person D'])
  })
})

describe('buildMultiSpeakersFromDetected', () => {
  it('keeps phones for known speakers and assigns unused sessions', () => {
    const rows = buildMultiSpeakersFromDetected(
      ['Person A', 'Person D'],
      [
        { speaker: 'Person A', phone: '+84111' },
        { speaker: 'Person B', phone: '+84222' },
      ],
      ['+84111', '+84222', '+84333'],
    )
    expect(rows).toEqual([
      { speaker: 'Person A', phone: '+84111' },
      { speaker: 'Person D', phone: '+84222' },
    ])
  })
})

describe('summarizeParseIssues', () => {
  it('groups skipped unknown speaker lines', () => {
    const summary = summarizeParseIssues([
      {
        level: 'error',
        code: 'skipped_line',
        message: 'Dong #7 (Person D) bi bo qua — khong nhan dien duoc vai',
        line_id: 7,
      },
      {
        level: 'error',
        code: 'skipped_line',
        message: 'Dong #14 (Person D) bi bo qua — khong nhan dien duoc vai',
        line_id: 14,
      },
      {
        level: 'warning',
        code: 'missing_reply',
        message: 'Dong #129 reply_to #128 khong ton tai',
        line_id: 129,
      },
    ])
    expect(summary).toEqual([
      {
        message:
          '2 dòng bị bỏ qua — vai "Person D" chưa được cấu hình (bấm Tách nội dung để tự nhận diện)',
        line_id: 7,
      },
      {
        message: 'Dong #129 reply_to #128 khong ton tai',
        line_id: 129,
      },
    ])
    expect(summarizeParseIssueMessages([
      {
        level: 'error',
        code: 'skipped_line',
        message: 'Dong #7 (Person D) bi bo qua — khong nhan dien duoc vai',
        line_id: 7,
      },
    ])).toEqual([
      '1 dòng bị bỏ qua — vai "Person D" chưa được cấu hình (bấm Tách nội dung để tự nhận diện)',
    ])
  })
})

describe('deckLogShowMeta', () => {
  it('hides generic success meta but keeps errors and delays', () => {
    expect(
      deckLogShowMeta({
        lineId: 1,
        speakerLabel: 'A',
        phone: '+84111',
        message: 'Hi',
        status: 'success',
        detail: 'Da gui tin nhan · TG #1',
      }),
    ).toBe(false)

    expect(
      deckLogShowMeta({
        lineId: 2,
        speakerLabel: 'B',
        phone: '+84222',
        message: 'Yo',
        status: 'error',
        detail: 'Flood wait 30s',
      }),
    ).toBe(true)

    expect(
      deckLogShowMeta({
        lineId: 3,
        speakerLabel: 'A',
        phone: '+84111',
        message: 'Wait',
        status: 'pending',
        detail: 'Cho delay (8s) — cung nguoi',
      }),
    ).toBe(true)
  })
})

describe('formatDeckLogMeta', () => {
  it('shows phone, telegram id, and reply context for successful sends', () => {
    expect(
      formatDeckLogMeta({
        lineId: 2,
        speakerLabel: 'Person B',
        phone: '+84902222222',
        message: 'Hello',
        status: 'success',
        detail: 'Tra loi dong #1 · Da tra loi tin nhan · TG #105 · Reply TG #99',
        messageId: 105,
        replyToMsgId: 99,
        replyToLineId: 1,
      }),
    ).toBe(
      '+84902222222 · Trả lời dòng #1 · Đã trả lời tin nhắn · TG #105 · Reply TG #99',
    )
  })

  it('humanizes running, skipped, and error states', () => {
    expect(
      formatDeckLogMeta({
        lineId: 3,
        speakerLabel: 'A',
        phone: '+84111',
        message: 'Wait',
        status: 'running',
        detail: 'Dang go (4s)... · Tra loi dong #2',
        replyToLineId: 2,
      }),
    ).toBe('+84111 · Đang gõ (4s)… · Trả lời dòng #2')

    expect(
      formatDeckLogMeta({
        lineId: 1,
        speakerLabel: 'A',
        phone: '',
        message: 'Old',
        status: 'skipped',
        detail: 'Bo qua — chay tu dong #4',
      }),
    ).toBe('Bỏ qua — chạy từ dòng #4')

    expect(
      formatDeckLogMeta({
        lineId: 4,
        speakerLabel: 'B',
        phone: '+84222',
        message: 'Fail',
        status: 'error',
        detail: 'Flood wait 30s · Reply TG #88',
        replyToMsgId: 88,
      }),
    ).toBe('+84222 · Flood wait 30s · Reply TG #88')
  })

  it('shows inter-line delay while next line is pending', () => {
    expect(
      formatDeckLogMeta({
        lineId: 3,
        speakerLabel: 'B',
        phone: '+84222',
        message: 'Next',
        status: 'pending',
        detail: 'Cho delay (12s) — doi nguoi',
      }),
    ).toBe('+84222 · Chờ delay 12s · đổi người')
  })

  it('keeps typing duration on successful lines', () => {
    expect(
      formatDeckLogMeta({
        lineId: 2,
        speakerLabel: 'A',
        phone: '+84111',
        message: 'Hi',
        status: 'success',
        detail: 'Da gui tin nhan · Go 4s · TG #88',
        messageId: 88,
      }),
    ).toBe('+84111 · Đã gửi tin nhắn · Đã gõ 4s · TG #88')
  })
})

describe('summarizePreviewLineStats', () => {
  it('counts actionable, done, and skipped lines separately', () => {
    expect(
      summarizePreviewLineStats([
        {
          lineId: 1,
          scriptRef: 1,
          round: '',
          speakerLabel: 'A',
          speakerId: 'a',
          phone: '+84111',
          message: 'one',
          replyTo: null,
          status: 'success',
          detail: '',
        },
        {
          lineId: 2,
          scriptRef: 2,
          round: '',
          speakerLabel: 'B',
          speakerId: 'b',
          phone: '+84222',
          message: 'two',
          replyTo: null,
          status: 'skipped',
          detail: '',
        },
        {
          lineId: 3,
          scriptRef: 3,
          round: '',
          speakerLabel: 'A',
          speakerId: 'a',
          phone: '+84111',
          message: 'three',
          replyTo: null,
          status: 'pending',
          detail: '',
        },
        {
          lineId: 4,
          scriptRef: 4,
          round: '',
          speakerLabel: 'B',
          speakerId: 'b',
          phone: '+84222',
          message: 'four',
          replyTo: null,
          status: 'error',
          detail: 'fail',
        },
      ]),
    ).toEqual({
      total: 4,
      todo: 1,
      live: 0,
      done: 1,
      skip: 1,
      fail: 1,
      actionable: 2,
    })
  })
})
export type TaskAction = 'join' | 'react' | 'reply' | 'send'

export interface ParsedTelegramLink {
  raw: string
  kind: 'post' | 'group' | 'invite' | 'invalid'
  peerId: string
  messageId: number | null
  groupLink: string
  label: string
  supportedActions: TaskAction[]
}

const PUBLIC_POST_RE = /(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]+)\/(\d+)\/?$/i
const PRIVATE_POST_RE = /(?:https?:\/\/)?t\.me\/c\/(\d+)\/(\d+)\/?$/i
const INVITE_RE = /(?:https?:\/\/)?t\.me\/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)\/?$/i
const GROUP_RE = /(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]+)\/?$/i

function normalizeLinkInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('t.me/')) return `https://${trimmed}`
  if (trimmed.startsWith('@')) return `https://t.me/${trimmed.slice(1)}`
  return trimmed
}

export function parseTelegramLink(raw: string): ParsedTelegramLink {
  const normalized = normalizeLinkInput(raw)
  const invalid = (label: string): ParsedTelegramLink => ({
    raw: normalized,
    kind: 'invalid',
    peerId: '',
    messageId: null,
    groupLink: normalized,
    label,
    supportedActions: [],
  })

  if (!normalized) {
    return invalid('Chưa nhập link')
  }

  const privateMatch = normalized.match(PRIVATE_POST_RE)
  if (privateMatch) {
    const channelId = privateMatch[1]
    const messageId = Number(privateMatch[2])
    const peerId = `-100${channelId}`
    return {
      raw: normalized,
      kind: 'post',
      peerId,
      messageId,
      groupLink: normalized,
      label: `Post riêng tư · peer ${peerId} · msg #${messageId}`,
      supportedActions: ['react', 'reply'],
    }
  }

  const publicMatch = normalized.match(PUBLIC_POST_RE)
  if (publicMatch) {
    const username = publicMatch[1]
    const messageId = Number(publicMatch[2])
    if (username === 'c') return invalid('Link không hợp lệ')
    const peerId = `@${username}`
    return {
      raw: normalized,
      kind: 'post',
      peerId,
      messageId,
      groupLink: `https://t.me/${username}`,
      label: `@${username} · post #${messageId}`,
      supportedActions: ['react', 'reply'],
    }
  }

  const inviteMatch = normalized.match(INVITE_RE)
  if (inviteMatch) {
    const hash = inviteMatch[1]
    const groupLink = `https://t.me/+${hash}`
    return {
      raw: normalized,
      kind: 'invite',
      peerId: groupLink,
      messageId: null,
      groupLink,
      label: `Invite link · +${hash}`,
      supportedActions: ['join'],
    }
  }

  const groupMatch = normalized.match(GROUP_RE)
  if (groupMatch) {
    const username = groupMatch[1]
    const groupLink = `https://t.me/${username}`
    return {
      raw: normalized,
      kind: 'group',
      peerId: `@${username}`,
      messageId: null,
      groupLink,
      label: `@${username}`,
      supportedActions: ['join', 'send'],
    }
  }

  if (/^-?\d+$/.test(normalized)) {
    return {
      raw: normalized,
      kind: 'group',
      peerId: normalized,
      messageId: null,
      groupLink: normalized,
      label: `Peer ID ${normalized}`,
      supportedActions: ['send'],
    }
  }

  if (normalized.startsWith('@')) {
    const peerId = normalized
    return {
      raw: normalized,
      kind: 'group',
      peerId,
      messageId: null,
      groupLink: `https://t.me/${normalized.slice(1)}`,
      label: peerId,
      supportedActions: ['join', 'send'],
    }
  }

  return invalid('Không nhận dạng được link Telegram')
}

export function actionLabel(action: TaskAction): string {
  const map: Record<TaskAction, string> = {
    join: 'Join group',
    react: 'Thả reaction',
    reply: 'Reply bài post',
    send: 'Gửi tin nhắn',
  }
  return map[action]
}

export function isActionAllowed(
  parsed: ParsedTelegramLink,
  action: TaskAction,
): boolean {
  return parsed.supportedActions.includes(action)
}
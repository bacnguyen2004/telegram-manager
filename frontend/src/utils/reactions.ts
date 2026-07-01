import type { DialogReactionsPolicy } from '../types/api'

export const DEFAULT_QUICK_REACTIONS = ['👍', '❤️', '🔥', '👏', '😂'] as const

const QUICK_PICKER_LIMIT = 5

export function pickerEmojis(policy: DialogReactionsPolicy | null): string[] {
  if (!policy?.enabled) return []
  if (policy.mode === 'all') return [...DEFAULT_QUICK_REACTIONS]
  return policy.allowed_emojis.filter((emoji) => !emoji.startsWith('custom:'))
}

export function buildReactionPickerGroups(
  policy: DialogReactionsPolicy | null,
  maxQuick = QUICK_PICKER_LIMIT,
): { quick: string[]; more: string[] } {
  const all = pickerEmojis(policy)
  if (all.length <= maxQuick) {
    return { quick: all, more: [] }
  }

  const preferred = DEFAULT_QUICK_REACTIONS.filter((emoji) => all.includes(emoji))
  const quick: string[] = []
  for (const emoji of preferred) {
    if (quick.length >= maxQuick) break
    quick.push(emoji)
  }
  for (const emoji of all) {
    if (quick.length >= maxQuick) break
    if (!quick.includes(emoji)) quick.push(emoji)
  }

  const quickSet = new Set(quick)
  const more = all.filter((emoji) => !quickSet.has(emoji))
  return { quick, more }
}

export function canReactWith(
  policy: DialogReactionsPolicy | null,
  emoji: string,
  chosen = false,
): boolean {
  if (chosen) return true
  if (!policy?.enabled || policy.mode === 'none') return false
  if (emoji.startsWith('custom:')) return false
  if (policy.mode === 'all') return true
  return policy.allowed_emojis.includes(emoji)
}

export function reactionsHint(policy: DialogReactionsPolicy | null): string | null {
  if (!policy?.enabled || policy.mode === 'none') {
    return 'Group này đã tắt reaction'
  }
  if (policy.has_custom && pickerEmojis(policy).length === 0) {
    return 'Group chỉ cho custom emoji — chưa hỗ trợ trên web'
  }
  return null
}
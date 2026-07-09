import type {
  AddPollOptionData,
  CancelPollVoteData,
  DeleteMessagesData,
  ForwardMessageData,
  ForwardMessagesData,
  PinMessageData,
  PollInfoData,
  ReactMessageData,
  SendMessageData,
  VotePollData,
} from '../types/api'
import { request, requestForm } from './http'

export const messagesApi = {
  sendMessage(phone: string, peerId: string, text: string) {
    return request<SendMessageData>('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ phone, peer_id: peerId, text }),
    })
  },

  replyMessage(
    phone: string,
    peerId: string,
    replyToMsgId: number,
    text: string,
  ) {
    return request<SendMessageData>('/messages/reply', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        peer_id: peerId,
        reply_to_msg_id: replyToMsgId,
        text,
      }),
    })
  },

  sendReaction(
    phone: string,
    peerId: string,
    messageId: number,
    emoji: string,
  ) {
    return request<ReactMessageData>('/messages/react', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        peer_id: peerId,
        message_id: messageId,
        emoji,
      }),
    })
  },

  getPollInfo(phone: string, peerId: string, messageId: number, link?: string) {
    const params = new URLSearchParams({
      phone,
      peer_id: peerId,
      message_id: String(messageId),
    })
    if (link?.trim()) params.set('link', link.trim())
    return request<PollInfoData>(`/messages/poll?${params}`)
  },

  addPollOption(
    phone: string,
    peerId: string,
    messageId: number,
    label: string,
    link?: string,
    voteAfter = false,
  ) {
    return request<AddPollOptionData>('/messages/poll/add-option', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        peer_id: peerId,
        message_id: messageId,
        label: label.trim(),
        link: link?.trim() || null,
        vote_after: voteAfter,
      }),
    })
  },

  cancelPollVote(
    phone: string,
    peerId: string,
    messageId: number,
    link?: string,
    options?: string[],
  ) {
    return request<CancelPollVoteData>('/messages/vote/cancel', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        peer_id: peerId,
        message_id: messageId,
        link: link?.trim() || null,
        options: options?.length ? options : null,
      }),
    })
  },

  votePoll(
    phone: string,
    peerId: string,
    messageId: number,
    option: string,
    link?: string,
    options?: string[],
  ) {
    return request<VotePollData>('/messages/vote', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        peer_id: peerId,
        message_id: messageId,
        option,
        options: options?.length ? options : null,
        link: link?.trim() || null,
      }),
    })
  },

  removeReaction(phone: string, peerId: string, messageId: number) {
    const params = new URLSearchParams({
      phone,
      peer_id: peerId,
      message_id: String(messageId),
    })
    return request<ReactMessageData>(`/messages/react?${params}`, {
      method: 'DELETE',
    })
  },

  deleteMessage(phone: string, peerId: string, messageId: number) {
    const params = new URLSearchParams({
      phone,
      peer_id: peerId,
    })
    return request<SendMessageData>(`/messages/${messageId}?${params}`, {
      method: 'DELETE',
    })
  },

  sendMedia(
    phone: string,
    peerId: string,
    file: File,
    caption?: string,
    replyToMsgId?: number,
  ) {
    const form = new FormData()
    form.append('phone', phone)
    form.append('peer_id', peerId)
    form.append('file', file)
    if (caption) form.append('caption', caption)
    if (replyToMsgId) form.append('reply_to_msg_id', String(replyToMsgId))
    return requestForm<SendMessageData>('/messages/send-media', form)
  },

  forwardMessage(
    phone: string,
    fromPeerId: string,
    toPeerId: string,
    messageId: number,
  ) {
    return request<ForwardMessageData>('/messages/forward', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        from_peer_id: fromPeerId,
        to_peer_id: toPeerId,
        message_id: messageId,
      }),
    })
  },

  forwardMessages(
    phone: string,
    fromPeerId: string,
    toPeerId: string,
    messageIds: number[],
  ) {
    return request<ForwardMessagesData>('/messages/forward-bulk', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        from_peer_id: fromPeerId,
        to_peer_id: toPeerId,
        message_ids: messageIds,
      }),
    })
  },

  editMessage(phone: string, peerId: string, messageId: number, text: string) {
    return request<SendMessageData>('/messages/edit', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        peer_id: peerId,
        message_id: messageId,
        text,
      }),
    })
  },

  deleteMessages(phone: string, peerId: string, messageIds: number[]) {
    return request<DeleteMessagesData>('/messages/delete-bulk', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        peer_id: peerId,
        message_ids: messageIds,
      }),
    })
  },

  pinMessage(phone: string, peerId: string, messageId: number, unpin = false) {
    return request<PinMessageData>('/messages/pin', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        peer_id: peerId,
        message_id: messageId,
        unpin,
      }),
    })
  },
}

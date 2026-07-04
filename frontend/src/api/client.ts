import type {
  ApiEnvelope,
  CheckSessionsData,
  DialogMessagesData,
  DialogPinnedMessagesData,
  DialogsData,
  MarkDialogReadData,
  AddPollOptionData,
  CancelPollVoteData,
  ReactMessageData,
  DeleteMessagesData,
  ForwardMessageData,
  ForwardMessagesData,
  PinMessageData,
  VotePollData,
  PollInfoData,
  SendMessageData,
  GroupActionData,
  GroupsData,
  LeaveAllGroupsData,
  AuditLogsData,
  GroupScansData,
  HealthData,
  LoginCodeData,
  MetadataOverviewData,
  SessionMetaOverviewData,
  RosterColumnItem,
  RosterData,
  RosterImportResult,
  RosterRowItem,
  LoginData,
  PrivacyRuleType,
  RegisterData,
  SendCodeData,
  DeleteSessionData,
  SessionDetailData,
  SessionMeData,
  SessionAuthorizationsData,
  RevokeAuthorizationData,
  UpdateSessionAvatarData,
  UpdateSessionProfileData,
  SessionsData,
  Update2faData,
  UpdatePrivacyData,
} from '../types/api'

const API_BASE = '/api'

async function requestForm<T>(
  path: string,
  formData: FormData,
): Promise<ApiEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      body: formData,
    })
  } catch (err) {
    const hint =
      'Kiểm tra backend đang chạy và Vite proxy (vite.config.ts → VITE_API_PROXY_TARGET).'
    const msg = err instanceof Error ? err.message : 'Network error'
    throw new Error(`${msg}. ${hint}`)
  }

  try {
    return (await response.json()) as ApiEnvelope<T>
  } catch {
    throw new Error(
      `Phản hồi không hợp lệ từ API (HTTP ${response.status}). Có thể proxy trỏ sai port backend.`,
    )
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<ApiEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err
    }
    const hint =
      'Kiểm tra backend đang chạy và Vite proxy (vite.config.ts → VITE_API_PROXY_TARGET).'
    const msg = err instanceof Error ? err.message : 'Network error'
    throw new Error(`${msg}. ${hint}`)
  }

  try {
    return (await response.json()) as ApiEnvelope<T>
  } catch {
    throw new Error(
      `Phản hồi không hợp lệ từ API (HTTP ${response.status}). Có thể proxy trỏ sai port backend.`,
    )
  }
}

export const api = {
  health() {
    return request<HealthData>('/health')
  },

  listSessions() {
    return request<SessionsData>('/sessions')
  },

  getSession(phone: string) {
    return request<SessionDetailData>(`/sessions/${encodeURIComponent(phone)}`)
  },

  getSessionMe(phone: string) {
    return request<SessionMeData>(`/sessions/${encodeURIComponent(phone)}/me`)
  },

  sessionAvatarUrl(phone: string, updatedAt?: string | null) {
    const params = new URLSearchParams()
    if (updatedAt) params.set('v', updatedAt)
    const query = params.toString()
    const base = `/api/sessions/${encodeURIComponent(phone)}/avatar`
    return query ? `${base}?${query}` : base
  },

  updateSessionProfile(
    phone: string,
    body: { first_name: string; last_name: string; username: string; about: string },
  ) {
    return request<UpdateSessionProfileData>(
      `/sessions/${encodeURIComponent(phone)}/profile`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    )
  },

  uploadSessionAvatar(phone: string, file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return requestForm<UpdateSessionAvatarData>(
      `/sessions/${encodeURIComponent(phone)}/avatar`,
      formData,
    )
  },

  deleteSessionAvatar(phone: string) {
    return request<UpdateSessionAvatarData>(
      `/sessions/${encodeURIComponent(phone)}/avatar`,
      { method: 'DELETE' },
    )
  },

  listSessionAuthorizations(phone: string) {
    return request<SessionAuthorizationsData>(
      `/sessions/${encodeURIComponent(phone)}/authorizations`,
    )
  },

  revokeSessionAuthorization(phone: string, authHash: string) {
    return request<RevokeAuthorizationData>(
      `/sessions/${encodeURIComponent(phone)}/authorizations/${encodeURIComponent(authHash)}`,
      { method: 'DELETE' },
    )
  },

  deleteSession(phone: string) {
    return request<DeleteSessionData>(`/sessions/${encodeURIComponent(phone)}`, {
      method: 'DELETE',
    })
  },

  checkSessions(phones?: string[], signal?: AbortSignal) {
    return request<CheckSessionsData>('/sessions/check', {
      method: 'POST',
      body: JSON.stringify(phones ? { phones } : {}),
      signal,
    })
  },

  sendCode(phone: string) {
    return request<SendCodeData>('/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    })
  },

  login(phone: string, code: string, password?: string) {
    return request<LoginData>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, code, password: password || null }),
    })
  },

  register(phone: string, code: string, firstName: string, lastName?: string) {
    return request<RegisterData>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        code,
        first_name: firstName,
        last_name: lastName || '',
      }),
    })
  },

  getLoginCode(phone: string) {
    return request<LoginCodeData>(`/auth/login-code/${encodeURIComponent(phone)}`)
  },

  update2fa(
    phone: string,
    newPassword: string,
    currentPassword?: string,
    hint?: string,
  ) {
    return request<Update2faData>('/auth/2fa', {
      method: 'PUT',
      body: JSON.stringify({
        phone,
        new_password: newPassword,
        current_password: currentPassword || null,
        hint: hint || '',
      }),
    })
  },

  updatePrivacy(phone: string, ruleType: PrivacyRuleType) {
    return request<UpdatePrivacyData>('/auth/privacy', {
      method: 'PUT',
      body: JSON.stringify({ phone, rule_type: ruleType }),
    })
  },

  joinGroup(phone: string, groupLink: string) {
    return request<GroupActionData>('/groups/join', {
      method: 'POST',
      body: JSON.stringify({ phone, group_link: groupLink }),
    })
  },

  leaveGroup(phone: string, groupLink: string) {
    return request<GroupActionData>('/groups/leave', {
      method: 'POST',
      body: JSON.stringify({ phone, group_link: groupLink }),
    })
  },

  leaveAllGroups(phone: string) {
    return request<LeaveAllGroupsData>('/groups/leave-all', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    })
  },

  listGroups(phone: string, limit = 1000) {
    return request<GroupsData>(
      `/groups/${encodeURIComponent(phone)}?limit=${limit}`,
    )
  },

  /** Mặc định 500 — backend cho phép tối đa 500; acc nhiều DM/group cần cao hơn 200. */
  listDialogs(phone: string, limit = 500) {
    return request<DialogsData>(
      `/dialogs/${encodeURIComponent(phone)}?limit=${limit}`,
    )
  },

  getPinnedMessages(phone: string, peerId: string, limit = 30, skip = 0) {
    const params = new URLSearchParams({
      peer_id: peerId,
      limit: String(limit),
    })
    if (skip > 0) params.set('skip', String(skip))
    return request<DialogPinnedMessagesData>(
      `/dialogs/${encodeURIComponent(phone)}/pinned?${params}`,
    )
  },

  getDialogMessages(
    phone: string,
    peerId: string,
    limit = 40,
    offsetId = 0,
    options?: { aroundId?: number; offsetDate?: string },
  ) {
    const params = new URLSearchParams({
      peer_id: peerId,
      limit: String(limit),
    })
    if (offsetId > 0) params.set('offset_id', String(offsetId))
    if (options?.aroundId && options.aroundId > 0) {
      params.set('around_id', String(options.aroundId))
    }
    if (options?.offsetDate?.trim()) {
      params.set('offset_date', options.offsetDate.trim())
    }
    return request<DialogMessagesData>(
      `/dialogs/${encodeURIComponent(phone)}/messages?${params}`,
    )
  },

  markDialogRead(phone: string, peerId: string, maxId = 0) {
    return request<MarkDialogReadData>(
      `/dialogs/${encodeURIComponent(phone)}/read`,
      {
        method: 'POST',
        body: JSON.stringify({ peer_id: peerId, max_id: maxId }),
      },
    )
  },

  messagePhotoUrl(phone: string, peerId: string, messageId: number) {
    const params = new URLSearchParams({ peer_id: peerId })
    return `/api/dialogs/${encodeURIComponent(phone)}/messages/${messageId}/photo?${params}`
  },

  messageMediaUrl(phone: string, peerId: string, messageId: number) {
    const params = new URLSearchParams({ peer_id: peerId })
    return `/api/dialogs/${encodeURIComponent(phone)}/messages/${messageId}/media?${params}`
  },

  getNewDialogMessages(
    phone: string,
    peerId: string,
    minId: number,
    limit = 50,
  ) {
    const params = new URLSearchParams({
      peer_id: peerId,
      min_id: String(minId),
      limit: String(limit),
    })
    return request<DialogMessagesData>(
      `/dialogs/${encodeURIComponent(phone)}/messages/new?${params}`,
    )
  },

  searchDialogMessages(
    phone: string,
    peerId: string,
    query: string,
    limit = 50,
  ) {
    const params = new URLSearchParams({
      peer_id: peerId,
      q: query.trim(),
      limit: String(limit),
    })
    return request<DialogMessagesData>(
      `/dialogs/${encodeURIComponent(phone)}/messages/search?${params}`,
    )
  },

  dialogMessageStreamUrl(phone: string, peerId: string, minId: number) {
    const params = new URLSearchParams({
      peer_id: peerId,
      min_id: String(minId),
    })
    return `/api/dialogs/${encodeURIComponent(phone)}/messages/stream?${params}`
  },

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
    return request<SendMessageData>(
      `/messages/${messageId}?${params}`,
      { method: 'DELETE' },
    )
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

  metadataOverview() {
    return request<MetadataOverviewData>('/metadata/overview')
  },

  listAuditLogs(options?: {
    phone?: string
    actionPrefix?: string
    status?: string
    limit?: number
    offset?: number
  }) {
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    if (options?.phone?.trim()) params.set('phone', options.phone.trim())
    if (options?.actionPrefix?.trim()) params.set('action_prefix', options.actionPrefix.trim())
    if (options?.status?.trim()) params.set('status', options.status.trim())
    return request<AuditLogsData>(`/metadata/audit?${params}`)
  },

  listGroupScans(phone?: string, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (phone?.trim()) params.set('phone', phone.trim())
    return request<GroupScansData>(`/metadata/group-scans?${params}`)
  },

  listSessionMetaOverview() {
    return request<SessionMetaOverviewData>('/metadata/sessions')
  },

  getRoster() {
    return request<RosterData>('/roster')
  },

  patchRosterRow(phone: string, fields: Record<string, string>) {
    return request<RosterRowItem>(`/roster/${encodeURIComponent(phone)}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    })
  },

  createRosterColumn(label: string) {
    return request<RosterColumnItem>('/roster/columns', {
      method: 'POST',
      body: JSON.stringify({ label }),
    })
  },

  renameRosterColumn(columnKey: string, label: string) {
    return request<RosterColumnItem>(`/roster/columns/${encodeURIComponent(columnKey)}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    })
  },

  deleteRosterColumn(columnKey: string) {
    return request<{ column_key: string }>(
      `/roster/columns/${encodeURIComponent(columnKey)}`,
      { method: 'DELETE' },
    )
  },

  importRoster(payload: {
    new_column_labels: string[]
    rows: { phone: string; fields: Record<string, string> }[]
  }) {
    return request<RosterImportResult>('/roster/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  parseConversation(payload: import('../utils/conversationScript').ConversationParseRequestPayload) {
    return request<import('../utils/conversationScript').ConversationValidateData>(
      '/conversation/parse',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    )
  },

  createConversationJob(
    script: import('../utils/conversationScript').ConversationScript,
    options?: {
      startLineId?: number
      carriedLineResults?: import('../utils/conversationScript').ConversationLineResult[]
    },
  ) {
    return request<{ job_id: number; status: string; total_lines: number }>(
      '/conversation/jobs',
      {
        method: 'POST',
        body: JSON.stringify({
          script,
          start_line_id: options?.startLineId ?? null,
          carried_line_results: options?.carriedLineResults ?? [],
        }),
      },
    )
  },

  listConversationJobs(limit = 10, offset = 0) {
    return request<import('../utils/conversationScript').ConversationJobListData>(
      `/conversation/jobs?limit=${limit}&offset=${offset}`,
    )
  },

  getConversationJob(jobId: number) {
    return request<import('../utils/conversationScript').ConversationJobData>(
      `/conversation/jobs/${jobId}`,
    )
  },

  stopConversationJob(jobId: number) {
    return request<import('../utils/conversationScript').ConversationJobData>(
      `/conversation/jobs/${jobId}/stop`,
      { method: 'POST' },
    )
  },

  resumeConversationJob(jobId: number) {
    return request<import('../utils/conversationScript').ConversationJobData>(
      `/conversation/jobs/${jobId}/resume`,
      { method: 'POST' },
    )
  },

  retryConversationLine(jobId: number, lineId: number) {
    return request<import('../utils/conversationScript').ConversationJobData>(
      `/conversation/jobs/${jobId}/lines/${lineId}/retry`,
      { method: 'POST' },
    )
  },

}
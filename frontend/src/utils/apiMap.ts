export const PAGE_LABELS: Record<string, string> = {
  '/': 'Tổng quan',
  '/health': 'Trạng thái API',
  '/sessions': 'Tài khoản',
  '/sessions?add=1': 'Thêm tài khoản',
  '/roster': 'Sổ tài khoản',
  '/proxy': 'Proxy',
  '/auto-profile': 'Auto hồ sơ',
  '/dialogs': 'Tin nhắn',
  '/groups': 'Nhóm & kênh',
  '/tasks': 'Tác vụ hàng loạt',
  '/conversation': 'Hội thoại tự nhiên',
  '/campaign': 'Chiến dịch',
  '/audit': 'Nhật ký hoạt động',
  '/security': 'Bảo mật',
}

export function pageLabel(path: string | null): string {
  if (!path) return 'Chỉ API'
  return PAGE_LABELS[path] ?? path
}

export interface ApiMapItem {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'WS'
  path: string
  page: string | null
}

export interface ApiMapGroup {
  group: string
  label: string
  items: ApiMapItem[]
}

export const apiMap: ApiMapGroup[] = [
  {
    group: 'health',
    label: 'Trạng thái API',
    items: [{ method: 'GET', path: '/api/health', page: '/health' }],
  },
  {
    group: 'sessions',
    label: 'Tài khoản',
    items: [
      { method: 'GET', path: '/api/sessions', page: '/sessions' },
      { method: 'POST', path: '/api/sessions/check', page: '/sessions' },
      { method: 'GET', path: '/api/sessions/{phone}', page: '/sessions' },
      { method: 'DELETE', path: '/api/sessions/{phone}', page: '/sessions' },
      { method: 'GET', path: '/api/sessions/{phone}/me', page: '/sessions' },
      { method: 'GET', path: '/api/sessions/{phone}/avatar', page: '/sessions' },
      { method: 'PATCH', path: '/api/sessions/{phone}/profile', page: '/sessions' },
      { method: 'POST', path: '/api/sessions/{phone}/avatar', page: '/sessions' },
      { method: 'DELETE', path: '/api/sessions/{phone}/avatar', page: '/sessions' },
      { method: 'GET', path: '/api/sessions/{phone}/authorizations', page: '/sessions' },
      { method: 'DELETE', path: '/api/sessions/{phone}/authorizations/{auth_hash}', page: '/sessions' },
    ],
  },
  {
    group: 'roster',
    label: 'Sổ tài khoản',
    items: [
      { method: 'GET', path: '/api/roster', page: '/roster' },
      { method: 'PATCH', path: '/api/roster/{phone}', page: '/roster' },
      { method: 'POST', path: '/api/roster/columns', page: '/roster' },
      { method: 'PATCH', path: '/api/roster/columns/{column_key}', page: '/roster' },
      { method: 'DELETE', path: '/api/roster/columns/{column_key}', page: '/roster' },
      { method: 'POST', path: '/api/roster/import', page: '/roster' },
    ],
  },
  {
    group: 'groups',
    label: 'Nhóm & kênh',
    items: [
      { method: 'POST', path: '/api/groups/join', page: '/groups' },
      { method: 'POST', path: '/api/groups/leave', page: '/groups' },
      { method: 'POST', path: '/api/groups/leave-all', page: '/groups' },
      { method: 'GET', path: '/api/groups/{phone}', page: '/groups' },
    ],
  },
  {
    group: 'dialogs',
    label: 'Danh sách chat',
    items: [
      { method: 'GET', path: '/api/dialogs/{phone}', page: '/dialogs' },
      { method: 'GET', path: '/api/dialogs/{phone}/messages', page: '/dialogs' },
      { method: 'GET', path: '/api/dialogs/{phone}/messages/new', page: '/dialogs' },
      { method: 'GET', path: '/api/dialogs/{phone}/messages/search', page: '/dialogs' },
      { method: 'GET', path: '/api/dialogs/{phone}/messages/stream', page: '/dialogs' },
      { method: 'WS', path: '/api/dialogs/{phone}/messages/ws', page: '/dialogs' },
      { method: 'GET', path: '/api/dialogs/{phone}/pinned', page: '/dialogs' },
      { method: 'GET', path: '/api/dialogs/{phone}/messages/{id}/photo', page: '/dialogs' },
      { method: 'GET', path: '/api/dialogs/{phone}/messages/{id}/media', page: '/dialogs' },
      { method: 'POST', path: '/api/dialogs/{phone}/read', page: '/dialogs' },
    ],
  },
  {
    group: 'messages',
    label: 'Gửi & thao tác',
    items: [
      { method: 'POST', path: '/api/messages/send', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/reply', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/send-media', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/forward', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/forward-bulk', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/edit', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/delete-bulk', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/pin', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/react', page: '/dialogs' },
      { method: 'DELETE', path: '/api/messages/react', page: '/dialogs' },
      { method: 'DELETE', path: '/api/messages/{message_id}', page: '/dialogs' },
      { method: 'GET', path: '/api/messages/poll', page: '/tasks' },
      { method: 'POST', path: '/api/messages/poll/add-option', page: '/tasks' },
      { method: 'POST', path: '/api/messages/vote', page: '/tasks' },
      { method: 'POST', path: '/api/messages/vote/cancel', page: '/tasks' },
    ],
  },
  {
    group: 'conversation',
    label: 'Hội thoại tự nhiên',
    items: [
      { method: 'POST', path: '/api/conversation/validate', page: '/conversation' },
      { method: 'POST', path: '/api/conversation/parse', page: '/conversation' },
      { method: 'GET', path: '/api/conversation/jobs', page: '/conversation' },
      { method: 'POST', path: '/api/conversation/jobs', page: '/conversation' },
      { method: 'GET', path: '/api/conversation/jobs/{job_id}', page: '/conversation' },
      { method: 'POST', path: '/api/conversation/jobs/{job_id}/resume', page: '/conversation' },
      { method: 'POST', path: '/api/conversation/jobs/{job_id}/lines/{line_id}/retry', page: '/conversation' },
      { method: 'POST', path: '/api/conversation/jobs/{job_id}/stop', page: '/conversation' },
    ],
  },
  {
    group: 'metadata',
    label: 'Nhật ký',
    items: [
      { method: 'GET', path: '/api/metadata/overview', page: '/audit' },
      { method: 'GET', path: '/api/metadata/audit', page: '/audit' },
      { method: 'GET', path: '/api/metadata/group-scans', page: '/audit' },
      { method: 'GET', path: '/api/metadata/sessions', page: '/sessions' },
    ],
  },
  {
    group: 'auth',
    label: 'Xác thực & bảo mật',
    items: [
      { method: 'POST', path: '/api/auth/send-code', page: '/sessions?add=1' },
      { method: 'POST', path: '/api/auth/login', page: '/sessions?add=1' },
      { method: 'POST', path: '/api/auth/register', page: '/sessions?add=1' },
      { method: 'GET', path: '/api/auth/login-code/{phone}', page: null },
      { method: 'PUT', path: '/api/auth/2fa', page: '/security' },
      { method: 'PUT', path: '/api/auth/privacy', page: '/security' },
    ],
  },
  {
    group: 'proxies',
    label: 'Proxy',
    items: [
      { method: 'GET', path: '/api/proxies', page: '/proxy' },
      { method: 'POST', path: '/api/proxies', page: '/proxy' },
      { method: 'GET', path: '/api/proxies/{id}', page: '/proxy' },
      { method: 'PATCH', path: '/api/proxies/{id}', page: '/proxy' },
      { method: 'DELETE', path: '/api/proxies/{id}', page: '/proxy' },
      { method: 'POST', path: '/api/proxies/{id}/check', page: '/proxy' },
      { method: 'GET', path: '/api/proxies/assignments', page: '/proxy' },
      { method: 'PUT', path: '/api/proxies/assignments/{phone}', page: '/proxy' },
      { method: 'POST', path: '/api/proxies/assignments/bulk', page: '/proxy' },
    ],
  },
  {
    group: 'auto-profile',
    label: 'Auto hồ sơ',
    items: [
      { method: 'POST', path: '/api/auto-profile/preview', page: '/auto-profile' },
      { method: 'POST', path: '/api/auto-profile/apply', page: '/auto-profile' },
    ],
  },
  {
    group: 'campaign',
    label: 'Chiến dịch',
    items: [
      { method: 'GET', path: '/api/campaign/ai-status', page: '/campaign' },
      { method: 'GET', path: '/api/campaign/market', page: '/campaign' },
      { method: 'POST', path: '/api/campaign/plan', page: '/campaign' },
      { method: 'POST', path: '/api/campaign/jobs', page: '/campaign' },
      { method: 'GET', path: '/api/campaign/jobs/{job_id}', page: '/campaign' },
      { method: 'POST', path: '/api/campaign/jobs/{job_id}/stop', page: '/campaign' },
      { method: 'POST', path: '/api/campaign/jobs/{job_id}/resume', page: '/campaign' },
      {
        method: 'POST',
        path: '/api/campaign/jobs/{job_id}/lines/{line_id}/retry',
        page: '/campaign',
      },
    ],
  },
]

export type ApiGroupId = (typeof apiMap)[number]['group']

export const API_ENDPOINT_COUNT = apiMap.reduce((sum, group) => sum + group.items.length, 0)
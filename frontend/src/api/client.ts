/**
 * Unified API facade — keeps `import { api } from '../api/client'` working.
 * Domain modules live alongside this file for smaller, focused edits.
 */
import { authApi } from './auth'
import { autoProfileApi } from './autoProfile'
import { campaignApi } from './campaign'
import { dialogsApi } from './dialogs'
import { groupsApi } from './groups'
import { healthApi } from './health'
import { messagesApi } from './messages'
import { metadataApi } from './metadata'
import { proxiesApi } from './proxies'
import { rosterApi } from './roster'
import { sessionsApi } from './sessions'

export const api = {
  ...healthApi,
  ...sessionsApi,
  ...authApi,
  ...groupsApi,
  ...dialogsApi,
  ...messagesApi,
  ...metadataApi,
  ...rosterApi,
  ...proxiesApi,
  ...autoProfileApi,
  ...campaignApi,
}

export type ApiClient = typeof api

// Named domain exports for optional direct imports
export {
  authApi,
  autoProfileApi,
  campaignApi,
  dialogsApi,
  groupsApi,
  healthApi,
  messagesApi,
  metadataApi,
  proxiesApi,
  rosterApi,
  sessionsApi,
}

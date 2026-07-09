import type { GroupActionData, GroupsData, LeaveAllGroupsData } from '../types/api'
import { request } from './http'

export const groupsApi = {
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
    return request<GroupsData>(`/groups/${encodeURIComponent(phone)}?limit=${limit}`)
  },
}

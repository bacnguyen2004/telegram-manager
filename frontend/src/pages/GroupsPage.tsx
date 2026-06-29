import { useState } from 'react'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { PhoneSelect } from '../components/PhoneSelect'
import { StatusBadge } from '../components/StatusBadge'
import type { GroupItem } from '../types/api'

type Tab = 'join' | 'leave' | 'list'

export function GroupsPage() {
  const [tab, setTab] = useState<Tab>('list')
  const [phone, setPhone] = useState('')
  const [groupLink, setGroupLink] = useState('')
  const [groups, setGroups] = useState<GroupItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [info, setInfo] = useState('')

  function resetAlerts() {
    setError('')
    setSuccess('')
    setInfo('')
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    resetAlerts()
    try {
      const res = await api.joinGroup(phone, groupLink.trim())
      if (!res.success || !res.data) {
        setError(res.error ?? 'Join thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      if (res.data.status === 'info') {
        setInfo(res.data.message)
        return
      }
      setSuccess(res.data.message)
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setLoading(false)
    }
  }

  async function handleLeave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    resetAlerts()
    try {
      const res = await api.leaveGroup(phone, groupLink.trim())
      if (!res.success || !res.data) {
        setError(res.error ?? 'Leave thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setSuccess(res.data.message)
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setLoading(false)
    }
  }

  async function handleList(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    resetAlerts()
    setGroups([])
    try {
      const res = await api.listGroups(phone)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được danh sách nhóm')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setGroups(res.data.groups)
      setSuccess(`Tìm thấy ${res.data.total} nhóm/channel`)
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Groups</h1>
          <p className="page-desc">Join / Leave / Danh sách nhóm Telegram</p>
        </div>
      </header>

      <div className="tab-bar">
        {(['list', 'join', 'leave'] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`tab-btn${tab === item ? ' tab-btn--active' : ''}`}
            onClick={() => {
              setTab(item)
              resetAlerts()
            }}
          >
            {item === 'list' ? 'Danh sách' : item === 'join' ? 'Join' : 'Leave'}
          </button>
        ))}
      </div>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />
      {info && <Alert type="info" message={info} />}

      {tab === 'join' && (
        <section className="panel" style={{ maxWidth: 520 }}>
          <h2>
            <code>POST /api/groups/join</code>
          </h2>
          <form onSubmit={(e) => void handleJoin(e)}>
            <PhoneSelect value={phone} onChange={setPhone} allowManual={false} />
            <label className="field">
              <span>Link nhóm</span>
              <input
                type="url"
                placeholder="https://t.me/example_group"
                value={groupLink}
                onChange={(e) => setGroupLink(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn btn--primary btn--block" disabled={loading || !phone}>
              {loading ? 'Đang join…' : 'Join group'}
            </button>
          </form>
        </section>
      )}

      {tab === 'leave' && (
        <section className="panel" style={{ maxWidth: 520 }}>
          <h2>
            <code>POST /api/groups/leave</code>
          </h2>
          <form onSubmit={(e) => void handleLeave(e)}>
            <PhoneSelect value={phone} onChange={setPhone} allowManual={false} />
            <label className="field">
              <span>Link / username / ID nhóm</span>
              <input
                type="text"
                placeholder="https://t.me/example_group"
                value={groupLink}
                onChange={(e) => setGroupLink(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn btn--primary btn--block" disabled={loading || !phone}>
              {loading ? 'Đang leave…' : 'Leave group'}
            </button>
          </form>
        </section>
      )}

      {tab === 'list' && (
        <>
          <section className="panel">
            <h2>
              <code>GET /api/groups/{'{phone}'}</code>
            </h2>
            <form className="inline-form" onSubmit={(e) => void handleList(e)}>
              <PhoneSelect value={phone} onChange={setPhone} allowManual={false} />
              <button type="submit" className="btn btn--primary" disabled={loading || !phone}>
                {loading ? 'Đang tải…' : 'Tải danh sách'}
              </button>
            </form>
          </section>

          {groups.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>Nhóm đã join</h2>
                <span className="panel-meta">{groups.length} mục</span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tên</th>
                      <th>Loại</th>
                      <th>Username</th>
                      <th>Members</th>
                      <th>Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.id}>
                        <td>{group.title || '—'}</td>
                        <td>
                          <StatusBadge status={group.is_channel ? 'info' : 'active'} />
                          <span className="muted"> {group.type}</span>
                        </td>
                        <td>{group.username ? `@${group.username}` : '—'}</td>
                        <td>{group.members_count || '—'}</td>
                        <td>
                          {group.link ? (
                            <a href={group.link} target="_blank" rel="noreferrer">
                              mở
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
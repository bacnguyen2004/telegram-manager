import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './SessionDetailModal.css'
import { api } from '../api/client'
import { ConfirmModal } from './ConfirmModal'
import { SessionAvatar } from './SessionAvatar'
import { StatusBadge } from './StatusBadge'
import type {
  SessionAuthorizationItem,
  SessionDetailData,
  SessionMeData,
} from '../types/api'
import { auditActionLabel } from '../utils/auditLabels'
import { formatBytes, formatDate, formatRelativeDate } from '../utils/format'
import { formatUsername } from '../utils/sessionDisplay'

type SessionDetailTab = 'profile' | 'authorizations' | 'tool'

interface SessionDetailModalProps {
  phone: string
  loading: boolean
  detailData: SessionDetailData | null
  meData: SessionMeData | null
  deleting: boolean
  deleteConfirmOpen?: boolean
  onClose: () => void
  onDelete: (phone: string) => void
  onRecheck: (phone: string) => void
  rechecking: boolean
  onProfileUpdated: () => void
}

function displayNameFromMe(me: SessionMeData | null): string {
  if (!me) return '—'
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ').trim()
  return name || '—'
}

function authorizationDeviceLabel(item: SessionAuthorizationItem): string {
  const parts = [item.device_model, item.platform].filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')
  if (item.app_name) return item.app_name
  return 'Thiết bị không rõ'
}

function authorizationLocation(item: SessionAuthorizationItem): string {
  const parts = [item.region, item.country].filter(Boolean)
  if (item.ip) parts.push(item.ip)
  return parts.join(' · ') || '—'
}

function devicePlatformIcon(item: SessionAuthorizationItem): string {
  const hay = `${item.platform} ${item.device_model} ${item.app_name}`.toLowerCase()
  if (hay.includes('iphone') || hay.includes('ios') || hay.includes('ipad')) return '📱'
  if (hay.includes('android')) return '🤖'
  if (hay.includes('mac') || hay.includes('osx')) return '💻'
  if (hay.includes('windows') || hay.includes('linux') || hay.includes('pc')) return '🖥️'
  if (hay.includes('web')) return '🌐'
  return '📟'
}

function InfoCard({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="sd-card">
      <div className="sd-card-head">
        <h4>{title}</h4>
        {action}
      </div>
      <div className="sd-card-body">{children}</div>
    </section>
  )
}

export function SessionDetailModal({
  phone,
  loading,
  detailData,
  meData,
  deleting,
  deleteConfirmOpen = false,
  onClose,
  onDelete,
  onRecheck,
  rechecking,
  onProfileUpdated,
}: SessionDetailModalProps) {
  const [tab, setTab] = useState<SessionDetailTab>('profile')
  const [authItems, setAuthItems] = useState<SessionAuthorizationItem[]>([])
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authLoadedPhone, setAuthLoadedPhone] = useState<string | null>(null)
  const [revokingHash, setRevokingHash] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [aboutInput, setAboutInput] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')
  const [avatarStamp, setAvatarStamp] = useState('')
  const [confirmAvatarDelete, setConfirmAvatarDelete] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<SessionAuthorizationItem | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const profileStatus = meData?.status ?? detailData?.db_metadata?.status ?? 'unknown'
  const savedUsername = formatUsername(meData?.username ?? detailData?.db_metadata?.username)
  const hasAvatar = Boolean(meData?.has_avatar ?? detailData?.db_metadata?.has_avatar)

  const heroName =
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    displayNameFromMe(meData) ||
    phone
  const heroUsername =
    formatUsername(usernameInput || meData?.username || undefined) ?? savedUsername
  const avatarLabel = heroName === phone ? phone : heroName
  const canEditProfile = meData?.status === 'success'

  const loadAuthorizations = useCallback(async (force = false) => {
    if (!force && authLoadedPhone === phone && authItems.length > 0) return
    setAuthLoading(true)
    setAuthError('')
    try {
      const res = await api.listSessionAuthorizations(phone)
      if (!res.success || !res.data) {
        setAuthItems([])
        setAuthError(res.error ?? 'Không tải được phiên đăng nhập')
        return
      }
      if (res.data.status !== 'success') {
        setAuthItems([])
        setAuthError(res.data.message || 'Không tải được phiên đăng nhập')
        return
      }
      setAuthItems(res.data.items)
      setAuthLoadedPhone(phone)
    } catch (err) {
      setAuthItems([])
      setAuthError(err instanceof Error ? err.message : 'Không tải được phiên đăng nhập')
    } finally {
      setAuthLoading(false)
    }
  }, [authItems.length, authLoadedPhone, phone])

  useEffect(() => {
    setTab('profile')
    setAuthItems([])
    setAuthLoadedPhone(null)
    setAuthError('')
    setProfileError('')
    setProfileSuccess('')
  }, [phone])

  useEffect(() => {
    if (!meData || meData.status !== 'success') {
      setFirstName('')
      setLastName('')
      setUsernameInput('')
      setAboutInput('')
      return
    }
    setFirstName(meData.first_name ?? '')
    setLastName(meData.last_name ?? '')
    setUsernameInput(meData.username ?? '')
    setAboutInput(meData.about ?? '')
  }, [meData, phone])

  useEffect(() => {
    if (!profileSuccess) return
    const timer = window.setTimeout(() => setProfileSuccess(''), 3000)
    return () => window.clearTimeout(timer)
  }, [profileSuccess])

  useEffect(() => {
    if (tab === 'authorizations' && !loading) {
      void loadAuthorizations()
    }
  }, [tab, loading, loadAuthorizations])

  const confirmBlockingClose =
    deleteConfirmOpen || confirmAvatarDelete || Boolean(confirmRevoke)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !confirmBlockingClose) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, confirmBlockingClose])

  const currentAuthCount = useMemo(
    () => authItems.filter((item) => !item.current).length,
    [authItems],
  )

  async function handleSaveProfile(event: React.FormEvent) {
    event.preventDefault()
    if (!canEditProfile) return

    setProfileSaving(true)
    setProfileError('')
    setProfileSuccess('')
    try {
      const res = await api.updateSessionProfile(phone, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: usernameInput.trim().replace(/^@+/, ''),
        about: aboutInput.trim(),
      })
      if (!res.success || !res.data) {
        setProfileError(res.error ?? 'Không cập nhật được hồ sơ')
        return
      }
      if (res.data.status !== 'success') {
        setProfileError(res.data.message || 'Không cập nhật được hồ sơ')
        return
      }
      setProfileSuccess('Đã cập nhật hồ sơ Telegram')
      onProfileUpdated()
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Không cập nhật được hồ sơ')
    } finally {
      setProfileSaving(false)
    }
  }

  async function handleAvatarSelected(file: File | null) {
    if (!file || !canEditProfile) return

    setAvatarBusy(true)
    setProfileError('')
    setProfileSuccess('')
    try {
      const res = await api.uploadSessionAvatar(phone, file)
      if (!res.success || !res.data) {
        setProfileError(res.error ?? 'Không tải được avatar')
        return
      }
      if (res.data.status !== 'success') {
        setProfileError(res.data.message || 'Không tải được avatar')
        return
      }
      setAvatarStamp(String(Date.now()))
      setProfileSuccess('Đã cập nhật avatar')
      onProfileUpdated()
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Không tải được avatar')
    } finally {
      setAvatarBusy(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  async function handleDeleteAvatar() {
    if (!canEditProfile) return

    setAvatarBusy(true)
    setProfileError('')
    setProfileSuccess('')
    try {
      const res = await api.deleteSessionAvatar(phone)
      if (!res.success || !res.data) {
        setProfileError(res.error ?? 'Không xóa được avatar')
        return
      }
      if (res.data.status !== 'success') {
        setProfileError(res.data.message || 'Không xóa được avatar')
        return
      }
      setAvatarStamp(String(Date.now()))
      setProfileSuccess('Đã xóa avatar')
      onProfileUpdated()
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Không xóa được avatar')
    } finally {
      setAvatarBusy(false)
      setConfirmAvatarDelete(false)
    }
  }

  async function handleRevoke(item: SessionAuthorizationItem) {
    if (item.current) return

    setRevokingHash(item.hash)
    setAuthError('')
    try {
      const res = await api.revokeSessionAuthorization(phone, item.hash)
      if (!res.success || !res.data) {
        setAuthError(res.error ?? 'Không đăng xuất được thiết bị')
        return
      }
      if (res.data.status === 'error') {
        setAuthError(res.data.message)
        return
      }
      await loadAuthorizations(true)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Không đăng xuất được thiết bị')
    } finally {
      setRevokingHash(null)
      setConfirmRevoke(null)
    }
  }

  const revokeLabel = confirmRevoke ? authorizationDeviceLabel(confirmRevoke) : ''

  return (
    <>
      <ConfirmModal
        open={confirmAvatarDelete}
        title="Xóa ảnh đại diện?"
        description="Ảnh profile trên Telegram sẽ bị xóa."
        details={['Thao tác này chỉ ảnh hưởng avatar trên Telegram']}
        confirmLabel="Xóa ảnh"
        loading={avatarBusy}
        onConfirm={() => void handleDeleteAvatar()}
        onCancel={() => {
          if (avatarBusy) return
          setConfirmAvatarDelete(false)
        }}
      />

      <ConfirmModal
        open={Boolean(confirmRevoke)}
        title="Đăng xuất thiết bị?"
        variant="warn"
        description={
          confirmRevoke ? (
            <>
              Thiết bị <strong>{revokeLabel}</strong> sẽ bị đăng xuất khỏi Telegram.
            </>
          ) : null
        }
        details={[
          'Đây là phiên trên Telegram (Settings → Devices)',
          'Không xóa file session của tool',
        ]}
        confirmLabel="Đăng xuất"
        loading={Boolean(confirmRevoke && revokingHash === confirmRevoke.hash)}
        onConfirm={() => {
          if (!confirmRevoke) return
          void handleRevoke(confirmRevoke)
        }}
        onCancel={() => {
          if (revokingHash) return
          setConfirmRevoke(null)
        }}
      />

    <div
      className="modal-backdrop session-detail-backdrop"
      onClick={() => {
        if (confirmBlockingClose) return
        onClose()
      }}
    >
      <div
        className="modal session-detail-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-detail-title"
      >
        <header className="sd-hero">
          <div className="sd-hero-bg" aria-hidden />
          <button
            type="button"
            className="sd-hero-close"
            onClick={() => {
              if (confirmBlockingClose) return
              onClose()
            }}
            aria-label="Đóng"
          >
            ✕
          </button>
          <div className="sd-hero-content">
            <div className="sd-hero-avatar-wrap">
              <SessionAvatar
                phone={phone}
                label={avatarLabel}
                hasAvatar={hasAvatar}
                avatarUpdatedAt={
                  avatarStamp || detailData?.db_metadata?.avatar_updated_at || null
                }
                size="lg"
              />
            </div>
            <div className="sd-hero-text">
              <h2 id="session-detail-title" className="sd-hero-name">
                {loading ? 'Đang tải…' : heroName}
              </h2>
              <p className="sd-hero-phone">{phone}</p>
              <div className="sd-hero-meta">
                {heroUsername ? (
                  <span className="sd-hero-username">{heroUsername}</span>
                ) : null}
                <StatusBadge status={profileStatus} />
              </div>
            </div>
          </div>
        </header>

        <div className="sd-tabbar" role="tablist" aria-label="Chi tiết account">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'profile'}
            className={`sd-tab${tab === 'profile' ? ' sd-tab--active' : ''}`}
            onClick={() => setTab('profile')}
          >
            Hồ sơ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'authorizations'}
            className={`sd-tab${tab === 'authorizations' ? ' sd-tab--active' : ''}`}
            onClick={() => setTab('authorizations')}
          >
            Phiên đăng nhập
            {authLoadedPhone === phone && authItems.length > 0 ? (
              <span className="sd-tab-badge">{authItems.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'tool'}
            className={`sd-tab${tab === 'tool' ? ' sd-tab--active' : ''}`}
            onClick={() => setTab('tool')}
          >
            Session tool
          </button>
        </div>

        <div className="sd-body">
          {loading ? (
            <div className="sd-loading">
              <span className="sd-loading-spinner" aria-hidden />
              <span>Đang tải chi tiết account…</span>
            </div>
          ) : tab === 'profile' ? (
            <div className="sd-panel">
              {meData?.status === 'unauthorized' ? (
                <div className="sd-alert sd-alert--warn">
                  <p>Session tool chưa đăng nhập hoặc hết hạn.</p>
                  <Link to="/sessions?add=1" className="btn btn--primary btn--sm">
                    Đăng nhập lại
                  </Link>
                </div>
              ) : null}
              {profileError ? (
                <div className="sd-alert sd-alert--error">
                  <p>{profileError}</p>
                </div>
              ) : null}
              {profileSuccess ? (
                <div className="sd-alert sd-alert--success">
                  <p>{profileSuccess}</p>
                </div>
              ) : null}

              {meData ? (
                <InfoCard
                  title="Chỉnh sửa hồ sơ Telegram"
                  action={
                    <div className="sd-avatar-actions">
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        hidden
                        disabled={!canEditProfile || avatarBusy}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null
                          void handleAvatarSelected(file)
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={!canEditProfile || avatarBusy}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        {avatarBusy ? '…' : 'Đổi ảnh'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={!canEditProfile || avatarBusy || !hasAvatar}
                        onClick={() => setConfirmAvatarDelete(true)}
                      >
                        Xóa ảnh
                      </button>
                    </div>
                  }
                >
                  <form onSubmit={(e) => void handleSaveProfile(e)}>
                    <div className="sd-form-grid">
                      <label className="sd-field">
                        <span>Tên</span>
                        <input
                          type="text"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          required
                          maxLength={64}
                          disabled={!canEditProfile || profileSaving}
                        />
                      </label>
                      <label className="sd-field">
                        <span>Họ</span>
                        <input
                          type="text"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          maxLength={64}
                          disabled={!canEditProfile || profileSaving}
                          placeholder="Tuỳ chọn"
                        />
                      </label>
                      <label className="sd-field sd-field--full">
                        <span>Username</span>
                        <div className="sd-username-wrap">
                          <span className="sd-username-prefix">@</span>
                          <input
                            type="text"
                            value={usernameInput}
                            onChange={(e) =>
                              setUsernameInput(e.target.value.replace(/^@+/, ''))
                            }
                            placeholder="để trống để xóa"
                            maxLength={32}
                            disabled={!canEditProfile || profileSaving}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </div>
                      </label>
                      <label className="sd-field sd-field--full">
                        <span>Bio</span>
                        <textarea
                          className="sd-textarea"
                          value={aboutInput}
                          onChange={(e) => setAboutInput(e.target.value)}
                          placeholder="Tiểu sử hiển thị trên Telegram"
                          maxLength={70}
                          rows={3}
                          disabled={!canEditProfile || profileSaving}
                        />
                        <span className="sd-field-hint">
                          {aboutInput.length}/70 ký tự
                        </span>
                      </label>
                      <div className="sd-field sd-field--full sd-field--readonly">
                        <span>Telegram ID</span>
                        <output className="sd-readonly-value">
                          {meData.me_id ?? '—'}
                        </output>
                      </div>
                    </div>

                    <div className="sd-profile-actions">
                      <button
                        type="submit"
                        className="btn btn--primary btn--sm"
                        disabled={!canEditProfile || profileSaving || !firstName.trim()}
                      >
                        {profileSaving ? 'Đang lưu…' : 'Lưu hồ sơ'}
                      </button>
                    </div>

                    {meData.status === 'error' && meData.message ? (
                      <p className="detail-message sd-form-message">
                        {meData.message}
                      </p>
                    ) : null}
                  </form>
                </InfoCard>
              ) : (
                <div className="sd-empty">
                  <span className="sd-empty-icon">👤</span>
                  <p>Chưa có dữ liệu tài khoản Telegram.</p>
                </div>
              )}
            </div>
          ) : null}

          {!loading && tab === 'authorizations' ? (
            <div className="sd-panel">
              <InfoCard
                title="Thiết bị đang đăng nhập"
                action={
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={authLoading}
                    onClick={() => void loadAuthorizations(true)}
                  >
                    Làm mới
                  </button>
                }
              >
                <p className="sd-card-desc">
                  Giống Telegram Settings → Devices. Khác với file session của tool.
                </p>
                {authError ? (
                  <div className="sd-alert sd-alert--error sd-alert--spaced">
                    <p>{authError}</p>
                  </div>
                ) : null}
                {authLoading ? (
                  <div className="sd-loading sd-loading--compact">
                    <span className="sd-loading-spinner" aria-hidden />
                    <span>Đang tải phiên đăng nhập…</span>
                  </div>
                ) : authItems.length === 0 ? (
                  <div className="sd-empty">
                    <span className="sd-empty-icon">📱</span>
                    <p>Không có phiên nào hoặc chưa tải được.</p>
                  </div>
                ) : (
                  <>
                    <div className="sd-device-list">
                      {authItems.map((item) => (
                        <article
                          key={item.hash}
                          className={`sd-device-card${item.current ? ' sd-device-card--current' : ''}`}
                        >
                          <div className="sd-device-icon" aria-hidden>
                            {devicePlatformIcon(item)}
                          </div>
                          <div className="sd-device-main">
                            <div className="sd-device-title">
                              {authorizationDeviceLabel(item)}
                              {item.current ? (
                                <span className="sd-device-pill">Session tool</span>
                              ) : null}
                            </div>
                            <div className="sd-device-meta">
                              <span>{item.app_name || 'App không rõ'}</span>
                              <span>{authorizationLocation(item)}</span>
                              <span>
                                Hoạt động{' '}
                                {item.date_active
                                  ? formatRelativeDate(item.date_active)
                                  : '—'}
                              </span>
                            </div>
                          </div>
                          <div className="sd-device-action">
                            {item.current ? (
                              <span className="muted sd-device-using">
                                Đang dùng
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--sm btn--ghost"
                                disabled={revokingHash === item.hash}
                                onClick={() => setConfirmRevoke(item)}
                              >
                                {revokingHash === item.hash ? '…' : 'Đăng xuất'}
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                    <p className="panel-meta sd-auth-summary">
                      {authItems.length} phiên · {currentAuthCount} thiết bị khác có thể đăng xuất
                    </p>
                  </>
                )}
              </InfoCard>
            </div>
          ) : null}

          {!loading && tab === 'tool' ? (
            <div className="sd-panel">
              <div className="sd-tool-grid">
                <InfoCard
                  title="File session"
                  action={
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={rechecking}
                      onClick={() => onRecheck(phone)}
                    >
                      {rechecking ? 'Đang check…' : 'Kiểm tra lại'}
                    </button>
                  }
                >
                  {detailData ? (
                    <>
                      <dl className="sd-stat-grid">
                        <div className="sd-stat">
                          <dt>Tồn tại</dt>
                          <dd>{detailData.exists ? 'Có' : 'Không'}</dd>
                        </div>
                        <div className="sd-stat">
                          <dt>Kích thước</dt>
                          <dd>{formatBytes(detailData.size_bytes)}</dd>
                        </div>
                        <div className="sd-stat">
                          <dt>Sửa lần cuối</dt>
                          <dd>{formatDate(detailData.modified_at)}</dd>
                        </div>
                        <div className="sd-stat">
                          <dt>Journal</dt>
                          <dd>{detailData.has_journal ? 'Có' : 'Không'}</dd>
                        </div>
                      </dl>
                      {detailData.session_file ? (
                        <p className="sd-path-box sd-path-box--spaced">
                          <code>{detailData.session_file}</code>
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="muted">Không có dữ liệu file.</p>
                  )}
                </InfoCard>

                <InfoCard title="Metadata DB">
                  {detailData?.db_metadata ? (
                    <>
                      <dl className="sd-stat-grid">
                        <div className="sd-stat">
                          <dt>Nguồn</dt>
                          <dd>{detailData.db_metadata.source}</dd>
                        </div>
                        <div className="sd-stat">
                          <dt>Trạng thái</dt>
                          <dd>
                            <StatusBadge status={detailData.db_metadata.status} />
                          </dd>
                        </div>
                        {detailData.db_metadata.display_name ? (
                          <div className="sd-stat sd-stat--full">
                            <dt>Tên hiển thị</dt>
                            <dd>{detailData.db_metadata.display_name}</dd>
                          </div>
                        ) : null}
                        <div className="sd-stat sd-stat--full">
                          <dt>Sync lần cuối</dt>
                          <dd>{formatDate(detailData.db_metadata.last_synced_at)}</dd>
                        </div>
                      </dl>
                    </>
                  ) : (
                    <p className="muted">Chưa có metadata — bấm Kiểm tra để sync DB.</p>
                  )}
                </InfoCard>
              </div>

              {detailData?.db_metadata?.recent_audit.length ? (
                <InfoCard title="Audit gần đây">
                  <ul className="sd-timeline">
                    {detailData.db_metadata.recent_audit.map((item) => (
                      <li key={`${item.action}-${item.created_at}`}>
                        <span className="sd-timeline-dot" aria-hidden />
                        <div className="sd-timeline-body">
                          <span className="sd-timeline-action">
                            {auditActionLabel(item.action)}
                          </span>
                          <span className="sd-timeline-time">
                            {formatDate(item.created_at)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </InfoCard>
              ) : null}
            </div>
          ) : null}
        </div>

        {!loading ? (
          <footer className="sd-footer">
            <nav className="sd-footer-links" aria-label="Liên kết nhanh">
              <Link to="/roster" className="sd-footer-link">
                Sổ acc
              </Link>
              <Link
                to={`/security?phone=${encodeURIComponent(phone)}`}
                className="sd-footer-link"
              >
                Bảo mật
              </Link>
              <Link
                to={`/audit?phone=${encodeURIComponent(phone)}`}
                className="sd-footer-link"
              >
                Audit
              </Link>
            </nav>
            {tab === 'tool' ? (
              <button
                type="button"
                className="btn btn--danger btn--sm"
                disabled={deleting}
                onClick={() => onDelete(phone)}
              >
                {deleting ? 'Đang xóa…' : 'Xóa khỏi tool'}
              </button>
            ) : (
              <p className="sd-footer-hint">Xóa file session nằm ở tab Session tool</p>
            )}
          </footer>
        ) : null}
      </div>
    </div>
    </>
  )
}
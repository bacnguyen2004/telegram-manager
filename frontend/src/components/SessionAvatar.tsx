import { useState, type CSSProperties } from 'react'
import { api } from '../api/client'
import { avatarHue, dialogInitials } from '../utils/avatar'

interface SessionAvatarProps {
  phone: string
  label: string
  hasAvatar?: boolean
  avatarUpdatedAt?: string | null
  size?: 'sm' | 'md' | 'lg'
}

export function SessionAvatar({
  phone,
  label,
  hasAvatar = false,
  avatarUpdatedAt,
  size = 'md',
}: SessionAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const seed = label.trim() || phone
  const initials = dialogInitials(seed === '—' ? phone : seed)
  const showPhoto = hasAvatar && !imgFailed

  return (
    <span
      className={`sessions-avatar sessions-avatar--${size}${showPhoto ? ' sessions-avatar--photo' : ''}`}
      style={
        showPhoto
          ? undefined
          : ({ '--avatar-hue': avatarHue(seed) } as CSSProperties)
      }
      aria-hidden
    >
      {showPhoto ? (
        <img
          src={api.sessionAvatarUrl(phone, avatarUpdatedAt)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  )
}
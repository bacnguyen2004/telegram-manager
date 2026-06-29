import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { HealthData } from '../types/api'

export function HealthBadge() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    async function poll() {
      try {
        const res = await api.health()
        setOffline(false)
        if (res.success && res.data) {
          setHealth(res.data)
        } else {
          setHealth(null)
        }
      } catch {
        setOffline(true)
        setHealth(null)
      }
    }

    void poll()
    const timer = window.setInterval(() => void poll(), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const status = offline ? 'offline' : (health?.status ?? 'unknown')

  return (
    <Link to="/health" className={`health-badge health-badge--${status}`}>
      <span className="health-dot" />
      {offline
        ? 'Backend offline'
        : health?.status === 'ok'
          ? 'Backend OK'
          : health?.status === 'degraded'
            ? 'Backend degraded'
            : 'Đang kiểm tra…'}
    </Link>
  )
}
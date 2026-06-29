export function dialogInitials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return (title.slice(0, 2) || '?').toUpperCase()
}

export function avatarHue(seed: string): number {
  let hash = 0
  for (const ch of seed) hash = (hash + ch.charCodeAt(0)) % 360
  return hash
}

export function mediaTypeLabel(contentType: string): string {
  const map: Record<string, string> = {
    photo: 'Ảnh',
    sticker: 'Sticker',
    video: 'Video',
    audio: 'Audio',
    document: 'File',
    media: 'Media',
  }
  return map[contentType] ?? contentType
}
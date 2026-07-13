import { describe, expect, it } from 'vitest'
import {
  buildAutoPersonas,
  defaultPersonaForSlot,
  personaToSpeaker,
  speakerIdFromIndex,
  summarizePersonas,
} from './campaignPersona'

describe('campaignPersona', () => {
  it('speakerIdFromIndex uses a,b,c then a2', () => {
    expect(speakerIdFromIndex(0)).toBe('a')
    expect(speakerIdFromIndex(1)).toBe('b')
    expect(speakerIdFromIndex(25)).toBe('z')
    expect(speakerIdFromIndex(26)).toBe('a2')
  })

  it('defaultPersonaForSlot diversifies roles and assets', () => {
    const p0 = defaultPersonaForSlot(0)
    const p1 = defaultPersonaForSlot(1)
    expect(p0.role).toBeTruthy()
    expect(p1.role).toBeTruthy()
    expect(p0.favoriteAssets.length).toBeGreaterThan(0)
    // first slot can open by default
    expect(p0.canOpen).toBe(true)
  })

  it('buildAutoPersonas assigns lead to first phone and unique speaker ids', () => {
    const phones = ['+84901', '+84902', '+84903', '+84904']
    const rows = buildAutoPersonas(phones, {
      language: 'en',
      labelsByPhone: { '+84901': 'Alex' },
    })
    expect(rows).toHaveLength(4)
    expect(rows[0].role).toBe('lead')
    expect(rows[0].name).toBe('Alex')
    expect(rows[0].canOpen).toBe(true)
    const ids = new Set(rows.map((r) => r.speakerId))
    expect(ids.size).toBe(4)
    const speakers = rows.map(personaToSpeaker)
    expect(speakers[0]).toMatchObject({
      id: 'a',
      label: 'Alex',
      phone: '+84901',
      role: 'lead',
    })
  })

  it('summarizePersonas is non-empty and includes names', () => {
    const rows = buildAutoPersonas(['+1', '+2'], { language: 'vi' })
    const summary = summarizePersonas(rows)
    expect(summary).toContain(rows[0].name)
    expect(summary).toContain(rows[0].role)
  })
})

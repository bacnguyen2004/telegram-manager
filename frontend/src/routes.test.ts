import { describe, expect, it } from 'vitest'
import { matchRoutes } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'

const routes: RouteObject[] = [
  {
    path: '/',
    element: null,
    children: [
      { index: true, element: null },
      { path: 'sessions', element: null },
      { path: 'roster', element: null },
      { path: 'auto-profile', element: null },
      { path: 'conversation', element: null },
      { path: 'campaign', element: null },
      { path: 'groups', element: null },
    ],
  },
  { path: '*', element: null },
]

describe('app routes', () => {
  it('matches /roster under layout', () => {
    const matches = matchRoutes(routes, '/roster')
    expect(matches).not.toBeNull()
    expect(matches?.some((m) => m.route.path === 'roster')).toBe(true)
  })

  it('matches /auto-profile under layout', () => {
    const matches = matchRoutes(routes, '/auto-profile')
    expect(matches).not.toBeNull()
    expect(matches?.some((m) => m.route.path === 'auto-profile')).toBe(true)
  })

  it('matches /conversation under layout (campaign UI)', () => {
    const matches = matchRoutes(routes, '/conversation')
    expect(matches).not.toBeNull()
    expect(matches?.some((m) => m.route.path === 'conversation')).toBe(true)
  })

  it('still has /campaign route (redirect target in app router)', () => {
    const matches = matchRoutes(routes, '/campaign')
    expect(matches).not.toBeNull()
    expect(matches?.some((m) => m.route.path === 'campaign')).toBe(true)
  })

  it('does not send /roster to splat only', () => {
    const matches = matchRoutes(routes, '/roster')
    const splatOnly = matches?.length === 1 && matches[0].route.path === '*'
    expect(splatOnly).toBe(false)
  })
})
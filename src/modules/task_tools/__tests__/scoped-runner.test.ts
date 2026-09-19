import { describe, expect, it } from '@jest/globals'
import type { ApiRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import { selectionCookie, withSelectionCookie } from '../lib/scoped-runner'

describe('scoped runner', () => {
  it('builds the selection cookie only from a complete trusted scope', () => {
    expect(selectionCookie({ tenantId: 't-1', organizationId: 'o-1' })).toBe(
      'om_selected_tenant=t-1; om_selected_org=o-1',
    )
    expect(selectionCookie({ tenantId: 't-1', organizationId: null })).toBeNull()
  })

  it('pins the selection cookie on every handler while keeping route exports', async () => {
    const seen: Array<string | null> = []
    const route: ApiRouteManifestEntry = {
      moduleId: 'staff',
      kind: 'route-file',
      path: '/staff/x',
      methods: ['GET', 'POST'],
      load: async () => ({
        openApi: { tag: 'x' },
        metadata: { GET: { requireAuth: true } },
        GET: (req: Request) => { seen.push(req.headers.get('cookie')); return new Response('{}') },
        POST: (req: Request) => { seen.push(req.headers.get('cookie')); return new Response('{}') },
      }),
    }
    const [wrapped] = withSelectionCookie([route], 'om_selected_org=o-1')
    const mod = await wrapped!.load()
    expect(mod.openApi).toEqual({ tag: 'x' })
    expect(mod.metadata).toEqual({ GET: { requireAuth: true } })
    await (mod.GET as (req: Request) => Promise<Response>)(new Request('http://internal.local/api/staff/x'))
    await (mod.POST as (req: Request) => Promise<Response>)(
      new Request('http://internal.local/api/staff/x', { method: 'POST', headers: { cookie: 'om_selected_org=forged' } }),
    )
    expect(seen).toEqual(['om_selected_org=o-1', 'om_selected_org=o-1'])
  })
})

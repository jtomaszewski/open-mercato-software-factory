/** @jest-environment jsdom */
import * as React from 'react'
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import type { TaskRunDetail } from '../../task_delegation/lib/runsQuery'
import type { ChangeRequestDto } from '../lib/changeRequests'

const CHANGE_REQUEST_ID = '44444444-4444-4444-8444-444444444444'
let grantedFeatures: string[] = []

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string, fallback?: string) => fallback ?? key }))
jest.mock('@open-mercato/shared/security/features', () => ({ hasFeature: (features: string[] | undefined, feature: string) => (features ?? []).includes(feature) }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: { grantedFeatures } }) }))
jest.mock('next/navigation', () => ({ usePathname: () => '/backend/code/changes' }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (path: string) => {
    if (path.includes('/change-requests/')) return Promise.resolve({ ok: true, status: 200, result: loaded })
    return Promise.resolve({ ok: false, status: 404, result: null })
  },
  apiCallOrThrow: jest.fn(),
}))

const changeRequest = {
  id: CHANGE_REQUEST_ID,
  taskId: '11111111-1111-4111-8111-111111111111',
  delegationId: '33333333-3333-4333-8333-333333333333',
  projectId: '22222222-2222-4222-8222-222222222222',
  projectName: 'www',
  title: 'Update the tank',
  summary: 'Capacity 5000 l → 5200 l',
  repoFullName: 'o/site',
  baseBranch: 'main',
  branch: null,
  number: 18,
  url: 'https://github.test/o/site/pull/18',
  headSha: null,
  mergeCommitSha: null,
  status: 'open',
  statusReason: null,
  decidedAt: null,
  decidedByName: null,
  createdAt: '2026-09-20T08:21:00.000Z',
  updatedAt: '2026-09-20T08:25:00.000Z',
} as unknown as ChangeRequestDto

const run = {
  taskId: changeRequest.taskId,
  taskTitle: 'Update the tank',
  taskDescription: null,
  projectId: changeRequest.projectId,
  projectName: 'www',
  delegation: { startedAt: '2026-09-20T08:21:00.000Z', releasedAt: null, closeReason: null, links: [] },
  process: { id: 'e6250809-f9f5-43a4-816e-cbc1b6ee16bc', status: 'completed', milestones: [] },
  steps: [],
  agentRuns: [
    { id: '60cfeee9-fdeb-4e6b-8f3a-4952c3b1b340', agentId: 'website_publishing.researcher', status: 'ok', stepId: 'research', startedAt: '2026-09-20T08:21:35.238Z', completedAt: '2026-09-20T08:21:48.923Z', latencyMs: 13552, errorMessage: null },
    { id: '1037c656-df95-4f31-b6b1-f1f37d86bd06', agentId: 'website_publishing.developer', status: 'ok', stepId: 'develop', startedAt: '2026-09-20T08:21:50.090Z', completedAt: '2026-09-20T08:24:47.812Z', latencyMs: 177593, errorMessage: null },
  ],
} as unknown as TaskRunDetail

const loaded = { changeRequest, run }

import { ChangeRequestDetail } from '../components/ChangeRequestDetail'

afterEach(() => { grantedFeatures = [] })

describe('ChangeRequestDetail', () => {
  it('links the run to the trace of every agent that worked on it', async () => {
    grantedFeatures = ['agent_orchestrator.trace.view']
    render(<ChangeRequestDetail id={CHANGE_REQUEST_ID} />)

    await waitFor(() => expect(screen.getByTestId('change-request-timeline')).toBeInTheDocument())
    const traceLinks = screen.getAllByRole('link', { name: 'Open trace' })
      .map((link) => link.getAttribute('href'))
    expect(traceLinks).toEqual(expect.arrayContaining([
      '/backend/traces/60cfeee9-fdeb-4e6b-8f3a-4952c3b1b340',
      '/backend/traces/1037c656-df95-4f31-b6b1-f1f37d86bd06',
    ]))
    // The header action goes to the newest invocation — what the run last did.
    expect(screen.getByTestId('change-request-open-trace')).toHaveAttribute('href', '/backend/traces/1037c656-df95-4f31-b6b1-f1f37d86bd06')
  })

  it('offers no technical link a reader is not allowed to follow', async () => {
    render(<ChangeRequestDetail id={CHANGE_REQUEST_ID} />)

    await waitFor(() => expect(screen.getByTestId('change-request-timeline')).toBeInTheDocument())
    expect(screen.queryByTestId('change-request-open-trace')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open trace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Technical details' })).not.toBeInTheDocument()
  })
})

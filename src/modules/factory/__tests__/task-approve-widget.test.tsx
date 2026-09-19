/** @jest-environment jsdom */
import * as React from 'react'
import { beforeEach, expect, it, jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import type { TaskReview } from '../lib/review'
import { injectionTable } from '../widgets/injection-table'
import TaskApprove from '../widgets/injection/task-approve/widget.client'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const readApi = jest.fn<(path: string) => Promise<unknown>>()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string, fallback?: string) => fallback ?? key }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: { currentOrganization: { id: 'org' } } }) }))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ APP_EVENT_DOM_NAME: 'om:event', useAppEvent: () => {} }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (path: string) => readApi(path),
}))

const review: TaskReview = {
  taskId: TASK_ID,
  delegationActive: true,
  previewUrl: 'https://preview.test/',
  pr: { number: 8, url: 'https://github.test/o/r/pull/8', state: 'open', merged: false, headSha: 'sha' },
  checks: [{ name: 'build', status: 'completed', conclusion: 'success', url: 'https://github.test/checks/1' }],
  files: [{ filename: 'index.html', status: 'modified', additions: 14, deletions: 14, patch: '@@\n+new\n-old' }],
}

beforeEach(() => { readApi.mockReset().mockResolvedValue({ review }) })

it('sits under the run-status bar in the drawer header, not in the sidebar', () => {
  expect(injectionTable['detail:staff:staff_time_task:header']).toEqual({ widgetId: 'factory.injection.task-approve', priority: 10 })
  expect(injectionTable['detail:staff:staff_time_task:sidebar']).toBeUndefined()
})

it('shows the preview and the publish action, and folds the pull request and the diff away', async () => {
  render(<TaskApprove context={{ taskId: TASK_ID }} />)
  await waitFor(() => expect(screen.getByTestId('factory-task-approve')).toBeInTheDocument())

  expect(screen.getByTestId('factory-review-preview')).toHaveAttribute('href', 'https://preview.test/')
  expect(screen.getByRole('button', { name: 'factory.approve.action' })).toBeInTheDocument()

  const technical = screen.getByTestId('factory-review-technical')
  expect(technical.tagName).toBe('DETAILS')
  expect(technical).not.toHaveAttribute('open')
  // The pull request and the per-file diff live inside the collapsed block, nowhere else.
  expect(technical).toContainElement(screen.getByRole('link', { name: 'PR #8' }))
  expect(technical).toContainElement(screen.getByTestId('factory-review-file'))
})

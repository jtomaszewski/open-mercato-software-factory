/** @jest-environment jsdom */
import * as React from 'react'
import { jest, test, expect } from '@jest/globals'
import { act, render, screen } from '@testing-library/react'
import { RepositoryConnect } from '../RepositoryConnect'

let mockQuery = new URLSearchParams('code=test-code&state=test-state')
const mockTranslate = (key: string) => key
const mockRunMutation = jest.fn()
const mockComplete = jest.fn()
jest.mock('next/navigation', () => ({ useSearchParams: () => mockQuery }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({ useGuardedMutation: () => ({ runMutation: mockRunMutation }) }))
jest.mock('../../lib/connection-completion', () => ({ completeConnectionOnce: (...args: unknown[]) => mockComplete(...args) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCallOrThrow: jest.fn(), readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/Page', () => ({ Page: ({ children }: React.PropsWithChildren) => <div>{children}</div>, PageBody: ({ children }: React.PropsWithChildren) => <div>{children}</div> }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: () => <div>Connected repository picker</div> }))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => null }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: () => null }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>, ErrorMessage: ({ label }: { label: string }) => <div>{label}</div> }))

test('OAuth URL cleanup does not discard the in-flight connection result', async () => {
  let finish!: (result: unknown) => void
  mockComplete.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  mockQuery = new URLSearchParams('code=test-code&state=test-state')
  const view = render(<RepositoryConnect />)
  mockQuery = new URLSearchParams()
  view.rerender(<RepositoryConnect />)
  await act(async () => { finish({ status: 'connected', connectionId: 'connection-1', grantedRepositories: [] }) })
  expect(screen.queryByText('repositories.connect.invalidReturn')).toBeNull()
  expect(screen.getByText('Connected repository picker')).toBeTruthy()
  expect(mockComplete).toHaveBeenCalledTimes(1)
})

test('offers a local return path when callback parameters are missing', async () => {
  mockQuery = new URLSearchParams()
  render(<RepositoryConnect />)
  expect(await screen.findByText('repositories.connect.invalidReturn')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'repositories.connect.back' })).toHaveAttribute('href', '/backend/repositories')
})

test('offers a local return path when connection completion fails', async () => {
  mockQuery = new URLSearchParams('code=test-code&state=failed-state')
  mockComplete.mockImplementationOnce(async () => { throw new Error('connection failed') })
  render(<RepositoryConnect />)
  expect(await screen.findByText('repositories.connect.completeError')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'repositories.connect.back' })).toHaveAttribute('href', '/backend/repositories')
})

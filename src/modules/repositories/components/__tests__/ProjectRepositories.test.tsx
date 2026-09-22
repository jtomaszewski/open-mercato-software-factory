/** @jest-environment jsdom */
import * as React from 'react'
import { beforeEach, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProjectRepositories from '../../widgets/injection/project-repositories/widget.client'

const readApi = jest.fn<(path: string) => Promise<unknown>>()
const mutateApi = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const version = '2026-09-20T10:00:00.000Z'
const repo = { id: 'repo-1', fullName: 'example/website', status: 'active' }
const link = { id: 'link-1', repositoryId: repo.id, fullName: repo.fullName, status: 'active', isDefault: true, updatedAt: version }
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string, fallback?: string) => fallback ?? key }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (path: string) => readApi(path),
  apiCallOrThrow: (...args: unknown[]) => mutateApi(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(), retryLastMutation: jest.fn() }),
}))
beforeEach(() => { readApi.mockReset(); mutateApi.mockReset().mockResolvedValue({}) })

it('provides a next step instead of an empty selector when no repository is registered', async () => {
  readApi.mockResolvedValue({ items: [] })
  render(<ProjectRepositories context={{ projectId: 'project-1' }} />)
  expect(await screen.findByText('Register a repository before linking it to this project.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Manage repositories' })).toHaveAttribute('href', '/backend/repositories')
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
})

it('distinguishes all repositories already linked and explains the default', async () => {
  readApi.mockImplementation(async (path) => ({ items: path.includes('project-links') ? [link] : [repo] }))
  render(<ProjectRepositories context={{ projectId: 'project-1' }} />)
  expect(await screen.findByText('The listed repositories are already linked to this project.')).toBeInTheDocument()
  expect(screen.getByText("Agents use the default repository for this project's code changes.")).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Disconnect from project' })).toBeInTheDocument()
})

it('shows the repository selector when a repository can be linked', async () => {
  readApi.mockImplementation(async (path) => ({ items: path.includes('project-links') ? [] : [repo] }))
  render(<ProjectRepositories context={{ projectId: 'project-1' }} />)
  expect(await screen.findByRole('combobox', { name: 'Choose a repository' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add repository' })).toBeDisabled()
})

it('keeps disconnection scoped to the project link and its version', async () => {
  readApi.mockImplementation(async (path) => ({ items: path.includes('project-links') ? [link] : [repo] }))
  render(<ProjectRepositories context={{ projectId: 'project-1' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect from project' }))
  await waitFor(() => expect(mutateApi).toHaveBeenCalledTimes(1))
  expect(mutateApi).toHaveBeenCalledWith('/api/repositories/project-links', expect.objectContaining({
    method: 'DELETE', body: JSON.stringify({ projectId: 'project-1', repositoryId: 'repo-1', updatedAt: version }),
  }))
})

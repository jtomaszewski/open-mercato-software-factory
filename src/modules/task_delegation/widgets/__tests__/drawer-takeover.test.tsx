/** @jest-environment jsdom */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import { injectionTable } from '../injection-table'
import TaskAssignedToHeader, { HIDE_STAFF_ASSIGNEE_FIELD, STAFF_ASSIGNEE_FIELD_TESTID } from '../injection/task-assigned-to/widget.client'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string, fallback?: string) => fallback ?? key }))
jest.mock('../../components/AssignedToPicker', () => ({ AssignedToPicker: () => null }))

const DRAWER_SOURCE = path.join(process.cwd(), 'node_modules/@open-mercato/core/src/modules/staff/lib/time-tracking-ui/TaskDrawer.tsx')

/**
 * The tripwire for the one place this module depends on `staff`'s internals. `staff` 0.8.0 does not
 * publish a seam for the drawer's assignee field, so the picker hides it with a scoped rule; if the
 * drawer's markup moves, this fails at `yarn test` instead of leaving two assignment controls — one
 * visible, one only reachable by keyboard — in front of a user.
 */
it('pins the single drawer assignee control our rule hides', () => {
  const source = readFileSync(DRAWER_SOURCE, 'utf8')
  const occurrences = source.match(new RegExp(`data-testid="${STAFF_ASSIGNEE_FIELD_TESTID}"`, 'g')) ?? []
  expect(occurrences).toHaveLength(1)
  expect(HIDE_STAFF_ASSIGNEE_FIELD).toContain(`[data-testid="${STAFF_ASSIGNEE_FIELD_TESTID}"]`)
  // `display: none` is what also takes the field out of the tab order; visibility/opacity would not.
  expect(HIDE_STAFF_ASSIGNEE_FIELD).toContain('display: none')
})

it('renders the picker and its rule in the drawer header spot', () => {
  render(<TaskAssignedToHeader context={{ taskId: '11111111-1111-4111-8111-111111111111' }} />)
  const host = screen.getByTestId('task-assigned-to')
  expect(host).toBeInTheDocument()
  expect(host.querySelector('style')?.textContent).toContain(STAFF_ASSIGNEE_FIELD_TESTID)
  expect(injectionTable['detail:staff:staff_time_task:header']).toMatchObject({ widgetId: 'task_delegation.injection.task-assigned-to' })
})

it('renders nothing without a task in context', () => {
  const { container } = render(<TaskAssignedToHeader context={{}} />)
  expect(container).toBeEmptyDOMElement()
})

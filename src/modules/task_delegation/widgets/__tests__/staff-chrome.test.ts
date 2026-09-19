import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from '@jest/globals'
import pl from '../../i18n/pl.json'
import en from '../../i18n/en.json'
import {
  BLANKED_STAFF_KEYS,
  HIDE_OWNER_IRRELEVANT_CARD_CHROME,
  HIDE_OWNER_IRRELEVANT_DRAWER_CHROME,
  OWNER_IRRELEVANT_DRAWER_TESTIDS,
} from '../../components/staffChrome'
import { injectionTable } from '../injection-table'

const STAFF_UI = path.join(process.cwd(), 'node_modules/@open-mercato/core/src/modules/staff/lib/time-tracking-ui')
const read = (file: string) => readFileSync(path.join(STAFF_UI, file), 'utf8')

/**
 * The tripwire for every `staff` internal this module hides. `staff` 0.8.0 publishes no seam for
 * dropping a drawer section or a card control, so the rules match its own markup; when that markup
 * moves, this fails at `yarn test` rather than leaving a company owner looking at a timer we meant
 * to hide — or, worse, at a drawer section we meant to keep and accidentally hid.
 */
describe('the drawer chrome we hide', () => {
  const drawer = read('TaskDrawer.tsx')
  const quickLog = read('TaskQuickLog.tsx')
  const tagPicker = read('TagPicker.tsx')
  const sources = `${drawer}\n${quickLog}\n${tagPicker}`

  it.each(OWNER_IRRELEVANT_DRAWER_TESTIDS)('still finds staff\'s %s section', (testId) => {
    expect(sources).toContain(`data-testid="${testId}"`)
    expect(HIDE_OWNER_IRRELEVANT_DRAWER_CHROME).toContain(`[data-testid="${testId}"]`)
  })

  it('still finds the subtasks section it only hides while empty', () => {
    expect(drawer).toContain('data-testid="task-drawer-subtasks"')
    expect(HIDE_OWNER_IRRELEVANT_DRAWER_CHROME).toContain('[data-testid="task-drawer-subtasks"]:not(:has(li))')
  })

  it('still finds the tag picker inside the properties section', () => {
    expect(drawer).toContain('data-testid="task-drawer-properties"')
    expect(drawer).toContain('testIdPrefix="task-drawer"')
    expect(tagPicker).toContain('`${testIdPrefix}-tag-select`')
  })

  it('keeps the sections the owner still needs', () => {
    // Comments, the timeline and the status select are never named by a hiding rule.
    expect(HIDE_OWNER_IRRELEVANT_DRAWER_CHROME).not.toContain('task-drawer-status-select')
    expect(HIDE_OWNER_IRRELEVANT_DRAWER_CHROME).not.toContain('comment')
    expect(drawer).toContain('data-testid="task-drawer-status-select"')
  })

  it('takes the hidden controls out of the tab order rather than merely out of sight', () => {
    expect(HIDE_OWNER_IRRELEVANT_DRAWER_CHROME).toContain('display: none')
    expect(HIDE_OWNER_IRRELEVANT_DRAWER_CHROME).not.toMatch(/visibility:\s*hidden|opacity:\s*0/)
  })
})

describe('the board-card chrome we hide', () => {
  const card = read('KanbanCard.tsx')

  it('still finds the card root, its tag row, its separator and its quick actions', () => {
    expect(card).toContain('data-task-card={task.id}')
    expect(card).toContain('className="flex flex-wrap gap-1"')
    expect(card).toContain('<div className="h-px w-full bg-border" aria-hidden="true" />')
    expect(card).toContain('data-testid={`kanban-card-actions-${task.id}`}')
  })

  it('hides the timer and add-time buttons but not the move menu', () => {
    expect(HIDE_OWNER_IRRELEVANT_CARD_CHROME).toContain('[data-testid^="kanban-card-actions-"] > button')
    // The move control is wrapped in a div, so a child-button rule cannot reach it.
    expect(card).toContain('<div className="relative">')
    expect(HIDE_OWNER_IRRELEVANT_CARD_CHROME).not.toContain('kanban-card-move')
  })

  it('hides the per-column logged total but keeps the task count', () => {
    const column = read('KanbanColumn.tsx')
    expect(column).toContain('data-testid={`kanban-hours-${status.id}`}')
    expect(column).toContain('data-testid={`kanban-count-${status.id}`}')
    expect(HIDE_OWNER_IRRELEVANT_CARD_CHROME).toContain('[data-testid^="kanban-hours-"]')
    expect(HIDE_OWNER_IRRELEVANT_CARD_CHROME).not.toContain('kanban-count-')
  })

  it('blanks the logged segment of the board subtitle, which no selector can reach', () => {
    const screen = read('TaskBoardScreen.tsx')
    // `staff` joins the subtitle from parts and drops the empty ones — that is what makes an
    // empty translation remove the segment instead of rendering a stray separator.
    expect(screen).toContain("t('staff.time_tracking.board.summary.logged'")
    expect(screen).toContain("part.length > 0")
    for (const key of BLANKED_STAFF_KEYS) {
      expect((pl as Record<string, string>)[key]).toBe('')
      expect((en as Record<string, string>)[key]).toBe('')
    }
    // The task count shares the line and stays.
    expect((pl as Record<string, string>)['staff.time_tracking.board.summary.tasks']).toBeUndefined()
  })

  it('is mounted once for the whole board rather than once per card', () => {
    expect(injectionTable['staff.time_task.board:toolbar'])
      .toEqual({ widgetId: 'task_delegation.injection.board-chrome', priority: 90 })
  })
})

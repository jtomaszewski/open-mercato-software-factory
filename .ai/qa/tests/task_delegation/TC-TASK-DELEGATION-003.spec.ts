import { test, expect } from '@playwright/test'

/**
 * The drawer takeover, in a real browser: the picker replaces `staff`'s own assignee field, and the
 * field it replaces is neither visible nor focusable. `staff` 0.8.0 publishes no seam for that
 * field, so the picker hides it with a scoped rule; `src/modules/task_delegation/widgets/__tests__/
 * drawer-takeover.test.tsx` pins the selector at unit level and this case proves the result.
 *
 * The environment needs one staff task to open. A run without any (a bare ephemeral database) skips
 * with that reason rather than passing on an empty page — seed it with
 * `yarn mercato task_delegation seed-demo`.
 */
const EMAIL = process.env.OM_INIT_SUPERADMIN_EMAIL ?? 'superadmin@acme.com'
const PASSWORD = process.env.OM_INIT_SUPERADMIN_PASSWORD ?? 'secret'

test('the task drawer offers exactly one assignment control', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { form: { email: EMAIL, password: PASSWORD }, maxRedirects: 0 })
  expect([200, 204, 302, 303, 307].includes(login.status()), `login answered ${login.status()}`).toBe(true)

  const tasks = await page.request.get('/api/staff/timesheets/tasks?page=1&pageSize=1')
  test.skip(!tasks.ok(), `staff tasks unavailable (${tasks.status()}); seed the demo board first`)
  const body = await tasks.json() as { items?: { id?: string }[] }
  const taskId = body.items?.[0]?.id
  test.skip(!taskId, 'no staff task in this environment; seed the demo board first')

  await page.goto(`/backend/staff/time-tracking/board?task=${taskId}`)
  await expect(page.getByTestId('task-assigned-to')).toBeVisible()
  await expect(page.getByTestId('assigned-to-trigger').first()).toBeVisible()

  const staffField = page.getByTestId('task-drawer-assignee-select')
  await expect(staffField).toBeHidden()
  const focusState = await page.evaluate(() => {
    const field = document.querySelector<HTMLElement>('[data-testid="task-drawer-assignee-select"]')
    if (!field) return 'absent'
    field.focus()
    return document.activeElement === field ? 'focusable' : 'not-focusable'
  })
  expect(focusState, 'staff\'s hidden assignee field must stay out of the tab order').not.toBe('focusable')
})

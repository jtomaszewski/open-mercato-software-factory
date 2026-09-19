import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'

/**
 * Every run state of the task drawer, in a real browser, in Polish.
 *
 * The states are driven by the orchestrator, so reaching all of them for real would mean seeding
 * nine process instances. Instead the delegation read this module's widgets call is stubbed per
 * state and everything else — staff's drawer, the injection spots, the locale, the design system —
 * is the running application. That is exactly the surface this change touches.
 *
 * Also the screenshot source for the PR: run with `PW_STATE_SHOTS=1` to write
 * `.ai/qa/screenshots/task-drawer-<state>.png`.
 *
 * The environment needs one staff task to open. A run without any (a bare ephemeral database)
 * skips with that reason — seed it with `yarn mercato task_delegation seed-demo`.
 */
/**
 * The accounts `mercato init` seeds locally: the superadmin, and the `admin@<domain>` /
 * `employee@<domain>` users it derives from the superadmin's domain. The ephemeral integration
 * harness signs in as `admin@acme.com`, a bare `yarn initialize` as `superadmin@acme.com`, so the
 * helper below tries each in turn instead of assuming one environment.
 */
const ACCOUNTS: { email: string; password: string }[] = [
  { email: process.env.OM_INIT_SUPERADMIN_EMAIL ?? 'superadmin@acme.com', password: process.env.OM_INIT_SUPERADMIN_PASSWORD ?? 'secret' },
  { email: process.env.OM_INIT_ADMIN_EMAIL ?? 'admin@acme.com', password: process.env.OM_INIT_ADMIN_PASSWORD ?? 'secret' },
]

async function signIn(page: Page): Promise<void> {
  const answers: string[] = []
  for (const account of ACCOUNTS) {
    const response = await page.request.post('/api/auth/login', { form: account, maxRedirects: 0 })
    if ([200, 204, 302, 303, 307].includes(response.status())) return
    answers.push(`${account.email}: ${response.status()}`)
  }
  throw new Error(`no seeded account could sign in (${answers.join(', ')})`)
}
const SHOTS = process.env.PW_STATE_SHOTS === '1'
const SHOT_DIR = path.join(process.cwd(), '.ai', 'qa', 'screenshots')

type Delegation = Record<string, unknown> | null

function delegation(overrides: Record<string, unknown> = {}): Delegation {
  return {
    id: '00000000-0000-4000-8000-00000000d001',
    delegateUserId: '00000000-0000-4000-8000-00000000a001',
    delegateName: 'Software Engineer',
    releasedAt: null,
    updatedAt: new Date().toISOString(),
    startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    processInstanceId: '00000000-0000-4000-8000-00000000p001',
    links: [],
    outcome: null,
    closeReason: null,
    runState: 'running',
    ...overrides,
  }
}

const REVIEW = {
  delegationActive: true,
  pr: { number: 8, url: 'https://github.test/o/site/pull/8', state: 'open', merged: false, headSha: 'abc123' },
  previewUrl: 'https://preview.test/stal-zbiorniki',
  checks: [{ name: 'build', status: 'completed', conclusion: 'success', url: 'https://github.test/checks/1' }],
  files: [{ filename: 'index.html', status: 'modified', additions: 14, deletions: 14, patch: '@@ -1 +1 @@\n-<h1>Stare</h1>\n+<h1>Nowe</h1>' }],
}

/** Answers the batched delegation read with the same stub for every task id it asks about. */
async function stub(page: Page, taskId: string, value: Delegation, review: Record<string, unknown> | null) {
  await page.route('**/api/task_delegation/delegations?*', async (route) => {
    const ids = new URL(route.request().url()).searchParams.get('taskIds')?.split(',') ?? []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: ids.map((id) => ({
          taskId: id,
          taskUpdatedAt: new Date().toISOString(),
          assigneeStaffMemberId: '00000000-0000-4000-8000-00000000s001',
          assigneeName: 'Jan Kowalski',
          delegation: value,
        })),
      }),
    })
  })
  await page.route('**/api/factory/tasks/*/review', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ review: review ? { ...review, taskId } : null }) })
  })
}

const STATES: { name: string; delegation: Delegation; review: Record<string, unknown> | null; expect: RegExp }[] = [
  { name: 'no-agent', delegation: null, review: null, expect: /Nikt jeszcze nad tym nie pracuje/ },
  { name: 'starting', delegation: delegation({ runState: 'starting', processInstanceId: null }), review: null, expect: /zaczyna prac/ },
  { name: 'stalled', delegation: delegation({ runState: 'stalled', processInstanceId: null }), review: null, expect: /Praca jeszcze się nie zaczęła/ },
  { name: 'running', delegation: delegation({ runState: 'running' }), review: null, expect: /pracuje · 12 min/ },
  {
    name: 'awaiting-decision',
    delegation: delegation({
      runState: 'awaiting_decision',
      links: [{ kind: 'caseload', ref: 'proposal-1', url: '/backend/agents/caseload', addedAt: new Date().toISOString() }],
    }),
    review: null,
    expect: /proponuje plan/,
  },
  {
    name: 'complete',
    delegation: delegation({
      runState: 'complete',
      links: [{ kind: 'pr', ref: '#8', url: 'https://github.test/o/site/pull/8', addedAt: new Date().toISOString() }],
    }),
    review: REVIEW,
    expect: /Zmiana gotowa/,
  },
  {
    name: 'published',
    delegation: delegation({
      runState: 'complete', outcome: 'done', releasedAt: new Date().toISOString(),
      links: [{ kind: 'pr', ref: '#8', url: 'https://github.test/o/site/pull/8', addedAt: new Date().toISOString() }],
    }),
    review: { ...REVIEW, delegationActive: false, pr: { ...REVIEW.pr, merged: true, state: 'closed' } },
    expect: /Opublikowane na stronie/,
  },
  {
    name: 'failed-configuration',
    delegation: delegation({
      runState: 'failed', outcome: 'failed', releasedAt: new Date().toISOString(), processInstanceId: null,
      closeReason: 'FACTORY_GITHUB_TOKEN is not set; the factory cannot open pull requests.',
    }),
    review: null,
    expect: /Fabryka nie jest gotowa/,
  },
  {
    name: 'failed-agent',
    delegation: delegation({
      runState: 'failed', outcome: 'failed', releasedAt: new Date().toISOString(),
      closeReason: 'Nie znalazłem pliku hero-2026.jpg w katalogu zdjęć.',
      links: [{ kind: 'run', ref: 'run-c4d9', url: '/backend/agents/runs/run-c4d9', addedAt: new Date().toISOString() }],
    }),
    review: null,
    expect: /nie dał rady/,
  },
  {
    name: 'rejected',
    delegation: delegation({
      runState: 'rejected', outcome: 'rejected', releasedAt: new Date().toISOString(),
      closeReason: 'Za duży zakres jak na tę stronę.',
    }),
    review: null,
    expect: /Plan odrzucony/,
  },
]

test.describe('the task drawer reads as one status bar in Polish', () => {
  test.beforeAll(() => { if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true }) })

  for (const state of STATES) {
    test(`says what is happening in the ${state.name} state`, async ({ page }) => {
      await signIn(page)
      await page.context().addCookies([{ name: 'locale', value: 'pl', url: 'http://localhost:3000' }])

      const tasks = await page.request.get('/api/staff/timesheets/tasks?page=1&pageSize=1')
      test.skip(!tasks.ok(), `staff tasks unavailable (${tasks.status()}); seed the demo board first`)
      const taskId = (await tasks.json() as { items?: { id?: string }[] }).items?.[0]?.id
      test.skip(!taskId, 'no staff task in this environment; seed the demo board first')

      await stub(page, taskId!, state.delegation, state.review)
      await page.goto(`/backend/staff/time-tracking/board?task=${taskId}`)

      const bar = page.getByTestId('task-run-status')
      await expect(bar).toBeVisible()
      await expect(bar).toContainText(state.expect)

      const drawer = page.getByTestId('task-drawer')
      // No raw i18n key reaches the owner, in any state.
      await expect(drawer).not.toContainText(/task_delegation\.|factory\.[a-z]+\./)
      // Staff's time-tracking chrome is gone, and gone from the tab order with it.
      for (const hidden of ['task-drawer-quick-log', 'task-drawer-logged', 'task-drawer-entries']) {
        await expect(page.getByTestId(hidden)).toBeHidden()
      }
      // What the owner still needs stays.
      await expect(page.getByTestId('task-drawer-status-select')).toBeVisible()

      if (SHOTS) await drawer.screenshot({ path: path.join(SHOT_DIR, `task-drawer-${state.name}.png`) })
    })
  }

  test('the board card says the state in one Polish phrase', async ({ page }) => {
    await signIn(page)
    await page.context().addCookies([{ name: 'locale', value: 'pl', url: 'http://localhost:3000' }])

    const tasks = await page.request.get('/api/staff/timesheets/tasks?page=1&pageSize=1')
    test.skip(!tasks.ok(), `staff tasks unavailable (${tasks.status()}); seed the demo board first`)
    const taskId = (await tasks.json() as { items?: { id?: string }[] }).items?.[0]?.id
    test.skip(!taskId, 'no staff task in this environment; seed the demo board first')

    await stub(page, taskId!, delegation({ runState: 'running' }), null)
    await page.goto('/backend/staff/time-tracking/board')
    const chip = page.getByTestId('task-delegate-badge').first()
    await expect(chip).toBeVisible()
    await expect(chip).toContainText(/Pracuje · \d+ min/)
    if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, 'board-card-chip.png'), fullPage: false })
  })
})

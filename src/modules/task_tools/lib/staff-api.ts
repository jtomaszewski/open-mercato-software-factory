/**
 * Thin client over the installed `staff` task-board routes (core 0.8.0).
 *
 * Every call goes through `createAiApiOperationRunner`, which invokes the route
 * handler in process with the caller's identity: the route's `requireFeatures`,
 * project-membership narrowing, validation, mutation guards, commands and events
 * all apply unchanged, and nothing here touches a `staff` table directly.
 *
 * Routes consumed (all under `/api`):
 *  - GET  /staff/timesheets/time-projects           (`staff.timesheets.projects.view`)
 *  - GET  /staff/timesheets/tasks                   (`staff.timesheets.tasks.view`)
 *  - POST /staff/timesheets/tasks                   (`staff.timesheets.tasks.manage`)
 *  - GET  /staff/timesheets/task-statuses           (`staff.timesheets.tasks.view`)
 *  - GET  /staff/timesheets/tasks/{id}/comments     (`staff.timesheets.tasks.view`)
 *  - POST /staff/timesheets/tasks/{id}/comments     (`staff.timesheets.tasks.manage`)
 */
import type {
  AiApiOperationRequest,
  AiApiOperationResponse,
  AiApiOperationRunner,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'

const TASKS_PATH = '/staff/timesheets/tasks'
const PROJECTS_PATH = '/staff/timesheets/time-projects'
const STATUSES_PATH = '/staff/timesheets/task-statuses'

/** Route cap for `pageSize` on every list route consumed here. */
export const MAX_PAGE_SIZE = 100
/** Bound on paging through projects/statuses, so a huge tenant cannot loop unbounded. */
const MAX_PAGES = 10

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

export type TaskToolErrorCode =
  | 'project_not_found'
  | 'task_not_found'
  | 'validation_failed'
  | 'forbidden'
  | 'not_found'
  | 'staff_api_error'

/**
 * A machine-readable tool failure. The MCP server relays `message` verbatim as the
 * tool error, so the message is the JSON payload a client can parse for `code`.
 */
export class TaskToolError extends Error {
  readonly code: TaskToolErrorCode
  readonly status: number | null
  readonly details: unknown

  constructor(code: TaskToolErrorCode, message: string, options: { status?: number | null; details?: unknown } = {}) {
    const payload: Record<string, unknown> = { code, message }
    if (options.status !== undefined && options.status !== null) payload.status = options.status
    if (options.details !== undefined) payload.details = options.details
    super(JSON.stringify(payload))
    this.name = 'TaskToolError'
    this.code = code
    this.status = options.status ?? null
    this.details = options.details
  }
}

function errorCodeForStatus(status: number): TaskToolErrorCode {
  if (status === 400 || status === 422) return 'validation_failed'
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  return 'staff_api_error'
}

export function toTaskToolError(response: AiApiOperationResponse<unknown>): TaskToolError {
  return new TaskToolError(errorCodeForStatus(response.statusCode), response.error ?? 'staff API request failed', {
    status: response.statusCode,
    details: response.details,
  })
}

type Row = Record<string, unknown>

/** List rows come back with the route's snake_case column names; accept camelCase too. */
function readString(row: Row, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.length > 0) return value
    if (value instanceof Date) return value.toISOString()
  }
  return null
}

function readItems(data: unknown): Row[] {
  if (!data || typeof data !== 'object') return []
  const items = (data as { items?: unknown }).items
  return Array.isArray(items) ? items.filter((item): item is Row => !!item && typeof item === 'object') : []
}

function readTotal(data: unknown, fallback: number): number {
  const total = data && typeof data === 'object' ? (data as { total?: unknown }).total : undefined
  return typeof total === 'number' && Number.isFinite(total) ? total : fallback
}

function readTotalPages(data: unknown): number {
  const value = data && typeof data === 'object' ? (data as { totalPages?: unknown }).totalPages : undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : 1
}

export type ProjectRecord = { id: string; code: string; name: string; status: string | null }

export type TaskRecord = {
  id: string
  reference: string | null
  title: string
  description: string | null
  timeProjectId: string | null
  taskStatusId: string | null
  parentTaskId: string | null
  assigneeStaffMemberId: string | null
  updatedAt: string | null
}

export type CommentRecord = {
  id: string
  authorUserId: string | null
  authorName: string | null
  body: string
  createdAt: string | null
}

function toProject(row: Row): ProjectRecord | null {
  const id = readString(row, 'id')
  if (!id) return null
  return {
    id,
    code: readString(row, 'code') ?? '',
    name: readString(row, 'name') ?? '',
    status: readString(row, 'status'),
  }
}

function toTask(row: Row): TaskRecord | null {
  const id = readString(row, 'id')
  if (!id) return null
  return {
    id,
    reference: readString(row, 'reference'),
    title: readString(row, 'title') ?? '',
    description: readString(row, 'description'),
    timeProjectId: readString(row, 'time_project_id', 'timeProjectId'),
    taskStatusId: readString(row, 'task_status_id', 'taskStatusId'),
    parentTaskId: readString(row, 'parent_task_id', 'parentTaskId'),
    assigneeStaffMemberId: readString(row, 'assignee_staff_member_id', 'assigneeStaffMemberId'),
    updatedAt: readString(row, 'updated_at', 'updatedAt'),
  }
}

function toComment(row: Row): CommentRecord | null {
  const id = readString(row, 'id')
  if (!id) return null
  return {
    id,
    authorUserId: readString(row, 'authorUserId'),
    // The route resolves the author's display name; users without one fall back to email.
    authorName: readString(row, 'authorName', 'authorEmail'),
    body: typeof row.body === 'string' ? row.body : '',
    createdAt: readString(row, 'createdAt'),
  }
}

/** The project code is everything before the reference's last `-` (codes may contain `-`). */
export function projectCodeFromReference(reference: string | null): string | null {
  if (!reference) return null
  const cut = reference.lastIndexOf('-')
  return cut > 0 ? reference.slice(0, cut) : null
}

/**
 * The project board with the task drawer open — `TaskBoardScreen` reads the drawer
 * task from the `task` search param (SPEC-007 Q-001). Absolute when the app URL is
 * known, so an external MCP client can link to it.
 */
export function boardHref(projectId: string, taskId: string, appUrl?: string | null): string {
  const path = `/backend/staff/time-tracking/projects/${encodeURIComponent(projectId)}/board?task=${encodeURIComponent(taskId)}`
  const base = typeof appUrl === 'string' ? appUrl.trim().replace(/\/+$/, '') : ''
  return base ? `${base}${path}` : path
}

export type TaskListQuery = {
  q?: string
  reference?: string
  id?: string
  timeProjectId?: string
  taskStatusId?: string
  pageSize?: number
  sortField?: string
  sortDir?: 'asc' | 'desc'
}

export function createStaffApi(runner: AiApiOperationRunner) {
  async function call<T = unknown>(request: AiApiOperationRequest): Promise<AiApiOperationResponse<T>> {
    return runner.run<T>(request)
  }

  async function callOrThrow<T = unknown>(request: AiApiOperationRequest): Promise<T | undefined> {
    const response = await call<T>(request)
    if (!response.success) throw toTaskToolError(response as AiApiOperationResponse<unknown>)
    return response.data
  }

  async function listProjects(options: { mine?: boolean } = {}): Promise<ProjectRecord[]> {
    const projects: ProjectRecord[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await callOrThrow({
        method: 'GET',
        path: PROJECTS_PATH,
        query: {
          page,
          pageSize: MAX_PAGE_SIZE,
          sortField: 'code',
          sortDir: 'asc',
          ...(options.mine ? { mine: 'true' } : {}),
        },
      })
      for (const row of readItems(data)) {
        const project = toProject(row)
        if (project) projects.push(project)
      }
      if (page >= readTotalPages(data)) break
    }
    return projects
  }

  /** `null` for a project that does not exist or that the caller may not see (the route answers both with 404). */
  async function getProjectById(id: string): Promise<ProjectRecord | null> {
    const response = await call({ method: 'GET', path: PROJECTS_PATH, query: { ids: id, pageSize: 1 } })
    if (!response.success) {
      if (response.statusCode === 404) return null
      throw toTaskToolError(response)
    }
    const row = readItems(response.data)[0]
    const project = row ? toProject(row) : null
    return project && project.id === id ? project : null
  }

  /**
   * Resolve a project id or code among the projects the caller can see. Codes are
   * unique per organisation; an exact match wins, then a unique case-insensitive one.
   * Anything else — including another organisation's code — is `project_not_found`.
   */
  async function resolveProject(ref: string): Promise<ProjectRecord> {
    const value = ref.trim()
    if (value.length > 0) {
      if (isUuid(value)) {
        const project = await getProjectById(value)
        if (project) return project
      } else {
        const projects = await listProjects()
        const exact = projects.find((project) => project.code === value)
        if (exact) return exact
        const lower = value.toLowerCase()
        const loose = projects.filter((project) => project.code.toLowerCase() === lower)
        if (loose.length === 1) return loose[0]
      }
    }
    throw new TaskToolError('project_not_found', `No visible project with id or code "${value}".`)
  }

  async function listTasks(query: TaskListQuery): Promise<{ items: TaskRecord[]; total: number }> {
    const data = await callOrThrow({
      method: 'GET',
      path: TASKS_PATH,
      query: {
        page: 1,
        pageSize: Math.min(Math.max(query.pageSize ?? 20, 1), MAX_PAGE_SIZE),
        q: query.q,
        reference: query.reference,
        id: query.id,
        timeProjectId: query.timeProjectId,
        taskStatusId: query.taskStatusId,
        sortField: query.sortField,
        sortDir: query.sortDir,
      },
    })
    const items = readItems(data)
      .map(toTask)
      .filter((task): task is TaskRecord => task !== null)
    return { items, total: readTotal(data, items.length) }
  }

  /**
   * One task by id and/or exact reference, or `null`. The tasks route already hides
   * tasks in projects the caller is not a member of, so missing and invisible tasks
   * are indistinguishable here.
   */
  async function findTask(ref: { taskId?: string; reference?: string }): Promise<TaskRecord | null> {
    const reference = ref.reference?.trim()
    if (ref.taskId) {
      const { items } = await listTasks({ id: ref.taskId, pageSize: 1 })
      const task = items.find((item) => item.id === ref.taskId) ?? null
      if (task && reference && task.reference?.toLowerCase() !== reference.toLowerCase()) return null
      return task
    }
    if (!reference) return null
    // `reference` is a prefix match on the route (`WEB-1` also matches `WEB-10`), so
    // narrow to the exact reference here.
    const { items } = await listTasks({ reference, pageSize: MAX_PAGE_SIZE })
    const lower = reference.toLowerCase()
    return items.find((item) => item.reference?.toLowerCase() === lower) ?? null
  }

  /** Resolve a task given as a UUID or a reference. */
  async function findTaskByRef(value: string): Promise<TaskRecord | null> {
    const trimmed = value.trim()
    if (!trimmed) return null
    return isUuid(trimmed) ? findTask({ taskId: trimmed }) : findTask({ reference: trimmed })
  }

  async function listStatuses(query: { ids?: string[]; timeProjectId?: string }): Promise<Array<{ id: string; slug: string; timeProjectId: string | null }>> {
    const statuses: Array<{ id: string; slug: string; timeProjectId: string | null }> = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await callOrThrow({
        method: 'GET',
        path: STATUSES_PATH,
        query: {
          page,
          pageSize: MAX_PAGE_SIZE,
          ids: query.ids && query.ids.length > 0 ? query.ids.join(',') : undefined,
          timeProjectId: query.timeProjectId,
        },
      })
      for (const row of readItems(data)) {
        const id = readString(row, 'id')
        const slug = readString(row, 'slug')
        if (id && slug) statuses.push({ id, slug, timeProjectId: readString(row, 'time_project_id', 'timeProjectId') })
      }
      if (page >= readTotalPages(data)) break
    }
    return statuses
  }

  async function statusSlugsById(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    if (unique.length === 0) return new Map()
    const statuses = await listStatuses({ ids: unique })
    return new Map(statuses.map((status) => [status.id, status.slug]))
  }

  async function createTask(body: {
    timeProjectId: string
    title: string
    description?: string
    assigneeStaffMemberId?: string
  }): Promise<string> {
    const data = await callOrThrow<{ id?: unknown }>({ method: 'POST', path: TASKS_PATH, body })
    const id = data && typeof data.id === 'string' ? data.id : null
    if (!id) throw new TaskToolError('staff_api_error', 'The staff tasks route did not return the new task id.')
    return id
  }

  /** Oldest-first thread; `null` when the task is missing or not visible (404). */
  async function listComments(taskId: string, pageSize: number): Promise<{ items: CommentRecord[]; total: number } | null> {
    const response = await call({
      method: 'GET',
      path: `${TASKS_PATH}/${encodeURIComponent(taskId)}/comments`,
      query: { page: 1, pageSize },
    })
    if (!response.success) {
      if (response.statusCode === 404) return null
      throw toTaskToolError(response)
    }
    const items = readItems(response.data)
      .map(toComment)
      .filter((comment): comment is CommentRecord => comment !== null)
    return { items, total: readTotal(response.data, items.length) }
  }

  async function createComment(taskId: string, body: string): Promise<{ id: string | null; authorUserId: string | null }> {
    const response = await call<{ id?: unknown; authorUserId?: unknown }>({
      method: 'POST',
      path: `${TASKS_PATH}/${encodeURIComponent(taskId)}/comments`,
      body: { body },
    })
    if (!response.success) {
      if (response.statusCode === 404) throw new TaskToolError('task_not_found', 'Task not found or not accessible.')
      throw toTaskToolError(response as AiApiOperationResponse<unknown>)
    }
    return {
      id: typeof response.data?.id === 'string' ? response.data.id : null,
      authorUserId: typeof response.data?.authorUserId === 'string' ? response.data.authorUserId : null,
    }
  }

  return {
    listProjects,
    getProjectById,
    resolveProject,
    listTasks,
    findTask,
    findTaskByRef,
    listStatuses,
    statusSlugsById,
    createTask,
    listComments,
    createComment,
  }
}

export type StaffApi = ReturnType<typeof createStaffApi>

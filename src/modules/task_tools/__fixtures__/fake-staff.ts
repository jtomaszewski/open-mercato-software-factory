import type {
  AiApiOperationRequest,
  AiApiOperationResponse,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'

export const PROJECT_WEB = { id: '11111111-1111-4111-8111-111111111111', code: 'WEB', name: 'Website', status: 'active' }
export const PROJECT_OPS = { id: '22222222-2222-4222-8222-222222222222', code: 'OPS', name: 'Operations', status: 'active' }
export const STATUS_BACKLOG = { id: '33333333-3333-4333-8333-333333333333', slug: 'backlog', time_project_id: PROJECT_WEB.id }
export const STATUS_DONE = { id: '44444444-4444-4444-8444-444444444444', slug: 'done', time_project_id: PROJECT_WEB.id }

export function taskRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    reference: 'WEB-1',
    title: 'ZDP-5000 holds 5 200 l',
    description: 'Dimensions missing.',
    time_project_id: PROJECT_WEB.id,
    task_status_id: STATUS_BACKLOG.id,
    parent_task_id: null,
    assignee_staff_member_id: null,
    updated_at: '2026-09-19T10:00:00.000Z',
    ...overrides,
  }
}

type Handler = (request: AiApiOperationRequest) => AiApiOperationResponse<unknown> | undefined

/**
 * A fake of the in-process runner that answers the staff routes from fixtures. Every
 * request is recorded so tests can assert what was sent to `staff`.
 */
export function createFakeStaff(options: {
  projects?: Array<Record<string, unknown>>
  memberProjectIds?: string[]
  tasks?: Array<Record<string, unknown>>
  statuses?: Array<Record<string, unknown>>
  comments?: Array<Record<string, unknown>>
  handler?: Handler
} = {}) {
  const projects = options.projects ?? [PROJECT_WEB]
  const tasks = options.tasks ?? [taskRow()]
  const statuses = options.statuses ?? [STATUS_BACKLOG, STATUS_DONE]
  const comments = options.comments ?? []
  const requests: AiApiOperationRequest[] = []

  const ok = (data: unknown, statusCode = 200): AiApiOperationResponse<unknown> => ({ success: true, statusCode, data })
  const page = (items: unknown[]) => ok({ items, total: items.length, page: 1, pageSize: 100, totalPages: 1 })

  const run = async <T>(request: AiApiOperationRequest): Promise<AiApiOperationResponse<T>> => {
    requests.push(request)
    const custom = options.handler?.(request)
    if (custom) return custom as AiApiOperationResponse<T>
    const q = request.query ?? {}
    if (request.path === '/staff/timesheets/time-projects' && request.method === 'GET') {
      if (q.ids) {
        const hit = projects.filter((project) => project.id === q.ids)
        if (hit.length === 0) return { success: false, statusCode: 404, error: 'Project not found.' } as AiApiOperationResponse<T>
        return page(hit) as AiApiOperationResponse<T>
      }
      const rows = q.mine ? projects.filter((project) => options.memberProjectIds?.includes(String(project.id))) : projects
      return page(rows) as AiApiOperationResponse<T>
    }
    if (request.path === '/staff/timesheets/tasks' && request.method === 'GET') {
      let rows = tasks
      if (q.id) rows = rows.filter((row) => row.id === q.id)
      if (q.reference) rows = rows.filter((row) => String(row.reference).toLowerCase().startsWith(String(q.reference).toLowerCase()))
      if (q.q) rows = rows.filter((row) => String(row.title).toLowerCase().includes(String(q.q).toLowerCase()))
      if (q.timeProjectId) rows = rows.filter((row) => row.time_project_id === q.timeProjectId)
      if (q.taskStatusId) rows = rows.filter((row) => row.task_status_id === q.taskStatusId)
      return page(rows) as AiApiOperationResponse<T>
    }
    if (request.path === '/staff/timesheets/tasks' && request.method === 'POST') {
      return ok({ id: '66666666-6666-4666-8666-666666666666' }, 201) as AiApiOperationResponse<T>
    }
    if (request.path === '/staff/timesheets/task-statuses') {
      let rows = statuses
      if (q.ids) rows = rows.filter((row) => String(q.ids).split(',').includes(String(row.id)))
      if (q.timeProjectId) rows = rows.filter((row) => row.time_project_id === q.timeProjectId)
      return page(rows) as AiApiOperationResponse<T>
    }
    const commentsMatch = request.path.match(/^\/staff\/timesheets\/tasks\/([^/]+)\/comments$/)
    if (commentsMatch) {
      const visible = tasks.some((row) => row.id === commentsMatch[1])
      if (!visible) return { success: false, statusCode: 404, error: 'Task not found or not accessible.' } as AiApiOperationResponse<T>
      if (request.method === 'POST') {
        return ok({ id: '77777777-7777-4777-8777-777777777777', taskId: commentsMatch[1], authorUserId: 'u1' }, 201) as AiApiOperationResponse<T>
      }
      return page(comments) as AiApiOperationResponse<T>
    }
    return { success: false, statusCode: 404, error: `No route ${request.method} ${request.path}` } as AiApiOperationResponse<T>
  }

  return { runner: { run }, requests }
}

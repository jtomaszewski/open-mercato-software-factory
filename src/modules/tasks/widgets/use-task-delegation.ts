'use client'
import { useCallback, useEffect, useState } from 'react'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { getCurrentOrganizationScopeVersion, subscribeOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import type { TasksDelegationReadItem } from '../lib/delegationService'
import { loadTaskDelegation } from './delegation-loader'

export function useTaskDelegation(taskId: string | undefined) {
  const [item, setItem] = useState<TasksDelegationReadItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useAppEvent('tasks.task.*', refresh)
  useAppEvent('staff.timesheets.time_task.*', refresh)
  useAppEvent('workflows.instance.*', refresh)
  useAppEvent('agent_orchestrator.proposal.*', refresh)
  useEffect(() => subscribeOrganizationScopeChanged(() => { setItem(null); refresh() }), [refresh])
  useEffect(() => {
    if (!taskId) { setItem(null); setLoading(false); return }
    let current = true
    const scopeVersion = getCurrentOrganizationScopeVersion()
    const isCurrent = () => current && scopeVersion === getCurrentOrganizationScopeVersion()
    setLoading(true)
    setError(false)
    void loadTaskDelegation(taskId).then((value) => {
      if (isCurrent()) setItem(value)
    }, () => {
      if (isCurrent()) setError(true)
    }).finally(() => { if (isCurrent()) setLoading(false) })
    return () => { current = false }
  }, [taskId, revision])
  useEffect(() => {
    if (item?.delegation?.runState !== 'starting') return
    const timer = setTimeout(refresh, 60_000)
    return () => clearTimeout(timer)
  }, [item, refresh])
  return { item, loading, error, refresh }
}

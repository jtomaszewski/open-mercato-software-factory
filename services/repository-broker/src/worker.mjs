import { randomUUID } from 'node:crypto'

import { signedHeaders } from './transport.mjs'

const QUALIFICATION_DEADLINE_SECONDS = 14 * 60

function deadlineResult(request) {
  return {
    installationId: request.installationId,
    repositoryId: request.repositoryId,
    epoch: request.epoch,
    attemptId: request.attemptId,
    status: 'failed',
    report: { checks: [{
      id: 'qualification.deadline', status: 'failed', message: 'The qualification attempt exceeded its overall deadline.',
    }] },
  }
}

export class QualificationWorker {
  constructor({ store, qualify, reconcile = async () => {}, omBaseUrl, callbackKeyId, callbackSecret, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    this.store = store
    this.qualify = qualify
    this.reconcile = reconcile
    this.omBaseUrl = omBaseUrl
    this.callbackKeyId = callbackKeyId
    this.callbackSecret = callbackSecret
    this.fetchImpl = fetchImpl
    this.now = now
    this.timer = null
    this.qualificationTask = null
    this.callbackTask = null
    this.stopping = false
  }

  start() {
    if (this.timer || this.stopping) return
    this.timer = setInterval(() => void this.tick(), 1000)
    this.timer.unref()
    void this.tick()
  }

  async stop() {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await Promise.allSettled([this.qualificationTask, this.callbackTask].filter(Boolean))
  }

  wake() {
    if (this.stopping) return
    void this.tick()
  }

  async tick() {
    await Promise.all([this.tickCallbacks(), this.tickQualifications()])
  }

  async tickQualifications() {
    if (this.qualificationTask) return this.qualificationTask
    if (this.stopping) return
    const task = (async () => {
      for (const item of this.store.listQualifications()) {
        const request = JSON.parse(item.payload_json)
        const deadlineMs = (item.created_at + QUALIFICATION_DEADLINE_SECONDS) * 1000
        this.store.markChecking(item.attempt_id, Math.floor(this.now() / 1000))
        if (item.state === 'checking') {
          try {
            await this.reconcile(request)
          } catch {
            continue
          }
        }
        let result
        try {
          result = this.now() >= deadlineMs ? deadlineResult(request) : await this.qualify(request, { deadlineMs })
        } catch (error) {
          if (error?.code === 'sandbox_cleanup_unverified') continue
          result = {
            installationId: request.installationId,
            repositoryId: request.repositoryId,
            epoch: request.epoch,
            attemptId: request.attemptId,
            status: 'failed',
            report: { checks: [{ id: 'qualification.internal', status: 'failed', message: 'The qualification worker could not complete the check.' }] },
          }
        }
        this.store.saveResult(item.attempt_id, JSON.stringify(result), Math.floor(this.now() / 1000))
        await this.tickCallbacks()
      }
    })()
    this.qualificationTask = task
    try {
      return await task
    } finally {
      if (this.qualificationTask === task) this.qualificationTask = null
    }
  }

  async tickCallbacks() {
    if (this.callbackTask) return this.callbackTask
    if (this.stopping) return
    const task = (async () => {
      const nowSeconds = Math.floor(this.now() / 1000)
      for (const item of this.store.listDueCallbacks(nowSeconds)) {
        await this.deliver(item.attempt_id, JSON.parse(item.result_json), item.callback_attempts)
      }
    })()
    this.callbackTask = task
    try {
      return await task
    } finally {
      if (this.callbackTask === task) this.callbackTask = null
    }
  }

  async deliver(attemptId, result, priorAttempts) {
    const nowSeconds = Math.floor(this.now() / 1000)
    const url = new URL('/api/repositories/internal/qualification-results', this.omBaseUrl)
    const body = Buffer.from(JSON.stringify(result))
    const headers = signedHeaders({
      method: 'POST', url, body, keyId: this.callbackKeyId, secret: this.callbackSecret,
      timestamp: String(nowSeconds), requestId: randomUUID(),
    })
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(15_000),
      })
      if (response.body) await response.body.cancel().catch(() => {})
      if (!response.ok) throw new Error('callback_refused')
      this.store.markCallbackDelivered(attemptId, Math.floor(this.now() / 1000))
    } catch {
      const attempts = priorAttempts + 1
      if (attempts >= 8) {
        this.store.markCallbackAbandoned(attemptId, 'callback_delivery_failed', Math.floor(this.now() / 1000))
        return
      }
      const delaySeconds = Math.min(300, 2 ** attempts)
      this.store.scheduleCallbackRetry(
        attemptId, Math.floor(this.now() / 1000) + delaySeconds,
        'callback_delivery_failed', Math.floor(this.now() / 1000),
      )
    }
  }
}

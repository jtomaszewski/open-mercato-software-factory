import { afterEach, describe, expect, it } from '@jest/globals'
import { canonicalBrokerRequest, signBrokerRequest } from '../../../lib/broker'
import { authenticateAndClaimBrokerRequest } from '../auth'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('broker replay transaction', () => {
  it('does not consume the replay key when callback processing rolls back', async () => {
    process.env.REPOSITORIES_BROKER_KEY_ID = 'callback-v1'
    process.env.REPOSITORIES_BROKER_CALLBACK_SECRET = 'callback-secret'
    const timestamp = Math.floor(Date.now() / 1000)
    const requestId = '00000000-0000-4000-8000-000000000001'
    const rawBody = '{"ok":true}'
    const url = new URL('https://om.test/api/repositories/internal/qualification-results')
    const signature = signBrokerRequest('callback-secret', canonicalBrokerRequest('POST', url, String(timestamp), requestId, rawBody))
    const request = new Request(url, { method: 'POST', headers: {
      'x-om-broker-key-id': 'callback-v1',
      'x-om-broker-timestamp': String(timestamp),
      'x-om-broker-request-id': requestId,
      'x-om-broker-signature': signature,
    } })
    const claimed = new Set<string>()
    const transactional = async (operation: (tx: {
      create(_entity: unknown, input: { requestId: string }): { requestId: string }
      persist(value: { requestId: string }): void
      flush(): Promise<void>
    }) => Promise<void>) => {
      const staged = new Set<string>()
      const tx = {
        create: (_entity: unknown, input: { requestId: string }) => input,
        persist: (value: { requestId: string }) => { staged.add(value.requestId) },
        flush: async () => {},
      }
      await operation(tx)
      for (const value of staged) claimed.add(value)
    }

    await expect(transactional(async (tx) => {
      expect(await authenticateAndClaimBrokerRequest(request, rawBody, tx as never)).toBe(true)
      throw new Error('processing failed')
    })).rejects.toThrow('processing failed')
    expect(claimed).toEqual(new Set())

    await transactional(async (tx) => {
      expect(await authenticateAndClaimBrokerRequest(request, rawBody, tx as never)).toBe(true)
    })
    expect(claimed).toEqual(new Set([requestId]))
  })
})

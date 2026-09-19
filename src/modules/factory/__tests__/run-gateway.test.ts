import { afterEach, expect, jest, test } from '@jest/globals'
import { startFactoryRunGateway } from '../lib/run-gateway'

const realFetch = globalThis.fetch
const options = { model: 'anthropic/claude-sonnet-4.5', budgetUsd: 0.3, mcpUrl: 'http://127.0.0.1:3001/mcp', mcpApiKey: 'server-secret', openRouterApiKey: 'provider-secret', containerHost: '127.0.0.1' }
afterEach(() => { globalThis.fetch = realFetch })

test('forwards bounded inference without exposing provider credentials and refuses requests beyond the run budget', async () => {
  const upstream = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'result', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
  globalThis.fetch = upstream
  const gateway = await startFactoryRunGateway(options)
  try {
    const request = () => realFetch(`${gateway.providerBaseUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${gateway.providerApiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: options.model, messages: [{ role: 'user', content: 'Say OK' }] }) })
    expect((await request()).status).toBe(200)
    expect((await request()).status).toBe(402)
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(gateway.providerApiKey).not.toContain('provider-secret')
    const forwarded = JSON.parse(String(upstream.mock.calls[0][1]?.body))
    expect(forwarded.max_tokens).toBe(8192)
    expect(forwarded.provider.max_price).toEqual({ prompt: 6, completion: 22.5 })
  } finally { await gateway.close() }
})

test('MCP tool calls require the bound run token and never receive the broad server credential', async () => {
  const upstream = jest.fn<typeof fetch>().mockImplementation(async () => new Response('{}', { status: 200 }))
  globalThis.fetch = upstream
  const gateway = await startFactoryRunGateway(options)
  try {
    gateway.authorizeSessionToken('run-session')
    const call = (token: string) => realFetch(gateway.mcpUrl, { method: 'POST', headers: { ...gateway.mcpHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'agent_orchestrator.submit_outcome', arguments: { _sessionToken: token, outcome: {} } } }) })
    expect((await call('other-session')).status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
    expect((await call('run-session')).status).toBe(200)
    expect(gateway.mcpHeaders).not.toEqual(expect.objectContaining({ 'x-api-key': 'server-secret' }))
    expect(upstream.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ 'x-api-key': 'server-secret' }))
  } finally { await gateway.close() }
})

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { z } from 'zod'

export type FactoryRunGatewayOptions = {
  model: string; budgetUsd: number; mcpUrl: string; mcpApiKey: string; openRouterApiKey: string; containerHost?: string
}

const messageSchema = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.object({ type: z.literal('text'), text: z.string() }).strict())]).nullable().optional(),
  name: z.string().optional(), tool_call_id: z.string().optional(),
  tool_calls: z.array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
})
const inferenceSchema = z.object({
  model: z.string(), messages: z.array(messageSchema).min(1).max(128),
  tools: z.array(z.object({ type: z.literal('function'), function: z.object({ name: z.string(), description: z.string().optional(), parameters: z.record(z.string(), z.unknown()), strict: z.boolean().optional() }) })).max(128).optional(),
  tool_choice: z.union([z.enum(['auto', 'none', 'required']), z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) })]).optional(),
  temperature: z.number().min(0).max(2).optional(), stream: z.boolean().optional(),
})
const rpcSchema = z.object({
  jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.record(z.string(), z.unknown()).optional(),
})
const permittedModel = 'anthropic/claude-sonnet-4.5'
const maxOutputTokens = 8192
const maxBodyBytes = 1024 * 1024

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maxBodyBytes) throw new Error('Request too large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function matches(value: string | string[] | undefined, expected: string): boolean {
  if (typeof value !== 'string') return false
  const supplied = Buffer.from(value)
  const wanted = Buffer.from(expected)
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted)
}

export async function startFactoryRunGateway(options: FactoryRunGatewayOptions) {
  if (options.model !== permittedModel || !Number.isFinite(options.budgetUsd) || options.budgetUsd <= 0 || !options.openRouterApiKey || !options.mcpApiKey) throw new Error('Factory run requires a supported model, positive budget and host credentials')
  const upstreamMcp = new URL(options.mcpUrl)
  if (!['http:', 'https:'].includes(upstreamMcp.protocol) || upstreamMcp.username || upstreamMcp.password) throw new Error('Invalid MCP endpoint')
  const token = randomBytes(32).toString('hex')
  const providerToken = randomBytes(32).toString('hex')
  const controller = new AbortController()
  let sessionToken: string | undefined
  let reservedUsd = 0
  const server = createServer(async (request, response) => {
    const reject = (status: number, error: string) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error })) }
    try {
      const provider = request.url === '/v1/chat/completions'
      const mcp = request.url === '/mcp'
      if (!provider && !mcp) return reject(404, 'Unknown gateway route')
      if (!matches(request.headers.authorization, `Bearer ${provider ? providerToken : token}`)) return reject(401, 'Invalid run credential')
      if (request.method !== 'POST') return reject(405, 'Only POST is supported')
      const body = await readBody(request)
      if (mcp) {
        const rpc = rpcSchema.parse(body)
        if (rpc.method === 'tools/call') {
          const args = rpc.params?.arguments
          if (!sessionToken || !args || typeof args !== 'object' || !('_sessionToken' in args) || args._sessionToken !== sessionToken || rpc.params?.name !== 'agent_orchestrator.submit_outcome') return reject(403, 'Tool call is outside this run')
        } else if (!['initialize', 'notifications/initialized', 'ping', 'tools/list'].includes(rpc.method)) return reject(403, 'MCP method is outside this run')
        const upstream = await fetch(upstreamMcp, {
          method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': options.mcpApiKey }, body: JSON.stringify(rpc),
        })
        if (!upstream.ok) return reject(502, 'MCP request failed')
        if (upstream.status === 204 || upstream.status === 202) { response.writeHead(upstream.status); response.end(); return }
        const result: unknown = await upstream.json()
        if (rpc.method === 'tools/list' && result && typeof result === 'object' && 'result' in result && result.result && typeof result.result === 'object' && 'tools' in result.result && Array.isArray(result.result.tools)) {
          result.result.tools = result.result.tools.filter((tool: unknown) => tool && typeof tool === 'object' && 'name' in tool && tool.name === 'agent_orchestrator.submit_outcome')
        }
        response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result)); return
      }
      const inference = inferenceSchema.parse(body)
      if (inference.model !== options.model) return reject(403, 'Model differs from the configured run')
      // Reserve an upper bound, including framing/tool overhead. No refunds, even on errors.
      // Provider price filters use USD per million tokens and prevent more expensive routing.
      const promptTokenBound = Buffer.byteLength(JSON.stringify(inference)) * 2 + 8192
      const reservation = promptTokenBound * 6 / 1_000_000 + maxOutputTokens * 22.5 / 1_000_000
      if (reservedUsd + reservation > options.budgetUsd) return reject(402, 'Run budget exhausted')
      reservedUsd += reservation
      const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        headers: { authorization: `Bearer ${options.openRouterApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...inference, stream: false, max_tokens: maxOutputTokens, provider: { allow_fallbacks: false, max_price: { prompt: 6, completion: 22.5 } } }),
      })
      if (!upstream.ok) return reject(502, 'Model provider request failed')
      const result: unknown = await upstream.json()
      if (!inference.stream) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result)); return }
      writeCompletionStream(response, result)
    } catch {
      if (!response.headersSent) reject(400, 'Run gateway request could not be completed')
      else response.end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Gateway did not bind a TCP port')
  const host = options.containerHost ?? 'host.docker.internal'
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) { server.close(); throw new Error('Invalid container gateway host') }
  return {
    providerBaseUrl: `http://${host}:${address.port}/v1`, providerApiKey: providerToken, model: options.model,
    mcpUrl: `http://${host}:${address.port}/mcp`, mcpHeaders: { authorization: `Bearer ${token}` },
    authorizeSessionToken(value: string) { if (!value || sessionToken && sessionToken !== value) throw new Error('Run session is already bound'); sessionToken = value },
    async close() { controller.abort(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) },
  }
}

function writeCompletionStream(response: ServerResponse, value: unknown) {
  const result = z.object({ id: z.string(), model: z.string().optional(), created: z.number().optional(), choices: z.array(z.object({ index: z.number(), message: z.record(z.string(), z.unknown()), finish_reason: z.string().nullable() })), usage: z.unknown().optional() }).parse(value)
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const choices = result.choices.map(({ index, message, finish_reason }) => ({ index, delta: { ...message, ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls.map((tool: Record<string, unknown>, toolIndex: number) => ({ ...tool, index: toolIndex })) } : {}) }, finish_reason }))
  response.end(`data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices })}\n\ndata: [DONE]\n\n`)
}

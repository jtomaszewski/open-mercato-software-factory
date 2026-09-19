export type ConnectionConsentInput = {
  installationId?: string
  setupAction?: 'install' | 'update' | 'request'
  code?: string
}

export type ResolvedConnectionConsent =
  | { kind: 'waiting' }
  | { kind: 'verify'; installationId: string; code: string }

export class ConnectionConsentError extends Error {
  constructor(readonly code: 'installationMismatch' | 'invalidReturn') {
    super(`Repository connection consent error: ${code}`)
    this.name = 'ConnectionConsentError'
  }
}

export function resolveConnectionConsent(
  input: ConnectionConsentInput,
  expectedInstallationId: string | null,
): ResolvedConnectionConsent {
  if (expectedInstallationId) {
    if (input.installationId && input.installationId !== expectedInstallationId) {
      throw new ConnectionConsentError('installationMismatch')
    }
    if (!input.code || input.setupAction === 'request') throw new ConnectionConsentError('invalidReturn')
    return { kind: 'verify', installationId: expectedInstallationId, code: input.code }
  }
  if (input.setupAction === 'request') return { kind: 'waiting' }
  if ((input.setupAction !== 'install' && input.setupAction !== 'update') || !input.installationId || !input.code) {
    throw new ConnectionConsentError('invalidReturn')
  }
  return { kind: 'verify', installationId: input.installationId, code: input.code }
}

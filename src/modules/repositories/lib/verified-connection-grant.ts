import { randomUUID } from 'node:crypto'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export type VerifiedConnectionGrant = {
  installationId: string
  authorizationId: string
  accountLogin: string
  repositories: Array<{ id: string; fullName: string; defaultBranch: string }>
}

const verifiedConnectionGrants = new Map<string, VerifiedConnectionGrant>()

export function stageVerifiedConnectionGrant(grant: VerifiedConnectionGrant): string {
  const verificationId = randomUUID()
  verifiedConnectionGrants.set(verificationId, grant)
  return verificationId
}

export function consumeStagedConnectionGrant(verificationId: string): VerifiedConnectionGrant {
  const grant = verifiedConnectionGrants.get(verificationId)
  verifiedConnectionGrants.delete(verificationId)
  if (!grant) {
    throw new CrudHttpError(403, { code: 'unverifiedConnection', error: 'repositories.errors.unverifiedConnection' })
  }
  return grant
}

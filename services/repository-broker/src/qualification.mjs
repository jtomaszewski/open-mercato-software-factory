const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUIRED_PERMISSIONS = {
  metadata: 'read',
  contents: 'write',
  pull_requests: 'write',
  actions: 'read',
  checks: 'read',
  administration: 'read',
}

export class ValidationError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ValidationError'
    this.code = code
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function exactKeys(value, required, optional = []) {
  if (!plainObject(value)) return false
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
}

function boundedString(value, maximum = 2000) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !value.includes('\0')
}

function validateProfile(kind, profile) {
  const profileKeys = kind === 'static_site' ? ['version', 'commands', 'outputDirectory', 'vercel'] : ['version', 'commands']
  if (!exactKeys(profile, profileKeys) || profile.version !== 1) throw new ValidationError('invalid_profile')
  if (!exactKeys(profile.commands, ['install', 'build', 'test'], ['typecheck', 'lint'])) throw new ValidationError('invalid_profile')
  if (!Object.values(profile.commands).every((value) => boundedString(value))) throw new ValidationError('invalid_profile')
  if (kind === 'static_site') {
    if (!boundedString(profile.outputDirectory, 255) || profile.outputDirectory.startsWith('/') ||
        profile.outputDirectory.split('/').some((part) => part === '..' || part === '')) throw new ValidationError('invalid_profile')
    if (!exactKeys(profile.vercel, ['accountId', 'projectId']) ||
        !boundedString(profile.vercel.accountId, 255) || !boundedString(profile.vercel.projectId, 255) ||
        !/^[A-Za-z0-9_-]+$/.test(profile.vercel.accountId) || !/^[A-Za-z0-9_-]+$/.test(profile.vercel.projectId)) {
      throw new ValidationError('invalid_profile')
    }
  }
}

export function validateQualificationRequest(value) {
  const keys = ['installationId', 'authorizationId', 'repositoryId', 'githubRepositoryId', 'baseBranch', 'epoch', 'attemptId', 'kind', 'profile']
  if (!exactKeys(value, keys) || !/^\d{1,32}$/.test(value.installationId) ||
      !UUID_PATTERN.test(value.authorizationId) || !UUID_PATTERN.test(value.repositoryId) || !/^\d{1,32}$/.test(value.githubRepositoryId) ||
      !boundedString(value.baseBranch, 255) || /[\x00-\x20~^:?*[\\]/.test(value.baseBranch) || value.baseBranch.includes('..') ||
      value.baseBranch.startsWith('-') || value.baseBranch.endsWith('/') || value.baseBranch.endsWith('.lock') ||
      !Number.isSafeInteger(value.epoch) || value.epoch < 1 ||
      !UUID_PATTERN.test(value.attemptId) || !['pr_only', 'static_site'].includes(value.kind)) {
    throw new ValidationError('invalid_qualification_request')
  }
  validateProfile(value.kind, value.profile)
  return value
}

function check(id, passed, success, failure) {
  return { id, status: passed ? 'passed' : 'failed', message: passed ? success : failure }
}

export async function qualifyRepository({ request, github, sandbox, deadlineMs }) {
  const checks = []
  try {
    const grant = await github.getInstallationGrant(request.installationId, request.authorizationId, { deadlineMs })
    const repository = grant.repositories.find((item) => item.id === request.githubRepositoryId)
    checks.push(check('github.repository_grant', Boolean(repository), 'The installation currently grants this repository.', 'The repository is not in the current installation grant.'))
    if (!repository) return result(request, checks)
    checks.push(check(
      'github.permissions', github.hasPermissions(grant.permissions, REQUIRED_PERMISSIONS),
      'The GitHub App has the required repository permissions.',
      'The GitHub App lacks one or more required repository permissions.',
    ))
    const inspected = await github.inspectRepository(grant, repository, request.baseBranch, { deadlineMs })
    checks.push(check('github.base_branch', true, 'The configured base branch exists.', 'The configured base branch does not exist.'))
    checks.push({ id: 'profile.commands', status: 'passed', message: 'The strict version 1 profile declares every required command.' })
    checks.push(...await sandbox.run({
      fullName: repository.fullName,
      baseSha: inspected.branchSha,
      attemptId: request.attemptId,
      installationToken: grant.token,
      deadlineMs,
      profile: request.profile,
      kind: request.kind,
    }))
    if (request.kind === 'static_site') {
      checks.push({
        id: 'static_site.preview_configuration',
        status: 'failed',
        message: 'Vercel protection, disabled Git builds, and prebuilt upload capability cannot be verified because no credentialed Vercel qualification boundary is configured.',
      })
    }
  } catch (error) {
    if (error?.code === 'sandbox_cleanup_unverified') throw error
    checks.push({
      id: 'qualification.provider',
      status: 'failed',
      message: error?.code === 'github_not_found' ? 'The repository or base branch is not available to the installation.' : 'The provider qualification check could not be completed.',
    })
  }
  return result(request, checks)
}

function result(request, checks) {
  const boundedChecks = checks.slice(0, 100).map((item) => ({ ...item, message: item.message.slice(0, 2000) }))
  return {
    installationId: request.installationId,
    repositoryId: request.repositoryId,
    epoch: request.epoch,
    attemptId: request.attemptId,
    status: boundedChecks.length > 0 && boundedChecks.every((item) => item.status === 'passed') ? 'passed' : 'failed',
    report: { checks: boundedChecks },
  }
}

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { qualifyRepository, validateQualificationRequest } from '../src/qualification.mjs'

function request(kind = 'pr_only') {
  return {
    installationId: '42', authorizationId: randomUUID(), repositoryId: randomUUID(), githubRepositoryId: '9001', baseBranch: 'main',
    epoch: 1, attemptId: randomUUID(), kind,
    profile: kind === 'static_site' ? {
      version: 1,
      commands: { install: 'npm ci', build: 'npm run build', test: 'npm test' },
      outputDirectory: 'out',
      vercel: { accountId: 'team_123', projectId: 'prj_123' },
    } : { version: 1, commands: { install: 'npm ci', build: 'npm run build', test: 'npm test' } },
  }
}

function github({ permissions = true } = {}) {
  return {
    async getInstallationGrant() {
      return {
        token: 'installation-token',
        permissions: {},
        repositories: [{ id: '9001', fullName: 'example-org/example', defaultBranch: 'main' }],
      }
    },
    hasPermissions() { return permissions },
    async inspectRepository() { return { branchSha: 'a'.repeat(40) } },
  }
}

const passingSandbox = {
  async run({ profile }) {
    return Object.keys(profile.commands).map((name) => ({
      id: `sandbox.command.${name}`, status: 'passed', message: `The ${name} command passed.`,
    }))
  },
}

test('pr_only qualification passes from the grant, permissions, exact base SHA, and successful profile commands', async () => {
  const input = request()
  const result = await qualifyRepository({ request: input, github: github(), sandbox: passingSandbox })
  assert.equal(result.status, 'passed')
  assert.equal(result.attemptId, input.attemptId)
  assert.deepEqual(result.report.checks.map((item) => item.id), [
    'github.repository_grant',
    'github.permissions',
    'github.base_branch',
    'profile.commands',
    'sandbox.command.install',
    'sandbox.command.build',
    'sandbox.command.test',
  ])
})

test('static site qualification reports unavailable Vercel policy instead of synthetic success', async () => {
  const result = await qualifyRepository({ request: request('static_site'), github: github(), sandbox: passingSandbox })
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.report.checks.at(-1), {
    id: 'static_site.preview_configuration',
    status: 'failed',
    message: 'Vercel protection, disabled Git builds, and prebuilt upload capability cannot be verified because no credentialed Vercel qualification boundary is configured.',
  })
})

test('profile validation rejects undeclared fields and path traversal', () => {
  const extra = request()
  extra.profile.token = 'not-allowed'
  assert.throws(() => validateQualificationRequest(extra), /invalid_profile/)
  const traversal = request('static_site')
  traversal.profile.outputDirectory = '../out'
  assert.throws(() => validateQualificationRequest(traversal), /invalid_profile/)
})

test('the durable overall deadline is forwarded to provider and sandbox operations', async () => {
  const input = request()
  const deadlineMs = 1_789_770_840_000
  const received = []
  const deadlineGithub = github()
  deadlineGithub.getInstallationGrant = async (installationId, authorizationId, options) => {
    received.push(['grant', installationId, authorizationId, options.deadlineMs])
    return github().getInstallationGrant()
  }
  deadlineGithub.inspectRepository = async (grant, repository, baseBranch, options) => {
    received.push(['inspect', baseBranch, options.deadlineMs])
    return { branchSha: 'a'.repeat(40) }
  }
  const sandbox = { async run(value) { received.push(['sandbox', value.deadlineMs]); return [] } }
  await qualifyRepository({ request: input, github: deadlineGithub, sandbox, deadlineMs })
  assert.deepEqual(received, [
    ['grant', '42', input.authorizationId, deadlineMs],
    ['inspect', 'main', deadlineMs],
    ['sandbox', deadlineMs],
  ])
})

test('unverified sandbox cleanup remains retryable instead of becoming a qualification result', async () => {
  const error = new Error('sandbox_cleanup_unverified')
  error.code = 'sandbox_cleanup_unverified'
  await assert.rejects(
    () => qualifyRepository({
      request: request(),
      github: github(),
      sandbox: { async run() { throw error } },
      deadlineMs: Date.now() + 60_000,
    }),
    (received) => received === error,
  )
})

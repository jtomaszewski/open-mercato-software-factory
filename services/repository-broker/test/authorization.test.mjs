import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { AuthorizedGitHub } from '../src/authorization.mjs'
import { BrokerStore } from '../src/store.mjs'

test('persisted authorization remains immutable and fails closed for unknown or mismatched IDs', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-authorization-test-'))
  const grants = new Map([
    ['42', {
      installationId: '42', accountLogin: 'example-org', token: 'first-token', permissions: {},
      repositories: [
        { id: '9001', fullName: 'example-org/allowed', defaultBranch: 'main' },
        { id: '9002', fullName: 'example-org/not-consented', defaultBranch: 'main' },
      ],
    }],
    ['43', {
      installationId: '43', accountLogin: 'other-org', token: 'other-token', permissions: {},
      repositories: [{ id: '9100', fullName: 'other-org/allowed', defaultBranch: 'main' }],
    }],
  ])
  const github = {
    async verifyInstallationConsent() {
      return { ...grants.get('42'), repositories: [grants.get('42').repositories[0]] }
    },
    async getInstallationGrant(installationId) { return grants.get(installationId) },
    async listBranches(grant, repositoryId) {
      assert.equal(grant.repositories.some((item) => item.id === repositoryId), true)
      return ['main']
    },
  }
  const store = new BrokerStore(stateDirectory)
  const authorized = new AuthorizedGitHub({ github, store })
  try {
    const verified = await authorized.verifyInstallationConsent('42', 'one-use-code')
    assert.match(verified.authorizationId, /^[0-9a-f-]{36}$/)
    assert.deepEqual(verified.repositories.map((item) => item.id), ['9001'])

    grants.get('42').repositories.push({ id: '9003', fullName: 'example-org/later', defaultBranch: 'main' })
    const refreshed = await authorized.getInstallationGrant('42', verified.authorizationId)
    assert.deepEqual(refreshed.repositories.map((item) => item.id), ['9001'])
    await assert.rejects(() => authorized.listBranches('42', verified.authorizationId, '9002'), /repository_not_authorized/)
    await assert.rejects(() => authorized.getInstallationGrant('42', 'f5f487b6-52d7-44df-8fae-bda4450e34bb'), /authorization_not_found/)
    await assert.rejects(() => authorized.getInstallationGrant('43', verified.authorizationId), /authorization_installation_mismatch/)
  } finally {
    store.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

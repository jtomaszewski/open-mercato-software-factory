import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadConfig } from '../src/config.mjs'

test('example HMAC placeholders are rejected even though they meet the byte minimum', () => {
  const directory = mkdtempSync(join(tmpdir(), 'repository-broker-config-test-'))
  const privateKeyFile = join(directory, 'app.pem')
  writeFileSync(privateKeyFile, 'synthetic-private-key', { mode: 0o600 })
  chmodSync(privateKeyFile, 0o600)
  const baseEnvironment = {
    BROKER_STATE_DIR: join(directory, 'state'),
    BROKER_OM_URL: 'http://127.0.0.1:5001',
    REPOSITORIES_BROKER_KEY_ID: 'test-key',
    REPOSITORIES_BROKER_REQUEST_SECRET: 'synthetic-request-secret-at-least-32-bytes',
    REPOSITORIES_BROKER_CALLBACK_SECRET: 'synthetic-callback-secret-at-least-32-bytes',
    GITHUB_APP_ID: '1',
    GITHUB_APP_CLIENT_ID: 'synthetic-client',
    GITHUB_APP_CLIENT_SECRET: 'synthetic-client-secret',
    GITHUB_APP_PRIVATE_KEY_FILE: privateKeyFile,
  }
  try {
    for (const [name, value] of [
      ['REPOSITORIES_BROKER_REQUEST_SECRET', 'replace-with-at-least-32-random-bytes'],
      ['REPOSITORIES_BROKER_CALLBACK_SECRET', 'replace-with-a-different-32-byte-secret'],
    ]) {
      assert.throws(() => loadConfig({ ...baseEnvironment, [name]: value }), /must not use the example placeholder/)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

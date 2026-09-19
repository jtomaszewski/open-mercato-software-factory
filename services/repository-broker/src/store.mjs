import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class BrokerStore {
  constructor(stateDirectory) {
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
    chmodSync(stateDirectory, 0o700)
    this.database = new DatabaseSync(join(stateDirectory, 'broker.sqlite'))
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS replay_claims (
        request_id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS qualification_attempts (
        attempt_id TEXT PRIMARY KEY,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL,
        result_json TEXT,
        callback_attempts INTEGER NOT NULL DEFAULT 0,
        callback_next_at INTEGER,
        callback_delivered_at INTEGER,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS repository_authorizations (
        authorization_id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL,
        repository_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
    `)
    this.claimReplayStatement = this.database.prepare(
      'INSERT INTO replay_claims (request_id, expires_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
    )
    this.cleanupReplayStatement = this.database.prepare('DELETE FROM replay_claims WHERE expires_at < ?')
  }

  close() {
    this.database.close()
  }

  claimReplay(requestId, expiresAt, nowSeconds = Math.floor(Date.now() / 1000)) {
    this.cleanupReplayStatement.run(nowSeconds - 1)
    return this.claimReplayStatement.run(requestId, expiresAt).changes === 1
  }

  claimAttempt(attemptId, payloadHash, payloadJson, nowSeconds) {
    const inserted = this.database.prepare(`
      INSERT INTO qualification_attempts (
        attempt_id, payload_hash, payload_json, state, created_at, updated_at
      ) VALUES (?, ?, ?, 'accepted', ?, ?)
      ON CONFLICT DO NOTHING
    `).run(attemptId, payloadHash, payloadJson, nowSeconds, nowSeconds)
    if (inserted.changes === 1) return 'created'
    const existing = this.database.prepare(
      'SELECT payload_hash FROM qualification_attempts WHERE attempt_id = ?',
    ).get(attemptId)
    return existing.payload_hash === payloadHash ? 'existing' : 'conflict'
  }

  createAuthorization(authorizationId, installationId, repositoryIds, nowSeconds) {
    this.database.prepare(`
      INSERT INTO repository_authorizations (
        authorization_id, installation_id, repository_ids_json, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(authorizationId, installationId, JSON.stringify(repositoryIds), nowSeconds)
  }

  getAuthorization(authorizationId) {
    const row = this.database.prepare(`
      SELECT installation_id, repository_ids_json
      FROM repository_authorizations
      WHERE authorization_id = ?
    `).get(authorizationId)
    if (!row) return null
    const repositoryIds = JSON.parse(row.repository_ids_json)
    if (!Array.isArray(repositoryIds) || repositoryIds.some((item) => typeof item !== 'string')) {
      throw new Error('authorization_record_invalid')
    }
    return { installationId: row.installation_id, repositoryIds }
  }

  listQualifications(limit = 10) {
    return this.database.prepare(`
      SELECT attempt_id, payload_json, state, created_at
      FROM qualification_attempts
      WHERE state IN ('accepted', 'checking')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit)
  }

  listDueCallbacks(nowSeconds, limit = 10) {
    return this.database.prepare(`
      SELECT attempt_id, result_json, callback_attempts
      FROM qualification_attempts
      WHERE state = 'callback_pending' AND callback_next_at <= ?
      ORDER BY callback_next_at ASC, created_at ASC
      LIMIT ?
    `).all(nowSeconds, limit)
  }

  markChecking(attemptId, nowSeconds) {
    this.database.prepare(`
      UPDATE qualification_attempts SET state = 'checking', updated_at = ?
      WHERE attempt_id = ? AND state IN ('accepted', 'checking')
    `).run(nowSeconds, attemptId)
  }

  saveResult(attemptId, resultJson, nowSeconds) {
    this.database.prepare(`
      UPDATE qualification_attempts
      SET state = 'callback_pending', result_json = ?, callback_next_at = ?, updated_at = ?, last_error_code = NULL
      WHERE attempt_id = ?
    `).run(resultJson, nowSeconds, nowSeconds, attemptId)
  }

  scheduleCallbackRetry(attemptId, nextAt, errorCode, nowSeconds) {
    this.database.prepare(`
      UPDATE qualification_attempts
      SET callback_attempts = callback_attempts + 1, callback_next_at = ?, last_error_code = ?, updated_at = ?
      WHERE attempt_id = ? AND state = 'callback_pending'
    `).run(nextAt, errorCode, nowSeconds, attemptId)
  }

  markCallbackDelivered(attemptId, nowSeconds) {
    this.database.prepare(`
      UPDATE qualification_attempts
      SET state = 'delivered', callback_delivered_at = ?, updated_at = ?, last_error_code = NULL
      WHERE attempt_id = ? AND state = 'callback_pending'
    `).run(nowSeconds, nowSeconds, attemptId)
  }

  markCallbackAbandoned(attemptId, errorCode, nowSeconds) {
    this.database.prepare(`
      UPDATE qualification_attempts
      SET state = 'callback_failed', callback_attempts = callback_attempts + 1, last_error_code = ?, updated_at = ?
      WHERE attempt_id = ? AND state = 'callback_pending'
    `).run(errorCode, nowSeconds, attemptId)
  }
}

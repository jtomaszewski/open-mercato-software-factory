import { readFileSync, statSync } from 'node:fs'

function required(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing required configuration: ${name}`)
  return value
}

function secret(environment, name) {
  const value = required(environment, name)
  if (value.startsWith('replace-with-')) throw new Error(`${name} must not use the example placeholder`)
  if (Buffer.byteLength(value) < 32) throw new Error(`${name} must contain at least 32 bytes`)
  return value
}

function positiveInteger(value, fallback, maximum) {
  if (value === undefined || value === '') return fallback
  if (!/^\d+$/.test(value)) throw new Error('invalid numeric configuration')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error('invalid numeric configuration')
  return parsed
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function omBaseUrl(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('BROKER_OM_URL must be an origin')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error('BROKER_OM_URL must use HTTPS, except for loopback HTTP')
  }
  return url.origin
}

export function loadConfig(environment = process.env) {
  const host = environment.BROKER_HOST || '127.0.0.1'
  if (!isLoopback(host) && environment.BROKER_ALLOW_REMOTE_BIND !== 'true') {
    throw new Error('non-loopback BROKER_HOST requires BROKER_ALLOW_REMOTE_BIND=true')
  }
  const keyId = required(environment, 'REPOSITORIES_BROKER_KEY_ID')
  const privateKeyFile = required(environment, 'GITHUB_APP_PRIVATE_KEY_FILE')
  if ((statSync(privateKeyFile).mode & 0o077) !== 0) throw new Error('GITHUB_APP_PRIVATE_KEY_FILE must not be accessible by group or others')
  const qualificationImage = environment.BROKER_QUALIFICATION_IMAGE || null
  if (qualificationImage && !/@sha256:[0-9a-f]{64}$/.test(qualificationImage)) {
    throw new Error('BROKER_QUALIFICATION_IMAGE must be pinned by sha256 digest')
  }
  return {
    host,
    port: positiveInteger(environment.BROKER_PORT, 5010, 65535),
    stateDirectory: required(environment, 'BROKER_STATE_DIR'),
    omBaseUrl: omBaseUrl(required(environment, 'BROKER_OM_URL')),
    requestKeys: new Map([[keyId, secret(environment, 'REPOSITORIES_BROKER_REQUEST_SECRET')]]),
    callbackKeyId: keyId,
    callbackSecret: secret(environment, 'REPOSITORIES_BROKER_CALLBACK_SECRET'),
    github: {
      appId: required(environment, 'GITHUB_APP_ID'),
      clientId: required(environment, 'GITHUB_APP_CLIENT_ID'),
      clientSecret: required(environment, 'GITHUB_APP_CLIENT_SECRET'),
      privateKey: readFileSync(privateKeyFile, 'utf8'),
    },
    qualificationImage,
    commandTimeoutMs: positiveInteger(environment.BROKER_QUALIFICATION_COMMAND_TIMEOUT_SECONDS, 900, 1800) * 1000,
  }
}

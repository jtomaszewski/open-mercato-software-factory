import { GitHubClient } from './github.mjs'
import { AuthorizedGitHub } from './authorization.mjs'
import { loadConfig } from './config.mjs'
import { OmUsabilityClient, RepositoryExecutionService } from './execution.mjs'
import { qualifyRepository } from './qualification.mjs'
import { SandboxRunner } from './sandbox.mjs'
import { createBrokerServer } from './server.mjs'
import { BrokerStore } from './store.mjs'
import { QualificationWorker } from './worker.mjs'

const config = loadConfig()
const store = new BrokerStore(config.stateDirectory)
const github = new AuthorizedGitHub({ github: new GitHubClient(config.github), store })
const usability = new OmUsabilityClient({
  omBaseUrl: config.omBaseUrl,
  keyId: config.callbackKeyId,
  secret: config.callbackSecret,
})
const execution = new RepositoryExecutionService({ github, usability })
const sandbox = new SandboxRunner({ image: config.qualificationImage, commandTimeoutMs: config.commandTimeoutMs })
const worker = new QualificationWorker({
  store,
  qualify: (request, { deadlineMs }) => qualifyRepository({ request, github, sandbox, deadlineMs }),
  reconcile: (request) => sandbox.reconcileAttempt(request),
  omBaseUrl: config.omBaseUrl,
  callbackKeyId: config.callbackKeyId,
  callbackSecret: config.callbackSecret,
})
const server = createBrokerServer({ requestKeys: config.requestKeys, store, github, worker, execution })

server.listen(config.port, config.host, () => worker.start())

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  const workerStopped = worker.stop()
  const sandboxStopped = await sandbox.stop()
  await workerStopped
  server.close(() => {
    store.close()
    process.exit(sandboxStopped ? 0 : 1)
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

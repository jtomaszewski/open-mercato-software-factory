import { randomUUID } from 'node:crypto'

import { GitHubError } from './github.mjs'

export class AuthorizedGitHub {
  constructor({ github, store, now = () => Date.now() }) {
    this.github = github
    this.store = store
    this.now = now
  }

  async verifyInstallationConsent(installationId, code, options) {
    const grant = await this.github.verifyInstallationConsent(installationId, code, options)
    const authorizationId = randomUUID()
    this.store.createAuthorization(
      authorizationId,
      installationId,
      grant.repositories.map((item) => item.id),
      Math.floor(this.now() / 1000),
    )
    return { ...grant, authorizationId }
  }

  authorization(installationId, authorizationId) {
    const authorization = this.store.getAuthorization(authorizationId)
    if (!authorization) throw new GitHubError('authorization_not_found', 403)
    if (authorization.installationId !== installationId) {
      throw new GitHubError('authorization_installation_mismatch', 403)
    }
    return authorization
  }

  async getInstallationGrant(installationId, authorizationId, options) {
    const authorization = this.authorization(installationId, authorizationId)
    const grant = await this.github.getInstallationGrant(installationId, options)
    const repositoryIds = new Set(authorization.repositoryIds)
    return { ...grant, repositories: grant.repositories.filter((item) => repositoryIds.has(item.id)) }
  }

  async listBranches(installationId, authorizationId, githubRepositoryId, options) {
    const grant = await this.getInstallationGrant(installationId, authorizationId, options)
    if (!grant.repositories.some((item) => item.id === githubRepositoryId)) {
      throw new GitHubError('repository_not_authorized', 404)
    }
    return this.github.listBranches(grant, githubRepositoryId, options)
  }

  hasPermissions(actual, required) {
    return this.github.hasPermissions(actual, required)
  }

  inspectRepository(grant, repositoryInfo, baseBranch, options) {
    return this.github.inspectRepository(grant, repositoryInfo, baseBranch, options)
  }

  exportSource(grant, repositoryInfo, baseBranch, options) {
    return this.github.exportSource(grant, repositoryInfo, baseBranch, options)
  }

  openPullRequest(grant, repositoryInfo, input, options) {
    return this.github.openPullRequest(grant, repositoryInfo, input, options)
  }
}

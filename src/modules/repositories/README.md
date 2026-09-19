# Code repositories

GitHub repositories registered through a GitHub App and linked to staff projects
(spec: `.ai/specs/2026-09-19-code-repositories.md`, "Implemented slice").

- **Connect** (`/backend/repositories` → Connect GitHub): installs the App (or authorizes an
  existing installation) and verifies the OAuth consent. Only repositories the connecting user can
  push to are ever reachable through that connection.
- **Register**: pick a granted repository and its base branch. Disable before remove.
- **Link**: the **Repositories** tab on a staff project links repositories; one can be the default.
- **Use**: `repositoryAccess.forProject({ tenantId, organizationId, projectId })` (DI) returns the
  project's default (or only) repository with an installation token scoped to it (~1 h), or `null`
  when the project has none. The factory uses it for the site checkout and PRs.

## Setup

1. Create a GitHub App: callback URL `<APP_URL>/backend/repositories/connect`, "Request user
   authorization (OAuth) during installation" on, repository permissions Metadata: read,
   Contents: read & write, Pull requests: read & write, Checks: read, Deployments: read.
2. Generate a client secret and a private key, then set `REPOSITORIES_GITHUB_APP_*` (see
   `.env.example`) and restart the app.
3. Connect GitHub, register the repository, link it to the project (mark it default).

# Software Engineer task execution

The `factory` principal keeps its stable ID and displays as Software Engineer. A delegated
board task uses the qualified repository linked to its project. The task stores the repository
ID, configuration epoch and profile digest when it is assigned; changing or disabling that
configuration prevents a stale run from publishing.

The workflow prepares the repository through the GitHub App broker, invokes `factory.developer`
through the installed agent runtime, and sends the resulting text diff to the broker. The broker
creates one branch and pull request per delegation. The task receives the PR link and moves to
review. A `pr_only` repository is reviewed and merged in GitHub. The legacy website approval
endpoint cannot merge repository-bound delegations.

The agent receives the task, optional linked catalog record, registered repository/base branch,
and qualified verification commands. Its source checkout has no Git metadata or provider token.
The host retains the baseline outside the agent workspace. Changes to protected paths, links,
binary files or executable modes fail before publication. Existing executable files retain their
mode when their text changes; new files use mode `100644`.

## Local configuration

1. Configure and run the [repository broker](../../../services/repository-broker/README.md).
   Set matching `REPOSITORIES_BROKER_*` values on the app and broker, and configure the GitHub
   App slug and client ID on the app. Private App credentials remain in the broker.
2. In Repositories, connect the installed GitHub App, register the repository and base branch,
   configure its install/build/test commands, and run qualification. Link the qualified
   repository from the project's Repositories tab, then choose it when assigning a task.
3. Build the isolated runner image using `docker/factory-runner/Dockerfile`, and set
   `FACTORY_DEVELOPER_RUNNER_IMAGE` to that local image. Start the normal authenticated MCP
   service. Give the host application `MCP_SERVER_API_KEY`, a host-reachable `OPENCODE_MCP_URL`
   and `OPENROUTER_API_KEY`; do not place these in a source checkout or agent image.
4. Set `FACTORY_DEVELOPER_MODEL=anthropic/claude-sonnet-4.5` and an explicit positive
   `FACTORY_DEVELOPER_BUDGET_USD`. The default budget is zero, so missing configuration does
   not start a paid run. The gateway reserves an upper cost bound for each request and does
   not refund reservations. A run may therefore reach its limit below the actual billed cost.

Each run has a scoped model credential and MCP relay. Only the run's minted session token can
submit its outcome. The real provider key and broad MCP credential stay on the host. The
runtime removes the run's container and verifies its absence before returning changes for
publication. Non-factory agents retain the installed runtime behavior.

For an existing tenant, `mercato factory ensure-process` registers the workflow; normal
`setup.seedDefaults` handles new tenants. The display name of an existing principal can be
changed in the standard Users administration form without changing `factory` or its roles.

## Current delivery boundary

The GitHub App path supports `pr_only`. The `static_site` profile schema is present, but
qualification refuses to certify preview/publishing until a Vercel provider is configured.
The legacy site-specific review/approval code remains for old unbound delegations; it is not
used by repository-bound runs. This change does not deploy a service or merge generated PRs.

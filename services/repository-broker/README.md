# Repository broker

This standalone Node 24 service keeps GitHub App credentials outside Open Mercato. It implements the signed repository-broker contract with real GitHub REST calls and a persistent SQLite replay and qualification journal. There is no fake provider mode.

## GitHub App configuration

Enable "Request user authorization (OAuth) during installation". For the current local Open Mercato runtime, set the callback URL to:

```text
http://127.0.0.1:5001/backend/repositories/connect
```

Configure these repository permissions:

- Metadata: read
- Contents: read and write
- Pull requests: read and write
- Actions: read
- Checks: read
- Administration: read

Do not grant Workflows, Secrets, or Environments access. The broker refreshes the installation and repository grant before branch reads and every qualification. This local implementation does not receive GitHub webhooks and therefore does not claim immediate webhook-based revocation evidence. Grant loss is observed on the next broker read or qualification.

The OAuth callback must include a one-use user authorization code. `POST /installations/verify` exchanges it for a user token, enumerates `GET /user/installations/{installationId}/repositories`, and keeps only repositories where that user has push or administrative access and the App is currently installed. The broker discards the user token and persists the immutable repository-ID subset under a new `authorizationId`. A reconnect creates a separate authorization record. Refresh, branch reads, and qualification require the authorization ID to match the installation and intersect the persisted subset with the current App grant, so refresh can shrink access but cannot widen the original consent.

## Configuration and startup

Copy `.env.example` into a private process environment. The service does not load dotenv files itself. The private-key file must be owner-only (`chmod 600`) and the state directory is forced to mode `0700`.

Generate independent request and callback secrets, for example with `openssl rand -hex 32`. The example placeholder values are rejected at startup even though their text exceeds the minimum length. Open Mercato uses the request secret for calls to the broker. The broker uses the callback secret for `POST /api/repositories/internal/qualification-results`. Both sides use `REPOSITORIES_BROKER_KEY_ID` as the current key ID.

Run from this directory:

```bash
npm test
npm run check
npm start
```

The service binds to `127.0.0.1:5010` by default. A non-loopback bind is rejected unless `BROKER_ALLOW_REMOTE_BIND=true` is explicitly set. This process serves plain HTTP, so a remote bind also requires a separately managed authenticated TLS boundary. `BROKER_OM_URL` accepts HTTPS, or HTTP only for a loopback origin.

## Signed transport

Every route requires these headers:

```text
x-om-broker-key-id
x-om-broker-timestamp
x-om-broker-request-id
x-om-broker-signature
```

The signature is lowercase hexadecimal HMAC-SHA256 over:

```text
UPPERCASE_METHOD
PATHNAME
SORTED_URLSEARCHPARAMS_QUERY
UNIX_TIMESTAMP_SECONDS
UUID_REQUEST_ID
SHA256_RAW_BODY_HEX
```

There is no trailing newline. Duplicate query keys, malformed paths, timestamps outside five minutes, reused request IDs, and bodies over 1 MiB are rejected. Replay claims are committed to SQLite before route side effects.

The routes are:

- `POST /installations/verify`
- `GET /installations/:id?authorizationId=...`
- `GET /repositories/:githubId/branches?installationId=...&authorizationId=...`
- `POST /qualifications`
- `POST /executions/source`
- `POST /executions/pull-requests`

## Qualification behavior

Local qualification refreshes the GitHub installation grant, verifies the exact repository ID and App permissions, resolves the configured base branch to a 40-character commit SHA, and runs every command declared by the version 1 profile. The sandbox checks out that inspected commit SHA, not a moving branch name. This local gate does not require branch protection and does not inspect or certify GitHub Actions workflow isolation.

Profile commands run only when `BROKER_QUALIFICATION_IMAGE` names a digest-pinned image already present in the Docker daemon. Checkout runs in a trusted, deterministic container with a 512 MiB and 100,000-inode tmpfs workspace. The owner-only host credential files are streamed over Docker exec stdin into a 64 KiB container tmpfs owned by UID/GID 65534; they are never placed in command arguments, environment values, or a host bind readable by that UID. The broker copies the checked-out source to an owner-only temporary directory after removing `.git`, rejects symlinks and special files, then removes the credentialed container. Untrusted commands run sequentially in a second deterministic container with a 8 GiB and 500,000-inode tmpfs workspace plus a bounded writable home for Corepack and package-manager caches. The declared `install` command temporarily receives dependency network access. The broker then disconnects the container and verifies that it has no attached network before running the declared `build`, `test`, `typecheck`, and `lint` commands. Any command failure or failed network removal fails qualification. Untrusted command writes are never bind-mounted or copied back to the host. Both containers disable Docker logging and use `--pull=never`, a read-only root filesystem, no Linux capabilities, `no-new-privileges`, bounded memory, CPU, processes, and time. The command container runs as UID/GID 65534 and receives no GitHub token or other secret. Containers are force-removed on timeout, failure, shutdown, and normal cleanup. Without the image, the `sandbox.toolchain` check fails.

The current contract has no Vercel credential or API boundary. A `static_site` qualification therefore records `static_site.preview_configuration` as failed rather than claiming that Standard Protection, disabled Git builds, or prebuilt upload capability was verified.

## Execution source and pull requests

Execution requests carry the frozen `delegationId`, repository registry ID, configuration epoch, and profile digest together with the installation, immutable authorization, GitHub repository ID, and configured base branch. Before exporting source and again before creating a pull request, the broker signs a `GET /api/repositories/internal/usability` request with the callback key and all eight fields. Open Mercato must confirm that the exact frozen binding remains active, linked, unchanged, qualified, and available, and that its current connection and repository resolve to the same installation, authorization, GitHub repository, and branch tuple. The broker then refreshes the installation grant within the persisted authorization subset and verifies the current App permissions.

`POST /executions/source` resolves the configured base branch and returns the exact commit SHA plus a bounded JSON file inventory. File bytes are base64 encoded. The export accepts regular and executable blobs only, rejects truncated trees, links, submodules, `.git` path components, traversal, oversized blobs, more than 5,000 entries, more than 32 MiB of decoded source, or a serialized response over 48 MiB. GitHub installation tokens remain inside the broker.

`POST /executions/pull-requests` accepts the exact exported base SHA and a bounded set of changed UTF-8 files. It refuses `.github/**`, `.git/**`, `.gitmodules`, `.env*`, `.vercel/**`, and `vercel.json`. The request contract remains `path` plus `content`: new text files use mode `100644`, while changes to existing regular files preserve mode `100644` or executable mode `100755`. Existing links, submodules, trees, and unsupported modes cannot be replaced. The broker requires the base branch to remain at that SHA before the first write, creates blobs and a tree, creates one operation-marked commit, creates the deterministic `open-mercato/delegation-<delegationId>` ref without force, and opens the pull request. Retries reconcile the operation marker, parent SHA, branch, and existing pull request; a branch from another operation fails instead of being moved.

Attempts are immutable by `attemptId`. Retrying the same payload is accepted idempotently; reusing the ID with a different payload returns 409. Every attempt has a durable 14-minute overall deadline derived from its persisted creation time; restart never grants a fresh execution window. Provider and sandbox operations receive the remaining time. Results and callback retries survive restarts. Before a recovered `checking` attempt contacts GitHub or creates a new checkout, the worker removes both deterministic container names for that attempt and confirms absence through an exact Docker name inventory. A failed inspect plus daemon health is not accepted as proof of absence. If cleanup cannot be proved during either an initial or recovered run, the attempt remains in `checking` for retry and provider execution does not resume. Due callbacks have an independent dispatcher, so a long qualification cannot starve delivery. Callback delivery uses at most eight attempts with persisted exponential backoff, then remains recorded as `callback_failed` for operator inspection in `broker.sqlite`. Shutdown stops new dispatch, interrupts sandbox work, and waits for in-flight qualification and callback tasks before closing SQLite.

## Secret handling

The broker has no request logging. Provider response bodies, OAuth codes, nonces, signatures, private keys, user tokens, installation tokens, command output, and source content are never returned in errors or qualification reports. Installation tokens exist only in memory and in a short-lived owner-only Git askpass file during checkout; that file is removed before untrusted commands start.

The local application dependency tree is approximately 1.7 GiB and 137,000 files. The command workspace therefore permits 8 GiB and 500,000 inodes, with an 12 GiB memory cap and two CPUs; checkout retains the smaller 512 MiB source cap. These are finite local execution limits, not deployment requirements.

Temporary archives use the command workspace. Package-manager caches use a separate 3 GiB home directory outside the repository, so its package.json module type cannot change how Corepack executes cached Yarn releases. The container is removed after qualification.

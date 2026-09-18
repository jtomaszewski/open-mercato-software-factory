# Agent Orchestrator: architecture brief

How Open Mercato's enterprise `agent_orchestrator` module runs LLM agents as **propose-only**
workers inside a durable, audited business-process engine, and never lets one write to the
database on its own authority. Reference for [SPEC-001](specs/SPEC-001-2026-09-18-agentic-software-factory.md),
which builds on it.

> **Verified against** upstream `open-mercato/open-mercato` `develop` at
> [`83330e2`](https://github.com/open-mercato/open-mercato/tree/83330e271e) (2026-09-18).
> Claims were spot-checked against code; where they drifted, the code won. This app pins
> `@open-mercato/enterprise` 0.8.0, which may lag `develop`.
>
> **Sources of truth** (read these when this brief and the code disagree):
> - Module guide: [`agent_orchestrator/AGENTS.md`](https://github.com/open-mercato/open-mercato/blob/develop/packages/enterprise/src/modules/agent_orchestrator/AGENTS.md)
>   (also in `node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/`)
> - Spec index: [`.ai/specs/enterprise/agent-orchestrator/`](https://github.com/open-mercato/open-mercato/blob/develop/.ai/specs/enterprise/agent-orchestrator/README.md);
>   its `00-IMPLEMENTED-BASELINE.md` predates the process model, taxonomy and unification specs
>   ([triggered process model](https://github.com/open-mercato/open-mercato/blob/develop/.ai/specs/enterprise/agent-orchestrator/2026-08-11-triggered-process-model.md),
>   [agent taxonomy](https://github.com/open-mercato/open-mercato/blob/develop/.ai/specs/enterprise/agent-orchestrator/2026-08-11-agent-taxonomy.md),
>   [workflow unification](https://github.com/open-mercato/open-mercato/blob/develop/.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md))
> - File agents: [`2026-06-22-opencode-file-defined-agents.md`](https://github.com/open-mercato/open-mercato/blob/develop/.ai/specs/2026-06-22-opencode-file-defined-agents.md)

Most agent frameworks answer "how do I get a model to call a tool?". This module answers: how
do you put a non-deterministic worker inside a system of record without giving up audit,
tenancy, permissions, or the ability to say no?

**The load-bearing invariant.** An agent never mutates domain state. It returns a typed,
schema-validated result. If that result contains an intent to change something, the intent is
persisted as a proposal, a policy or a human disposes of it, and only then does an effector
replay the approved actions through the ordinary command bus, with the same audit, undo, cache
invalidation, events and search indexing any human write gets.

The agent is a proposer; the workflow engine is the executor; the disposition gate is the
boundary between them.

## 1. Dictionary

Terms are used precisely; several pairs exist because conflating them caused real bugs.

### The unit of work

| Term | Meaning |
|---|---|
| **Agent** (registry entry) | A named, versioned unit of LLM work: declared input, output schema, tool allowlist, runtime. Global and code/file-defined, not tenant rows. A tenant customises presentation (icon, tags) and policy, never the definition. |
| **`agentType`** (authoring declaration) | What the agent is *for*, declared before it runs: `researcher`, `decision_maker`, `action`. Listable, filterable, assertable in an eval. Not structural: `decision_maker` and `action` return the same envelope. |
| **`resultKind`** (runtime fact) | What actually came back: `research` (`{ kind, data }`), `proposal` (`{ kind, proposal }`), `artifact` (`{ kind, artifacts[], summary? }`). May legitimately disagree with `agentType`: a decision-maker that found nothing returns a `research` result. A finding, not a crash. Note the spellings: authoring type `researcher`, result kind `research`. |
| **AgentRun** | Immutable audit record of one execution (`running → ok \| error`). Answers "what did the agent do", never "what stage is the business at". Identity is `(workflowInstanceId, stepId, invocationId)`, partial-unique: a caller finds the run it caused by naming it, never by "newest since T". |
| **Proposal** (`AgentProposal`) | Persisted envelope `{ options[], rationale? }`: N ranked alternatives, a disposition selects at most one. An empty option set is stamped `none_proposed` at creation. |
| **Disposition** | Verdict on a proposal: `pending → auto_approved \| approved \| edited \| rejected`. A policy or a human decides; nothing else moves a proposal out of `pending`. |
| **Effector** | Turns an approved proposal's actions into commands on the command bus (`executeProposal.ts`). The only code path in the module that writes domain state. |
| **Artifact** (file plane) | A file an agent produced (drafted email, risk report). Bytes stored hashed and encrypted in `agent_run_artifacts`; the result carries references only. Fixed envelope, no per-agent schemas. |

### Execution and process

| Term | Meaning |
|---|---|
| **ProcessDefinition** | Authored: *what can happen*. Name, input schema, triggers, milestone vocabulary, required pointer at a `WorkflowDefinition`. Restates no execution semantics, carries no execution identity. |
| **WorkflowInstance** (core/workflows) | The execution and the single lifecycle owner: status, retry, waiting, cancellation, context. The one authoritative status. |
| **ProcessInstance** | Projection: business-facing read model of one WorkflowInstance (1:1, partial-unique). Status is derived, never transitioned independently. Decides nothing. |
| **Trigger** | One way a process starts: `schedule`, `event`, `manual`. All converge on one entry point. Triggers start processes, never agents. No manual trigger → a hand start returns 403. |
| **Milestone** | Declared business event (`{ key, label, order }`) a workflow step opts into emitting. An indirection so renaming a step doesn't change what a business reader sees. |
| **Outcome** | Optional business result stamped once on a process's terminal transition (type, id, label; FK id plus snapshot). Declared by the terminating source, never derived. A research process producing nothing is a valid completion. |
| **`INVOKE_AGENT`** (workflow activity) | The step type that calls an agent. Exposes five fixed outcome handles, so a workflow's shape is independent of which agent a step points at. |
| **Outcome handle** | `approved`, `researcher`, `rejected`, `guardrailBlocked`, `error`. A vocabulary of decisions: `research` and `artifact` results both route onto `researcher`; producing a document is not a decision. |

### Runtime and authoring

| Term | Meaning |
|---|---|
| **Runtime** | Where the loop executes: `native` (in the Node process via Vercel AI SDK object mode; legacy rows say `in-process`), `opencode` (sidecar container running file-defined agents), `external` (reserved: third-party runtimes reporting over the trace webhook). |
| **File agent** | An agent authored as a directory (`AGENT.md`, `OUTCOME.md`, skills, sub-agents, tools), compiled by `yarn generate` into a committed manifest plus container-mounted files. |
| **Skill** | Reusable instructions (plus optional templates, examples, sandboxed scripts) loaded on demand. Loading injects its instructions and unions its read-only tools into the allowlist. |
| **Sub-agent** | Nested, `research`-kind-only agent invoked by a parent. Depth capped at 1, no proposals, no sub-agents of its own, runs under the caller's scope. |
| **Tool** | Centrally defined (`defineAiTool`), ACL-gated, declares `isMutation`. Mutating tools are refused: file agents declaring one are skipped at registration; for code agents they are stripped at run time. That load-time check is advisory; enforcement is the tool allowlist, the per-call ACL and the `tool_scope` guardrail. |
| **Action vocabulary** | Effects an action agent may propose: `(workflow-safe commands ∪ workflow activity types) ∩ agent.allowedActions`. `allowedActions` narrows, never widens; no new effect surface. |
| **Sandbox** | An `isolated-vm` V8 isolate: no fs, network, `require` or `process`; hard wall-clock cap. Agent-authored scripts run only here. |
| **Session token** (per run) | Opaque credential correlating a sidecar session to its AgentRun, carrying the ACL re-checked on every tool call. Stored in the database (runner and MCP server are different processes). |

### Governance overlays

| Term | Meaning |
|---|---|
| **Guardrail** | Pre/post-call check: schema, prompt injection, grounding. Each writes an append-only `AgentGuardrailCheck` with redacted evidence. A trip routes to `guardrailBlocked`. |
| **Context bundle** (TDCR) | Task-Driven Context Routing: per-run record of the context actually given: routed and pruned sources, token accounting, redaction. |
| **Trace** | Append-only OpenTelemetry GenAI tree of `AgentSpan` and `AgentToolCall` rows. Must be persisted before the run returns: disposition reads trace completeness immediately. |
| **Eval** | An assertion applied to a run. Deterministic scorers may gate; `llm_judge` is advisory. Cases come from corrections and golden runs: `draft → approved → archived`. |
| **Correction** | Append-only record of a human overruling an agent (edit, reject, override, answer) with a mandatory reason. Raw material for eval cases. |
| **Agent principal** | Non-interactive `auth.User` of kind agent plus a scoped role; writes are attributed to it like a human's. Credential modes: `internal`, `oauth_client`, `authmd`. |
| **Caseload** | Operator surface for pending proposals: ranked options, declared facts, rationale, and which gate held an otherwise auto-approvable proposal. |

## 2. What it is built on

The module owns little infrastructure: two spines plus satellites, all consumed through DI.
Cross-module links are FK ids only, never ORM relations.

| Module | What the orchestrator gets |
|---|---|
| `core/workflows` | Durable engine: lifecycle, retry, cancellation, timers, `INVOKE_AGENT`, `USER_TASK` (human review), `WAIT_FOR_SIGNAL` (parking), outcome routing, work inbox, and the workflow-safe command catalogue bounding the action vocabulary. |
| `ai_assistant` | `defineAiTool` and the central tool registry, model/provider factory, MCP server exposing tools over HTTP, `isolated-vm` sandbox. |
| `core/auth` | Agent principals as real `auth.User` rows, scoped roles, wildcard-aware ACL re-checked per tool call. |
| `shared/commands` | The command bus: the effector's only write path, which buys audit, undo, cache invalidation, events and indexing. |
| `queue` | Worker fleet. Agent invocations run on a dedicated `workflow-invoke-agent` queue so long LLM runs don't starve housekeeping. |
| `events` | Typed events, several with `clientBroadcast` so the cockpit updates over SSE. |
| `search` | Retrieval-ranked optional fill for the context bundle. |
| `core/attachments` | Document ingest and the promotion path for produced artifacts. |
| `core/api_keys` | bcrypt-hashed client secrets for external-agent OAuth. |
| `web-research` | Search/fetch engine behind the optional `web_search` / `web_fetch` tools. |

It owns: runs, proposals, traces, evals, guardrails, context bundles, principals, process
definitions and projections.

## 3. The execution model

One durable execution, one lifecycle owner. (The module previously had a second engine beside
the workflow instance; every awkward thing followed from that split.)

| Record | Table | Role |
|---|---|---|
| ProcessDefinition | `process_definitions` | Authored. Points at a WorkflowDefinition. |
| WorkflowInstance | core workflows | The execution. The only lifecycle owner. |
| ProcessInstance | `process_instances` | Projection. Derived status. Decides nothing. |

**Every process points at a workflow, including the trivial one.** Choosing *Single agent* in
the authoring form materialises a real workflow definition:

```
START ──▸ INVOKE_AGENT(agentId) ──▸ END
step id: invoke_agent · resumes on signal: agent_orchestrator.proposal.ready
```

An ordinary row: visible in the Studio, editable, run by the one engine. Adding a wait, branch
or second agent later needs no migration. The generated workflow is the single source of truth
for its agent config and permission grant.

**Permission to start ≠ permissions the process runs with.** Execution identity belongs to the
workflow: core provisions a least-privilege principal from the workflow definition's
`grantedFeatures`. `ProcessInstance.triggeredBy` is provenance, never an ACL identity.

**Starting exactly once.** `processes.startExecution` inserts the ProcessInstance with a null
workflow reference first; a partial-unique index on `(organization_id, process_definition_id,
idempotency_key)` rejects racing losers. One key never produces two workflow instances.

**Event triggers probe an index, they don't scan.** For an incoming event the dispatcher
enumerates the exact id plus every trailing-wildcard prefix and issues one JSONB containment
probe per candidate against a `jsonb_path_ops` GIN index on `triggers`, then re-applies
matching in memory as a backstop.

## 4. One run, start to finish

```
Trigger (schedule · event · manual)
  ▼
processes.startExecution — ProcessInstance claims the idempotency key, before any workflow exists
  ▼
WorkflowInstance starts — the one durable execution, the one status
  ▼
INVOKE_AGENT — enqueue job, PARK at WAIT_FOR_SIGNAL; workflow txn COMMITS here
  ▼                                  (the agent never runs inside the workflow txn)
Worker → agentRuntime.run() — admission gate (global + per-tenant), then AgentRun opens
  ▼
The agent run
  1. context bundle assembled (TDCR): routed, pruned, redacted
  2. pre-call guardrail: prompt injection over untrusted spans
  3. model loop: native runner OR OpenCode container
  4. post-call guardrails: schema · tool scope · grounding
  5. trace persisted before returning (no span ⇒ trace-incomplete ⇒ never auto-approves)
  ▼
Typed AgentResult: research · proposal · artifact  (proposal ⇒ AgentProposal, pending)
  ▼
Auto-approval policy: nine ordered gates
  ├─ review: USER_TASK → Caseload; auto_disposition_block names the gate;
  │          human approves / edits / rejects + mandatory reason → AgentCorrection
  └─ auto_approved: every gate cleared; disposition_by = rule:threshold (render as a rule, not a user)
  ▼
signal agent_orchestrator.proposal.ready → instance resumes, routed by outcome handle
  ▼
approved ⇒ Effector → command bus → audited write (vocabulary re-checked here) → END + outcome
```

**The park is the point.** Running the model inline meant a failing statement aborted the whole
workflow transaction, and for the container runtime the per-run session rows sat in an open
transaction the MCP process couldn't see, so the agent couldn't authenticate its own outcome.

### The disposition gate, in order

`evaluateAutoApproval` (`lib/disposition/autoApprovalPolicy.ts`) is pure: no ORM, container or
clock. Everything not depending on the model's own opinion is answered before confidence.
First match wins.

| # | Gate | Recorded block | Why |
|---|---|---|---|
| 1 | Agent declared `alwaysAsk` | — | Authoring opt-out of automation. |
| 2 | Empty option set | — | `none_proposed`: nothing to approve. |
| 3 | Tenant switch off | `policy` | Tenant master switch in Settings. |
| 4 | A guardrail blocked | `guardrail` | Any block-result check on the run. |
| 5 | Trace incomplete | `trace_incomplete` | Zero spans: an unauditable run can't be unattended. |
| 6 | Top option exceeds risk ceiling | `risk` | Risk is declared per action; an option's risk is the max across its actions. |
| 7 | Confidence missing / not a number | — | Fails closed. |
| 8 | Confidence below threshold | — | Didn't clear the bar. |
| 9 | Top and runner-up within margin | `near_tie` | Confident but not discriminating; a human breaks the tie. |
| — | Otherwise | `auto_approved` | Selected option = top-ranked. |

**A block is not a miss.** `auto_disposition_block` is written only when a proposal cleared the
bar and was held anyway; null means "didn't clear". It is separate from `disposition_reason`,
which belongs to the operator and feeds corrections and evals.

### Disposing an option set

The operator surface never derives which option a verdict runs:

- a disposed proposal replays its own recorded selection;
- a single-option proposal preselects it;
- a multi-option proposal preselects nothing; Approve stays disabled until a human picks.

An edit applies to the selected option only; other options, rationales and confidences survive
verbatim, so the override stays a usable training signal.

## 5. Where the code runs

Two runtimes behind one registry and one `agentRuntime.run()`. The choice is an authoring
decision; callers never branch on it.

| Runtime | Authoring | Use when |
|---|---|---|
| `native` (legacy: `in-process`) | `defineAgent` in `ai-agents.ts`, AI SDK object mode | Typed agents as code. Fastest, lowest ops surface, in-process sub-agents, per-provider concurrency budgets, automatic 429 backoff. |
| `opencode` | File-defined `agents/<id>/` directory | Needs progressive-disclosure skills, sandboxed scripts, a file workspace, or a non-TypeScript author. |
| `external` | — | Reserved: third-party runtime reporting over the HMAC trace webhook. |

### The container runtime is a two-plane system

```
OPEN MERCATO (Node processes)                   OPENCODE CONTAINER (mercato-opencode)
─────────────────────────────                   ─────────────────────────────────────
Queue worker · OpenCodeAgentRunner  ──HTTP+SSE──▸ opencode serve :4096
  mints per-run session token                      pinned image · bash denied
  (TTL 120m, caller's roles)                       native web tools disabled
agentWorkspaceManager                              agents/*.md  (ro mount, "*": false + deny block)
  leases work/<token>/{in,out}                     skills/*/SKILL.md (ro mount, instructions only)
                                  ◂──shared vol──  /home/opencode/work (only writable path)
MCP server (mcp:serve-http)       ◂──remote MCP──  every call carries _sessionToken
  submit_outcome · load_skill
  run_skill_script · delegate_agent
  isMutation:false · ACL re-checked per call
isolated-vm sandbox (30 s · 32 MB · no fs/net)
Postgres: agent_run_sessions · api_keys · runs · proposals
```

- Runner and MCP server are **different processes**: correlation is a database row, not a
  `Map`, and completion is polled, not awaited.
- Scripts and local tools are **not** shipped to the container; they stay server-side behind
  `run_skill_script`, so nothing the model names escapes the sandbox or the ACL.
- **The reverse leg carries the authority.** Every capability flows back through an MCP call
  with the per-run token, whose ACL is resolved server-side and scoped to the invoking caller's
  roles (never a static or superadmin identity).

### Completing a run across a process boundary

The agent finishes by calling `submit_outcome`, which lands in the MCP process. The runner:

- sends the message fire-and-forget with the run's own timeout;
- races an SSE idle signal, a poll of the correlation row, and the wall-clock deadline;
- on first idle with no outcome, sends **one** corrective nudge;
- on a second idle with nothing, fails the run.

The idle subscription is latched. `submit_outcome` resolves the active agent from the
correlation store (never from the model's claim), re-validates against that agent's schema, and
returns schema failures as data so the agent can self-correct. A toolless run gets one
synthetic span, since zero spans would make auto-approval unreachable.

### The sandbox

Skill helpers and local tools run in a fresh `isolated-vm` isolate per execution (reusing the
platform's Code Mode sandbox). No `require`, `process`, `fs`, `Buffer`, `fetch` or network;
`globalThis` shadowed; only the structured-cloned arguments and a bounded console are injected.
30 s wall clock, 32 MB, disposed in `finally`. Trust model: script **source** is trusted,
committed, generator-baked content; the model only chooses which named script runs.

### Fleet shape

- Production requires the Redis-backed queue; the default file-based local queue is sequential
  and caps near ~1,400 one-minute runs/day.
- Sizing: `runs/day × avg seconds ÷ window seconds ⇒ concurrent slots`. Runs are I/O-bound:
  scale by replicas, not per-process concurrency past ~20.
- The admission gate and per-provider LLM budget are **process-local**, not fleet-wide. The real
  throttle is worker concurrency × replicas; the practical ceiling is usually the DB connection
  budget, which the worker silently clamps at startup.

## 6. How an agent is built

A file agent is a directory. The generator reads it; nothing it produces is hand-edited.

```
agents/company_researcher/
├── AGENT.md         frontmatter + instructions — the agent itself
├── OUTCOME.md       result kind + JSON Schema — the output contract
├── SAMPLE.json      optional: example input, powers the Playground
├── FACTS.json       optional: what the Caseload shows a reviewer
├── skills/deal_qualification/
│   ├── SKILL.md     instructions loaded on demand
│   ├── TEMPLATE.md  output shape
│   ├── examples/
│   └── scripts/score.ts   sandboxed pure function, never leaves the server
├── sub-agents/revenue_estimator/
│   ├── AGENT.md     research-kind only, no sub-agents of its own
│   └── OUTCOME.md
└── tools/lookup_history.ts   `// @ref <tool id>` to a central tool, OR a sandboxed run(args)
```

Working example in this app: `src/modules/agent_examples/agents/company_researcher/`.

**AGENT.md**: frontmatter plus the agent's own instructions only.

```yaml
---
id: deals.company_researcher        # required
label: Company researcher           # required
description: Research a company on the public web to qualify it as a prospect.  # required
tools: [agent_orchestrator.web_search, agent_orchestrator.web_fetch]
skills: [deal_qualification]
subAgents: [deals.revenue_estimator]
maxSteps: 14
---
You research a company on the public web ... You are a propose-only researcher: …
```

The generator appends the outcome contract, the sub-agent section and the terminal submit
instruction; don't hand-write them. A missing `AGENT.md`/`OUTCOME.md` or a missing
`id`/`label`/`description` **fails generation**; a duplicate id is skipped with a warning.

**OUTCOME.md**: `kind: research | proposal | artifact` in frontmatter; the first fenced JSON
block is the schema, trailing prose is shipped to the model verbatim.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["actions", "confidence", "rationale"],
  "properties": {
    "actions": { "type": "array", "minItems": 1, "items": { } },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "rationale": { "type": "string", "minLength": 1 }
  }
}
```

It compiles to the same Zod object the code path uses, so both runtimes validate one contract.
Supported subset: objects, arrays, scalars, `enum`, `const`, `required`, `nullable`, min/max
bounds. `oneOf`, `anyOf`, `allOf`, `not`, `$ref`, `format`, `pattern`, `patternProperties`,
`additionalItems`, `propertyNames`, `if/then/else` fail generation loudly. `artifact` declares
no schema: its envelope is fixed platform-wide.

**Skills** load on demand and union their read-only tools into the allowlist. Only `SKILL.md`
is copied into the container; templates, examples and scripts stay server-side behind MCP.

**Tools**: a `// @ref <tool id>` file points at a central, ACL-gated tool (preferred).
Anything else in `tools/` is a local sandboxed `run(args)` under a synthetic skill id, invoked
via `run_skill_script`; no native container tool file is emitted, since that would bypass the
MCP gate.

**Sub-agents** are `research`-kind only, depth 1, run under the caller's scope, and are
delegated through a server-side MCP tool rather than the container's native task spawning
(which wouldn't inherit the session token).

**FACTS.json** declares the Caseload decision-panel facts: label, source
(`input`/`payload`/`output`), dot-path, format. Without one, a capped generic derivation is
used. Malformed: `yarn generate` fails; at load time it is ignored with a warning.

### What `yarn generate` produces

- `generated/file-agents.generated.ts`: committed manifest, plain data with raw JSON Schema,
  recompiled to Zod and registered at load time.
- `docker/opencode/{agents,skills}/`: one flat `.md` per agent and per sub-agent, mounted
  read-only; changes need a container restart.

Both are committed, both generated from the same directory; hand-editing either desynchronises
the two runtimes' view of the same agent.

### The two propose-only gates

The emitted container file for the agent above:

```yaml
---
description: "Research a company on the public web to qualify it as a prospect."
mode: primary
tools:
  "*": false                                              # gate 1: deny everything…
  "open-mercato_agent_orchestrator_web_search": true      # …then allow one by one
  "open-mercato_agent_orchestrator_web_fetch": true
  "open-mercato_agent_orchestrator_submit_outcome": true
  "open-mercato_agent_orchestrator_load_skill": true
  "open-mercato_agent_orchestrator_run_skill_script": true
  "open-mercato_agent_orchestrator_delegate_agent": true  # only when sub-agents are declared
permission:
  write: deny
  edit: deny
  bash: deny
  task: deny                                              # native spawning bypasses the token
---
<AGENT.md body verbatim>
## Sub-agents        ← appended by the generator
## Outcome contract  ← appended by the generator, from OUTCOME.md
```

**Gate 1 is static, gate 2 is live.** The deny-all allowlist bounds what the agent can attempt;
the per-run session token bounds what it can do, with the ACL re-resolved on every MCP call, so
it survives a tenant revoking a permission mid-run.

### The code-authored alternative

A native agent is a `defineAgent` call in a module's `ai-agents.ts`: same id, label, result
kind, Zod output schema, tool allowlist and optional `allowedActions`, executed in-process via
AI SDK object mode. Registry, run record, guardrails, disposition and effector are identical.
You lose skills and the file workspace; you gain no container, lower latency and per-provider
concurrency budgeting with backoff.

## 7. Governance overlays

Five cross-cutting concerns wrap every run regardless of runtime. All write append-only records.

### Guardrails

Deterministic, no model calls. Evidence is pointer-only (source ref, locator, rule ids,
counts); raw untrusted text never enters an evidence field.

| Check | Phase | What it does |
|---|---|---|
| `prompt_injection` | pre | Scores untrusted document and retrieval spans (trusted entity spans excluded). Instruction override and tool directives block alone; obfuscated spacing, encoded payloads, symbol density corroborate. Also matches bare financial imperatives ("approve and pay out"). |
| `schema` | post | Result must parse against the agent's output schema. |
| `tool_scope` | post | Hard backstop: any attempted mutating or off-allowlist tool blocks, however elicited. Holds even if injection detection is evaded. |
| `grounding` | post | Capabilities declared factual only. Cite-or-abstain; malformed claims count as uncited. |

A pre-call block fails the run before disposition; a post-call block persists its rows, then
fails. Either way the workflow routes to `guardrailBlocked` (core duck-types the error code
rather than importing an enterprise type).

### Context (TDCR)

For a run's declared capability the resolver:

- resolves a registered context module; none ⇒ fails closed;
- collects candidates from declared entity, retrieval and document sources, scoped from the
  caller scope, never from input;
- redacts before measuring (encrypted-at-rest fields, conservative PII patterns); fields are
  removed, not blanked;
- packs to a token budget: mandatory sources never pruned, optional fill by score, overflow
  dropped whole;
- persists exactly one immutable bundle.

Untrusted spans (for the injection guardrail) and citable sources (for grounding) are surfaced
but not persisted. Assembly is best-effort: the bundle is evidence, not a gate.

### Trace

Append-only OTel GenAI span and tool-call tree, correlated on `(runtime, externalRunId)` and
idempotent. Large payloads offload to object storage; rows keep redacted summaries. The
container runtime ingests its trace even on failure.

### Evals

See §8. Online scoring runs inline at trace ingest; offline replay runs for CI; operator
corrections populate the case set.

### Identity

Every agent gets a non-interactive `auth.User` and scoped role. Credential modes: `internal`
(platform-run agents), `oauth_client` (external agents with client credentials), `authmd`
(self-registration via an issuer-signed identity assertion). Delegation grants are revocable;
revocation denies already-minted tokens on their next request. Public identity and
trace-ingest endpoints rate-limit per IP **before** credential verification. An unregistered
limiter fails open; a registered-but-broken one fails closed.

## 8. Evals

Three authored objects, two execution planes, one honesty rule.

| Object | What it is |
|---|---|
| **Assertion** | A scorer instance: title, config, `appliesTo` (agent id or `*`), type, severity `gate` or `warn`. Unique on org + appliesTo + key; the key is an instance slug, not the scorer id. |
| **Eval case** | Input plus expected result for one agent; `draft → approved → archived`. Input/expected encrypted at rest; canonical input hash stored in plaintext. Case-level assertion overrides reference assertions by id. |
| **Suite run** | Every approved case for one agent, optionally ×N, optionally pinned to an eval-set version and compared to a baseline. Append-only. Serves both workbench and CI. |

### Scorer registry: 20 deterministic + 1 advisory

| Group | Scorers |
|---|---|
| text | `equals` · `contains` · `starts_with` · `regex` |
| structured | `json_valid` · `json_schema` · `json_match` · `json_path_compare` |
| tools | `tool_used` · `tool_count` · `tool_args_match` · `tool_sequence` |
| economics | `latency` · `cost` · `step_count` |
| agent | `output_present` · `required_keys` · `confidence_threshold` · `disposition_equals` · `no_pii` · `action_vocabulary` |
| judge | `llm_judge` (warn only; scoring runs on a separate async path) |

Score functions are pure and synchronous, which guarantees the online and offline planes agree.
Descriptors carry their config schema, so the UI form is generated from the registry. A preview
endpoint dry-runs `{ scorerKey, config }` against a historical run without persisting. Bad
config is a 422 at write time and a skip at eval time, so a typo never flips a gate.

### Seeded defaults (per tenant and org, `appliesTo: '*'`, editable rows)

| Key | Severity | Enabled | Asserts |
|---|---|---|---|
| `output_present` | gate | yes | The run produced output. |
| `min_confidence` | warn | yes | Confidence ≥ 0.5. |
| `no_pii` | warn | yes | No personal data in output. |
| `llm_judge_helpfulness` | warn | no | Off by default: costs inference. |

Resolution: everything whose `appliesTo` is the agent or `*`, deduped by key; agent-specific
wins, **but may not weaken the gate tier**. Case overrides then shallow-merge and re-validate;
an invalid override yields a recorded skip, never a silent pass.

### Where cases come from

```
"Add to evals" (a good run, from trace or playground) ─┐
Production run → Caseload → human overrules            │
  (AgentCorrection + mandatory reason) ────────────────┴─▸ DRAFT case (input = run's, expected = correction)
                                                            ▼
                                        engineer approves (input hash computed) → regression set
                                                            ▼
                                        replay (fresh inference) + verdict → next prompt/schema change
```

Nothing enters the regression set without human approval. Approval unlocks replay (suites and
CI run approved cases only), export (versioned JSON, approved only) and online golden matching
(via the input hash). **Editing an approved case demotes it to draft**, so you can't pass a
failing gate by rewriting its expectation.

### Two planes

- **Online** (every run, at trace ingest): deterministic assertions stamp `evalPassed`; golden
  match by input hash stamps `goldenPassed`; the LLM judge is sampled by hash of run id and
  queued. Observability only: blocks nothing.
- **Offline** (suite run): approved cases × repeat (pending rows *are* the selection, cap 500),
  **fresh inference** under the agent's own principal (propose-only, never disposes),
  deterministic scoring, then pass score, variance and baseline comparison. Real cost, so it
  needs its own `eval.run` feature.

Execution: ≤ 5 case runs run inline; larger suites enqueue and return 202. The worker drains
pending rows at concurrency 1, idempotently, re-resolving scope from the row. Progress events
stay tiny (the notification bridge drops oversized payloads). Cancel is a terminal transition,
not a delete.

### Verdict (first match)

| # | Condition | Outcome |
|---|---|---|
| 1 | No eval-set version pinned | `advisory` |
| 2 | Any safety regression (gate-tier, non-judge pass rate dropped vs baseline) | `failed`, no toggle |
| 3 | No pass score computable | `failed` |
| — | Otherwise | `passed` |

Pass score = passed ÷ (passed + failed); errors and skips excluded. The baseline must pin the
same eval-set version. No absolute threshold in the gate; a caller may narrow (e.g. 95%) but
never widen.

### CI

```bash
yarn mercato agent_orchestrator eval \
  --agent deals.company_researcher \
  --tenant <id> --org <id> \
  --eval-set-version 2026-09-a \   # pin the dataset, or you get 'advisory'
  --baseline <suiteRunId> \
  --repeat 3 \
  --gate true                      # also accepts --release
```

| Exit | Meaning |
|---|---|
| 0 | passed |
| 1 | failed (with `--gate`, also when the gate couldn't run) |
| 2 | bad arguments; refused to gate on an advisory run; or gate couldn't run without `--gate` |

**What is wired today:** the CLI is the gate's only production caller. Nothing blocks a release
promotion on eval results yet; wire the exit code into a required CI check.

### Workbench

The agent detail page's **Evaluation** tab: assertions (drawer generated from scorer
descriptors, dry-run preview), cases (approve, archive, edit name/expected; input read-only),
runs (all or one case, repeat count, judge-may-gate toggle; live progress; per-assertion
expected-vs-actual mismatch table; link to trace). No side-by-side diff of two suite runs.

## 9. Surfaces

**There is one business-execution API, and it isn't the agent one.**
`POST /processes/:id/executions` starts a business execution: async, `202 { executionId }`,
403 without a manual trigger. `POST /agents/:id/run` is an engineering primitive (one agent,
synchronous, no retry, waits, signals or lifecycle) for playground, evals and diagnostics.

Representative routes under `/api/agent_orchestrator/` (features prefixed `agent_orchestrator.`):

| Route | Feature | Purpose |
|---|---|---|
| `POST /processes/:id/executions` | `processes.run` | External contract: start one business execution. |
| `GET /executions[/:id]` | `processes.view` | Derived status, milestones, proposals, outcome. |
| `GET /agents[/:id]` | `agents.view` | Registry and detail, resolved skills, token usage. |
| `POST /agents/:id/run` | `agents.run` | Playground / evals / diagnostics only. |
| `GET /proposals` | `proposals.view` | The Caseload queue. |
| `POST /proposals/:id/dispose` | `proposals.dispose` | Human verdict; optimistic-locked. |
| `GET /runs[/:id]` | `trace.view` | Runs; filter by eval failure or low confidence. |
| `POST /trace/ingest` | HMAC | Runtime-adapter webhook; idempotent on `(runtime, externalRunId)`. |
| `POST /corrections` | `trace.correct` | Record a human overruling the agent. |
| `GET /context-bundles` | `context.read` | What an agent was actually given. |
| `/identity/*` | public / `identity.tokens` | OAuth discovery, client credentials, identity assertions (public); grant revocation (`identity.tokens`). |

### Cockpit

Overview (KPIs, needs-attention) · Agents (registry, runtime and tenant tags, token usage) ·
Playground · Caseload · Processes (running) and Process definitions (authoring; two routes on
purpose: "what is happening now" vs "what can happen") · Traces · Audit. Tenant icons and tags
live in a settings row keyed by agent id. Several events broadcast to the client over SSE.

### Permissions

21 features: view/run/manage for agents, view/dispose for proposals, view/correct for traces,
manage/run/export for evals, read/manage for guardrails, read for context, read/manage/tokens
for identity, view/manage/run for processes, plus `web_search` and `web_fetch`.

The egress pair is the precedent to copy: network egress is a different capability from "may
run an agent", so it is separately grantable, not granted to the seeded employee, operator
and engineer roles (admin and superadmin get `agent_orchestrator.*`), and re-checked per MCP
call, with SSRF protection (DNS pinning on every redirect hop), domain allow/deny lists and
per-run and per-tenant budgets.

## 10. What it deliberately does not do

- **No second execution engine.** Even "just run this agent" materialises a real workflow.
- **No new effect surface.** Action agents propose only effects the platform already runs
  under its own gates; `allowedActions` narrows, never widens.
- **No sixth outcome handle.** Artifacts route onto `researcher`.
- **No trusting the model about itself.** Active agent, schema and permissions are resolved
  server-side from the correlation store.
- **No derived selection.** The option a verdict runs is the one a human picked or the policy
  explicitly selected, never re-inferred from ranking.
- **No mutable audit.** Spans, tool calls, guardrail checks, context bundles, corrections and
  eval results have no update or delete timestamps.

**The shape of the bet.** Model quality is what's most likely to change, so nothing structural
depends on it. Confidence is evidence, not authorisation; the effect vocabulary is bounded by
the platform, not the prompt; the audit trail is written by the runtime, not the agent. Swap the
model and the governance is unchanged.

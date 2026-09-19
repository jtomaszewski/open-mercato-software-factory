# SPEC-008: Software Engineer: the delegatable agent gets a role name

**Status**: Implemented
**Owner**: HackOn team · **Date**: 2026-09-19 · **Tracker**: —
**Parent**: [SPEC-002](./SPEC-002-2026-09-18-tasks-module.md), whose delegate picker, card badge
and drawer section render this name. [SPEC-009](./SPEC-009-2026-09-19-assignment-picker.md) turns
the single agent into a roster and depends on this rename only for its copy.

## TLDR

The one agent a person can hand a task to is provisioned as **`Factory`** — the machine's name,
not the job's. It becomes **Software Engineer** everywhere a human reads it: the delegate picker,
the card badge, the drawer, the two CLI outputs and the prose of SPEC-001 and SPEC-002.

Identifiers do not move. `FACTORY_AGENT_ID = 'factory'`, `factory.deliver`, `FACTORY_COLUMNS`, the
`factory/catalog-match` check and the product's own name stay exactly as they are; this is a
naming change where people read, not a refactor.

One catch decides the shape of the work: the agent's name is written **only when the principal is
created**, so no code change and no re-provision renames the agent in a database that already ran
the setup. That needs its own step.

## Problem Statement

- **The name describes the machine, not the job.** People assign work to a role they can reason
  about — "who is going to do this?". `Factory` answers with infrastructure: it sets no
  expectation of what comes back, and it reads oddly next to the human names in the same picker.
- **One word, three meanings.** "Factory" is the product (the agentic software factory), the
  module's internals (`factory.deliver`, `FACTORY_COLUMNS`) and the name of the only agent a
  person can pick. Only the third is wrong, and it is the one everybody sees.
- **The roster is about to grow.** SPEC-009 turns the single delegate into a list of roles. A list
  reading "Factory, Reviewer, Researcher" mixes a machine with two jobs; "Software Engineer,
  Reviewer, Researcher" reads like a team.

## User Stories

- **Product owner** opens the delegate picker on `WEB-12` and picks **Software Engineer**. The
  card badge, the drawer and the notification that follows all say the same thing.
- **Team lead** reads an audit entry for a delegated task and sees Software Engineer there too,
  because the name is the agent principal's own `auth.User.name` and not a label our UI paints on
  top of it.
- **Whoever runs the demo** on a database seeded before this change runs one CLI step, and the
  agent is renamed there as well — no reset, no re-seed, the same `userId` and delegation history.

## Proposed Solution

Three edits and one migration step:

1. The provisioned display name in `task_delegation/lib/demoSetup.ts` becomes `Software Engineer`,
   with `FACTORY_AGENT_ID` untouched, so every id, role, email and process binding stays valid.
2. The two CLI outputs, the one test fixture and the one error message that spell the visible name
   follow it.
3. The prose in SPEC-001 and SPEC-002 says Software Engineer where it said factory agent.
4. A CLI step renames the agent principal in databases that already have one — see *Data Models*
   for why provisioning cannot do it.

The word stays where it names the product or an identifier. That line is drawn in *Design*, hit by
hit, so the next person does not have to re-derive it.

## Design

**In scope — what a human reads** (verified by `grep -rniI factory src scripts docs` on
`ad3e000`, after PR #20 renamed the module `tasks` → `task_delegation`):

| File:line | Today | Becomes | Kind |
|---|---|---|---|
| `src/modules/task_delegation/lib/demoSetup.ts:127` | `displayName: 'Factory'` | `'Software Engineer'` | seed data; the name in the picker, card and drawer |
| `src/modules/task_delegation/cli.ts:31` | `` `factory agent ${…}` `` | `` `Software Engineer agent ${…}` `` | CLI output |
| `src/modules/demo_fixtures/cli.ts:40` | `…, factory agent ${…}` | `…, Software Engineer agent ${…}` | CLI output |
| `src/modules/task_delegation/lib/__tests__/delegationService-degradation.test.ts:26` | `name: 'Factory'` | `name: 'Software Engineer'` | test fixture on the visible name |
| `src/modules/task_delegation/i18n/en.json:30` | "The factory orchestrator is unavailable." | "The agent orchestrator is unavailable." | error message; see the resolved open question |
| `src/modules/task_delegation/commands/tasks.ts:188,196,284` | the same string as an in-code fallback | follows the i18n value | error message |
| `docs/specs/SPEC-001…md:59,120,828,832,842` | "the factory agent" | "the Software Engineer" | spec prose |
| `docs/specs/SPEC-002…md:83,105,280` | `"Factory agent"` | `"Software Engineer"` | spec prose |

The i18n **key** `task_delegation.errors.orchestratorUnavailable` is an identifier and does not
move; only its value and the three literal fallbacks do. `en.json` is the module's only locale
file, so there is no other translation to keep in step.

**Out of scope — identifiers and internals:** `FACTORY_AGENT_ID = 'factory'` and every
`agentDefinitionId: 'factory'` comparison (`demoSetup.ts:21,126`, `delegationService.ts:121`,
`commands/tasks.ts:195`, `start-factory.ts:31,46`), `factory.deliver` (`commands/tasks.ts:193`,
`start-factory.ts:50,53`), `FACTORY_COLUMNS` and `lib/factoryColumns.ts`, `FactoryTaskColumn` and
`ensureFactoryColumns` (`transitionPolicy.ts:13,16,54,64,66`, `commands/tasks.ts:69-91`), the
subscriber id `task_delegation:start-factory` with its tests, code comments, the CI status
`factory/catalog-match`, the whole `src/modules/factory/` module — which is the product's delivery
module, not the agent, hence its `category: 'Factory'` and OpenAPI `tag: 'Factory'` — and the
product's own name in the README and SPEC-001's title. SPEC-001:714 names Cursor's "Factory MCP",
someone else's product, and stays.

Two `[internal]` throws in `subscribers/start-factory.ts:37,53` also keep the word. They are
diagnostics for the event log, not user-facing copy — the `[internal]` prefix is the repository's
marker for exactly that — and :53 names the `factory.deliver` process definition outright. They are
the reason the grep gate in *Implementation Approach* is scoped to the two user-facing phrases
rather than to the bare word.

The agent's generated email (`agent+factory+<organizationId>@agent.internal`) is an identifier and
stays too — it is never shown in the board's surfaces.

## Data Models

No schema change, and exactly one stored value moves: the agent principal's `auth.User.name`,
encrypted at rest like every other user name.

It does not move by itself. `provisionAgentPrincipal` (enterprise `agent_orchestrator`) sets
`name: parsed.displayName ?? parsed.agentDefinitionId` **only on the branch that creates the user**;
for an existing principal it reconciles the role, the ACL and the user-role link and never touches
the name. So on any database that already ran `task_delegation seed-demo` — including the demo —
the agent stays `Factory` until something updates that row explicitly. Hence step 4: an update
through the `auth.users.update` command, which decrypts, re-encrypts and audits the change and
touches no other column, addressed by the principal's `userId`.

## API Contracts

No contract changes shape. `GET /api/task_delegation/agents` keeps returning
`{ items: [{ userId, agentId, name }] }`; `agentId` stays `'factory'` and only the `name` value
differs. Consumers that match on the id — the `start-factory` subscriber, `task_tools`, the
orchestrator's process binding — are unaffected by design; anything that matched on the string
"Factory" was already reading a display value.

The new CLI surface is additive: `mercato task_delegation rename-agent --tenant <id> --org <id>`,
idempotent, no flags beyond scope.

## Implementation Approach

Each step leaves the app working and ends with its own test.

**Phase 1: the rename**

1. `displayName: 'Software Engineer'` in `task_delegation/lib/demoSetup.ts`, `FACTORY_AGENT_ID`
   unchanged. *Test:* the `demoSetup` test asserts the new display name and the unchanged
   `agentDefinitionId`.
2. A CLI step that renames an existing agent principal: resolve the principal for
   `agentDefinitionId: 'factory'` in the scope via `agentPrincipalService.resolve`, update its
   `auth.User.name` through `auth.users.update`, report when there is nothing to do. *Test:* a
   principal named `Factory` is renamed with the same `userId`; a second run, a database whose
   agent is already `Software Engineer`, an unprovisioned scope and a container without the
   orchestrator are each a reported no-op that issues no command. Unit tests mock the command bus,
   so the write itself and the cross-tenant refusal are proved against a real database by the
   procedure in `docs/development/task-delegation-verification.md`.
3. The two CLI output strings, the test fixture and the orchestrator error message from *Design*.
   *Test:* `yarn test` green; `grep -rni "factory agent\|factory orchestrator" src` returns only
   the two `[internal]` throws named in *Design*.
4. The prose in SPEC-001 and SPEC-002, plus the `rename-agent` line in SPEC-004's entry points —
   that spec is the demo runbook, and a database seeded before this change is exactly the one that
   would say `Factory` on stage. *Test:* none (docs); the inventory above is the evidence.

Validation: `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`.
The rename step is exercised against the demo database before the demo, not during it.

## Key Design Decisions

1. **The rename stops at what people read.** Renaming `factory.*` would touch the orchestrator's
   process binding, the seeded rows, the CI status and SPEC-001's contract for no visible gain,
   and every one of those is a place where a half-applied rename fails silently.
2. **The name lives on the principal, not as a label in our UI.** Audit entries, notifications,
   `staff` and the MCP tools all read `auth.User.name`; painting "Software Engineer" over
   `Factory` in our components only would make those surfaces disagree with the board.
   SPEC-009 adds a roster label for our own surfaces and keeps the two in sync deliberately.
3. **Existing databases get an explicit step.** Provisioning is create-only, so "just re-run
   setup" would look like it worked and change nothing — the step is small, and it is the
   difference between a renamed demo and a demo that still says Factory on stage.
4. **The rename CLI goes through the command, never the ORM.** `auth.users.update` handles the
   name's encryption, emits the CRUD side effects and writes the audit entry; a direct `em` write
   would silently skip all three and leave the search index stale.

## Open Questions

- ~~**Does "The factory orchestrator is unavailable." change too?**~~ **Resolved 2026-09-19:** yes.
  The goal is zero occurrences of the word on screen, so the message becomes "The agent
  orchestrator is unavailable." — "agent", not "Software Engineer", because the sentence names the
  orchestrator that runs agents, not the agent itself. One i18n value plus three in-code fallbacks.
- **Do we want the same rename upstream?** If the Open Mercato maintainers ever ship a default
  agent roster, the display name is theirs to pick. Worth one question at the event.

## Changelog

<!-- Record, not state: rows are closed once dated — append, never rewrite. -->

| Date | Change |
|------|--------|
| 2026-09-19 | Split out of the combined rename-plus-picker draft after a scope-cohesion review; this spec is the rename only, the picker is SPEC-009. |
| 2026-09-19 | Verified against a disposable database across two tenants: the rename lands through `auth.users.update`, a second run writes nothing, and the same command with the wrong `--tenant` is refused — where the pre-fix filter renamed the other tenant's agent. Procedure recorded in `docs/development/task-delegation-verification.md`. Agent identity constants moved to `lib/agentIdentity.ts`. |
| 2026-09-19 | Implemented. Review caught the rename resolving its user by id alone: `resolveAgentPrincipal` matches on `organizationId` only, so the lookup now repeats the full scope and pins `kind: 'agent'`, with a test that fails without it. Added the `rename-agent` line to SPEC-004's entry points. |
| 2026-09-19 | Re-verified the inventory against `ad3e000`: PR #20 renamed the module `tasks` → `task_delegation`, so every path moved; added SPEC-001:120 and corrected the SPEC-002 line numbers. Resolved the orchestrator-message open question as a change, moving it from Borderline into scope. |

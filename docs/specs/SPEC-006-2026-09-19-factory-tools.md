# SPEC-006: Factory tools: chat intake and site drift detection as AI tools

**Status**: Draft
**Owner**: HackOn team · **Date**: 2026-09-19 · **Tracker**: —
**Parent**: [SPEC-001](./SPEC-001-2026-09-18-agentic-software-factory.md) (the factory),
[SPEC-002](./SPEC-002-2026-09-18-tasks-module.md) (the task board and delegation),
[SPEC-005](./SPEC-005-2026-09-19-stal-zbiorniki-www.md) (the site this spec reads).
**Demo**: [SPEC-004](./SPEC-004-2026-09-18-demo-stal-zbiorniki.md) scene 2 and the bridge to scene 3.
**Glossary**: [`CONTEXT.md`](../../CONTEXT.md) · **Decisions**: [ADR-0001](../adr/0001-factory-tools-in-their-own-module.md),
[ADR-0002](../adr/0002-chat-writes-only-tasks.md)

## TLDR

Marek, the business owner, tells the Open Mercato chat "ZDP-5000 holds 5 200 l, not 5 000, and the
dimensions are missing" and, after one approval card, a delegated task is on the board and the
factory is running. He then asks "does the site match the catalog?" and gets the list of product
pages that drifted from the catalog, each with a one-click "create a task to fix it".

This is one app module, **`factory_tools`**, that ships one chat agent and six AI tools. The tools
are registered once through `defineAiTool`, so they serve the Open Mercato chat (the primary
surface, with its approval card) and the Open Mercato MCP server (a secondary surface for
external clients) from one definition. Everything is built on installed capabilities: the core
`staff` task board (0.8.0), the `ai_assistant` mutation approval runtime, the `catalog` read tools
and the shared outbound-fetch helpers. **The chat writes nothing but tasks and comments** (ADR-0002);
catalog and site changes stay with the factory.

## Problem Statement

- **Scene 2 of the demo starts in the chat** (SPEC-004): a sentence from Marek must become a
  delegated task. SPEC-002 designs this as `tasks.intake` inside the `tasks` module, but that
  module is being built by another person and is on no remote branch the day before the freeze.
  Without a working chat intake the demo falls back to "Marek creates the task by hand".
- **After scene 2 the site is wrong and nothing notices.** SPEC-005 states that
  `catalog.product.updated` is not a trigger, so the corrected `ZDP-5000` record and its product
  page ("5 000 l", no dimensions) diverge "until the next PR". The demo's hook is "records and the
  site visibly drift apart"; today the only detector is a person reading the page.
- **The chat has a shortcut that would break the story.** `catalog.update_product` already exists
  behind an approval card. Using it for "change the price on the site" would bypass the Caseload
  and leave the site stale, since the site changes only through factory PRs (SPEC-005).
- **Two specs name the same write tool twice** (`factory_send_task` in SPEC-001,
  `tasks_create` in SPEC-002) with different inputs, and SPEC-002's traceability key
  `source_ref = '{conversationId}:{messageId}'` is not obtainable: in 0.8.0 a tool handler
  receives no conversation or message id (verified in `McpToolContext`).

## Overview and Success Measures

- **Primary outcome:** scene 2 of the Sunday demo runs from the chat: sentence → approval card →
  delegated task on the board in under 60 seconds, with no manual task creation.
- **Leading indicators:** `yarn mercato ai_assistant mcp:list-tools` lists the six tools; the
  intake agent appears in the chat picker; the drift check on the live site reports `ZDP-5000`
  after the scene-2 correction and nothing else.
- **Baseline:** no chat intake exists; the fallback is a hand-made task (SPEC-004 fallback table).
- **Market / product reference:** Linear's agent delegation, GitHub's "assign an issue to the
  coding agent", Warp's Factory MCP `send_task`. Adopted: one write ("create the work item,
  optionally hand it to the agent") behind an explicit confirmation, with a link back. Rejected:
  an agent that edits the record or the site from the chat; per-user OAuth for the external
  client.

## Goals

- **REQ-001** — A user who may manage tasks turns a chat request into a `staff` task through the
  standard approval card; nothing is written before confirmation; the reply links the task.
- **REQ-002** — With `delegate: true` and the `tasks` module installed, the created task is
  delegated to the factory agent in the same confirmed action; without the module or the
  permission it lands in the backlog and the reply says why.
- **REQ-003** — The chat and MCP clients can read a task by reference or id, search tasks and list
  projects, seeing exactly what the caller sees on the board.
- **REQ-004** — A user can add a comment to a task from the chat, through the approval card, under
  their own name.
- **REQ-005** — A read-only drift check compares the live site with the catalog, keyed by SKU, on
  the four fields the site exposes as data attributes (title, net price, in stock, capacity) and
  reports products missing from the site, within a bounded number of requests and time.
- **REQ-006** — Each drifted product can be turned into one prefilled "align the product page"
  task through the same create-task card.
- **REQ-007** — The same tools are available on the Open Mercato MCP server to an external client
  whose API key holds only the task features; the repository documents how to connect one.
- **REQ-008** — Every task created by these tools records its intake source in a visible footer;
  a repeated confirmation of the same approval card in the chat cannot create a second task
  (runtime guarantee, covered by TEST-015).

## Non-goals

- No catalog writes from the chat (ADR-0002); no PR opened by the chat (SPEC-001, SPEC-005).
- No moving tasks between columns and no un-delegation from the chat (SPEC-002 guard; user
  decision).
- No `tasks_intake` dedupe table and no migration of our own; it stays with the `tasks` owner.
- No comparison of certifications or dimensions (the site exposes them only as table text).
- No drift check against PR previews; `factory/catalog-match` (SPEC-005) owns that.
- No organisation-level settings UI for the site URL; an environment variable serves the demo.
- No two-way handoff (pull a task into a session, push a session's result) — SPEC-001 roadmap.
- No new pages: the chat, the board and the drawer are installed UI.

## Proposed Solution

One app module, `src/modules/factory_tools/`, with:

- **`ai-tools.ts`** — six tools, dot-namespaced like core (`factory_tools.create_task`,
  `factory_tools.get_task`, `factory_tools.search_tasks`, `factory_tools.list_projects`,
  `factory_tools.comment_task`, `factory_tools.check_site_drift`). Writes are `isMutation: true`
  with `loadBeforeRecord`, so the chat shows the standard *Review proposed changes* card and the
  handler runs only after **Confirm** with `approvedPendingActionId` in its context.
- **`ai-agents.ts`** — one chat agent, `factory_tools.intake` ("Task intake" / „Zgłoś zadanie”),
  `mutationPolicy: 'confirm-required'`, allow-list = our six tools plus four catalog **read**
  tools for quoting records (`catalog.get_product`, `catalog.list_products`, `catalog.list_prices`,
  `catalog.list_categories`).
- **`acl.ts`** — one feature, `factory_tools.drift.view`, for the drift check (it makes outbound
  HTTP). Task tools require the board's own features, `staff.timesheets.tasks.view` and
  `staff.timesheets.tasks.manage`, so the chat's ACL is the board's ACL (SPEC-002 principle).
- **`i18n/*.json`, `index.ts`, `setup.ts`** — labels in every project locale, module metadata,
  role defaults for the one feature.

Task creation goes through the installed `staff` API (`POST /api/staff/timesheets/tasks`) via
`createAiApiOperationRunner`, the pattern core's own mutation tools use, so route ACL, validation
and `staff`'s events apply unchanged. Delegation calls the `tasks` module's HTTP contract from
SPEC-002 (`GET /api/tasks/agents`, `POST /api/tasks/delegations`) only when that module is
installed; the dependency is optional and detected at call time.

The drift check fetches `sitemap.xml` from the configured site origin, then each `/produkty/<sku>/`
page, reads the `data-*` attributes SPEC-005's `ProductPage` renders as a contract
(`data-sku`, `data-title`, `data-price-net`, `data-in-stock`, `data-capacity-liters`), and compares
them with `catalog.get_product { includeRelated: true }` for the same SKU. It returns a typed list;
the agent renders it and offers "create a task for each".

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Own module `factory_tools`, not `tasks` (ADR-0001) | `tasks` is on another person's local branch; zero shared files; testable today against core `staff` | Files inside `src/modules/tasks/` as SPEC-002 sketches | Nothing runs until the other branch lands; merge into the same directory hours before the freeze |
| Chat writes only tasks and comments (ADR-0002) | One path for every change; the factory proposes the record change in the Caseload and the site PR in one plan (SPEC-003) | `catalog.update_product` from the chat, then an "align the site" task | Duplicates scene 2's before → after moment and bypasses the Caseload |
| One write tool, one input shape | SPEC-001 (`factory_send_task`) and SPEC-002 (`tasks_create`) named the same thing twice | Two tools | Two names for one action confuse the model and the MCP client; SPEC-001 gets a changelog row |
| Dot-namespaced names (`factory_tools.create_task`) | Core convention; the MCP server passes names through verbatim (verified 0.8.0) | Underscores as in SPEC-002 | Would be the only pack breaking the convention |
| Task ACL = `staff` features; one own feature for drift | No new roles for the demo; the drift check is the only new capability | A full own feature set | Duplicates what the board already gates |
| Delegate resolved from `GET /api/tasks/agents` **at preview time** | Exactly one agent on the demo → zero configuration; several → the preview fails with the list and the agent asks before any card, so the task is never created without its delegate decision | Env var or module setting; resolving in the handler | Configuration the board already knows; a handler that "asks" after Confirm would leave a task behind |
| Agent always asks which project | User decision: no hidden default | Env var with the site project key | A wrong default silently files tasks in the wrong project |
| One approval card per drifted product | Demo has one drift (`ZDP-5000`); a product page is one PR | One bulk card creating N tasks | A second runtime mode (`isBulk`) to test the day before the freeze |
| Source recorded as a description footer | `staff` tasks carry no source field; the `tasks_intake` table is the `tasks` owner's | Custom fields on the `staff` task | Extra field installation now; noted as roadmap |
| Chat idempotency from the runtime; MCP gets an informational `clientRef`, no dedupe | A confirmed pending action executes once (verified: `confirmed` short-circuit); MCP has no per-call id, and a field called "idempotency key" that does not deduplicate would be a false contract | Own dedupe table; an `idempotencyKey` input | Migration hours before the freeze; a no-op key becomes a compatibility trap when it later starts deduplicating |
| Site URL from `FACTORY_SITE_URL` (production only) | "The live site" is the demo thesis; previews belong to `catalog-match` | Per-organisation setting; preview URLs | Settings UI is out of scope; previews already checked by the runner |

## Domain Vocabulary and Business Rules

Terms are defined in [`CONTEXT.md`](../../CONTEXT.md); the rules below are the ones this spec adds.

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| **Drift** | For one SKU: a `field_mismatch` on any of `title`, `priceNet`, `inStock`, `capacityLiters`; or `missing_on_site` (SKU in the catalog, no `/produkty/<sku>/` in a **successfully parsed** sitemap). A SKU on the site but not in the catalog is reported as `unknown_on_site` and never turned into a task | Catalog record (`catalog.get_product`) vs `data-*` attributes of the live page | Sitemap unreachable or unparsable → `{ partial: true, error: 'site_unreadable', drifts: [] }`, never `missing_on_site`; a page unreachable or over budget → that SKU in `unchecked`, `partial: true`; the tool never guesses |
| **Field comparison** | `priceNet`: catalog `regular` price `unitPriceNet` in PLN rounded to 0.01 vs `data-price-net` (empty = null); `inStock`: membership of the catalog category with handle `od-reki` vs `data-in-stock`; `capacityLiters`: `metadata.capacityLiters` (number or numeric string) vs `data-capacity-liters`; `title`: trimmed, case-sensitive | SPEC-005 mapping table | A catalog value the rule cannot derive (no PLN price, non-numeric capacity) → `catalog: null`, still reported as mismatch when the site has a value |
| **Intake source** | `chat` when `ctx.approvedPendingActionId` is present, else `mcp`. Footer: `— Intake: {source} · ref {sourceRef}` where `sourceRef` = the pending action id (chat) or the client's `clientRef` (MCP) or `—` | Tool handler | Never omitted; appended after the description, separated by a blank line |
| **Delegation from intake** | Decided at **preview** (`loadBeforeRecord`): allowed when the caller could delegate on the board (`tasks.delegate`) and `GET /api/tasks/agents` returns exactly one agent, or the input names `agentUserId`. The preview payload carries `delegate: { agentUserId, label } \| null` and `reason`, so the card shows the delegate or the reason before Confirm. Several agents and no `agentUserId` → the preview fails with the agent list and no card is shown; the agent asks and retries | `tasks` module (SPEC-002) | Missing module, no permission, or zero agents → card says "no delegate: {reason}", task created in the backlog; agent gone between preview and Confirm, or delegation call fails after the task was created → `delegated: false, reason: 'no_agent' \| 'delegation_failed'`, task stays in backlog, no automatic retry (delegate on the board) |
| **Task body** | Markdown, ≤ 8 000 chars including the footer; the agent writes title (≤ 255), context, the quoted record (SKU, id, current values), acceptance criteria. `links[]` are appended before the footer as a Markdown list "Links:" | `staff` validators | Over length → the handler returns a validation error to the model, which shortens and retries |
| **Untrusted text** | Task comments, task descriptions from the board and every byte of the site are untrusted prompt input | SPEC-002 | The agent prompt says so; the drift tool returns only parsed attributes, never page text |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Business owner (Marek) in the chat | create task, delegate, comment, read tasks and projects, run the drift check | tenant + organisation from the session; task visibility = projects he is a member of or all with `staff.timesheets.manage_all` | `staff.timesheets.tasks.view`, `staff.timesheets.tasks.manage`, `tasks.delegate` (for delegation), `factory_tools.drift.view`, `catalog.products.view` |
| Team member in the chat | read tasks and projects, comment | same | `staff.timesheets.tasks.view`, `staff.timesheets.tasks.manage` (comment) |
| External MCP client (developer's Claude Code / Cursor) | create task, read tasks and projects; no card, so the write executes immediately | tenant + organisation of the API key; the key's user must hold the features **and have a staff member** (otherwise `staff` answers `assignee_required`) | `staff.timesheets.tasks.view`, `staff.timesheets.tasks.manage`; **never** `catalog.products.manage` |
| Factory agent (workflow principal) | none of these tools | — | — |

`tenantId` and `organizationId` come only from `McpToolContext` (session or API key); both must be
present or the handler throws before any read (`requireToolScope`, the `example` pattern). No
input field carries scope. There is no system-scope operation in this module. The `staff` list
route already narrows tasks to the caller's project memberships, so `search_tasks` and
`get_task` cannot show a task the caller could not open on the board.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Tasks, projects, references, comments, board, drawer | reuse | `staff` (core 0.8.0) | HTTP routes via `createAiApiOperationRunner`; ids only | The board is the source of truth (SPEC-002) |
| Delegation, agents list, run state | reuse, optional | `tasks` (SPEC-002, in progress) | its HTTP routes called in-process through `createAiApiOperationRunner` (the sanctioned AI-tool seam, same as for `staff`; no raw fetch), 5 s per call; route absent (404) → degraded | Owned by another person; must not block us. An optional DI service would be the alternative if `tasks` exposes one |
| Mutation approval card, pending actions, idempotent confirm | reuse | `ai_assistant` | `isMutation` + `loadBeforeRecord`; `approvedPendingActionId` | Standard contract; nothing written before Confirm |
| Product record with prices and categories | reuse | `catalog` | `catalog.get_product { includeRelated }`, `catalog.list_products { q }` (agent allow-list and in-process from the drift tool) | Catalog is the source of truth |
| Outbound HTTP with SSRF guard and timeout | reuse | `@open-mercato/shared` | `safeOutboundFetch` + `fetchWithTimeout` composed in one helper | No ad hoc fetch |
| Tool pack, agent, ACL, i18n, setup | app-own | `factory_tools` (new) | module root files read by `yarn generate` | The only new surface |
| Result cards in the chat | reuse | `@open-mercato/ui` | fenced block `open-mercato:activity { title, status, href, description }` | No custom UI part needed |
| Site pages and sitemap | external, read-only | `hackaton-stal-zbiorniki-landing` (SPEC-005) | `data-*` attributes contract | Site changes only through PRs |

## Architecture and Data Flow

```text
Marek in AI chat ──▶ agent factory_tools.intake ──▶ factory_tools.create_task (isMutation)
                                                      │ preview: loadBeforeRecord(project) [+ GET /api/tasks/agents] → approval card
                                                      │ Confirm → /api/ai/actions/{id}/confirm → handler(ctx.approvedPendingActionId)
                                                      ├─▶ POST /api/staff/timesheets/tasks  (staff, existing)  → task {id, reference}
                                                      └─▶ [tasks installed?] GET /api/tasks/agents → POST /api/tasks/delegations
                                                                               → tasks.task.delegated → SPEC-001 start-factory
Marek: "does the site match?" ──▶ factory_tools.check_site_drift (read)
                                    ├─▶ GET {FACTORY_SITE_URL}/sitemap.xml, /produkty/<sku>/  (safe fetch, ≤ 50 pages, ≤ 5 in flight)
                                    └─▶ catalog.get_product(includeRelated)  per SKU (in-process)
                                    → [{ sku, kind, field?, site, catalog, href }]  → agent offers create_task per SKU
External MCP client ──▶ POST /mcp (x-api-key) ──▶ same tools, no card, ACL from the key's user
```

- **Module boundaries:** `factory_tools` owns no records. It owns the agent, the tool
  definitions, the drift comparison rules and one ACL feature. Tasks stay in `staff`; delegation
  stays in `tasks`; the site stays in its repo.
- **Extension points:** module-root `ai-tools.ts` / `ai-agents.ts`, `acl.ts`, `setup.ts` role
  grants, i18n catalogs. No widget, interceptor or subscriber.
- **Alternatives considered:** a `tasks`-module-only design (SPEC-002 as written) — rejected in
  ADR-0001; a Code Mode script instead of six tools — rejected because the approval card exists
  only for declared mutation tools.
- **Compatibility:** no installed contract changes. SPEC-001's `factory_send_task` name is retired
  in favour of `factory_tools.create_task` (changelog row in SPEC-001). SPEC-002's chat intake
  section is superseded by this spec (changelog row in SPEC-002); its `tasks_intake` table remains
  that module's roadmap. Tool names and input shapes below become a contract for agents and MCP
  clients once shipped (`BACKWARD_COMPATIBILITY.md` applies to renames).

## User Journeys

### Journey J-001 — Scene 2: a sentence becomes a delegated task

1. Marek is on the `ZDP-5000` product page, opens the AI launcher (⌘L), picks **Task intake**.
2. He types: „ZDP-5000 ma 5200 l, nie 5000, i brakuje wymiarów”. The agent calls
   `catalog.list_products { q: 'ZDP-5000' }` then `catalog.get_product { includeRelated: true }`,
   quotes the record (title, capacity 5000 l, dimensions empty), and asks which project
   (`factory_tools.list_projects` → e.g. `WEB`, `DEMO`) if more than one exists; it always asks.
3. It calls `factory_tools.create_task { project: 'WEB', title, description, delegate: true }`.
   The preview (`loadBeforeRecord`) loads the project and, since `tasks` is installed and lists
   one agent, resolves the delegate. The approval card shows: project `WEB`, title, description
   (with acceptance criteria and the quoted record), delegate „Factory agent”, source `chat`.
   Nothing is written.
4. Marek clicks **Confirm**. The handler creates the task (`WEB-13`, backlog, assignee = Marek's
   staff member), appends the footer, and delegates it to the agent fixed at preview. The reply
   is an `activity` card „WEB-13 · Popraw ZDP-5000: pojemność 5200 l i wymiary” with status
   `queued` (the column the delegate command moved it to) and a link to the board. The board
   shows the card with the delegate badge (SPEC-002 widget).
5. Failures: no `tasks.delegate` or `tasks` absent → the card already reads „bez delegacji:
   {reason}”, task lands in backlog; several agents and none named → no card, the preview
   returns the list and the agent asks „Któremu agentowi?”; project renamed between preview and
   Confirm → 412 stale, the card asks to re-run; delegation call fails after the task exists →
   task in backlog, reply says „utworzone, delegacja nie powiodła się” with the board link;
   description over 8 000 chars → the model is told to shorten.

### Journey J-002 — The 15-second bridge: drift after the correction

1. After scene 2 the Caseload change is applied and the catalog says 5 200 l. Marek asks the
   intake agent: „Czy strona zgadza się z katalogiem?”.
2. The agent calls `factory_tools.check_site_drift {}`. The tool reads the sitemap (7 URLs),
   fetches 7 pages, compares with 7 catalog records, and returns one drift:
   `ZDP-5000 · capacityLiters · site 5000 · catalog 5200` plus `href` to the live page.
3. The agent shows a short table and offers „Utworzyć zadanie dla ZDP-5000?”. Marek says yes.
4. The agent calls `factory_tools.create_task` once per chosen SKU (one card each, at most 5 per
   turn) with a prefilled body („Wyrównaj stronę produktu ZDP-5000 do katalogu: pojemność 5000 l
   → 5200 l; źródło: live site vs catalog on 2026-09-20”), `delegate: true`. Approval card →
   Confirm → `WEB-14`, delegated. The factory opens the PR (SPEC-005 flow). The demo owner
   decides whether that PR is shown.
5. Failures: sitemap unreachable → „Nie udało się odczytać mapy strony (timeout 10 s)”, no drift
   and no task offered; one page unreachable → that SKU listed as unchecked, the rest reported;
   more than 50 product URLs → the first 50 checked, `partial: true`, the reply says so.

### Journey J-003 — "What is happening with WEB-13?"

1. Anyone with `staff.timesheets.tasks.view` asks the agent about `WEB-13`.
2. `factory_tools.get_task { reference: 'WEB-13' }` returns the task, its column, parent,
   comments, and, when `tasks` is installed, the delegation (agent, run state, links to the
   instance, Caseload item, PR, preview) from `GET /api/tasks/delegations?taskIds=`.
3. The reply is one `activity` card plus two sentences. A caller who is not a member of the
   task's project gets „Nie znaleziono” — the `staff` route returns no row, not a redacted one.

### Journey J-004 — External client (secondary)

1. A developer creates an API key (Settings → API Keys, or `mcp:ensure-api-key`) for a user whose
   role holds only `staff.timesheets.tasks.view` and `.manage` **and who has a staff member**
   (the README says so; without one `staff` refuses with `assignee_required`).
2. Claude Code is configured with `{"mcpServers":{"open-mercato":{"type":"http","url":"http://localhost:3001/mcp","headers":{"x-api-key":"omk_…"}}}}`.
3. `factory_tools.create_task { project: 'WEB', title, description, clientRef }` creates the
   task immediately (no card on this surface). `clientRef` is informational: it lands in the
   footer, it does **not** deduplicate; the README tells the client to call once. Dedupe arrives
   with the `tasks_intake` table (SPEC-002 roadmap).

## UI and Interaction Contracts

No new page, route, menu entry or widget: every surface is installed UI (the AI chat, the
`staff` board and drawer). What is unique is the content of three chat artefacts.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| Chat: approval card for `create_task` | Review project, title, description, delegate (or the reason there is none), source; Confirm / Cancel | `loadBeforeRecord` on the project record (+ agents list); `POST /api/staff/timesheets/tasks` | `catalog.update_product` card (`mutation-preview-card`) | runtime `mutation-preview-card` | preview, confirming, confirmed (link), 412 stale, expired (15 min), permission denied, preview refused (ambiguous agent → agent asks) | REQ-001, REQ-002, REQ-006 |
| Chat: approval card for `comment_task` | Review task reference and body | `loadBeforeRecord` on the task; `POST /api/staff/timesheets/tasks/{id}/comments` | same | same | as above | REQ-004 |
| Chat: result card | Link the created task | fenced `open-mercato:activity { title: '{reference} · {title}', status: {current column slug: 'backlog', or 'queued' right after delegation}, href, description }` | `customers.*` activity replies | `RecordCardShell` | success only | REQ-001 |
| Chat: drift result | Table of drifts + offer to create tasks | tool result rendered as Markdown by the agent | — | Markdown | empty („Strona zgadza się z katalogiem”), partial, error (site unreachable) | REQ-005, REQ-006 |
| Chat picker: agent entry | Choose **Task intake** | `ai-agents.ts` label, description, suggestions | `example.todo_assistant` | launcher picker | — | REQ-001 |

`href` of the result card is the task's project board (`/backend/staff/time-tracking/projects/{projectId}/board`)
with the drawer deep link the `staff` board exposes; the exact query parameter is read from the
installed board page in Phase 1 and recorded in the changelog.

### UI architecture

N/A — navigation, dashboard and widgets are unchanged; the primary flow is any page → ⌘L →
Task intake → sentence → Confirm. Empty, responsive and keyboard behaviour are the installed
chat's; the drift empty state reads „Strona zgadza się z katalogiem” plus the checked count.

Localization: agent label, description and suggestions in `i18n/{en,pl,de,es,ko}.json` under
`factory_tools.*`; tool `displayName`s in English (runtime convention); the agent answers in the
language of the request. Design system: no custom component, so no token work.

## Data Models

N/A — no new entity, table or migration. The module persists nothing. Configuration:

| Setting | Type | Default | Used by |
|---|---|---|---|
| `FACTORY_SITE_URL` | absolute `https://` origin | none (drift tool returns `configured: false`) | `check_site_drift` |
| `FACTORY_SITE_MAX_PAGES` | integer 1–200 | `50` | `check_site_drift` |
| `FACTORY_SITE_REQUEST_TIMEOUT_MS` | integer | `10000` per request | `check_site_drift` |
| `FACTORY_SITE_TOTAL_TIMEOUT_MS` | integer | `25000` for the whole check (one `AbortController`) | `check_site_drift` |

Drift check budget: at most 5 pages in flight; 512 KB per response; the catalog side lists
products with `catalog.list_products` paged to exhaustion up to 200 SKUs, beyond that
`partial: true`. Attribute extraction is a bounded regex over the single element carrying
`data-product-page` (no HTML parser dependency is added).

Description footer (persisted inside `staff_time_tasks.description`, ≤ 8 000 chars total):
`\n\n— Intake: chat · ref 8f3c…` (source, then the pending action id or `clientRef`).

## API, Command, and Error Contracts

No new HTTP route or command. The contracts are the six tools, one agent, and the installed
routes they call. All tools: scope from `McpToolContext` only; handlers parse `unknown` input
again with the declared Zod schema; `maxCallsPerTurn` 5 for reads and for `create_task` (one
card per call), 1 for `comment_task`.

| Tool | Gate | Input | Success result | Errors / concurrency | REQ |
|---|---|---|---|---|---|
| `factory_tools.create_task` (`isMutation`; `loadBeforeRecord` → project record, `before: { taskId: null, projectCode, delegate: { agentUserId, label } \| null, reason? }`, `display` labels for the card) | `staff.timesheets.tasks.manage` | `{ project: string (project id or code), title: 1..255, description?: ≤ 7 800 md, delegate?: boolean, agentUserId?: uuid, links?: [{ kind: 'record'\|'url'\|'pr', label, href }] ≤ 10, clientRef?: 1..128 (informational) }` | `{ taskId, reference, projectId, statusSlug, delegated: boolean, delegationId?, reason?: 'tasks_module_absent'\|'no_permission'\|'no_agent'\|'delegation_failed', href }` | preview: `project_not_found` (also for another tenant's code); `ambiguous_agent` with the agent list (no card); confirm: 412 stale project version; `staff` 422 `assignee_required`; delegation failure after creation → task kept, `delegated: false` | 001, 002, 006, 008 |
| `factory_tools.get_task` | `staff.timesheets.tasks.view` | `{ reference?: string, taskId?: uuid }` (one required) | `{ task: { id, reference, title, description, statusSlug, projectId, projectCode, assignee, parent?, updatedAt }, comments: [{ id, authorName, body, createdAt }] ≤ 50, delegation?: { agentId, agentLabel, runState, outcome?, links: [{ kind, url }] } }` | not found or not visible → `{ found: false }` | 003 |
| `factory_tools.search_tasks` | `staff.timesheets.tasks.view` | `{ query?: string, project?: string, status?: string (slug), limit?: 1..50 = 20 }` | `{ items: [{ id, reference, title, statusSlug, projectCode, hasDelegate }], totalCount }` | none beyond ACL | 003 |
| `factory_tools.list_projects` | `staff.timesheets.projects.view` | `{}` | `{ items: [{ id, code, name, isMember }] }` | none | 001, 003 |
| `factory_tools.comment_task` (`isMutation`, `loadBeforeRecord` → task) | `staff.timesheets.tasks.manage` | `{ task: reference or id, body: 1..5000 }` | `{ commentId, taskId, reference }` | task not visible → `task_not_found`; 412 stale | 004 |
| `factory_tools.check_site_drift` | `factory_tools.drift.view` + `catalog.products.view` | `{ sku?: string (^[A-Za-z0-9-]{1,32}$) }` | `{ configured: boolean, siteUrl, checkedSkus: number, partial: boolean, error?: 'site_unreadable', unchecked: string[], drifts: [{ sku, kind: 'field_mismatch'\|'missing_on_site'\|'unknown_on_site', field?: 'title'\|'priceNet'\|'inStock'\|'capacityLiters', site: string\|number\|boolean\|null, catalog: same, href }] }` | `FACTORY_SITE_URL` unset → `configured: false`; unsafe or non-`https` URL → `site_url_rejected` (thrown); sitemap unreachable/unparsable → `partial: true, error: 'site_unreadable', drifts: []`; page timeout → SKU in `unchecked`, `partial: true` | 005 |

Installed routes consumed (unchanged): `POST/GET /api/staff/timesheets/tasks` (query: `q`,
`reference`, `id`, `timeProjectId`, `taskStatusId`, `pageSize` ≤ 100), `GET/POST
/api/staff/timesheets/tasks/{id}/comments`, `GET /api/staff/timesheets/time-projects`; from
`tasks` when installed: `GET /api/tasks/agents`, `POST /api/tasks/delegations { taskId, agentUserId }`,
`GET /api/tasks/delegations?taskIds=`. `project` accepts a project **code** (`WEB`) or id; codes
are unique per organisation (`staff_time_projects_code_unique_idx`).

Agent `factory_tools.intake`: `moduleId: 'factory_tools'`, `executionMode: 'chat'`,
`readOnly: false`, `mutationPolicy: 'confirm-required'`, `requiredFeatures: ['staff.timesheets.tasks.view']`,
`untrustedInput` for comments and site content, `allowedTools` = the six tools + the four catalog
read tools, `suggestions`: „Zgłoś poprawkę rekordu…”, „Czy strona zgadza się z katalogiem?”,
„Co się dzieje z WEB-13?”. System prompt sections: role, scope (never ask for tenant), how to write
a good task (title, context, quoted record with id and current values, acceptance criteria, ≤ 2
clarifying questions, always ask for the project), delegation proposal, untrusted input, response
style (link card, ≤ 3 sentences).

MCP surface: the same six names appear in `mcp:list-tools`; the external call has no approval
card (documented in the README with the role recommendation above).

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `tasks.task.delegated` | `tasks` (via our `POST /api/tasks/delegations`) | SPEC-001 `start-factory` | run starts | `task:{taskId}:{delegationId}` key (SPEC-002) |
| `ai_assistant` pending action `confirmed` | runtime | audit | handler ran once | second Confirm returns the stored result, handler not re-run (TEST-015) |

This module emits no event of its own; `staff` emits its usual task and comment events for the
writes we make. No scheduled job. The drift check is synchronous and bounded (pages, per-request and total
timeouts); a future scheduled drift report is roadmap, not this spec.

## Security, Privacy, and Compliance

- **Authorization:** tool `requiredFeatures` are checked by the runtime in the chat and by the MCP
  server in ListTools and CallTool; every write also passes the `staff` route's own
  `requireFeatures`. No role-name checks. The intake agent's allow-list contains no catalog write
  tool, so even a prompt-injected model cannot reach `catalog.update_product` through it.
- **Tenant isolation:** scope from context only; `requireToolScope` fails closed. `staff` list
  routes narrow to project membership. The drift tool reads catalog records with the caller's
  scope; the site is public.
- **Sensitive data:** task titles and bodies may quote customer names typed by the user; they are
  stored where `staff` stores every task description (no new store). The footer contains a
  pending action id, not a secret. API keys are never echoed; the README shows a placeholder.
- **Abuse and failure modes:** SSRF — the site origin comes from the environment, never from the
  model; the only model-influenced part is `sku`, validated `^[A-Za-z0-9-]{1,32}$` and lower-cased
  into the path; fetch goes through the shared `safeOutboundFetch` composed with
  `fetchWithTimeout` (`lib/site-fetch.ts`), no redirects followed, 512 KB cap. Prompt injection —
  page HTML is never returned to the model, only parsed attribute values; comments and
  descriptions are labelled untrusted in the prompt. Replay — chat Confirm is idempotent by
  runtime; MCP is documented as not deduplicated. Enumeration — `get_task` answers `found: false`
  identically for missing and invisible tasks; `project` codes resolve inside the caller's
  organisation only.

## Integration Coverage

Tests are self-contained: they seed a tenant, a staff member, a project with the default status,
and use an HTML fixture served locally for the site.

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | tenant, user with `staff.timesheets.tasks.manage`, project `WEB` | `create_task` via the tool test runner with a context carrying `approvedPendingActionId` | task exists with reference `WEB-n`, default status, assignee = caller's staff member, footer `Intake: chat · ref <id>`; `delegated: false, reason: 'tasks_module_absent'` | REQ-001, REQ-008 |
| TEST-002 | security | user without `staff.timesheets.tasks.manage` | `create_task`, `comment_task` | ACL denial before the handler; no row written | REQ-001, REQ-004 |
| TEST-003 | integration | `tasks` HTTP contract stubbed: one agent | `create_task { delegate: true }`: preview then handler | preview `before.delegate` names that agent; handler calls `POST /api/tasks/delegations` with the task id and agent; `delegated: true` | REQ-002 |
| TEST-004 | integration | stub returns two agents | `create_task { delegate: true }` preview | preview throws `ambiguous_agent` with both agents; no task row; retry with `agentUserId` succeeds | REQ-002 |
| TEST-005 | integration | project membership: caller not a member of `OPS` | `search_tasks`, `get_task` for an `OPS` task | `found: false`; `OPS` task absent from results | REQ-003 |
| TEST-006 | integration | task `WEB-1` | `comment_task` via runner with approval context | comment row with `authorUserId` = caller; body verbatim | REQ-004 |
| TEST-007 | integration | local HTTP fixture: sitemap with 3 URLs, pages with `data-*`; catalog seeded with the same 3 SKUs + 1 more; one page with capacity 5000 vs catalog 5200 | `check_site_drift {}` | exactly two drifts: `field_mismatch capacityLiters` and `missing_on_site`; `partial: false` | REQ-005 |
| TEST-008 | integration | (a) one page sleeps > request timeout; (b) `FACTORY_SITE_MAX_PAGES=2` with 3 URLs; (c) sitemap returns 500 | `check_site_drift` | (a) that SKU in `unchecked`, others compared; (b) `partial: true`, third SKU unchecked; (c) `error: 'site_unreadable'`, `drifts: []`, **no** `missing_on_site`; never throws | REQ-005 |
| TEST-009 | security | `FACTORY_SITE_URL=http://127.0.0.1:…` and `sku: '../admin'` | `check_site_drift` | `site_url_rejected` for private origin; Zod rejects the SKU | REQ-005 |
| TEST-010 | contract | generated registries | `mcp:list-tools` output and agent registry | six tool names with the `factory_tools.` prefix; agent `factory_tools.intake` with `confirm-required` and the ten allowed tools | REQ-007 |
| TEST-011 | unit | tool definitions | `loadBeforeRecord` for `create_task` and `comment_task` | returns project / task with `recordVersion`, `before.delegate`/`reason` filled; `null` when out of scope | REQ-001, REQ-002, REQ-004 |
| TEST-012 | manual (demo rehearsal) | live site, seeded demo tenant after the scene-2 correction | J-001 and J-002 in the chat | card → Confirm → `WEB-n` on the board; drift lists only `ZDP-5000 capacityLiters` | REQ-001, REQ-005, REQ-006 |
| TEST-013 | integration (MCP) | HTTP MCP server with an API key whose user holds only the two task features and has a staff member | `tools/list`, then `tools/call factory_tools.create_task { clientRef }` | list contains the six tools and no `catalog.*` mutation tool; task created with footer `Intake: mcp · ref <clientRef>`; second identical call creates a second task (documented) | REQ-007, REQ-008 |
| TEST-014 | security | user without `factory_tools.drift.view` | `check_site_drift` | ACL denial before any fetch (fixture server receives no request) | REQ-005 |
| TEST-015 | integration | pending action for `create_task` | `POST /api/ai/actions/{id}/confirm` twice | one task row; second response returns the stored result | REQ-008 |
| TEST-016 | integration | `tasks` stub: delegation with run state `in_design` and links | `get_task { reference }` | `delegation` present with agent label, run state and links; absent when the stub returns 404 | REQ-003 |
| TEST-017 | unit | `setup.ts` role defaults | seed defaults twice | `factory_tools.drift.view` granted to admin and employee once; idempotent | REQ-005 |
| TEST-018 | unit | i18n catalogs | key parity across `en`, `pl`, `de`, `es`, `ko` | identical key sets under `factory_tools.*` | REQ-001 |
| TEST-019 | security | tenant A and tenant B both with a project coded `WEB` | tenant B caller: `create_task { project: 'WEB' }`, `search_tasks { project: 'WEB' }` | resolves only B's project; A's tasks never appear; A's id as `project` → `project_not_found` | REQ-001, REQ-003 |

## Implementation Phases

### Phase 1 — Intake on the `staff` board (works without `tasks`)

- **Depends on:** `staff`, `planner`, `resources` enabled in `src/modules.ts` (the same edit the
  `tasks` owner makes); `yarn generate`.
- **Outcome:** in the chat, **Task intake** turns a sentence into a task with an approval card and
  a result card; `get_task`, `search_tasks`, `list_projects`, `comment_task` work; MCP lists the
  tools.
- **Why this order / value delivered:** scene 2 becomes demo-able even if `tasks` never lands
  (task in backlog, delegated by hand as today's fallback).
- **Deliverables:** `src/modules/factory_tools/{index.ts, acl.ts, setup.ts, i18n/*.json, ai-tools.ts,
  ai-agents.ts, lib/scope.ts, lib/staff-api.ts, lib/intake-footer.ts, __tests__/*}`; `modules.ts`
  entry; README section "Connect an MCP client".
- **Independent slices / estimated commits:** (a) scaffold + ACL + i18n + agent skeleton; (b)
  read tools; (c) `create_task` + footer + card; (d) `comment_task`; (e) README + `mcp:list-tools`
  check. ~5 commits.
- **Requirements closed:** REQ-001, REQ-003 (board part), REQ-004, REQ-007, REQ-008.
- **Tests:** TEST-001, TEST-002, TEST-005, TEST-006, TEST-010, TEST-011, TEST-013, TEST-015,
  TEST-017, TEST-018, TEST-019.
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test src/modules/factory_tools`;
  `yarn mercato ai_assistant mcp:list-tools | grep factory_tools.`.
- **Exit gate:** J-001 steps 1–4 without delegation in the chat (light and dark, sheet and dock);
  a second Confirm click creates no second task; a user without `staff.timesheets.tasks.manage`
  sees the agent refuse to write.

### Phase 2 — Site drift detection and repair path

- **Depends on:** Phase 1 slices (a) scaffold + agent and (c) `create_task` (for the repair
  offer); not on Phase 1's full exit gate. `FACTORY_SITE_URL` set to the production site.
- **Outcome:** „Czy strona zgadza się z katalogiem?” returns the drift list; „tak, utwórz” yields
  one prefilled `create_task` card per drifted SKU.
- **Why this order / value delivered:** the 15-second bridge between scene 2 and scene 3 and the
  answer to SPEC-005's Q&A gap; independent of the `tasks` module.
- **Deliverables:** `lib/site-fetch.ts` (composed safe fetch + timeout + size cap), `lib/drift.ts`
  (parse `data-*`, comparison rules), `check_site_drift` tool, prompt section for the repair
  offer, HTML fixture under `__tests__/fixtures/site/`.
- **Independent slices / estimated commits:** (a) fetch + parse + rules with unit tests; (b) tool
  + agent prompt; (c) rehearsal against the live site. ~3 commits.
- **Requirements closed:** REQ-005, REQ-006.
- **Tests:** TEST-007, TEST-008, TEST-009, TEST-014, TEST-012 (drift part).
- **Validation:** as Phase 1 plus `yarn test src/modules/factory_tools/__tests__/drift*`.
- **Exit gate:** on the live site after the seeded catalog is corrected to 5 200 l, the only drift
  is `ZDP-5000 capacityLiters`; with the site URL unset the tool says it is not configured, the
  agent does not offer a task.

### Phase 3 — Delegation through the `tasks` module

- **Depends on:** Phase 1 exit gate; `tasks` module installed with `GET /api/tasks/agents`,
  `POST /api/tasks/delegations`, `GET /api/tasks/delegations` as in SPEC-002 (Q-001).
- **Outcome:** `delegate: true` delegates in the confirmed action; `get_task` shows delegation
  and run state; the result card status is `queued`.
- **Why this order / value delivered:** the full scene 2 ("appears, delegated") and J-003 with
  run state; last because it is the only external dependency.
- **Deliverables:** `lib/tasks-api.ts` (feature-detected client), delegation branch in
  `create_task`, enrichment in `get_task`, reason strings in i18n.
- **Independent slices / estimated commits:** (a) client + detection; (b) create branch; (c)
  get enrichment. ~3 commits.
- **Requirements closed:** REQ-002, REQ-003 (delegation part).
- **Tests:** TEST-003, TEST-004, TEST-016, TEST-012 (delegation part).
- **Validation:** as Phase 1; rehearsal with the `tasks` branch merged.
- **Exit gate:** J-001 step 4 shows the delegate badge on the board within seconds of Confirm;
  with `tasks` disabled the same flow lands in backlog with the reason.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, approval card, result card | `factory_tools.create_task`, `POST /api/staff/timesheets/tasks` | Phase 1 | TEST-001, TEST-002, TEST-011, TEST-018, TEST-019, TEST-012 | AC-001 |
| REQ-002 | J-001 steps 3–5 | `GET /api/tasks/agents` (preview), `POST /api/tasks/delegations`, `tasks.task.delegated` | Phase 3 | TEST-003, TEST-004, TEST-011, TEST-012 | AC-002 |
| REQ-003 | J-003 | `get_task`, `search_tasks`, `list_projects`, `GET /api/tasks/delegations` | Phase 1, 3 | TEST-005, TEST-016, TEST-019 | AC-003 |
| REQ-004 | comment card | `comment_task`, `POST …/tasks/{id}/comments` | Phase 1 | TEST-002, TEST-006 | AC-004 |
| REQ-005 | J-002 steps 1–2 | `check_site_drift`, `FACTORY_SITE_*`, `factory_tools.drift.view` | Phase 2 | TEST-007, TEST-008, TEST-009, TEST-014, TEST-017 | AC-005 |
| REQ-006 | J-002 steps 3–4 | `create_task` prefilled, `maxCallsPerTurn` 5 | Phase 2 | TEST-012 (manual; the tool itself is covered by TEST-001) | AC-006 |
| REQ-007 | J-004 | MCP server ListTools/CallTool, README | Phase 1 | TEST-010, TEST-013 | AC-007 |
| REQ-008 | footer, Confirm | `approvedPendingActionId`, `clientRef` | Phase 1 | TEST-001, TEST-013, TEST-015 | AC-008 |

Extension-surface traceability (per `.ai/guides/spec-delivery.md`; reference files from
`src/modules/example/references/surface-inventory.json`, all `readable`):

| Surface | Requirement | Reference capability / exact file | Phase | Self-contained test | Mechanism |
|---|---|---|---|---|---|
| Module metadata | REQ-001 | `module.metadata` / `src/modules/example/index.ts` | 1 | TEST-010 (registry lists the module's tools) | `emitted-example` |
| ACL feature `factory_tools.drift.view` | REQ-005 | `module.acl-features` / `src/modules/example/acl.ts` | 1 | TEST-014 | `emitted-example` |
| Role defaults for the feature | REQ-005 | `module.setup-role-features` / `src/modules/example/setup.ts` | 1 | TEST-017 | `emitted-example` |
| i18n catalogs `factory_tools.*` | REQ-001 | `module.i18n-catalogs` / `src/modules/example/i18n/en.json` (and `pl`, `de`, `es`, `ko`) | 1 | TEST-018 | `emitted-example` |
| AI tool pack (six tools) | REQ-001…008 | `ai.tool-pack` / `src/modules/example/ai-tools.ts` | 1–3 | TEST-001…011, TEST-013…016, TEST-019 | `emitted-example` |
| AI agent `factory_tools.intake` | REQ-001 | `ai.agent` / `src/modules/example/ai-agents.ts` | 1 | TEST-010 | `emitted-example` |

Not used: `ai.agent-extension`, `ai.tool-override`, `ai.agent-override` (no foreign agent is
extended or replaced), entities, routes, widgets, subscribers.

## Rollout, Migration, and Rollback

- **Migration:** none. `yarn db:generate` must report no change for this module.
- **Enable:** add `{ id: 'staff' }`, `{ id: 'planner' }`, `{ id: 'resources' }` (core) and
  `{ id: 'factory_tools', from: '@app' }` to `src/modules.ts`; `yarn generate`; set
  `FACTORY_SITE_URL=https://hackaton-stal-zbiorniki-landing.vercel.app` on the demo instance;
  `yarn mercato seed:defaults` (or `init`) grants `factory_tools.drift.view` to the default admin
  and employee roles. Restart the MCP process so ListTools includes the pack.
- **Demo data:** none beyond SPEC-004's seed; the drift only appears after scene 2 corrects
  `ZDP-5000`.
- **Rollback:** remove the `modules.ts` entry and re-run `yarn generate`; tasks already created
  remain ordinary `staff` tasks with a footer. Revoke the external API key if one was issued.
- **Observability:** tool calls and pending actions are logged by `ai_assistant`; the drift tool
  logs `checkedSkus`, `partial`, elapsed ms at `info`.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| `tasks` module lands with a different HTTP contract than SPEC-002 | Phase 3 breaks; delegation unavailable | Client isolated in `lib/tasks-api.ts`; detection returns `tasks_module_absent`; agreed today with the owner (Q-001) | Scene 2 falls back to manual delegation |
| The chatting user has no staff member | `staff` returns `assignee_required` (422) | Demo tenant seeds Marek as a staff member; the tool surfaces the message | None on the demo |
| Description with footer exceeds 8 000 chars | Validation error | Tool caps `description` at 7 800 and tells the model | None |
| Live site temporarily down during the demo | Drift check fails | `partial`/error message in the reply; rehearsal at 10:30; fallback: skip the bridge | Bridge skipped |
| MCP write without a card executes immediately | An external client can file tasks freely | Narrow role, no catalog features; README says so | Accepted for a secondary surface |
| Dotted tool names rejected by a specific MCP client | External client cannot call | Core tools already carry dots; one verification call from Claude Code in Phase 1 | Client-specific |
| Price comparison rounding or missing PLN `regular` price | False drift or `catalog: null` | Rules fixed in the vocabulary table; fixture covers null | Edge products flagged for a human |
| Agent invents a project or record values | Wrong task | Prompt: always ask for the project, quote only tool output; `project_not_found` error | Model behaviour |

## Acceptance Criteria

- [ ] **AC-001** — A user with `staff.timesheets.tasks.manage` creates a task from the chat only
  after Confirm; the task has a `staff` reference, default status, the caller as assignee and the
  intake footer; the reply links it; a second Confirm creates nothing.
- [ ] **AC-002** — With `tasks` installed and one agent, `delegate: true` results in
  `tasks.task.delegated` for the new task within the same confirmed action; without the module or
  the permission the task is in backlog and the reply names the reason.
- [ ] **AC-003** — `get_task`/`search_tasks` return only tasks the caller can open on the board;
  invisible and missing tasks are indistinguishable.
- [ ] **AC-004** — A comment posted from the chat appears in the drawer under the caller's name.
- [ ] **AC-005** — On the fixture, the drift check reports exactly the seeded mismatches; on the
  live site after the scene-2 correction it reports only `ZDP-5000 capacityLiters`; it never
  fetches a private address and never exceeds the page and time budgets.
- [ ] **AC-006** — From a drift result, each chosen SKU gets its own approval card (up to 5 per
  turn) and, once confirmed, one task with the field, site and catalog values in the body.
- [ ] **AC-007** — `mcp:list-tools` lists the six tools; a client with a task-only API key creates
  a task and cannot list any `catalog.*` mutation tool.
- [ ] **AC-008** — Every task created by the tools carries `— Intake: {chat|mcp} · ref …`.
- [ ] Every tool has self-contained integration coverage (TEST-001…011, 013…019); the two
  chat journeys are additionally rehearsed by hand (TEST-012); the configured validation gate
  passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`, `.ai/guides/spec-delivery.md`, `.ai/guides/ai-workflows.md`, `src/modules/example/README.md`, `example/ai-tools.ts`, `example/ai-agents.ts`; 0.8.0 sources of `ai_assistant`, `staff`, `catalog`, `ui`, `shared` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | traceability table; every REQ has tests and an AC |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001 in Phase 1 (+3), J-002 in Phase 2, J-003 in Phases 1/3 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse map: `staff`, `ai_assistant`, `catalog`, shared fetch; no entity, route or widget |
| UI contracts identify references, canonical components, and theme/state coverage | pass | installed chat surfaces only; card references named |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 1–3 |

Verdict: `Blocked — user approval of the spec`. Q-001 gates Phase 3 only; Phases 1 and 2 have
no external dependency.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Does the `tasks` module ship `GET /api/tasks/agents`, `POST /api/tasks/delegations { taskId, agentUserId }` and `GET /api/tasks/delegations?taskIds=` exactly as SPEC-002 states, and the feature `tasks.delegate`? | `tasks` owner | Phase 3 only | pending, to confirm 2026-09-19 |
| Q-002 | Add the 15-second drift bridge (J-002) between scenes 2 and 3 of SPEC-004? | demo owner | no | proposed row for SPEC-004 |
| Q-003 | Exact deep-link parameter of the `staff` board drawer for the result card `href` | implementer | no | read from the installed board page in Phase 1 |
| Q-004 | `.ai/agentic.config.json` points `paths.specs` at `.ai/specs` while SPEC-001…006 live in `docs/specs/`; align the config with the ledger? | repo maintainers | no | housekeeping; this spec follows the team's `docs/specs` ledger by the author's decision of 2026-09-19 |
| Q-005 | The fresh-context review proposed splitting the drift check into its own spec (it depends on intake only through `create_task` by name). Kept as one spec by the author's decision of 2026-09-19 (one module, one agent, one demo bridge); revisit if Phase 2 slips past the freeze | spec author | no | decided: one spec; Phase 2 depends only on Phase 1 slices (a) and (c) |

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Initial draft after a two-round design interview (17 decisions). Own module `factory_tools` (ADR-0001); chat writes only tasks and comments (ADR-0002); one write tool replacing SPEC-001's `factory_send_task` and SPEC-002's `tasks_create`; dot-namespaced names; ACL reuses `staff` features plus `factory_tools.drift.view`; delegate resolved from the `tasks` agents list; the agent always asks for the project; drift check on production only, four compared `data-*` fields plus missing pages, one card per product; intake footer instead of a dedupe table; `source_ref` from the pending action id because 0.8.0 exposes no conversation id to handlers. |
| 2026-09-19 | Fresh-context review applied: delegate and permission resolved at preview (`loadBeforeRecord`), ambiguous agent refuses the preview instead of leaving a task behind; `missing_on_site` only from a parsed sitemap, `site_unreadable` otherwise; `idempotencyKey` renamed `clientRef` (informational, no dedupe); `create_task` allows 5 calls per turn for multi-SKU repair; `tasks` routes called through `createAiApiOperationRunner` with a 5 s timeout and `delegation_failed`; two timeout variables, ≤ 5 pages in flight, regex extraction, catalog paging; tests TEST-013…019 added (MCP, drift ACL, double Confirm, delegation enrichment, setup, i18n parity, cross-tenant project code); MCP client user needs a staff member; split into two specs recorded as Q-005 (declined). |

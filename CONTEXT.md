# Open Mercato Software Factory

Shared vocabulary for the specs in `docs/specs/`: an agentic factory started from the Open Mercato
task board, the product catalog as the source of truth, and the company website as the target repo.

## Language

### Tasks and the factory

**Factory**:
The agentic process that takes a delegated task and carries it to a change (a PR, a record change,
a message) through human decision gates.
_Avoid_: orchestrator (the engine underneath), agent (one role inside the factory)

**Task**:
A record on the task board with a frozen reference; the unit of work the factory can receive.
_Avoid_: ticket, issue, task order

**Reference**:
The permanent task identifier of the form `PROJECT-CODE-number` (e.g. `WEB-12`), assigned once
and never changed.
_Avoid_: task number, id

**Delegation**:
Naming an agent as a task's delegate; the moment the factory starts. The **delegate** is always an
agent; the person responsible for the task stays the **assignee**.
_Avoid_: assigning to an agent, trigger

**Intake**:
The path by which a task reaches the board: by hand, from the chat, from an MCP client, from an
event. The intake source is recorded with the task.
_Avoid_: import, ingestion

**Intake agent**:
The chat agent that turns a request into a well-formed task and proposes its delegation. It is
the only writer the chat has, and it writes nothing but tasks and comments.
_Avoid_: factory agent (that is the delegate), assistant

**Caseload**:
Where a person decides inside the factory: the design gate, approval of a record change, review.
_Avoid_: inbox, approvals

### Catalog and website

**Catalog**:
The products in Open Mercato; the only source of truth for name, SKU, price, capacity and
certifications.
_Avoid_: product database, CMS

**Site**:
The company's public website, a repo the factory changes only through pull requests.
_Avoid_: landing page (the demo's Polish shorthand), frontend

**Product page**:
The public page of one product on the site.
_Avoid_: product card (the list tile), landing

**In stock** (PL „Od ręki”):
Products available immediately; a category in the catalog, a list built from that category on
the site.
_Avoid_: availability, stock level

**Drift**:
A difference between a product record in the catalog and its published product page, or a
product present in the catalog but absent from the site. Drift is detected, never repaired in
place: the repair is a task for the factory.
_Avoid_: desync, mismatch (one field of a drift), out of date

### Chat and MCP

**AI tool**:
One capability exposed to a model, with a description, an input schema and required permissions.
One definition serves both the Open Mercato chat and the MCP server. Open Mercato's own code
calls these "MCP tools" regardless of surface.
_Avoid_: "MCP" as the name of a tool, function, endpoint

**Factory tools**:
The AI tools this project adds: task intake, task reading, comments and drift detection.
_Avoid_: the MCP, tasks MCP

**Chat agent**:
A specialised assistant inside the Open Mercato chat with its own instructions and allow-list of
AI tools.
_Avoid_: bot, assistant (the whole chat surface)

**Approval card**:
The before → after preview the chat shows before it writes anything; the write happens only after
confirmation. It exists only in the chat; an MCP client has none.
_Avoid_: preview (a PR's site preview), confirm dialog

**MCP server**:
The Open Mercato service through which an external client calls AI tools with the permissions of
its API key. A secondary surface: the chat is the primary one.
_Avoid_: "MCP" without saying which of the three things is meant

**MCP client**:
An external developer tool (Claude Code, Cursor) connected to the MCP server.
_Avoid_: integration, plugin

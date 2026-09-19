# Open Mercato Software Factory

Shared vocabulary for the specs in `docs/specs/`: an agentic factory started from the Open Mercato
task board, and the AI tools that let MCP clients work with that board.

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
The path by which a task reaches the board: by hand, from an MCP client, from an event. The intake
source is recorded with the task.
_Avoid_: import, ingestion

### AI tools and MCP

**AI tool**:
One capability exposed to a model, with a description, an input schema and required permissions.
Open Mercato's own code calls these "MCP tools".
_Avoid_: "MCP" as the name of a tool, function, endpoint

**Factory tools**:
The AI tools this project adds: create, read, search and comment on tasks, and list projects.
_Avoid_: the MCP, tasks MCP

**MCP server**:
The Open Mercato service through which an external client calls AI tools with the permissions of
its API key.
_Avoid_: "MCP" without saying which thing is meant

**MCP client**:
An external tool (Claude Code, Claude Desktop, Cursor) connected to the MCP server.
_Avoid_: integration, plugin

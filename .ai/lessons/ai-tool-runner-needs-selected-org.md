---
title: "Pin the selected organization when an AI tool calls routes through the operation runner"
modules: ["task_tools", "factory"]
areas: ["debugging", "ai-workflow"]
topics: ["data-scoping", "ai-tools"]
---

# Pin the selected organization when an AI tool calls routes through the operation runner

**Context**: `factory.request_change` failed in the in-app chat with `project_not_found` for `DEMO`, although the browser saw the project and the tool context carried the right tenant, org, and `isSuperAdmin: true`. Mocked unit tests passed.

**Problem**: `createAiApiOperationRunner` builds a synthetic request without the `om_selected_org` cookie. For a super admin, the CRUD factory reads "no selection" as "all organizations" and nulls `auth.orgId`. Routes that need one organization, such as the staff project/task access resolver, then deny everything and return an empty 200 instead of an error.

**Rule**: App AI tools that call org-scoped routes use `createScopedApiOperationRunner` (`src/modules/task_tools/lib/scoped-runner.ts`), which sets the selection cookies from the trusted tool context. Verify new tools in the real chat as a super admin, not only with mocked runners.

**Applies to**: `src/modules/*/ai-tools.ts` using the in-process API runner.

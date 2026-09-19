---
status: proposed
---

# The chat writes only tasks; every catalog and site change goes through the factory

Open Mercato's chat already has `catalog.update_product` behind an approval card, so "change the
price of ZDP-5000 in the chat" could write the catalog directly and then ask the factory to align
the site. We decided the intake agent has no catalog write tool at all: the chat's single write is
"create a task" (plus comments), and the factory proposes the record change in the Caseload and
opens the site PR in one plan (SPEC-003 mixed plan). One path for every change keeps the demo's
thesis (a plan before action, one human gate, compare-and-set, nothing hidden) and keeps the
catalog and the site from diverging by design. The cost is one more hop for a trivial price
change and a dependency on the factory being up.

## Considered options

- Chat writes the catalog with the approval card, then creates an "align the site" task.
  Rejected: it duplicates the before → after moment of demo scene 2 and bypasses the Caseload.
- Chat opens the site PR itself. Rejected by SPEC-001 and SPEC-005: the site changes only through
  factory PRs.

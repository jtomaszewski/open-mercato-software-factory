/**
 * The module's own rights.
 *
 * Until now every surface here was gated on `task_delegation.*`, which conflated two genuinely
 * different grants: "may hand a board task to an agent" and "may merge that agent's work into a
 * production repository". They are given to different people in any organisation that cares, so
 * they are separate features — the task-drawer routes keep requiring the delegation feature too,
 * because those act on a delegation as well as on a change.
 */
export const features = [
  { id: 'code_changes.view', title: 'View code change requests', module: 'code_changes' },
  { id: 'code_changes.decide', title: 'Approve or reject code change requests', module: 'code_changes', dependsOn: ['code_changes.view'] },
]

export default features

export const features = [
  { id: 'tasks.view', title: 'View task delegations', module: 'tasks' },
  { id: 'tasks.delegate', title: 'Delegate tasks to agents', module: 'tasks', dependsOn: ['tasks.view'] },
  { id: 'tasks.process', title: 'Process delegated tasks', module: 'tasks' },
]

export default features

export const features = [
  { id: 'repositories.view', title: 'View code repositories', module: 'repositories' },
  { id: 'repositories.manage', title: 'Manage code repositories', module: 'repositories', dependsOn: ['repositories.view'] },
  { id: 'repositories.link', title: 'Link code repositories to projects', module: 'repositories', dependsOn: ['repositories.view'] },
]

export default features


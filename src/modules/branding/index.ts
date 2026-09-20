import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'branding',
  title: 'Branding',
  version: '0.1.0',
  description:
    "This installation's product name, shown wherever an installed surface names the app. Translations only: strings the app owns live in src/i18n, but a module dictionary is the only layer that outranks an installed module's own (see i18n/README.md).",
  author: 'HackOn team',
  license: 'MIT',
}

export default metadata

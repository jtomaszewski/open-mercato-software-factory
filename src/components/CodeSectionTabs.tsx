"use client"
import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

export type CodeSectionTab = 'changes' | 'repositories'

const TABS: { id: CodeSectionTab; href: string; labelKey: string; fallback: string }[] = [
  { id: 'changes', href: '/backend/code/changes', labelKey: 'code_changes.runs.nav.title', fallback: 'Code changes' },
  { id: 'repositories', href: '/backend/code/repositories', labelKey: 'repositories.nav.title', fallback: 'Repositories' },
]

/**
 * The Code section's two halves: what the agents changed, and what they changed it in.
 *
 * It lives in the app rather than in either module on purpose: the Code section spans
 * `code_changes` and `repositories`, and `code_changes` treats `repositories` as optional (it
 * falls back to the environment when no repository is registered). Putting the shell in either
 * module would turn that optional dependency into a hard one for the sake of a tab bar.
 *
 * `active` is passed by the page rather than inferred, so a detail route under `/code/changes/:id`
 * still marks its own tab without this component having to know the section's URL shapes.
 */
export function CodeSectionTabs({ active }: { active?: CodeSectionTab }) {
  const t = useT()
  const pathname = usePathname()
  const current = active ?? TABS.find((tab) => pathname?.startsWith(tab.href))?.id

  return (
    <nav aria-label={t('backend.nav.code', 'Code')} className="flex gap-1 border-b border-border" data-testid="code-section-tabs">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={current === tab.id ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            current === tab.id
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >{t(tab.labelKey, tab.fallback)}</Link>
      ))}
    </nav>
  )
}

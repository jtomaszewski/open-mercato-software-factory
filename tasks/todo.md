# Rebrand the demo company: Stal-Zbiorniki → Metal Zbiorniki

Source of truth: https://metal-zbiorniki.pl/ (real company, Full Stack House client —
case study at https://www.fullstack.house/pl/results/metal-zbiorniki).

Decisions taken with the user:
- real client logos downloaded from the live site,
- real contact data (address, phones, NIP/REGON/KRS), no demo disclaimer,
- landing repo gets a branch + PR (Vercel preview).

## Brand facts

| | |
|---|---|
| Name | Metal Zbiorniki sp. z o.o. |
| Tagline | Zbiorniki stalowe na miarę |
| Since | 2008 |
| Address | ul. Powstańców Wielkopolskich 1, 63-200 Jarocin |
| Phone / e-mail | +48 600 427 656 · biuro@metal-zbiorniki.pl |
| Projects | +48 783 380 935 · projekty@metal-zbiorniki.pl |
| Office | +48 570 062 851 · sekretariat@metal-zbiorniki.pl |
| IDs | NIP 6172227419 · REGON 526472938 · KRS 0001060186 |
| Primary | `#274086` · dark `#16244b` · light `#829eea` · pale `#eef2fa` · ink `#333` |
| Type | Open Sans (400/600/700), no condensed display face |
| Logo | concentric arcs + wordmark, `#283e89`/`#a9a9aa`; white variant = `brightness-0 invert` |

## Phase 1 — landing site (~/src/jt/hackaton-stal-zbiorniki-landing)

- [x] Branch `rebrand/metal-zbiorniki`
- [x] `public/images/logo.svg` + favicon; drop the `SZ` monogram
- [x] `app/globals.css` — brand palette tokens, white page, Open Sans
- [x] `app/layout.tsx` — Open Sans, metadata
- [x] `lib/product.ts` — `COMPANY` → real data (+ the three contact desks)
- [x] `components/site-header.tsx` — white header, real logo, blue uppercase nav
- [x] `components/site-footer.tsx` — navy footer, contact desks, NIP/REGON/KRS
- [x] `app/page.tsx` — hero, industry cards, "Zaufali nam" band, certs, od-ręki, CTA, opinie, FAQ
- [x] `lib/realizations.ts` — real clients
- [x] `public/logos/**` — real client logos, delete the fictional ones
- [x] `components/product-card.tsx`, `product-page.tsx`, `realization-page.tsx` — restyle
- [x] `app/regulamin/page.tsx`, `app/realizacje`, `app/od-reki` — copy + company name
- [x] `tests/site.spec.ts`, `AGENTS.md`, `README.md`
- [x] `npm run lint && npm run typecheck && npm run build && npm test`
- [x] Push + PR

## Phase 2 — ERP demo fixtures (this repo)

- [x] `public/brand/metal-zbiorniki-logo.png` from the real SVG
- [x] `lib/companyStory.ts` — name, logo, customers matching the new realizations, order `MZ-…`
- [x] `lib/stalZbiorniki.ts` → `lib/metalZbiorniki.ts` (+ symbols, CLI command, callers, tests)
- [x] Agent prompts: `src/modules/website_publishing/agents/**`, `docker/opencode/agents*/`
- [x] `README.md`, module READMEs, `demo_fixtures/index.ts` description
- [x] `yarn generate && yarn typecheck && yarn lint && yarn test`

## Review

Both repos rebranded, both gates green.

**Landing site** — [PR #14](https://github.com/jtomaszewski/hackaton-stal-zbiorniki-landing/pull/14)
on `rebrand/metal-zbiorniki`. `npm run lint`, `typecheck`, `build`, `test` (6/6) pass.
The home page now runs the real site's section order: hero, industries, the customer logo
strip + UDT/PED/PZH approvals, the offer list, the catalog, the quote CTA, testimonials, FAQ.
New `lib/content.ts` holds that copy under change class `content`, so the factory's content
agent may edit it without a developer review.

**ERP** — `yarn generate`, `typecheck`, `lint`, `ds:check`, `test` (295/295), `build` pass.
`lib/stalZbiorniki.ts` is now `lib/metalZbiorniki.ts`, `seed-stal-zbiorniki` is
`seed-metal-zbiorniki` (`scripts/demo-reset.mjs` follows), `DEMO_WATER_ORDER` is
`DEMO_OPEN_ORDER` and carries its own `customer` key instead of a literal in `company.ts`.

**Left as is on purpose**

- The GitHub repo name `hackaton-stal-zbiorniki-landing`, its Vercel URL and
  `code_changes` `DEFAULT_REPO` — renaming the repo would break the factory's checkout.
- `docs/specs/SPEC-00*.md` filenames and bodies — the historical design record.
- The catalog SKUs (ZWP/ZDP/ZCH/ZPPOZ/MX). Scene 2 corrects `ZDP-5000` and scene 3 adds
  `ZWM-1500`; renaming them would break both.
- `seedMetalZbiornikiCompany` still keeps an existing `logoUrl` rather than replacing it
  (`organization.logoUrl || await uploadLogo()`), so re-seeding onto a database that already
  holds the old brand updates the name but keeps the old logo. `yarn demo:reset` wipes first,
  so the documented path is unaffected.

## Follow-up (2026-09-20)

Database reset with `yarn demo:reset` and the app started on http://localhost:3000.
Verified in the database: organization `Metal Zbiorniki` with a fresh logo attachment,
orders `MZ-2026-0051` and `SO-2026-0042`, projects `KRONO` / `EUROSERV` / `DEMO`, and the
seven catalog handles. The backend dashboard shows the wordmark and the three new customers.

The landing's home page was then cut to hero / products / realizations / one-row footer, and
all real contact data removed from the site (`COMPANY` keeps only the name, the tagline and a
`.example` inquiry address). `lib/content.ts` is deleted. Same PR, title and body re-synced.

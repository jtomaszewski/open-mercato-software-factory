# Branding overrides

`loadDictionary` (@open-mercato/shared/lib/i18n/server) merges the app dictionary
first and every enabled module's dictionary after it, in `src/modules.ts` order.
So a key an installed module ships — `auth.login.brandName` in
`@open-mercato/core` `auth` — wins over the same key in `src/i18n/*.json`.

This module is registered last so its dictionary outranks every other. Keep it to
keys that name the product on a surface the app cannot pass a prop to; everything
the app renders itself belongs in `src/i18n/*.json`.

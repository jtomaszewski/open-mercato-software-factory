# SPEC-006: Realizacja na stronie: zrealizowane zamówienie → logo klienta i karta realizacji

**Status**: Wdrożone poza Fazą 4 (galeria ze zdjęć z załączników) i statusem `factory/catalog-match`. Kod mieszka w `src/modules/website_publishing` po podziale `factory` → `code_changes` + `website_publishing` (`4259a41`), więc ścieżki i nazwy kontraktów w tekście poniżej są nieaktualne: zdarzenie to `website_publishing.order.fulfilled`, proces to `website_publishing.website_change`.
**Właściciel**: zespół HackOn · **Data**: 2026-09-19 · **Tracker**: —
**Nadrzędna**: [SPEC-004](./SPEC-004-2026-09-18-demo-metal-zbiorniki.md) (scena 3b), buduje na
intake'u ze [SPEC-002](./SPEC-002-2026-09-18-tasks-module.md), zmianach `message` i `code` ze
[SPEC-003](./SPEC-003-2026-09-18-task-change-set.md) i stronie ze
[SPEC-005](./SPEC-005-2026-09-19-metal-zbiorniki-www.md).

## TLDR

Handlowiec oznacza zamówienie **Park of Poland (Suntago)** jako zrealizowane. Fabryka
scrape'uje stronę klienta (Firecrawl), znajduje logo i opis firmy i otwiera PR do strony
Metal Zbiorniki: logo w „Zaufali nam” i karta w „Realizacje” z danymi z linii zamówienia. Gdy
ktoś wrzuci zdjęcia z montażu do zamówienia, drugi PR dodaje galerię. Wszystko klasą `content`,
więc merguje Norbert po obejrzeniu preview. Zgoda klienta na referencję (mail wysyłany
i czytany przez Open Mercato) to usprawnienie po wersji basic, opisane w *Poza zakresem*.

Dowodzi dwóch rzeczy naraz: wyzwalacz żyje w sprzedaży, nie w repo, a fabryka wciąga do
systemu ewidencji dane z internetu, których tam nie było.

## Otwarte pytania

- **Q1. Wartość statusu realizacji.** Rozstrzygnięte 2026-09-19: strona zamówienia w backendzie
  ma tylko select `status` (słownik `sales.order_status`: `confirmed`, `in_fulfillment`,
  `fulfilled`, …); `fulfillment_status` to wolny tekst ustawiany kodem, bez UI. Wyzwalaczem jest
  przejście `status` na `fulfilled`. `sales.orders.update` w 0.8.0 nie emituje
  `sales.order.updated` (tylko `sales.order.confirmed`/`cancelled`), więc przejście łapie interceptor
  komendy fabryki i emituje własne `factory.order.fulfilled`. Seedowane zamówienie ma
  `status: confirmed`, `fulfillment_status: pending`.
- **Q2. Logo Suntago bez zgody.** Rozstrzygnięte 2026-09-19: akceptujemy na demo; strona
  `realizacje` dostaje `noindex`.
- **Q3. Krok zgody.** Rozstrzygnięte 2026-09-19: wersja basic bez zgody; pętla mailowa jako
  usprawnienie (*Poza zakresem*).

## Problem

Strona producenta ma sekcję referencji tylko wtedy, gdy ktoś pamięta, żeby ją zaktualizować.
Zrealizowane zamówienie to najlepszy moment na referencję i najczęściej przegapiany. Do
referencji trzeba logo (leży na stronie klienta), zgody (leży u klienta) i danych realizacji
(leżą w zamówieniu). Dziś te trzy rzeczy zbiera człowiek, więc referencje nie powstają.

## Proponowane rozwiązanie

```
sales.orders.update (status → fulfilled)
  └─ factory interceptor (before/after status) → factory.order.fulfilled (persistent)
      └─ factory subscriber → zadanie DEMO „Realizacja: Park of Poland (Suntago) — SO-2026-0042”,
            delegowane do Software Engineer; idempotencja: link do zamówienia w opisie zadania
      ↓ factory.deliver (ten sam proces co scena 3)
prepare_checkout          wczytuje zamówienie (klient, websiteUrl, linie z SKU) → context.order
INVOKE_AGENT researcher   tylko gdy jest zamówienie (warunek przejścia): web_fetch(websiteUrl)
                          → artefakt { summary, siteTitle, description, sourceUrl }
INVOKE_AGENT developer    order + research: logo curl-em z nagłówka strony klienta (reguła),
                          wpis w lib/realizations.ts → PR do repo strony (klasa content)
           → preview → Norbert zatwierdza → merge → strona na żywo

attachments.attachment.created (entity = zamówienie, mime image/*)
  └─ tasks subscriber → zadanie „Galeria realizacji: Park of Poland”, delegowane
      → 1 slice [code] → runner: zdjęcia do public/realizacje/<slug>/ (max 1600 px, webp), galeria na karcie
```

Proces `factory.deliver` dostaje jeden warunkowy krok: `checkout_ready → research` tylko gdy
`prepare_checkout` znalazł zamówienie, inaczej jak dotąd `checkout_ready → develop`. `web_fetch`
zwraca sam tekst strony (bez `<img src>`), więc researcher daje opis, a logo wybiera i pobiera
Developer w sandboxie (`curl`, reguła z `AGENTS.md` strony). Pliki binarne (logo raster, zdjęcia)
idą do PR-a jako bloby base64.

Narzędzie już jest: orkiestrator wystawia `agent_orchestrator.web_fetch` i
`agent_orchestrator.web_search` (`ENT/AGENTS.md` „Web Egress”; przykład
`src/modules/agent_examples/agents/deal_web_researcher/AGENT.md`). Agent deklaruje
`tools: [agent_orchestrator.web_fetch]` w swoim `AGENT.md`, a rola principala procesu dostaje
domyślnie wyłączone feature'y `agent_orchestrator.web_search` i `agent_orchestrator.web_fetch`
(fetch wymaga obu). `web_fetch` nie potrzebuje adaptera (własny klient HTTP z ochroną SSRF,
`render: 'auto'` dla stron-JS-shelli). Firecrawl zostaje źródłem zbuforowanego fixture'a
i planem awaryjnym, nie osobnym toolem.

### Co dodajemy

| Element | Gdzie | Uwagi |
|---|---|---|
| Interceptor `sales.orders.update` (status przed/po) → `factory.order.fulfilled`; subscriber → zadanie DEMO | `src/modules/factory/commands/interceptors.ts`, `subscribers/order-fulfilled.ts`, `lib/board.ts` | ten sam wzorzec co intake z `catalog.product.created` (scena 3). **Zrobione** |
| Subscriber `attachments.attachment.created` → intake, tylko dla zamówienia i obrazów | j.w. | jedno zadanie na partię: `source_ref = orderId:{data}` |
| Researcher z `web_fetch` (`tools: [agent_orchestrator.web_fetch]`), grant `agent_orchestrator.web_search`/`web_fetch` w `DELIVER_GRANTED_FEATURES` | `src/modules/factory/agents/researcher/`, `lib/deliver.ts` | bez własnego toola. **Zrobione** |
| Developer: logo z nagłówka strony klienta (`<img>` z „logo” w `src`/`alt`, SVG przed rastrem, wariant ciemny przed jasnym, potem `og:image`) do `public/logos/<slug>.svg|png`, wpis w rejestrze | `src/modules/factory/agents/developer/AGENT.md` | **Zrobione** |
| Strona: rejestr `lib/realizations.ts`, `app/realizacje/<slug>/page.tsx`, pasek „Zaufali nam” na stronie głównej, galeria | repo `hackaton-stal-zbiorniki-landing` | SPEC-005 wyłączało logotypy klientów, ten spec je włącza |
| Dane demo: klient Park of Poland (`websiteUrl`, kontakt Anna Kowalska) i zamówienie `SO-2026-0042`: 1 × ZPPOZ-20, 2 × ZCH-3000, 126 400 PLN netto, `confirmed`, opłacone | `src/modules/demo_fixtures/lib/stalZbiorniki.ts` (`seedStalZbiornikiDemo`) | zamówienie **nie** jest zrealizowane w seedzie, handlowiec zmienia status na `fulfilled` na scenie. Zrobione 2026-09-19, idempotentne po nazwie klienta i numerze zamówienia |
| Zbuforowany wynik scrape'u `parkofpoland.com` | `src/modules/demo_fixtures/lib/suntago.json` | plan awaryjny, gdy Firecrawl nie odpowie |

## Model danych (strona)

```ts
type Realization = {
  slug: string                 // 'park-of-poland'
  customerName: string         // 'Park of Poland (Suntago)'
  customerUrl: string          // z customers.website
  logo: string                 // '/logos/park-of-poland.svg'
  title: string                // 'Zbiorniki na wodę technologiczną dla parku wodnego Suntago'
  summary: string              // 1–2 zdania, z opisu firmy i linii zamówienia
  productSkus: string[]        // z linii zamówienia
  capacityLiters: number       // suma z katalogu
  deliveredAt: string          // 'YYYY-MM', z daty zmiany statusu
  photos: string[]             // '/realizacje/park-of-poland/01.webp', puste do drugiego PR-a
}
```

Sprawdzone 2026-09-19: `parkofpoland.com` daje `title`, `description` i
`build/images/logos/new/logo_dark.svg` w nagłówku, więc kandydat na logo wybiera się regułą,
bez modelu.

## Kontrakty

- `factory/catalog-match` na PR-ze realizacji porównuje `productSkus`, `customerName`
  i `capacityLiters` z zamówieniem i katalogiem. Nazwa statusu bez zmian (SPEC-005), opis mówi,
  co porównano.
- Klasa zmiany dla `app/realizacje/**`, `lib/realizations.ts`, `public/logos/**`,
  `public/realizacje/**`: `content`. Bez wpisów w `regulamin`.
- `web_fetch` dostaje tylko researcher (read-only, propose-only); runner dostaje gotowy URL logo
  w slice'ie i pobiera go sam.

## Scena 3b (SPEC-004, 3:30–4:30)

Handlowiec zmienia status zamówienia Park of Poland na *Fulfilled*. Tablica pokazuje zadanie
delegowane, z `sales.order.updated`. Przeskok do gotowego uruchomienia: artefakt researchera
z logo Suntago i opisem, PR z preview: logo w „Zaufali nam”, karta „Zbiorniki dla Suntago”.
Norbert zatwierdza, strona na żywo. Jeśli jest czas: przeciągnięcie dwóch zdjęć na zamówienie,
drugie zadanie, PR z galerią.

## Poza zakresem (usprawnienia po wersji basic)

- **Zgoda klienta przez maila, wysyłanego i czytanego przez Open Mercato.** Communications Hub
  (`communication_channels`) z providerem `channel_imap` (IMAP + SMTP, hasło aplikacji) albo
  `channel_gmail` już to potrafi: `sendAsUser` wysyła z kanału handlowca i tworzy konwersację,
  poll IMAP (domyślnie 300 s) dopasowuje odpowiedź po `In-Reply-To`/`References` i emituje
  `communication_channels.message.received` z `conversationId`. Do dobudowania: funkcja wysyłki
  po zatwierdzeniu w Caseload (zapisuje `conversationId` na intake zadania), subscriber na
  `message.received` dla tej konwersacji i agent `consent_reader` klasyfikujący odpowiedź na
  `granted` / `refused` / `question` / `other`; `granted` odblokowuje PR, reszta wraca do
  handlowca jako follow-up ze szkicem odpowiedzi. Szacunek ~4h, głównie skrzynki i interwał polla.
- **Firecrawl jako adapter `web_search`.** `OM_WEB_SEARCH_ADAPTERS` domyślnie `model-native`;
  pakiet adaptera Firecrawl nie jest zainstalowany. Potrzebny dopiero, gdy researcher ma
  *szukać* (np. przetargi, konkurencja), nie tylko czytać stronę klienta.

## Plany awaryjne

| Jeśli nie działa | Zamiast tego |
|---|---|
| `web_fetch` (ACL, SSRF, limit bajtów) | researcher czyta `suntago.json` z fixtures (zrzut z Firecrawl); mówimy, skąd to jest |
| Subscriber na `sales.order.updated` | handlowiec tworzy zadanie ręcznie z linkiem do zamówienia |
| Runner | otwarty PR #7 w repo landing (ten sam wpis i logo) plus nagrane uruchomienie, jak w scenie 3 |
| Zdjęcia (drugi PR) | wyciąć, zostaje logo i karta |

## Ryzyka

- **Prawdziwa marka** (Q2). Logo Suntago na publicznej stronie demo bez zgody.
- **Firecrawl na żywo** to kolejna usługa zewnętrzna na scenie; scrape robimy przed pitchem
  (jak uruchomienie kodujące ze sceny 3) i buforujemy.
- **Zdjęcia**: własne albo wygenerowane, nigdy ze strony klienta.

## Plan wdrożenia

### Faza 1: Strona (repo landing)

1. `lib/realizations.ts`, strona `realizacje/<slug>`, pasek „Zaufali nam”, galeria; `noindex`
   na `realizacje`. *Test:* ręczny PR z realizacją Park of Poland dostaje preview z logo na
   stronie głównej i kartą; Playwright ze SPEC-005 przechodzi.

### Faza 2: Intake i dane

2. Interceptor + subscriber → intake przy `status → fulfilled`. *Test:* zmiana statusu tworzy
   jedno delegowane zadanie; ponowny zapis zamówienia nie tworzy drugiego. **Zrobione.**
3. Klient, kontakt i zamówienie w `demo_fixtures`; `suntago.json`. *Test:* seed idempotentny. **Zrobione.**

### Faza 3: Agenci i runner

5. Researcher z `web_fetch` i grantem feature'ów; używa go, gdy klient ma `websiteUrl`. *Test:*
   artefakt dla `parkofpoland.com` zawiera opis i `sourceUrl`. **Zrobione.**
6. Runner: pobranie logo, PR z realizacją, `catalog-match`. *Test:* PR zielony, preview pokazuje
   logo i kartę, `catalog-match` czerwony po podmianie SKU w PR. **Zrobione poza `catalog-match`**
   (build strony i tak pada na nieznanym SKU).

### Faza 4: Zdjęcia (jeśli zostanie czas)

7. Subscriber `attachments.attachment.created`; runner dodaje galerię. *Test:* dwa zdjęcia
   na zamówieniu → jedno zadanie → PR z dwoma plikami webp i galerią na karcie.

### Faza 5: Próba

8. Scena 3b w próbie generalnej na świeżym tenancie; zanotować koszt zadania.

## Historia zmian

<!-- Record, not state: rows are closed once dated — append, never rewrite. -->

| Data | Zmiana |
|------|--------|
| 2026-09-19 | Szkic: zrealizowane zamówienie → scrape strony klienta (Firecrawl) → zgoda jako pole klienta → PR z logo i kartą realizacji; zdjęcia z załączników jako drugi PR; Park of Poland jako klient demo; scena 3b zastępuje scenę prawnika w SPEC-004. |
| 2026-09-19 | Własny tool Firecrawl zastąpiony wbudowanym `agent_orchestrator.web_fetch` (opt-in w `AGENT.md`, feature'y domyślnie wyłączone); Firecrawl zostaje źródłem fixture'a `suntago.json`. |
| 2026-09-19 | Q1 rozstrzygnięte: wyzwalacz to `status → fulfilled` (jedyny status z UI). Zrobione: seed klienta i zamówienia w `demo_fixtures`, fixture `suntago.json`; Faza 1 strony zmergowana w repo landing (PR #5). |
| 2026-09-19 | Wersja basic: krok zgody (pole, mail, drugi subscriber) wycięty z przepływu; pętla mailowa przez Communications Hub (IMAP/Gmail, `sendAsUser`, `message.received`) opisana jako usprawnienie w *Poza zakresem*. Q2 i Q3 rozstrzygnięte. |
| 2026-09-19 | Fazy 2–3 zrobione: `sales.order.updated` nie jest emitowane przez 0.8.0, więc wyzwalacz to interceptor `sales.orders.update` → `factory.order.fulfilled`; researcher z `web_fetch` jako warunkowy krok `factory.deliver`; logo pobiera Developer (web_fetch zwraca sam tekst); binarne pliki w PR-ach. Próba: 21 s researcher, 150 s developer, PR #12 w repo landing z zielonym `site`. |
| 2026-09-20 | Rebranding na Metal Zbiorniki (patrz SPEC-004): referencje wyjściowe na `main` to prawdziwi klienci z własnymi logo. Kontrakt bez zmian — `data-trusted-by` i `data-trusted-logo` przeniesione do sekcji „Realizacje”, ale pod tymi samymi nazwami. |
| 2026-09-20 | Status z `Draft` na stan faktyczny po audycie kodu. Zrobione: interceptor na `sales.orders.update` emitujący `website_publishing.order.fulfilled` tylko na przejściu na `fulfilled` (`commands/interceptors.ts:33-57`), persistent subscriber zakładający idempotentne zadanie na tablicy DEMO (`subscribers/order-fulfilled.ts`, `lib/board.ts:164-175`), agent Researcher z `agent_orchestrator.web_fetch` i grantami feature'ów plus warunkowy krok w procesie (`lib/workflow.ts:27-33,49-51`), reguła wyboru logo i pliki binarne w PR-ze (`agents/developer/AGENT.md:17`, `code_changes/lib/github.ts:107-111`); 5 suites / 23 testy zielone. Faza 1 strony zmergowana (PR #5/#6: rejestr, `/realizacje`, „Zaufali nam”, `noindex`, sekcja galerii). Dowód end-to-end: PR #12 w repo landing otwarty przez uruchomienie fabryki, `site` i Vercel zielone, czeka na merge. Otwarte: Faza 4 (brak subscribera `attachments.attachment.created`, więc zdjęcia z montażu nigdzie nie trafiają) i status `factory/catalog-match` (zero kodu w `src/`, ta sama luka co w SPEC-005). Pole zgody klienta pozostaje poza zakresem zgodnie z Q3. |

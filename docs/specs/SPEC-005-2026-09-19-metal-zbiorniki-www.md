# SPEC-005: Strona Metal Zbiorniki, docelowe repo fabryki na demo

**Status**: Draft
**Właściciel**: zespół HackOn · **Data**: 2026-09-19 · **Tracker**: —
**Nadrzędna**: [SPEC-004](./SPEC-004-2026-09-18-demo-metal-zbiorniki.md) (Q1 i sekcja „Docelowa
strona”), korzysta z kontraktu runnera i kierowania recenzji ze
[SPEC-001](./SPEC-001-2026-09-18-agentic-software-factory.md).

## TLDR

Firmowa strona Metal Zbiorniki to publiczne repo
[`jtomaszewski/hackaton-stal-zbiorniki-landing`](https://github.com/jtomaszewski/hackaton-stal-zbiorniki-landing),
w którym fabryka otwiera PR-y w scenach 3 i 4 demo. To aplikacja **Next.js** (App Router)
eksportowana statycznie (`output: 'export'`). Każdy produkt to osobna strona
`app/produkty/<sku>/page.tsx` z typowanym obiektem produktu i opisem w JSX. PR „nowy zbiornik od
ręki” to więc prawdziwy kod: jedna nowa strona i jedna linia w rejestrze produktów. TypeScript
i ESLint pilnują, że strona produktu ma komplet danych i nie robi nic poza wyrenderowaniem
wspólnego komponentu. **Vercel** buduje preview dla każdego PR. Repo ma to, czego fabryka potrzebuje
do weryfikacji: jedną komendę do lokalnego uruchomienia, typy, test Playwright chodzący po
zbudowanej stronie, wymagany check w CI i ścieżki, które mapa recenzji ze SPEC-001 rozpoznaje bez
wyjątków (`content` → waiver, `legal` → prawnik). Źródłem prawdy o produktach jest katalog Open
Mercato. Strona dostaje zmiany wyłącznie przez PR. Waiver merguje osobna tożsamość, nigdy bot,
który pisał kod.

## Problem

SPEC-001 zakłada, że możliwości agenta zależą od tego, jak dobrze da się zweryfikować docelowe
repo: testy, lokalne uruchomienie jedną komendą, CI, preview. Na demo nie ma jeszcze docelowego
repo. Sceny 3 („katalog → strona”) i 4 („regulamin czeka na prawnika”) potrzebują strony, która:

- wygląda jak strona producenta, bo jury ma uwierzyć w Norberta;
- przyjmuje nowy produkt jako mały PR, który wygląda jak praca programisty, a nie edycja w CMS-ie.
  To demo fabryki oprogramowania;
- ma preview dla każdego PR. Linkuje do niego ścieżka recenzji i prawnik otwiera je bez konta
  GitHub ani Vercel;
- ma checki, które sprawdzają „done” względem katalogu, a nie tylko względem tego, co agent sam
  napisał;
- rozdziela ścieżki tak, że mapa recenzji ze SPEC-001 działa bez wyjątków.

## Proponowane rozwiązanie

**Produkty w repo, nie pobierane z API.** Gdyby strona czytała katalog Open Mercato przy buildzie,
zmiana w katalogu trafiałaby na produkcję bez PR-a, bez recenzji i bez sceny 3. Przy stronach
w repo droga jest jedna i widoczna: rekord w katalogu → zadanie → PR ze stroną → preview →
recenzja według klasy zmiany → merge → deploy.

**Next ze stroną na produkt, a nie Markdown ani czysty HTML.** Rozważane opcje:

- *Markdown z frontmatterem (Astro content collections).* Ma najmniejszy diff i schemat Zod, ale
  PR wygląda jak edycja w CMS-ie.
- *Czysty HTML.* Każda strona kopiuje nagłówek i stopkę, a listy „Od ręki” i strona główna są
  edytowane ręcznie. Strony szybko się rozjeżdżają i nic nie waliduje danych.
- *Next, strona TSX na produkt* (wybrane). To ten sam stack co Open Mercato. Typ `Product` pełni
  rolę schematu: brakujące albo błędne pole zatrzymuje `next build`. Wspólny komponent trzyma
  wygląd w jednym miejscu. Diff to czytelny kod.

**Vercel.** Buduje preview dla każdego PR bez konfiguracji i publikuje jego URL w GitHub
deployment status. Projekt stoi na koncie Jacka, na planie Hobby, co wystarcza na niekomercyjny
hackathon. To inny wariant preview niż domyślny ze SPEC-001 i SPEC-003 (stack runu na maszynie
runnera za Caddy): tu preview hostuje samo docelowe repo. Szczegóły są w *Kontraktach*.

**Osobne publiczne repo.** GitHub App fabryki instalujemy tylko na nim, więc token bota ma dostęp
do jednego repo (wymaganie SPEC-001), a agent nie może pisać do kodu samej fabryki.

## Architektura

```
hackaton-stal-zbiorniki-landing/
├── AGENTS.md                          instrukcje dla agenta kodującego (patrz niżej)
├── README.md                          uruchomienie + ustawienia Vercel i rulesetu
├── next.config.ts                     output: 'export', images.unoptimized: true
├── eslint.config.mjs                  m.in. ograniczenia dla stron produktów
├── lib/product.ts                     typ Product, kategorie, kształty, cena brutto
├── components/                        layout, ProductPage, ProductCard, …   ← klasa `code`
├── public/products/<shape>.svg        4 ilustracje według kształtu          ← klasa `code`
├── app/
│   ├── layout.tsx, page.tsx           layout i strona główna                ← klasa `code`
│   ├── od-reki/page.tsx               lista inStock                         ← klasa `code`
│   ├── sitemap.ts                     z rejestru, dynamic = 'force-static'  ← klasa `code`
│   ├── produkty/
│   │   ├── index.ts                   rejestr: import każdego produktu      ← klasa `content`
│   │   └── <sku>/page.tsx             jedna strona na produkt               ← klasa `content`
│   └── regulamin/page.tsx             warunki sprzedaży w JSX               ← klasa `legal`
├── tests/site.spec.ts                 Playwright na zbudowanym `out/`
└── .github/workflows/site.yml         check `site`: lint, build, Playwright
```

**Strona produktu.** Każda wygląda tak samo, a różni się tylko danymi i opisem:

```tsx
// app/produkty/zwm-1500/page.tsx
import { ProductPage, productMetadata } from '@/components/product-page'
import type { Product } from '@/lib/product'

export const product = {
  sku: 'ZWM-1500',
  title: 'Zbiornik mobilny na wodę pitną 1500 l',
  // … pola z tabeli *Model danych*
} satisfies Product

export const metadata = productMetadata(product)

export default function Page() {
  return (
    <ProductPage product={product}>
      <p>Mobilny zbiornik na wodę pitną o pojemności 1500 l. …</p>
    </ProductPage>
  )
}
```

`app/produkty/index.ts` importuje `product` z każdej strony i eksportuje tablicę `products`, z której
korzystają strona główna, `/od-reki` i `sitemap.ts`. Nowy produkt to więc nowy katalog i jedna linia
w rejestrze.

**Ścieżki a klasy zmian.** Mapa recenzji jest konfiguracją projektu w Open Mercato (SPEC-001),
nie plikiem w repo. Repo zobowiązuje się tylko do stałych ścieżek:

| Ścieżka | Klasa zmiany | Recenzja |
|---|---|---|
| `app/produkty/**` | `content` | waiver, jeśli checki `site` i `factory/catalog-match` są zielone |
| `app/regulamin/**` | `legal` | prawnik w Caseload, na preview |
| wszystko inne | `code` | developer w GitHub |

Klasa `content` obejmuje tu kod TSX, więc ESLint ogranicza pliki `app/produkty/**`, żeby waiver
nie przepuścił niczego poza danymi i opisem:

- `no-restricted-imports`: dozwolone tylko `@/components/product-page` i `@/lib/product`;
- `react/no-danger`: bez `dangerouslySetInnerHTML`;
- `no-restricted-syntax`: bez `<script>`, `<iframe>`, `useEffect` i `fetch`;
- w `app/produkty/index.ts` dozwolone są tylko importy z `./<sku>/page`.

Domyślna mapa SPEC-001 wysyła do `legal` także „pricing copy, product claims”, a strona produktu
ma cenę i atesty. W tym projekcie mapa celowo traktuje strony produktów jako `content`. Zgodność
ceny i atestów z katalogiem sprawdza `factory/catalog-match`, a nie człowiek, bo źródłem tych
wartości jest rekord, który Norbert już zatwierdził w katalogu.

**Strony.** Tylko te, które pojawiają się w scenach 3 i 4:

| Trasa | Zawartość |
|---|---|
| `/` | hero, lista wszystkich produktów, pas logo klientów „Realizacje”, jednowierszowa stopka bez danych kontaktowych |
| `/od-reki` | produkty z `inStock: true` |
| `/produkty/<sku>` | ilustracja, nazwa, SKU, kategoria, tabela parametrów (pojemność, materiał, wymiary, waga, atesty), cena netto i brutto albo „Cena na zapytanie”, opis, przycisk „Wyślij zapytanie” (`mailto:` na fikcyjny adres) |
| `/regulamin` | warunki sprzedaży z § „Gwarancja” |

Wygląd wzorujemy na układzie prawdziwej strony producenta (ciemny granat i stal, zdjęcie hali
w hero, gęsta tabela parametrów); nazwa, logo i klienci są prawdziwi, a danych kontaktowych firmy
strona nie publikuje w ogóle. Strona jest po
polsku i responsywna, bo w demo pokażemy ją też na telefonie. Styl w Tailwind.

**Weryfikacja.** Trzy warstwy, z czego tylko ostatnia porównuje z katalogiem:

1. `npm run lint` i `next build` (z typecheckiem) odrzucają stronę produktu z brakującym albo
   błędnym polem, niedozwolonym importem albo kodem spoza szablonu.
2. `tests/site.spec.ts` (check `site`) serwuje zbudowany katalog `out/` i:
   - czyta `sitemap.xml` i sprawdza, że liczba adresów `/produkty/*` równa się liczbie katalogów
     `app/produkty/*/`, czyli że żadna strona nie wypadła z rejestru;
   - na każdej stronie produktu odczytuje atrybuty `data-sku`, `data-price-net` i `data-in-stock`,
     które renderuje `ProductPage`. Sprawdza unikalność SKU, to, że adres to `sku` małymi
     literami, i że widać nazwę, SKU i cenę (albo „Cena na zapytanie”);
   - sprawdza, że każdy produkt `inStock` jest na `/od-reki`, żaden inny tam nie trafia, a
     `/regulamin` się renderuje.

   Test chodzi po zbudowanej stronie, więc nowy produkt nie wymaga nowego testu.
3. **`factory/catalog-match`**, commit status wystawiany przez runner (SPEC-001) po otwarciu PR.
   Runner bierze rekord produktu z payloadu runu, otwiera `/produkty/<sku>` na preview Vercela
   i porównuje nazwę, SKU, cenę netto, pojemność i atesty. Tylko ta warstwa łapie błąd, w którym
   agent wpisał złą cenę spójnie w kodzie i na stronie.

Checka `site` nie odpalamy na preview Vercela, więc nie zależy od Vercela. Gałąź `main` wymaga
tylko `site`, żeby PR-y ludzi i PR-y ze zmianą regulaminu dało się zmergować bez `catalog-match`.
`catalog-match` wymaga polityka waivera, a nie ochrona gałęzi.

**`AGENTS.md` w repo** mówi agentowi kodującemu:

- komendy: `npm ci`, `npm run dev`, `npm run lint`, `npm run build`, `npm test`;
- jak zamienić rekord katalogu na stronę produktu (tabela w *Model danych*), z istniejącą stroną
  jako wzorem;
- że nowy produkt to nowy katalog `app/produkty/<sku>/` i jedna linia w `app/produkty/index.ts`,
  a zmiana produktu dotyka tylko jego `page.tsx`;
- że `app/regulamin/**` zmienia tylko wtedy, gdy zadanie mówi o regulaminie;
- że brakującej wartości wymaganej nie zgaduje, tylko kończy run pytaniem do człowieka;
- że nie zmienia komponentów, CI, testów, configów, `package.json` ani lockfile, chyba że zadanie
  tego dotyczy. SPEC-001 i tak oznacza takie pliki jako flagowane.

## Model danych

Typ `Product` w `lib/product.ts`. Nazwa katalogu strony to `sku` małymi literami. Opis produktu
to dzieci `ProductPage` w JSX, więc nie jest częścią typu.

| Pole | Typ | Z rekordu katalogu Open Mercato |
|---|---|---|
| (katalog strony) | `app/produkty/<sku małymi literami>/` | `sku`; `handle` z katalogu pomijamy, bo UI generuje go z tytułu |
| `sku` | `string` | `sku` |
| `title` | `string` | `title` |
| `subtitle` | `string?` | `subtitle` |
| `category` | `'woda-pitna' \| 'paliwa' \| 'chemia' \| 'ppoz' \| 'urzadzenia'` | pierwsza przypisana kategoria inna niż `od-reki`; brak takiej → run pyta człowieka |
| `inStock` | `boolean` | produkt jest w kategorii `od-reki`; `metadata.inStock` pomijamy |
| `capacityLiters` | `number` | `metadata.capacityLiters`, a gdy go brak, liczba przed „l” lub „m³” w tytule albo podtytule |
| `material` | `string` | `metadata.material`, a gdy go brak, gatunek stali z podtytułu lub opisu (`1.4301`, `S235JR`…) |
| `certifications` | `string[]` | `metadata.certifications` (w UI to tekst rozdzielony przecinkami), a gdy go brak, znane skróty (PZH, UDT, CNBOP) z podtytułu lub opisu; może być puste |
| `dimensionsMm` | `{ width: number; height: number; depth: number } \| null` | `dimensions` (mm) |
| `weightKg` | `number?` | `weightValue` przy `weightUnit: kg` |
| `priceNetPln` | `number \| null` | `unitPriceNet` ceny `regular` w PLN (string z 4 miejscami po przecinku → number); brak → `null`, na stronie „Cena na zapytanie” |
| `vatRate` | `number` | `taxRate`, domyślnie 23 |
| `shape` | `'vertical' \| 'horizontal' \| 'underground' \| 'mixer'` | `metadata.installation === 'underground'` → `underground`; inaczej `metadata.orientation`; inaczej kategoria `urzadzenia` → `mixer`; inaczej `vertical` |
| (opis, JSX) | akapity `<p>` | `description`, podzielony na akapity |

Pole `metadata.leadTimeWeeks` z seedu celowo pomijamy. Cenę brutto liczy `lib/product.ts`, nie
strona produktu. Wartości z `metadata` wpisane w UI przychodzą jako tekst. Agent zamienia je na
liczby, a typ `number` pilnuje, żeby nie trafił tam tekst.

Nazwy kategorii (`woda-pitna` → „Zbiorniki na wodę pitną” itd.) żyją w `lib/product.ts`. „Od ręki”
nie jest tam kategorią, tylko widokiem na `inStock`. Regulamin w § „Gwarancja” mówi o 24
miesiącach, a scena 4 zmienia to na 5 lat.

Pierwsze 7 stron produktów przepisujemy raz, ręcznie, z seedu `demo_fixtures`. Nie ma skryptu
synchronizacji: synchronizacja to praca fabryki. `ZDP-5000` trafia na stronę z tym samym błędem
co w katalogu (5000 l, bez wymiarów).

Ilustracje to cztery SVG według `shape`, nie zdjęcia. PR z nowym produktem nie dodaje więc żadnego
obrazka, a strona nie używa cudzych zdjęć.

## Kontrakty

- **Wymagany check na `main`:** `site` (GitHub Actions, na `pull_request` i na `push` do `main`).
- **Status fabryki:** `factory/catalog-match`. To commit status na SHA heada PR, `success` albo
  `failure` z opisem pierwszej niezgodności. Wystawia go runner tylko na PR-ach z produktem.
  Wymaga go polityka waivera, nie ochrona gałęzi.
- **Preview hostowane przez repo.** Runner nie stawia własnego stacku do preview. Po pushu czeka
  na GitHub deployment status z environment `Preview`, `sha` równym headowi PR i
  `state: success`, i bierze z niego `environment_url` jako `previewUrl`. Jeśli statusu nie ma po
  5 minutach, sygnał `factory.run.finished` idzie z `previewUrl: null`, bez `catalog-match`, więc
  bez waivera. Link w Open Mercato prowadzi prosto na URL Vercela, bez podpisanego przekierowania
  ze SPEC-003, bo repo i jego treść są publiczne.
- **Merge.** Ruleset na `main` wymaga PR-a, checka `site` i jednego approve'a. Bypass ma tylko
  druga GitHub App, czyli „merge identity” ze SPEC-001 (decyzja 6).
  - Waiver ze SPEC-001 merguje PR tą aplikacją, gdy klasa to `content`, a `site`
    i `catalog-match` są zielone.
  - GitHub App fabryki (bot kodujący) ma `contents: write` i `pull_requests: write`, ale nie ma
    bypassu, więc nie zmerguje własnego PR-a.
  - PR z klasą `legal` merguje człowiek po zatwierdzeniu prawnika w Caseload.
  - Jeśli na drugą aplikację zabraknie czasu, Norbert klika merge na scenie po obejrzeniu preview,
    a waiver pokazujemy na slajdzie.
- **Produkcja:** merge do `main` uruchamia deploy produkcyjny Vercela na domenie `*.vercel.app`
  projektu.

## Przypadki brzegowe

| Co się dzieje | Co widać |
|---|---|
| Agent pominie pole albo wpisze zły typ | `next build` czerwony na typecheckingu, check `site` czerwony, waiver niemożliwy; runner ma jedną rundę poprawek CI (SPEC-001), potem zadanie wraca z błędem |
| Agent doda do strony produktu import, skrypt albo `fetch` | `npm run lint` czerwony, jak wyżej |
| Agent zapomni dopisać stronę do rejestru | test: liczba katalogów ≠ liczba adresów w sitemap, `site` czerwony |
| Agent wpisze złą cenę spójnie w kodzie i na stronie | `site` zielony, `catalog-match` czerwony, brak waivera, zadanie czeka na developera z opisem niezgodności |
| Produkt dodany w UI bez kategorii innej niż „Od ręki” albo bez pojemności w tytule, podtytule i `metadata` | run kończy się pytaniem do Norberta, bez PR-a |
| Produkt w katalogu nie ma ceny | `priceNetPln: null`, strona pokazuje „Cena na zapytanie”; to częste przy zbiornikach na zamówienie |
| Produkt w katalogu nie ma wymiarów (`ZDP-5000` przed sceną 2) | `dimensionsMm: null`, wiersz wymiarów znika z tabeli |
| Zduplikowane SKU albo katalog ≠ `sku` | `site` czerwony |
| Vercel nie zbuduje preview w 5 minut | `previewUrl: null`, brak `catalog-match`, brak waivera; zadanie czeka na developera |
| Preview zabezpieczone logowaniem Vercel | prawnik nie otworzy linku; dlatego w projekcie wyłączamy Deployment Protection dla preview (repo i tak jest publiczne); krok 5 to sprawdza |
| Vercel nie zbuduje commita od bota | na Hobby blokada dotyczy commitów spoza zespołu w repo prywatnych; repo jest publiczne, a krok 6 to sprawdza na prawdziwym PR bota |
| Korekta w katalogu po publikacji (scena 2 poprawia `ZDP-5000`) | strona rozjeżdża się z katalogiem do następnego PR-a; wyzwalacz `catalog.product.updated` jest poza zakresem, to odpowiedź na Q&A |

## Ryzyka

- **Konto Vercel Jacka.** Hobby nie ma członków zespołu, więc tylko Jacek zmieni ustawienia
  projektu. README repo spisuje wszystkie ustawienia (Deployment Protection, gałąź produkcyjna,
  env), żeby w razie potrzeby dało się je odtworzyć na innym koncie w kilka minut.
- **Kod w klasie `content`.** Waiver przepuszcza TSX. Ograniczenia ESLint z *Architektury* są
  warunkiem waivera, a nie dodatkiem. Krok 4 testuje je PR-em z niedozwolonym importem.
- **Podobieństwo do prawdziwej firmy.** Marka, logo i klienci są prawdziwi (za zgodą — Metal
  Zbiorniki to klient Full Stack House), danych kontaktowych strona nie publikuje. Układ
  inspirowany, bez kopiowania tekstów ani zdjęć.
- **Wygląd poniżej oczekiwań jury.** Krok 3 kończy się zrzutami na desktopie i telefonie
  przeglądanymi przez zespół, zanim ktokolwiek zacznie łączyć sceny.

## Poza zakresem

- Strony kategorii, wersja angielska. Logotypy klientów i strona „Realizacje” doszły
  w [SPEC-006](./SPEC-006-2026-09-19-realizacja-klienta.md).
- WordPress (slajd z roadmapą w SPEC-004).
- Formularz zapytania z backendem i InboxOps (roadmapa).
- Synchronizacja katalog → strona inna niż przez PR fabryki, w tym `catalog.product.updated`.

## Plan wdrożenia

Właściciel: osoba od infrastruktury. Termin: sobota rano, przed połączeniem scen (SPEC-004
Faza 3). Kroki 1–5 nie zależą od fabryki.

### Faza 1: Repo, które się buduje

1. Publiczne repo `jtomaszewski/hackaton-stal-zbiorniki-landing`: Next (App Router, TypeScript
   strict, Tailwind), `output: 'export'`, skrypty npm, `AGENTS.md`, README. *Test:*
   `npm ci && npm run build` daje katalog `out/`.
2. `lib/product.ts`, `ProductPage`, rejestr, 7 stron produktów, regulamin, cztery ilustracje,
   `sitemap.ts`. *Test:* build przechodzi; strona z usuniętym `sku` zatrzymuje build z błędem
   typu wskazującym pole.
3. Layout, strona główna i `/od-reki`. *Test:* zrzuty `/`, `/od-reki`, `/produkty/zdp-5000`
   i `/regulamin` na 1440 px i 390 px, przejrzane przez zespół.

### Faza 2: Weryfikacja

4. Ograniczenia ESLint dla `app/produkty/**`, `tests/site.spec.ts` i workflow `site`. *Test:*
   check zielony na `main`; czerwony na PR ze zduplikowanym SKU, na PR z importem spoza szablonu,
   na PR ze stroną spoza rejestru i na celowo zepsutej gałęzi, w której `/od-reki` pomija jeden
   produkt.

### Faza 3: Deploy, preview i merge

5. Projekt Vercel na koncie Jacka podpięty do repo, Deployment Protection wyłączone dla preview,
   produkcja z `main`, ustawienia spisane w README. *Test:* dla PR-a
   `gh api repos/jtomaszewski/hackaton-stal-zbiorniki-landing/deployments?sha=<head>` i jego
   statusy zwracają `environment_url`; preview otwiera się w oknie incognito.
6. Ruleset na `main` (PR, `site`, 1 approve) z bypassem dla merge App; GitHub App fabryki ze
   SPEC-001 zainstalowana tylko na tym repo. *Test:* token bota wypycha gałąź i otwiera PR, który
   dostaje deployment Vercela `success`; ten sam token nie może zmergować PR-a, a merge App może.
7. Próba sceny 3 bez fabryki: `ZWM-1500` dodany w UI katalogu tak, jak zrobi to Norbert (SPEC-004),
   a potem ręcznie przepisany na stronę według tabeli *Model danych*. *Test:* każde pole da się
   wyprowadzić z rekordu utworzonego w UI; check zielony; preview pokazuje zbiornik na `/od-reki`
   i na `/produkty/zwm-1500`. PR zamykamy bez merge'a, bo na scenie zrobi go fabryka.

`factory/catalog-match` i odczyt preview z deployment status należą do runnera i powstają razem
z krokiem 3 SPEC-001. Ich test: PR z celowo złą ceną dostaje `catalog-match: failure`.

## Historia zmian

<!-- Record, not state: rows are closed once dated — append, never rewrite. -->

| Data | Zmiana |
|------|--------|
| 2026-09-19 | Szkielet: cel, mapa ścieżek na klasy zmian, otwarte pytania o framework, hosting, repo i źródło danych. |
| 2026-09-19 | Rozstrzygnięte: Astro, Vercel na koncie Jacka, publiczne repo `hackaton-stal-zbiorniki-landing`, produkty z plików w repo. Pełny spec: architektura, model danych z mapowaniem z katalogu, kontrakty, przypadki brzegowe, plan wdrożenia. |
| 2026-09-19 | Po recenzji: merge przez osobną App z bypassem (bot kodujący nie merguje), status `factory/catalog-match` jako warunek waivera, preview z GitHub deployment status zamiast stacku runnera, plik produktu nazwany po SKU, mapowanie odporne na produkt dodany w UI, kształt ilustracji, `id` w `categories.json`, test parsuje pliki sam, zakres zawężony do stron ze scen 3 i 4. |
| 2026-09-19 | Astro i Markdown zastąpione przez Next ze static export: strona TSX na produkt i rejestr, typ `Product` zamiast schematu Zod, ograniczenia ESLint dla klasy `content`, test Playwright chodzi po zbudowanym `out/` i sitemapie. |
| 2026-09-20 | Rebranding na Metal Zbiorniki (patrz SPEC-004): granat marki `#274086` na bieli zamiast granatu i pomarańczy, Open Sans zamiast Barlow, prawdziwe logo i 16 prawdziwych klientów w „Zaufali nam”. Strona główna ścięta do czterech sekcji (hero, produkty, realizacje, jednowierszowa stopka); sekcje marketingowe i `lib/content.ts` usunięte. Żadnych prawdziwych danych kontaktowych: `COMPANY` niesie tylko nazwę, hasło i adres `.example`. |

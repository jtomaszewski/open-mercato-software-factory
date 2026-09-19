# SPEC-004: Demo: Stal-Zbiorniki, producent zbiorników stalowych prowadzi swoją stronę z Open Mercato

**Status**: Draft
**Właściciel**: zespół HackOn · **Data**: 2026-09-18 · **Tracker**: —
**Rola dokumentu**: **jedyne źródło prawdy o niedzielnym pitchu.** Co mówimy, co klikamy, co jest
na slajdzie i co zrobić, gdy coś padnie. Pozostałe specki opisują, jak zbudowane są części
([SPEC-001](./SPEC-001-2026-09-18-agentic-software-factory.md) fabryka,
[SPEC-002](./SPEC-002-2026-09-18-tasks-module.md) tablica zadań,
[SPEC-003](./SPEC-003-2026-09-18-task-change-set.md) zmiany na zadaniu,
[SPEC-005](./SPEC-005-2026-09-19-stal-zbiorniki-www.md) strona,
[SPEC-006](./SPEC-006-2026-09-19-realizacja-klienta.md) realizacja klienta) i nie wypowiadają się
o pitchu. Gdy coś się nie zgadza, ten dokument wygrywa i to on jest do poprawienia.

## TLDR

5 minut prezentacji po polsku, 3 minuty Q&A. Jedna historia o jednej firmie:
**Stal-Zbiorniki Sp. z o.o.**, fikcyjny producent zbiorników stalowych wzorowany na
[metal-zbiorniki.pl](https://metal-zbiorniki.pl/). Właściciel, Marek, nie ma programisty i nigdy
nie czyta kodu. Z Open Mercato poprawia błędny rekord produktu (scena 2), wprowadza nowy zbiornik
z magazynu na stronę jako PR z preview, który sam zatwierdza (scena 3), a po zrealizowanym
zamówieniu widzi na stronie logo klienta i kartę realizacji (scena 3b). Wszystko na ekranie dzieje
się na żywo; uruchomienia kodujące startują przed pitchem, a na scenie pokazujemy ich wynik.

## Stan na dziś (2026-09-19)

| Scena | Forma | Zbudowane | Brakuje | Kto |
|---|---|---|---|---|
| 1. Hook | slajd | — | slajd | demo owner |
| 2. Poprawa rekordu | na żywo | katalog demo z błędnym `ZDP-5000` (`demo_fixtures`) | moduł `tasks`, chat intake (SPEC-002), zmiany `record` w Caseload (SPEC-003) | tasks owner |
| 3. Katalog → strona | na żywo, uruchomienie przed pitchem | strona z produktami i „Od ręki” w repo landing; ręczny PR z `ZWM-1500` ma preview (repo landing, PR #4) | intake z `catalog.product.created`, proces `factory.deliver`, runner (SPEC-001) | process + runner owner |
| 3b. Sprzedaż → referencja | na żywo, uruchomienie przed pitchem | klient Park of Poland i zamówienie `SO-2026-0042` w seedzie; strona „Realizacje” + „Zaufali nam” na `main` repo landing z fikcyjnym browarem jako pierwszą referencją; ręczny PR #7 z wpisem Park of Poland otwarty jako fallback; fixture scrape'u | intake z `sales.order.updated`, researcher z `web_fetch`, runner (SPEC-006 Fazy 2–3) | jak wyżej |
| 5. Co dalej | slajd | — | slajd | demo owner |

Na `main` tego repo są dziś specki i `demo_fixtures`. Modułów `tasks` i `factory` jeszcze nie ma.
PR #8 (kolegi) to spec wykonania i dostawy: wymaga jednego kliknięcia człowieka „Approve merge
and deploy” przy każdym merge'u, co pasuje do decyzji „klik Marka” poniżej.

## Decyzje zamknięte

| Decyzja | Wybór | Kiedy |
|---|---|---|
| Język pitchu, slajdów i danych na ekranie | **polski** (katalog i tak jest po polsku) | 2026-09-19 |
| Uruchomienia agentów | **na żywo**: uruchomienia kodujące (sceny 3 i 3b) startują przed pitchem, na scenie pokazujemy gotowy PR, preview i klik; nagranie tylko jako plan awaryjny | 2026-09-19 |
| Kto merguje PR ze sceny 3 | **Marek klika „zatwierdź” po obejrzeniu preview**; waiver (merge bez człowieka według klasy zmiany) zostaje na slajdzie „co dalej” | 2026-09-19 |
| Scena z prawnikiem | **wycięta**; ścieżka prawna jednym zdaniem na slajdzie „co dalej” | 2026-09-19 |
| Klient ze sceny 3b | **Park of Poland (Suntago)**, prawdziwa firma, logo z parkofpoland.com; zgoda klienta poza wersją basic | 2026-09-19 |
| Stack strony | Next ze static export, TSX na produkt, Vercel, publiczne repo `hackaton-stal-zbiorniki-landing` (SPEC-005) | 2026-09-19 |

## Scenariusz (5:00)

| Czas | Scena | Na ekranie | Dowodzi |
|---|---|---|---|
| 0:00–0:35 | **1. Hook** | Slajd: Marek, jego strona z nieaktualną sekcją „Od ręki”, oferty w Excelu, agencja „dwa tygodnie na każdą zmianę”. | problemu, w jednej osobie |
| 0:35–1:50 | **2. Poprawa rekordu** | Marek na stronie produktu otwiera asystenta (⌘L): „ZDP-5000 ma 5200 l, nie 5000, i brakuje wymiarów”. Powstaje zadanie, delegowane. Caseload pokazuje jedną zmianę w *ZDP-5000*: pojemność i wymiary przed → po. Marek zatwierdza, rekord się zmienia, szuflada zadania pokazuje `applied`. | plan przed działaniem; bramka człowieka; compare-and-set; nic ukrytego |
| 1:50–3:30 | **3. Katalog → strona** | Marek dodaje *ZWM-1500 Zbiornik mobilny na wodę pitną 1500 l* z zaznaczonym „Od ręki”. Tablica pokazuje nowe zadanie, delegowane, z `catalog.product.created`. Przeskok do gotowego uruchomienia: sizer „small”, PR w repo strony, preview z nową kartą w „Od ręki”, zielone checki i `catalog-match`. **Marek klika „zatwierdź”**, merge, strona na żywo pokazuje zbiornik, zadanie w `Done`. | wyzwalacz jest w systemie ewidencji, którego fabryki widzące tylko repo nie widzą; „done” sprawdzane względem danych |
| 3:30–4:30 | **3b. Sprzedaż → referencja** | Handlowiec zmienia status zamówienia *Park of Poland (Suntago)* na *Fulfilled*. Tablica pokazuje zadanie z `sales.order.updated`. Przeskok do gotowego uruchomienia: artefakt researchera z logo Suntago i opisem pobranym z parkofpoland.com, PR z preview: logo Suntago obok browaru w „Zaufali nam”, karta w „Realizacje” z danymi z zamówienia. Marek zatwierdza, strona na żywo. Jeśli jest czas: dwa zdjęcia przeciągnięte na zamówienie → drugi PR z galerią. | wyzwalacz w sprzedaży; fabryka wciąga do systemu dane z internetu, których tam nie było |
| 4:30–5:00 | **5. Co dalej** | Jeden slajd: merge bez człowieka dla klas niskiego ryzyka (waiver) i ścieżka prawna (regulamin czeka na prawnika); zgoda klienta mailem wysyłanym i czytanym przez Open Mercato; InboxOps (mail z zapytaniem → zadanie); WordPress; koszt i ewaluacje na zadanie z orkiestratora. | że to uogólnia się poza kod |

### Na scenie

- **Jedno okno przeglądarki, karty w tej kolejności:** tablica zadań · produkt `ZDP-5000` ·
  Caseload · formularz nowego produktu · PR ze sceny 3 · preview 3 · zamówienie `SO-2026-0042` ·
  PR ze sceny 3b · preview 3b · strona na żywo. Żadnego wpisywania URL-i.
- **Kto klika:** Marek (sceny 2, 3, zatwierdzenia), handlowiec (status zamówienia w 3b). Prawnik
  nie występuje.
- **Przed pitchem:** świeży tenant z `--no-examples` i seedem; uruchomienia kodujące scen 3 i 3b
  odpalone i zakończone (PR-y otwarte, preview zielone, **niezmergowane**); zadanie ze sceny 2
  jeszcze nie istnieje.
- Mówimy „Marek” i „zbiornik”, nigdy „encja”, „instancja workflow” ani „efektor”.
- Każda scena kończy się widoczną zmianą stanu: kolumną, znaczkiem, stroną.

## Plany awaryjne

Każdy plan awaryjny zachowuje historię. Zmieniają się tylko sceny, których dotyczy.

| Jeśli to nie działa do zamrożenia w niedzielę o 11:00 | Scena | Zamiast tego |
|---|---|---|
| Chat intake (SPEC-002) | 2 | Marek tworzy zadanie na tablicy ręcznie i je deleguje |
| Zmiany `record` w Caseload (SPEC-003) | 2 | wyciąć scenę 2 i oddać czas scenie 3 |
| Intake z `catalog.product.created` | 3 | Marek tworzy zadanie ręcznie z linkiem do produktu |
| Runner nie otwiera PR-ów | 3, 3b | fallback runnera ze SPEC-001 (Claude Managed Agents); jeśli i on zawiedzie, PR zrobiony ręcznie przed pitchem (repo landing ma otwarte PR #4 z `ZWM-1500` i PR #7 z realizacją Park of Poland) i nagranie uruchomienia jako dowód |
| `web_fetch` lub intake z zamówienia (SPEC-006) | 3b | researcher czyta `suntago.json` z fixtures; zadanie tworzone ręcznie; w ostateczności wyciąć 3b i oddać czas scenie 3 |
| Wszystko, co wymaga runnera | 3, 3b | proces `factory.status` ze SPEC-001: cotygodniowy status dla Marka, harmonogram → artefakt → zatwierdzenie → publikacja |
| Sieć na miejscu | wszystkie | nagrane pełne uruchomienie, komentowane na żywo |

## Przygotowanie do Q&A (3:00)

Prawdopodobne pytania i odpowiedź w dwóch zdaniach na każde:

- **„Co jeśli agent się myli?”** Proponuje, zanim działa. Marek zatwierdza widok przed → po,
  nieaktualna propozycja przechodzi w `conflict` zamiast nadpisywać, a zmianę rekordu można cofnąć.
  Kod wychodzi tylko jako PR z preview, który zatwierdza człowiek.
- **„Czemu Marek musi klikać? Miało być automatycznie.”** Dziś każdy merge to jedno kliknięcie
  na preview. Merge bez człowieka dla klas niskiego ryzyka (nowa strona produktu) jest zaprojektowany
  (waiver, SPEC-001), a tekst prawny nigdy się w nim nie mieści.
- **„Dlaczego nie agenci Linear, Jira albo Copilot?”** Widzą repo, a nie biznes. Tutaj zadanie
  zaczyna się od dodania produktu albo zrealizowania zamówienia, a „done” jest sprawdzane
  względem tego rekordu.
- **„Logo Suntago bez pytania?”** W wersji demo tak, na stronie z `noindex`. W procesie jest miejsce
  na zgodę: Open Mercato wysyła maila z prośbą i czyta odpowiedź (Communications Hub), PR powstaje
  dopiero po „tak”.
- **„Kto odpowiada?”** Człowiek przypisany do zadania. Agent jest delegatem, a każda akcja jest
  w logu audytu pod osobą, która ją zatwierdziła.
- **„Ile kosztuje zadanie?”** Orkiestrator zapisuje koszt każdego uruchomienia. Podajemy liczbę
  zmierzoną na próbie generalnej, nie szacunek.
- **„Czy to open source?”** Open Mercato jest na MIT. Agent Orchestrator jest source-available:
  darmowy lokalnie, produkcja wymaga licencji enterprise. Nasze moduły to zwykłe moduły Open
  Mercato.
- **„Czy działa z WordPressem?”** Nie w demo. To kolejny cel, a kontrakt runnera się nie zmienia.
- **„A dane z maili?”** InboxOps jest na roadmapie: mail z zapytaniem ofertowym staje się
  zadaniem dopasowanym do produktów z katalogu.

## Ryzyka

- **LLM na żywo na scenie.** Uruchomienia kodujące kończą się przed pitchem; każdy krok na scenie
  to jedno kliknięcie na stanie, który próba generalna już osiągnęła. Na żywo pracuje tylko
  scena 2 (krótka propozycja) i intake.
- **Prawdziwa marka.** Nazwa, logo i telefony Stal-Zbiorniki są fikcyjne. Park of Poland jest
  prawdziwy: jego logo trafia na stronę demo z `noindex`, do usunięcia po hackathonie.
- **Stan między próbami.** Seeder nigdy nie nadpisuje, więc poprawiony `ZDP-5000` i dodany
  `ZWM-1500` zostają. Reset to odtworzenie tenanta demo i zamknięcie PR-ów w repo strony.
- **Seedowane meble na instancji demo.** Używamy punktu wejścia `--no-examples`.

## Persona

**Marek, 52 lata, właściciel Stal-Zbiorniki** (okolice Wrocławia, założona w 2008, ~35 osób, 20+
klientów przemysłowych). Prowadzi sprzedaż, katalog i pracowników w Open Mercato. Strona firmy to
repo podłączone jako projekt. W firmie nie ma programisty. Agencja kasuje go za każdą zmianę
i robi ją dwa tygodnie. Zatwierdza plany i preview, nigdy kod.

## Dlaczego ta firma

Jury zapamiętuje osobę z problemem, nie architekturę. Najmocniejsza teza fabryki, że wyzwalacz
żyje we własnym systemie ewidencji firmy, potrzebuje firmy, której rekordy i strona widocznie
się rozjeżdżają. Prawdziwa metal-zbiorniki.pl pokazuje ten wzorzec: sprzedaż przez formularz,
trzy skrzynki i trzy telefony; sekcja „Od ręki” z trzema gotowymi zbiornikami, która musi się
zmienić tego samego dnia, gdy zbiornik zostanie sprzedany; parametry techniczne (pojemność,
gatunek stali, atesty PZH i UDT), w których błędna liczba sporo kosztuje.

## Dane demo

Seedowane przez `demo_fixtures` (`src/modules/demo_fixtures/lib/stalZbiorniki.ts`,
`seedStalZbiornikiDemo`):

- Sześć kategorii: woda, paliwa, chemia, ppoż., urządzenia procesowe oraz **„Od ręki”**.
- Siedem produktów z cenami netto w PLN, wagą, wymiarami w mm i parametrami w `metadata`.
- **`ZDP-5000` jest błędny celowo**: 5000 l zamiast 5200 l, bez wymiarów. Scena 2 to poprawia.
- **`ZWM-1500` nie jest seedowany.** Marek dodaje go na żywo w scenie 3, w formularzu nowego
  produktu: tytuł *Zbiornik mobilny na wodę pitną 1500 l*, podtytuł *Stal nierdzewna 1.4301,
  atest PZH*, SKU `ZWM-1500`, 11 900 PLN netto, kategorie „Zbiorniki na wodę pitną” i „Od ręki”.
  Pojemność, materiał i atest agent wyprowadza z tytułu i podtytułu (mapowanie w SPEC-005).
- **Park of Poland (Suntago)**: klient firmowy z `websiteUrl`, kontakt Anna Kowalska, zamówienie
  `SO-2026-0042` (1 × ZPPOZ-20, 2 × ZCH-3000, 126 400 PLN netto, `confirmed`, opłacone,
  niezrealizowane). Handlowiec zmienia status na *Fulfilled* w scenie 3b.
- `suntago.json`: zbuforowany scrape parkofpoland.com (logo, opis) jako plan awaryjny researchera.

Seeder zapisuje przez entity manager, więc nie emituje zdarzeń i nigdy nie uruchamia fabryki.
Jest idempotentny (po handle, nazwie klienta i numerze zamówienia) i nigdy nie nadpisuje.

Punkty wejścia: `yarn initialize` (z przykładami core, wystarcza do developmentu) albo dla
instancji demo `yarn mercato init --no-examples`, a potem
`yarn mercato demo_fixtures seed-stal-zbiorniki --tenant <id> --org <id>`.

## Docelowa strona

Publiczne repo `hackaton-stal-zbiorniki-landing` (SPEC-005): strona główna, „Od ręki”, strony
produktów, `regulamin`, a od SPEC-006 „Realizacje” i „Zaufali nam”. Każdy produkt i każda
realizacja to wpis w rejestrze i strona TSX, więc PR fabryki dodaje pliki, nie rekordy. Ma:

- preview na Vercelu dla każdego PR;
- check `site` (build + Playwright chodzący po zbudowanej stronie) wymagany na `main`;
- status `factory/catalog-match`, w którym runner porównuje preview z rekordem z katalogu
  (scena 3) albo z zamówieniem (scena 3b): teza „done sprawdzane względem danych”;
- merge po kliknięciu Marka; GitHub App fabryki nie merguje własnych PR-ów.

## Plan wdrożenia

### Faza 1: Dane i skrypt

1. `demo_fixtures` z seedem katalogu i CLI. **Zrobione.**
2. Przykłady ze SPEC-001 i SPEC-003 przeniesione na ZDP-5000. **Zrobione.**
3. Klient Park of Poland, zamówienie `SO-2026-0042`, `suntago.json` (SPEC-006). **Zrobione.**

### Faza 2: Strona

4. Repo landing według SPEC-005: produkty, „Od ręki”, `regulamin`, preview per PR. **Zrobione**
   (PR #4 z `ZWM-1500` ma preview).
5. Check `site` i ruleset na `main`. *Test:* czerwony na PR ze zduplikowanym SKU.
6. „Realizacje” i „Zaufali nam” (SPEC-006 Faza 1). **Zrobione** (repo landing, PR #5 i #6):
   na `main` fikcyjny Browar Rzemieślniczy Ostrów jako pierwsza referencja (static export wymaga
   co najmniej jednej strony), wpis Park of Poland w otwartym PR #7 jako fallback sceny 3b.

### Faza 3: Połączenie scen (z krokami 2–4 ze SPEC-001)

7. Scena 2 end to end na seedowanym `ZDP-5000`. *Test:* zatwierdzenie → rekord ma 5200 l
   i wymiary; szuflada pokazuje `applied`.
8. Scena 3 end to end od dodania `ZWM-1500` w UI katalogu. *Test:* PR z preview, klik Marka,
   strona na żywo pokazuje zbiornik, zadanie w `Done`.
9. Scena 3b end to end (SPEC-006 Fazy 2–3). *Test:* status *Fulfilled* → PR z logo i kartą,
   klik Marka, strona na żywo.

### Faza 4: Próby (sobota wieczór, niedziela do 11:00)

10. Slajdy do scen 1 i 5; nagranie zapasowe pełnego uruchomienia.
11. Dwie mierzone próby generalne na świeżym tenancie z `--no-examples`, z uruchomieniami
    kodującymi odpalonymi przed „pitchem”. Zanotować koszt na zadanie do Q&A.

## Historia zmian

<!-- Record, not state: rows are closed once dated — append, never rewrite. -->

| Data | Zmiana |
|------|--------|
| 2026-09-18 | Szkic: persona i fabuła Stal-Zbiorniki, seed katalogu demo (`demo_fixtures`), docelowa strona, plany awaryjne, Q&A. |
| 2026-09-19 | Scena 4 (prawnik) wycięta, na jej miejsce scena 3b: zrealizowane zamówienie Park of Poland → logo i karta realizacji na stronie (SPEC-006). Ścieżka prawna przeniesiona na slajd „co dalej”. |
| 2026-09-19 | Q1 rozstrzygnięte (Astro, Vercel, publiczne repo `hackaton-stal-zbiorniki-landing`); strona opisana w SPEC-005. |
| 2026-09-19 | ZWM-1500 z kategorią „Zbiorniki na wodę pitną” i parametrami w podtytule; weryfikacja strony przez check `site` i status `factory/catalog-match` (SPEC-005). |
| 2026-09-19 | Strona na Next ze static export zamiast Astro; produkt to strona TSX (SPEC-005). |
| 2026-09-19 | Repo landing: PR #5 (infrastruktura realizacji) i #6 (stan demo: fikcyjny browar na `main`) zmergowane; PR #7 z Park of Poland otwarty jako fallback sceny 3b. |
| 2026-09-19 | Dokument przepisany jako jedyne źródło prawdy o pitchu: „Stan na dziś”, decyzje zamknięte (polski, na żywo z uruchomieniami przed pitchem, merge po kliknięciu Marka zamiast waivera), scenariusz z kolejnością kart i podziałem ról, Q&A o kliknięciu i o logo Suntago; plan wdrożenia na końcu ze stanem kroków. |

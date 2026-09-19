# Fabryka oprogramowania Open Mercato

Słownik pojęć wspólny dla specyfikacji w `docs/specs/`: fabryka agentowa uruchamiana z tablicy
zadań Open Mercato, katalog produktów jako źródło prawdy i strona firmy jako repo docelowe.

## Język

### Zadania i fabryka

**Fabryka** (factory):
Proces agentowy, który bierze delegowane zadanie i doprowadza je do zmiany (PR, zmiana rekordu,
wiadomość) przez bramki decyzyjne człowieka.
_Avoid_: orkiestrator (to silnik pod spodem), agent (to jedna rola w fabryce)

**Zadanie** (task):
Rekord na tablicy zadań z zamrożoną referencją; jednostka pracy, którą fabryka może dostać.
_Avoid_: ticket, issue, task order

**Referencja** (reference):
Stały identyfikator zadania w formie `KOD-PROJEKTU-numer` (np. `WEB-12`), nadawany raz i nigdy
nie zmieniany.
_Avoid_: numer zadania, id

**Delegacja** (delegation):
Wskazanie agenta jako delegata zadania; moment, w którym fabryka startuje. **Delegat** to zawsze
agent; człowiek odpowiedzialny za zadanie pozostaje **przypisanym** (assignee).
_Avoid_: przypisanie do agenta, trigger

**Intake** (zgłoszenie):
Droga, którą zadanie trafia na tablicę: ręcznie, z chatu, od klienta MCP, ze zdarzenia. Źródło
intake jest zapisane przy zadaniu.
_Avoid_: import, ingestion

**Caseload**:
Miejsce decyzji człowieka w fabryce: bramka projektu, zatwierdzenie zmiany rekordu, recenzja.
_Avoid_: inbox, approvals, skrzynka

### Katalog i strona

**Katalog** (catalog):
Produkty w Open Mercato; jedyne źródło prawdy o nazwie, SKU, cenie, pojemności i atestach.
_Avoid_: baza produktów, CMS

**Strona produktu** (product page):
Publiczna strona jednego produktu w repo strony firmy; zmienia się wyłącznie przez PR.
_Avoid_: landing (to cała strona), karta produktu (to kafelek na liście)

**Od ręki** (in stock):
Produkty dostępne natychmiast; w katalogu to kategoria, na stronie to lista zbudowana z tej
kategorii.
_Avoid_: dostępność, magazyn

### Chat i MCP

**Narzędzie AI** (AI tool):
Jedna zdolność udostępniona modelowi, z opisem, schematem wejścia i wymaganymi uprawnieniami. Ta
sama definicja działa w chacie Open Mercato i na serwerze MCP.
_Avoid_: „MCP” jako nazwa narzędzia, funkcja, endpoint

**Serwer MCP** (MCP server):
Usługa Open Mercato, przez którą klient zewnętrzny woła narzędzia AI z uprawnieniami swojego
klucza API.
_Avoid_: „MCP” bez dopowiedzenia, którą z trzech rzeczy mamy na myśli

**Klient MCP** (MCP client):
Zewnętrzne narzędzie dewelopera (Claude Code, Cursor) podłączone do serwera MCP.
_Avoid_: integracja, wtyczka

**Agent chatu** (chat agent):
Wyspecjalizowany asystent w chacie Open Mercato z własną instrukcją i listą dozwolonych narzędzi.
_Avoid_: bot, asystent (to cała powierzchnia chatu)

**Karta zatwierdzenia** (approval card):
Podgląd zmiany przed → po, który chat pokazuje zanim cokolwiek zapisze; zapis następuje dopiero
po potwierdzeniu. Istnieje tylko w chacie, klient MCP jej nie ma.
_Avoid_: preview (to podgląd strony z PR), dialog potwierdzenia

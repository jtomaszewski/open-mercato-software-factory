// The Metal Zbiorniki company around the catalog: customers, staff, projects and their tasks,
// so the backend looks like a working business rather than an empty install. Customers follow
// the landing's realizations (hackaton-stal-zbiorniki-landing, lib/realizations.ts) and are real
// companies named on metal-zbiorniki.pl; what they ordered is the demo's own data.
// The DEMO board belongs to task_delegation's seed and scene 3; nothing here touches it.

export const DEMO_COMPANY_NAME = 'Metal Zbiorniki'
export const DEMO_COMPANY_LOGO_FILE = 'public/brand/metal-zbiorniki-logo.png'

export const DEMO_CUSTOMERS = [
  { key: 'panels', displayName: 'Swiss Krono Polska', industry: 'Przemysł drzewny', domain: 'swisskrono.pl', lifecycleStage: 'customer', description: 'Dwa zbiorniki ZWP-5000 na wodę uzdatnioną dla zakładu płyt drewnopochodnych w Żarach, łącznie 10 000 l.' },
  { key: 'chemicals', displayName: 'Euroservice Z.P.T.', industry: 'Chemia przemysłowa', domain: 'euroservice.com.pl', lifecycleStage: 'customer', description: 'Zbiornik ppoż. ZPPOZ-20 i dwa zbiorniki ZCH-3000. Odbiór techniczny przed przygotowaniem referencji.' },
  { key: 'installer', displayName: 'Ekos Poznań', industry: 'Instalacje przemysłowe', domain: 'ekos.poznan.pl', lifecycleStage: 'lead', description: 'Zapytanie o zbiornik dwupłaszczowy ZDP-5000 na zaplecze budowy. Parametry wymagają potwierdzenia.' },
] as const

export const DEMO_TEAMS = [
  { key: 'office', name: 'Sprzedaż i obsługa klienta', description: 'Zapytania, oferty, terminy dostaw i treści na stronie.' },
  { key: 'engineering', name: 'Technologia i jakość', description: 'Dokumentacja techniczna, weryfikacja parametrów i odbiory.' },
  { key: 'production', name: 'Produkcja i logistyka', description: 'Wytwarzanie, kompletacja i transport zbiorników.' },
] as const

export const DEMO_PEOPLE = [
  { key: 'sales', name: 'Katarzyna Lis', team: 'office', role: 'Koordynatorka sprzedaży i kontaktów z klientami' },
  { key: 'engineer', name: 'Piotr Domański', team: 'engineering', role: 'Technolog; dokumentacja i dobór materiałów' },
  { key: 'quality', name: 'Ewa Górecka', team: 'engineering', role: 'Kontrola jakości; weryfikacja dokumentów odbiorowych' },
  { key: 'production', name: 'Tomasz Borkowski', team: 'production', role: 'Planowanie produkcji i kompletacja' },
  { key: 'logistics', name: 'Alicja Sikora', team: 'production', role: 'Logistyka i uzgodnienie dostaw' },
] as const

export const DEMO_PROJECTS = [
  { key: 'panels', code: 'KRONO', name: 'Swiss Krono - dwa zbiorniki ZWP-5000', customer: 'panels', description: 'Dwa zbiorniki na wodę uzdatnioną, łącznie 10 000 l. Dokumentacja i obsługa po dostawie.', people: ['sales', 'quality', 'logistics'] },
  { key: 'chemicals', code: 'EUROSERV', name: 'Euroservice - instalacja technologiczna', customer: 'chemicals', description: 'ZPPOZ-20 i 2 x ZCH-3000. Odbiór, transport i przygotowanie materiałów referencyjnych.', people: ['engineer', 'quality', 'production', 'logistics'] },
] as const

export const DEMO_TASKS = [
  { project: 'panels', status: 'backlog', person: 'sales', title: 'Zaplanować kontakt po dostawie do Swiss Krono', description: 'Uzyskać opinię o użytkowaniu dwóch ZWP-5000.' },
  { project: 'panels', status: 'in-progress', person: 'quality', title: 'Skompletować archiwum dokumentacji ZWP-5000', description: 'Zebrać karty dwóch zbiorników i protokół odbioru.' },
  { project: 'panels', status: 'in-review', person: 'sales', title: 'Sprawdzić opis realizacji Swiss Krono', description: 'Dwa ZWP-5000, łącznie 10 000 l, luty 2026. Przegląd treści przed publikacją.' },
  { project: 'panels', status: 'done', person: 'logistics', title: 'Zamknąć checklistę dostawy dwóch zbiorników', description: 'Dostawa i rozładunek potwierdzone przez klienta.' },
  { project: 'chemicals', status: 'backlog', person: 'logistics', title: 'Uzgodnić okno transportowe Euroservice', description: 'ZPPOZ-20 wymaga zaplanowania rozładunku. Potwierdzić gotowość miejsca montażu przed wysyłką.' },
  { project: 'chemicals', status: 'in-progress', person: 'production', title: 'Przygotować komplet ZPPOZ-20 i dwóch ZCH-3000', description: 'Lista kompletacyjna dla zamówienia MZ-2026-0051.' },
  { project: 'chemicals', status: 'in-review', person: 'quality', title: 'Zweryfikować checklistę odbioru technicznego', description: 'Materiał, wymiary, króćce i komplet dokumentacji. Zakończenie wymaga akceptacji technologa.' },
  { project: 'chemicals', status: 'done', person: 'engineer', title: 'Uzgodnić zakres instalacji technologicznej', description: 'Zbiornik przeciwpożarowy 20 m³ oraz dwa zbiorniki chemiczne po 3000 l.' },
] as const

export const DEMO_OPEN_ORDER = {
  orderNumber: 'MZ-2026-0051',
  customer: 'chemicals',
  // The kitting task on the EUROSERV board is in progress.
  status: 'in_fulfillment',
  placedAt: '2026-09-01',
  expectedDeliveryAt: '2026-09-25',
  comments: 'Euroservice: komplet zbiorników do instalacji technologicznej.',
  lines: [
    { handle: 'zppoz-20', quantity: 1 },
    { handle: 'zch-3000', quantity: 2 },
  ],
} as const

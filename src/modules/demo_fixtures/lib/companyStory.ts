// The Stal-Zbiorniki company around the catalog: fictional customers, staff, projects and their
// tasks, so the backend looks like a working business rather than an empty install. Customers and
// projects follow the landing's realizations (hackaton-stal-zbiorniki-landing, lib/realizations.ts).
// The DEMO board belongs to task_delegation's seed and scene 3; nothing here touches it.

export const DEMO_COMPANY_NAME = 'Stal-Zbiorniki Sp. z o.o.'
export const DEMO_COMPANY_LOGO_PATH = '/brand/stal-zbiorniki-logo.png'

export const DEMO_CUSTOMERS = [
  { key: 'brewery', displayName: 'Browar Rzemieślniczy Ostrów', industry: 'Browarnictwo', domain: 'browar-ostrow.example', lifecycleStage: 'customer', description: 'Dwa zbiorniki ZWP-2000 zasilające linię warzelną, łącznie 4000 l.' },
  { key: 'water', displayName: 'Aqua Dolina - park wodny', industry: 'Rekreacja', domain: 'aqua-dolina.example', lifecycleStage: 'customer', description: 'Zbiornik ppoż. ZPPOZ-20 i dwa zbiorniki ZCH-3000. Odbiór techniczny przed przygotowaniem referencji.' },
  { key: 'transport', displayName: 'Trans-Sud - baza transportowa', industry: 'Transport', domain: 'trans-sud.example', lifecycleStage: 'lead', description: 'Zapytanie o zbiornik dwupłaszczowy ZDP-5000 do własnej bazy transportowej. Parametry wymagają potwierdzenia.' },
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
  { key: 'brewery', code: 'BROWAR', name: 'Browar Ostrów - dwa zbiorniki ZWP-2000', customer: 'brewery', description: 'Dwa zbiorniki na wodę technologiczną, łącznie 4000 l. Dokumentacja i obsługa po dostawie.', people: ['sales', 'quality', 'logistics'] },
  { key: 'water', code: 'AQUA', name: 'Aqua Dolina - instalacja technologiczna', customer: 'water', description: 'ZPPOZ-20 i 2 x ZCH-3000. Odbiór, transport i przygotowanie materiałów referencyjnych.', people: ['engineer', 'quality', 'production', 'logistics'] },
] as const

export const DEMO_TASKS = [
  { project: 'brewery', status: 'backlog', person: 'sales', title: 'Zaplanować kontakt po dostawie do browaru', description: 'Uzyskać opinię o użytkowaniu dwóch ZWP-2000.' },
  { project: 'brewery', status: 'in-progress', person: 'quality', title: 'Skompletować archiwum dokumentacji ZWP-2000', description: 'Zebrać karty dwóch zbiorników i protokół odbioru.' },
  { project: 'brewery', status: 'in-review', person: 'sales', title: 'Sprawdzić opis realizacji Browar Ostrów', description: 'Dwa ZWP-2000, łącznie 4000 l, maj 2026. Przegląd treści przed publikacją.' },
  { project: 'brewery', status: 'done', person: 'logistics', title: 'Zamknąć checklistę dostawy dwóch zbiorników', description: 'Dostawa i rozładunek potwierdzone przez klienta.' },
  { project: 'water', status: 'backlog', person: 'logistics', title: 'Uzgodnić okno transportowe Aqua Dolina', description: 'ZPPOZ-20 wymaga zaplanowania rozładunku. Potwierdzić gotowość miejsca montażu przed wysyłką.' },
  { project: 'water', status: 'in-progress', person: 'production', title: 'Przygotować komplet ZPPOZ-20 i dwóch ZCH-3000', description: 'Lista kompletacyjna dla zamówienia SZ-2026-0051.' },
  { project: 'water', status: 'in-review', person: 'quality', title: 'Zweryfikować checklistę odbioru technicznego', description: 'Materiał, wymiary, króćce i komplet dokumentacji. Zakończenie wymaga akceptacji technologa.' },
  { project: 'water', status: 'done', person: 'engineer', title: 'Uzgodnić zakres instalacji technologicznej', description: 'Zbiornik przeciwpożarowy 20 m³ oraz dwa zbiorniki chemiczne po 3000 l.' },
] as const

export const DEMO_WATER_ORDER = {
  orderNumber: 'SZ-2026-0051',
  placedAt: '2026-09-01',
  expectedDeliveryAt: '2026-09-25',
  comments: 'Aqua Dolina: komplet zbiorników do instalacji technologicznej.',
  lines: [
    { handle: 'zppoz-20', quantity: 1 },
    { handle: 'zch-3000', quantity: 2 },
  ],
} as const

import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
} from '@open-mercato/core/modules/catalog/data/entities'
import { rebuildCategoryHierarchyForOrganization } from '@open-mercato/core/modules/catalog/lib/categoryHierarchy'
import {
  CustomerAddress,
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { SalesDocumentAddress, SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'
import {
  ensureSalesDictionary,
  normalizeDictionaryValue,
  seedSalesStatusDictionaries,
} from '@open-mercato/core/modules/sales/lib/dictionaries'
import type { SalesCalculationService } from '@open-mercato/core/modules/sales/services/salesCalculationService'

/**
 * Demo data of Stal-Zbiorniki Sp. z o.o., the fictional steel-tank manufacturer the demo
 * runs on (SPEC-004): the catalog, plus one customer with one fulfilled-in-reality order
 * (SPEC-006). Data, not UI copy: texts are Polish because the company is.
 *
 * `ZDP-5000` is wrong on purpose — its real capacity is 5200 l and its dimensions are
 * empty. That is the record the owner corrects live (SPEC-004 scene 2). The mobile tank
 * `ZWM-1500` is NOT seeded: the owner adds it live (scene 3).
 *
 * The Park of Poland order `SO-2026-0042` is seeded as confirmed and paid but NOT
 * fulfilled: the salesperson marks it fulfilled live, which triggers the client-reference
 * flow (SPEC-006). Nothing here is ever overwritten on re-run.
 */

export type DemoSeedScope = { tenantId: string; organizationId: string }

export type DemoSeedResult = { products: number; customer: boolean; order: boolean }

type CategorySeed = { slug: string; name: string; description: string }

type ProductSeed = {
  handle: string
  sku: string
  title: string
  subtitle: string
  description: string
  categories: string[]
  netPricePln: number
  weightKg: number
  dimensionsMm: { width: number; height: number; depth: number } | null
  metadata: Record<string, unknown>
}

const VAT_RATE = 23

export const STAL_ZBIORNIKI_CATEGORIES: CategorySeed[] = [
  { slug: 'woda-pitna', name: 'Zbiorniki na wodę pitną', description: 'Zbiorniki ze stali nierdzewnej z atestem PZH.' },
  { slug: 'paliwa', name: 'Zbiorniki na paliwa i oleje', description: 'Zbiorniki dwupłaszczowe naziemne i podziemne.' },
  { slug: 'chemia', name: 'Zbiorniki na chemikalia', description: 'Zbiorniki ze stali kwasoodpornej.' },
  { slug: 'ppoz', name: 'Zbiorniki ppoż. i na wodę technologiczną', description: 'Zbiorniki przeciwpożarowe i procesowe.' },
  { slug: 'urzadzenia', name: 'Urządzenia technologiczne', description: 'Mieszalniki, reaktory, silosy.' },
  { slug: 'od-reki', name: 'Od ręki', description: 'Gotowe zbiorniki dostępne z magazynu.' },
]

export const STAL_ZBIORNIKI_PRODUCTS: ProductSeed[] = [
  {
    handle: 'zwp-2000',
    sku: 'ZWP-2000',
    title: 'Zbiornik na wodę pitną 2000 l',
    subtitle: 'Stal nierdzewna 1.4301, atest PZH',
    description:
      'Pionowy zbiornik na wodę pitną o pojemności 2000 l. Stal nierdzewna 1.4301 (AISI 304), atest PZH. Króćce przyłączeniowe DN50, właz rewizyjny DN400.',
    categories: ['woda-pitna', 'od-reki'],
    netPricePln: 14900,
    weightKg: 210,
    dimensionsMm: { width: 1200, height: 2100, depth: 1200 },
    metadata: { capacityLiters: 2000, material: '1.4301', orientation: 'vertical', certifications: ['PZH'], inStock: true },
  },
  {
    handle: 'zwp-5000',
    sku: 'ZWP-5000',
    title: 'Zbiornik na wodę pitną 5000 l',
    subtitle: 'Stal nierdzewna 1.4301, atest PZH',
    description:
      'Pionowy zbiornik na wodę pitną o pojemności 5000 l. Stal nierdzewna 1.4301 (AISI 304), atest PZH. Wykonanie na zamówienie, czas realizacji 4–6 tygodni.',
    categories: ['woda-pitna'],
    netPricePln: 27500,
    weightKg: 420,
    dimensionsMm: { width: 1800, height: 2400, depth: 1800 },
    metadata: { capacityLiters: 5000, material: '1.4301', orientation: 'vertical', certifications: ['PZH'], leadTimeWeeks: '4-6' },
  },
  {
    handle: 'zdp-5000',
    sku: 'ZDP-5000',
    title: 'Zbiornik dwupłaszczowy na olej napędowy 5000 l',
    subtitle: 'Naziemny, stal S235JR, dozór UDT',
    description:
      'Naziemny zbiornik dwupłaszczowy na olej napędowy o pojemności 5000 l. Stal S235JR, sonda szczelności przestrzeni międzypłaszczowej, podlega dozorowi UDT.',
    categories: ['paliwa', 'od-reki'],
    netPricePln: 18900,
    weightKg: 980,
    dimensionsMm: null,
    metadata: { capacityLiters: 5000, material: 'S235JR', orientation: 'horizontal', certifications: ['UDT'], inStock: true },
  },
  {
    handle: 'zdp-10000-pz',
    sku: 'ZDP-10000-PZ',
    title: 'Zbiornik dwupłaszczowy podziemny na olej opałowy 10 000 l',
    subtitle: 'Podziemny, izolacja epoksydowa, dozór UDT',
    description:
      'Podziemny zbiornik dwupłaszczowy na olej opałowy o pojemności 10 000 l. Stal S235JR, zewnętrzna izolacja epoksydowa, wskaźnik wycieku, podlega dozorowi UDT.',
    categories: ['paliwa'],
    netPricePln: 38400,
    weightKg: 1850,
    dimensionsMm: { width: 2000, height: 2000, depth: 3700 },
    metadata: { capacityLiters: 10000, material: 'S235JR', orientation: 'horizontal', certifications: ['UDT'], installation: 'underground' },
  },
  {
    handle: 'zch-3000',
    sku: 'ZCH-3000',
    title: 'Zbiornik na kwasy 3000 l',
    subtitle: 'Stal kwasoodporna 1.4571',
    description:
      'Pionowy zbiornik na kwasy i ługi o pojemności 3000 l. Stal kwasoodporna 1.4571 (AISI 316Ti), odpowietrzenie z filtrem, wanna wychwytowa w zestawie.',
    categories: ['chemia'],
    netPricePln: 31200,
    weightKg: 380,
    dimensionsMm: { width: 1500, height: 2200, depth: 1500 },
    metadata: { capacityLiters: 3000, material: '1.4571', orientation: 'vertical', certifications: [] },
  },
  {
    handle: 'zppoz-20',
    sku: 'ZPPOZ-20',
    title: 'Zbiornik przeciwpożarowy 20 m³',
    subtitle: 'Naziemny, stal ocynkowana, izolacja termiczna',
    description:
      'Naziemny zbiornik na wodę przeciwpożarową o pojemności 20 m³. Stal ocynkowana ogniowo, izolacja termiczna z płaszczem, podgrzewanie przeciwzamrożeniowe.',
    categories: ['ppoz', 'od-reki'],
    netPricePln: 64000,
    weightKg: 2600,
    dimensionsMm: { width: 2500, height: 4500, depth: 2500 },
    metadata: { capacityLiters: 20000, material: 'S235JR+Zn', orientation: 'vertical', certifications: ['CNBOP'], inStock: true },
  },
  {
    handle: 'mx-500',
    sku: 'MX-500',
    title: 'Mieszalnik procesowy 500 l',
    subtitle: 'Stal nierdzewna 1.4404, mieszadło ramowe',
    description:
      'Mieszalnik procesowy o pojemności roboczej 500 l. Stal nierdzewna 1.4404 (AISI 316L), mieszadło ramowe z motoreduktorem 1,5 kW, płaszcz grzewczy.',
    categories: ['urzadzenia'],
    netPricePln: 42800,
    weightKg: 320,
    dimensionsMm: { width: 900, height: 1900, depth: 900 },
    metadata: { capacityLiters: 500, material: '1.4404', certifications: [] },
  },
]

function money(value: number): string {
  return value.toFixed(4)
}

async function ensureCategories(em: EntityManager, scope: DemoSeedScope): Promise<Map<string, CatalogProductCategory>> {
  const map = new Map<string, CatalogProductCategory>()
  const now = new Date()
  for (const seed of STAL_ZBIORNIKI_CATEGORIES) {
    let record = await em.findOne(CatalogProductCategory, { ...scope, slug: seed.slug })
    if (!record) {
      record = em.create(CatalogProductCategory, {
        id: randomUUID(),
        ...scope,
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        parentId: null,
        rootId: null,
        treePath: null,
        depth: 0,
        ancestorIds: [],
        childIds: [],
        descendantIds: [],
        metadata: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(record)
    }
    map.set(seed.slug, record)
  }
  await em.flush()
  await rebuildCategoryHierarchyForOrganization(em, scope.organizationId, scope.tenantId)
  return map
}

/**
 * Seeds the Stal-Zbiorniki catalog into one tenant/organization. Idempotent by product
 * handle: existing products are left untouched, so a corrected `ZDP-5000` stays corrected
 * across re-runs. Returns the number of products created.
 *
 * Writes through the entity manager, like core's own catalog example seeder, so seeding
 * emits no `catalog.product.created` and never wakes the factory.
 */
export async function seedStalZbiorniki(em: EntityManager, scope: DemoSeedScope): Promise<number> {
  const regularKind = await em.findOne(CatalogPriceKind, { tenantId: scope.tenantId, code: 'regular', deletedAt: null })
  if (!regularKind) {
    throw new Error('Missing catalog price kind "regular"; run `yarn mercato seed:defaults --module catalog` first.')
  }

  const existing = await em.find(CatalogProduct, {
    ...scope,
    handle: { $in: STAL_ZBIORNIKI_PRODUCTS.map((product) => product.handle) },
  })
  const existingHandles = new Set(existing.map((product) => product.handle))
  const missing = STAL_ZBIORNIKI_PRODUCTS.filter((product) => !existingHandles.has(product.handle))
  if (!missing.length) return 0

  const categories = await ensureCategories(em, scope)
  const now = new Date()

  for (const seed of missing) {
    const product = em.create(CatalogProduct, {
      id: randomUUID(),
      ...scope,
      title: seed.title,
      subtitle: seed.subtitle,
      description: seed.description,
      sku: seed.sku,
      handle: seed.handle,
      productType: 'simple',
      primaryCurrencyCode: 'PLN',
      defaultUnit: 'pc',
      weightValue: String(seed.weightKg),
      weightUnit: 'kg',
      dimensions: seed.dimensionsMm ? { ...seed.dimensionsMm, unit: 'mm' } : null,
      countryOfOriginCode: 'PL',
      metadata: seed.metadata,
      taxRate: String(VAT_RATE),
      isConfigurable: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(product)

    seed.categories.forEach((slug, position) => {
      const category = categories.get(slug)
      if (!category) return
      em.persist(
        em.create(CatalogProductCategoryAssignment, {
          id: randomUUID(),
          ...scope,
          product,
          category,
          position,
          createdAt: now,
          updatedAt: now,
        }),
      )
    })

    em.persist(
      em.create(CatalogProductPrice, {
        id: randomUUID(),
        ...scope,
        product,
        priceKind: regularKind,
        currencyCode: 'PLN',
        kind: regularKind.code,
        minQuantity: 1,
        taxRate: String(VAT_RATE),
        unitPriceNet: money(seed.netPricePln),
        unitPriceGross: money(seed.netPricePln * (1 + VAT_RATE / 100)),
        createdAt: now,
        updatedAt: now,
      }),
    )
  }

  await em.flush()
  return missing.length
}

// ---------------------------------------------------------------------------------------
// Park of Poland (Suntago) — the customer of SPEC-006 and its one order.
// ---------------------------------------------------------------------------------------

export const PARK_OF_POLAND = {
  displayName: 'Park of Poland (Suntago)',
  legalName: 'Park of Poland Sp. z o.o.',
  brandName: 'Suntago',
  domain: 'parkofpoland.com',
  websiteUrl: 'https://parkofpoland.com/',
  // Fictional NIP and contact data; only the website is real (the logo scrape needs it).
  description: 'Park wodny Suntago. NIP 838-192-33-44 (dane fikcyjne).',
  primaryEmail: 'zakupy@parkofpoland.example',
  primaryPhone: '+48 46 858 12 00',
  industry: 'Rekreacja i rozrywka',
  sizeBucket: '201-500',
  address: {
    name: 'Siedziba',
    addressLine1: 'ul. Parkowa 1',
    city: 'Wręcza',
    region: 'mazowieckie',
    postalCode: '96-320',
    country: 'PL',
  },
  contact: {
    firstName: 'Anna',
    lastName: 'Kowalska',
    jobTitle: 'Kierownik Techniczny',
    email: 'anna.kowalska@parkofpoland.example',
    phone: '+48 600 123 456',
  },
} as const

export const SUNTAGO_ORDER = {
  orderNumber: 'SO-2026-0042',
  currencyCode: 'PLN',
  placedDaysAgo: 42,
  status: 'confirmed',
  // Free-text values, the same core's own example orders use: no fulfillment/payment
  // dictionary exists, only `sales.order_status`. Left `pending` on purpose (SPEC-006).
  fulfillmentStatus: 'pending',
  paymentStatus: 'paid',
  comments: 'Realizacja: zbiorniki na wodę technologiczną i chemię basenową dla parku wodnego Suntago.',
  lines: [
    { handle: 'zppoz-20', quantity: 1 },
    { handle: 'zch-3000', quantity: 2 },
  ],
} as const

type ParkOfPolandCustomer = {
  company: CustomerEntity
  profile: CustomerCompanyProfile | null
  contact: CustomerPersonProfile | null
  address: CustomerAddress | null
  created: boolean
}

function amount(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 10000) / 10000)
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Finds the seeded company by display name. Customer fields are encrypted at rest, so the
 * match happens in memory on decrypted rows, like core's own sales example seeder does.
 */
async function findParkOfPoland(em: EntityManager, scope: DemoSeedScope): Promise<CustomerEntity | null> {
  const companies = await findWithDecryption(
    em,
    CustomerEntity,
    { ...scope, kind: 'company', deletedAt: null },
    {},
    scope,
  )
  return companies.find((company) => company.displayName === PARK_OF_POLAND.displayName) ?? null
}

/**
 * Seeds the Park of Poland company, its office address and one contact person. Idempotent
 * by company display name: an existing company is returned as-is with whatever contact and
 * address it has now.
 */
export async function seedParkOfPoland(em: EntityManager, scope: DemoSeedScope): Promise<ParkOfPolandCustomer> {
  const existing = await findParkOfPoland(em, scope)
  if (existing) {
    const [profiles, contacts, addresses] = await Promise.all([
      findWithDecryption(em, CustomerCompanyProfile, { ...scope, entity: existing }, {}, scope),
      findWithDecryption(em, CustomerPersonProfile, { ...scope, company: existing }, { populate: ['entity'] }, scope),
      findWithDecryption(
        em,
        CustomerAddress,
        { ...scope, entity: existing },
        { orderBy: { isPrimary: 'desc', createdAt: 'asc' } },
        scope,
      ),
    ])
    return {
      company: existing,
      profile: profiles[0] ?? null,
      contact: contacts[0] ?? null,
      address: addresses[0] ?? null,
      created: false,
    }
  }

  const now = new Date()
  const company = em.create(CustomerEntity, {
    id: randomUUID(),
    ...scope,
    kind: 'company',
    displayName: PARK_OF_POLAND.displayName,
    description: PARK_OF_POLAND.description,
    primaryEmail: PARK_OF_POLAND.primaryEmail,
    primaryPhone: PARK_OF_POLAND.primaryPhone,
    lifecycleStage: 'customer',
    status: 'active',
    source: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(company)
  const profile = em.create(CustomerCompanyProfile, {
    id: randomUUID(),
    ...scope,
    entity: company,
    legalName: PARK_OF_POLAND.legalName,
    brandName: PARK_OF_POLAND.brandName,
    domain: PARK_OF_POLAND.domain,
    websiteUrl: PARK_OF_POLAND.websiteUrl,
    industry: PARK_OF_POLAND.industry,
    sizeBucket: PARK_OF_POLAND.sizeBucket,
    annualRevenue: null,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(profile)
  const address = em.create(CustomerAddress, {
    id: randomUUID(),
    ...scope,
    entity: company,
    name: PARK_OF_POLAND.address.name,
    purpose: 'office',
    companyName: PARK_OF_POLAND.legalName,
    addressLine1: PARK_OF_POLAND.address.addressLine1,
    addressLine2: null,
    city: PARK_OF_POLAND.address.city,
    region: PARK_OF_POLAND.address.region,
    postalCode: PARK_OF_POLAND.address.postalCode,
    country: PARK_OF_POLAND.address.country,
    latitude: null,
    longitude: null,
    buildingNumber: null,
    flatNumber: null,
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(address)

  const { contact: seed } = PARK_OF_POLAND
  const person = em.create(CustomerEntity, {
    id: randomUUID(),
    ...scope,
    kind: 'person',
    displayName: `${seed.firstName} ${seed.lastName}`,
    description: null,
    primaryEmail: seed.email,
    primaryPhone: seed.phone,
    lifecycleStage: 'customer',
    status: 'active',
    source: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(person)
  const contact = em.create(CustomerPersonProfile, {
    id: randomUUID(),
    ...scope,
    entity: person,
    company,
    firstName: seed.firstName,
    lastName: seed.lastName,
    preferredName: null,
    jobTitle: seed.jobTitle,
    department: null,
    seniority: null,
    timezone: null,
    linkedInUrl: null,
    twitterUrl: null,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(contact)
  em.persist(
    em.create(CustomerPersonCompanyLink, {
      id: randomUUID(),
      ...scope,
      person,
      company,
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    }),
  )

  await em.flush()
  return { company, profile, contact, address, created: true }
}

function buildCustomerSnapshot({ company, profile, contact }: ParkOfPolandCustomer) {
  return snapshot({
    customer: {
      id: company.id,
      kind: company.kind,
      displayName: company.displayName,
      primaryEmail: company.primaryEmail ?? null,
      primaryPhone: company.primaryPhone ?? null,
      personProfile: null,
      companyProfile: profile
        ? {
            id: profile.id,
            legalName: profile.legalName ?? null,
            brandName: profile.brandName ?? null,
            domain: profile.domain ?? null,
            websiteUrl: profile.websiteUrl ?? null,
          }
        : null,
    },
    contact: contact
      ? {
          id: contact.id,
          firstName: contact.firstName ?? null,
          lastName: contact.lastName ?? null,
          email: contact.entity?.primaryEmail ?? null,
          phone: contact.entity?.primaryPhone ?? null,
          companyId: company.id,
        }
      : null,
  })
}

function buildAddressSnapshot(address: CustomerAddress) {
  return snapshot({
    companyName: address.companyName ?? null,
    name: address.name ?? null,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? null,
    city: address.city ?? null,
    region: address.region ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country ?? null,
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
  })
}

async function resolveOrderStatusEntry(em: EntityManager, scope: DemoSeedScope, value: string): Promise<DictionaryEntry | null> {
  const dictionary = await ensureSalesDictionary({ em, ...scope, kind: 'order-status' })
  return em.findOne(DictionaryEntry, { dictionary, ...scope, normalizedValue: normalizeDictionaryValue(value) })
}

/**
 * Seeds the Suntago order for the given customer, priced from the product seed (the price
 * at placement, six weeks ago) and totalled by core's sales calculation service so the
 * numbers match what the Sales UI would compute. Idempotent by order number.
 */
export async function seedSuntagoOrder(
  em: EntityManager,
  calculationService: SalesCalculationService,
  scope: DemoSeedScope,
  customer: ParkOfPolandCustomer,
): Promise<boolean> {
  const existing = await em.count(SalesOrder, { ...scope, orderNumber: SUNTAGO_ORDER.orderNumber })
  if (existing > 0) return false

  const handles = SUNTAGO_ORDER.lines.map((line) => line.handle)
  const products = await em.find(CatalogProduct, { ...scope, handle: { $in: handles }, deletedAt: null })
  const productsByHandle = new Map(products.map((product) => [product.handle, product]))
  const missing = handles.filter((handle) => !productsByHandle.has(handle))
  if (missing.length) {
    throw new Error(`Cannot seed order ${SUNTAGO_ORDER.orderNumber}: missing products ${missing.join(', ')}.`)
  }

  await seedSalesStatusDictionaries(em, scope)
  const statusEntry = await resolveOrderStatusEntry(em, scope, SUNTAGO_ORDER.status)

  const lineSnapshots = SUNTAGO_ORDER.lines.map((line) => {
    const product = productsByHandle.get(line.handle)!
    const seed = STAL_ZBIORNIKI_PRODUCTS.find((candidate) => candidate.handle === line.handle)!
    const unitPriceNet = seed.netPricePln
    const unitPriceGross = unitPriceNet * (1 + VAT_RATE / 100)
    return {
      id: randomUUID(),
      kind: 'product' as const,
      name: product.title,
      description: seed.subtitle,
      comment: null,
      quantity: line.quantity,
      quantityUnit: product.defaultUnit ?? 'pc',
      normalizedQuantity: line.quantity,
      normalizedUnit: product.defaultUnit ?? 'pc',
      uomSnapshot: null,
      currencyCode: SUNTAGO_ORDER.currencyCode,
      unitPriceNet,
      unitPriceGross,
      taxRate: VAT_RATE,
      discountPercent: null,
      productId: product.id,
      productVariantId: null,
      catalogSnapshot: snapshot({
        product: { id: product.id, title: product.title, handle: product.handle ?? null, sku: product.sku ?? null, thumbnailUrl: null },
        variant: null,
        price: { currencyCode: SUNTAGO_ORDER.currencyCode, unitPriceNet, unitPriceGross },
      }),
      metadata: null,
    }
  })

  const calculation = await calculationService.calculateDocumentTotals({
    documentKind: 'order',
    lines: lineSnapshots,
    adjustments: [],
    context: { ...scope, currencyCode: SUNTAGO_ORDER.currencyCode },
  })
  const totals = calculation.totals
  const grandTotalGross = totals.grandTotalGrossAmount

  const now = new Date()
  const placedAt = new Date(now.getTime() - SUNTAGO_ORDER.placedDaysAgo * 24 * 60 * 60 * 1000)
  const orderId = randomUUID()
  const order = em.create(SalesOrder, {
    id: orderId,
    ...scope,
    orderNumber: SUNTAGO_ORDER.orderNumber,
    statusEntryId: statusEntry?.id ?? null,
    status: SUNTAGO_ORDER.status,
    fulfillmentStatusEntryId: null,
    fulfillmentStatus: SUNTAGO_ORDER.fulfillmentStatus,
    paymentStatusEntryId: null,
    paymentStatus: SUNTAGO_ORDER.paymentStatus,
    customerEntityId: customer.company.id,
    customerContactId: customer.contact?.id ?? null,
    customerSnapshot: buildCustomerSnapshot(customer),
    billingAddressId: customer.address?.id ?? null,
    shippingAddressId: customer.address?.id ?? null,
    billingAddressSnapshot: customer.address ? buildAddressSnapshot(customer.address) : null,
    shippingAddressSnapshot: customer.address ? buildAddressSnapshot(customer.address) : null,
    currencyCode: SUNTAGO_ORDER.currencyCode,
    placedAt,
    expectedDeliveryAt: null,
    comments: SUNTAGO_ORDER.comments,
    internalNotes: null,
    metadata: { seed: 'demo_fixtures.stal-zbiorniki' },
    subtotalNetAmount: amount(totals.subtotalNetAmount),
    subtotalGrossAmount: amount(totals.subtotalGrossAmount),
    discountTotalAmount: amount(totals.discountTotalAmount),
    taxTotalAmount: amount(totals.taxTotalAmount),
    shippingNetAmount: amount(totals.shippingNetAmount ?? 0),
    shippingGrossAmount: amount(totals.shippingGrossAmount ?? 0),
    surchargeTotalAmount: amount(totals.surchargeTotalAmount ?? 0),
    grandTotalNetAmount: amount(totals.grandTotalNetAmount),
    grandTotalGrossAmount: amount(grandTotalGross),
    // Paid in full six weeks ago; only the fulfillment is still open.
    paidTotalAmount: amount(grandTotalGross),
    refundedTotalAmount: '0',
    outstandingAmount: '0',
    totalsSnapshot: snapshot({ ...totals, paidTotalAmount: grandTotalGross, outstandingAmount: 0 }),
    lineItemCount: lineSnapshots.length,
    createdAt: placedAt,
    updatedAt: placedAt,
  })
  em.persist(order)

  calculation.lines.forEach((result, idx) => {
    const source = lineSnapshots[idx]!
    em.persist(
      em.create(SalesOrderLine, {
        id: source.id,
        order,
        ...scope,
        lineNumber: idx + 1,
        kind: source.kind,
        name: source.name,
        description: source.description,
        comment: null,
        quantity: amount(source.quantity),
        quantityUnit: source.quantityUnit,
        normalizedQuantity: amount(source.quantity),
        normalizedUnit: source.normalizedUnit,
        uomSnapshot: null,
        reservedQuantity: '0',
        fulfilledQuantity: '0',
        invoicedQuantity: '0',
        returnedQuantity: '0',
        currencyCode: source.currencyCode,
        unitPriceNet: amount(source.unitPriceNet),
        unitPriceGross: amount(source.unitPriceGross),
        discountAmount: amount(result.discountAmount),
        discountPercent: '0',
        taxRate: amount(source.taxRate),
        taxAmount: amount(result.taxAmount),
        totalNetAmount: amount(result.netAmount),
        totalGrossAmount: amount(result.grossAmount),
        productId: source.productId,
        productVariantId: null,
        catalogSnapshot: source.catalogSnapshot,
        metadata: null,
        createdAt: placedAt,
        updatedAt: placedAt,
      }),
    )
  })

  if (customer.address) {
    for (const purpose of ['billing', 'shipping'] as const) {
      em.persist(
        em.create(SalesDocumentAddress, {
          id: randomUUID(),
          ...scope,
          documentId: orderId,
          documentKind: 'order',
          customerAddressId: customer.address.id,
          name: customer.address.name ?? null,
          companyName: customer.address.companyName ?? customer.company.displayName,
          purpose,
          addressLine1: customer.address.addressLine1,
          addressLine2: customer.address.addressLine2 ?? null,
          city: customer.address.city ?? null,
          region: customer.address.region ?? null,
          postalCode: customer.address.postalCode ?? null,
          country: customer.address.country ?? null,
          latitude: customer.address.latitude ?? null,
          longitude: customer.address.longitude ?? null,
          buildingNumber: null,
          flatNumber: null,
          order,
          quote: null,
          createdAt: placedAt,
          updatedAt: placedAt,
        }),
      )
    }
  }

  await em.flush()
  return true
}

/**
 * The whole Stal-Zbiorniki demo: catalog, then the Park of Poland customer, then its order.
 * Each step is idempotent on its own, so a partial earlier run is completed, never redone.
 */
export async function seedStalZbiornikiDemo(
  em: EntityManager,
  container: AppContainer,
  scope: DemoSeedScope,
): Promise<DemoSeedResult> {
  const products = await seedStalZbiorniki(em, scope)
  const customer = await seedParkOfPoland(em, scope)
  const calculationService = container.resolve<SalesCalculationService>('salesCalculationService')
  const order = await seedSuntagoOrder(em, calculationService, scope, customer)
  return { products, customer: customer.created, order }
}

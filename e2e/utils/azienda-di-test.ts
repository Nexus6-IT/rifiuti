import type { Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { devLoginTokens } from './api-client'
import { isProductionTarget } from './env'
import { partitaIvaCasualeValida } from './partita-iva'
import { conPrefissoUnico } from './run-id'

/**
 * Azienda di test dedicata, per gli spec che creano dati con spazio dei codici limitato
 * (registri IVA: codici fino a 99) o con stato per azienda (es. «fatturazione da»).
 *
 * Perche': l'azienda seed «Azienda Test SRL» e' condivisa da tutti gli spec e, nel database
 * locale che dura nel tempo, esaurisce i 99 codici dei registri IVA (e lo stato di uno spec
 * disturba gli altri). Ogni spec che ne ha bisogno crea in `beforeAll` la PROPRIA azienda, con
 * tre utenti ADMIN / OPERATOR / VIEWER e i ruoli di sistema, e lavora solo li'.
 *
 * Pulizia: l'azienda, i suoi utenti e i dati che non si cancellano (movimenti del registro,
 * catena di hash) RESTANO nel database di test, riconoscibili dal prefisso della run nella
 * ragione sociale. Nulla si cancella dal database: i dati creati dentro l'azienda si ripuliscono
 * per id esatti con il teardown dello spec che li ha creati.
 *
 * Funziona solo con un database locale (`DATABASE_URL` su localhost/127.0.0.1) e mai contro un
 * target di produzione: in quel caso `clientDbLocale()` restituisce null e lo spec va saltato.
 */

export type RuoloAzienda = 'admin' | 'operator' | 'viewer'

export interface AziendaDiTest {
  tenantId: string
  email: Record<RuoloAzienda, string>
  /** Id degli utenti creati (admin, operator, viewer), per la pulizia per id esatti. */
  userIds: string[]
}

export type PianoAzienda = 'TRIAL' | 'PROFESSIONAL' | 'ENTERPRISE'

const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789'

function suffissoCasuale(n: number): string {
  let c = ''
  while (c.length < n) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  return c
}

/** Client Prisma verso il database locale, o null se non c'e' (DATABASE_URL assente o non locale). */
export function clientDbLocale(): PrismaClient | null {
  const url = process.env.DATABASE_URL?.trim()
  if (!url || isProductionTarget()) return null
  try {
    const host = new URL(url).hostname
    if (host !== 'localhost' && host !== '127.0.0.1') return null
  } catch {
    return null
  }
  return new PrismaClient({ datasources: { db: { url } } })
}

/**
 * Crea l'azienda di test con i tre utenti e i ruoli di sistema. `etichetta` entra nella ragione
 * sociale (insieme al prefisso della run) e nelle email degli utenti.
 */
export async function creaAziendaDiTest(
  client: PrismaClient,
  etichetta: string,
  /** Piano dell'azienda (default PROFESSIONAL, come l'azienda seed della CI). */
  piano: PianoAzienda = 'PROFESSIONAL'
): Promise<AziendaDiTest> {
  const unico = `${Date.now().toString(36)}${suffissoCasuale(4)}`
  const sigla = etichetta.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const tenant = await client.tenant.create({
    data: {
      partitaIva: partitaIvaCasualeValida(),
      ragioneSociale: conPrefissoUnico(`Azienda ${etichetta}`),
      address: 'Via delle Prove 1',
      city: 'Milano',
      province: 'MI',
      postalCode: '20100',
      country: 'IT',
      subscriptionTier: piano,
      subscriptionStatus: 'ACTIVE',
      firLimitPerMonth: 1000,
      userLimitTotal: 10,
    },
  })
  const utente = async (ruolo: 'ADMIN' | 'OPERATOR' | 'VIEWER', n: number) => {
    const email = `e2e-${sigla}-${unico}-${ruolo.toLowerCase()}@test.invalid`
    const u = await client.user.create({
      data: {
        tenantId: tenant.id,
        keycloakId: `e2e-${sigla}-${unico}-${ruolo.toLowerCase()}`,
        fiscalCode: `E2E${n}${unico.toUpperCase()}`.slice(0, 16).padEnd(16, 'X'),
        firstName: ruolo,
        lastName: etichetta.slice(0, 40),
        email,
        role: ruolo,
      },
    })
    return { u, email }
  }
  const admin = await utente('ADMIN', 1)
  const operator = await utente('OPERATOR', 2)
  const viewer = await utente('VIEWER', 3)

  await client.$queryRawUnsafe(
    `SELECT * FROM seed_default_roles_for_tenant($1::uuid, $2::uuid)`,
    tenant.id,
    admin.u.id
  )
  for (const [{ u }, nome] of [
    [admin, 'ADMIN'],
    [operator, 'OPERATOR'],
    [viewer, 'VIEWER'],
  ] as const) {
    const ruolo = await client.role.findFirst({ where: { tenantId: tenant.id, name: nome } })
    if (!ruolo) throw new Error(`ruolo ${nome} non creato per l'azienda di test`)
    await client.userRoleAssignment.create({
      data: {
        userId: u.id,
        roleId: ruolo.id,
        tenantId: tenant.id,
        assignedBy: admin.u.id,
        assignedAt: new Date(),
      },
    })
  }
  return {
    tenantId: tenant.id,
    email: { admin: admin.email, operator: operator.email, viewer: viewer.email },
    userIds: [admin.u.id, operator.u.id, viewer.u.id],
  }
}

/**
 * Crea un utente SUPER_ADMIN dentro l'azienda di test indicata (`users.tenant_id` e' NOT NULL,
 * quindi un SUPER_ADMIN ha sempre un'azienda di casa: senza `X-Tenant-ID` valgono i suoi moduli).
 * Restituisce id ed email; l'id va passato a `eliminaAziendaDiTest` per la pulizia.
 */
export async function creaSuperAdminDiTest(
  client: PrismaClient,
  tenantId: string,
  etichetta: string
): Promise<{ id: string; email: string }> {
  const unico = `${Date.now().toString(36)}${suffissoCasuale(4)}`
  const sigla = etichetta.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const email = `e2e-${sigla}-${unico}-superadmin@test.invalid`
  const u = await client.user.create({
    data: {
      tenantId,
      keycloakId: `e2e-${sigla}-${unico}-superadmin`,
      fiscalCode: `E2E9${unico.toUpperCase()}`.slice(0, 16).padEnd(16, 'X'),
      firstName: 'SUPER_ADMIN',
      lastName: etichetta.slice(0, 40),
      email,
      role: 'SUPER_ADMIN',
    },
  })
  return { id: u.id, email }
}

/**
 * Cancella, per id ESATTI, utenti e azienda creati da `creaAziendaDiTest` (e gli eventuali altri
 * utenti passati in `altriUtenti`). Mai per prefisso. Ritorna i problemi incontrati (un'azienda
 * con dati immutabili, per esempio movimenti del registro, non si cancella: resta nel database
 * di test come per gli altri spec). Le aziende senza dati immutabili spariscono.
 */
export async function eliminaAziendaDiTest(
  client: PrismaClient,
  azienda: AziendaDiTest,
  altriUtenti: string[] = []
): Promise<string[]> {
  const problemi: string[] = []
  const utenti = [...azienda.userIds, ...altriUtenti]
  const passo = async (nome: string, f: () => Promise<unknown>) => {
    try {
      await f()
    } catch (e) {
      problemi.push(`${nome}: ${(e as Error).message.split('\n').pop()}`)
    }
  }
  await passo('assegnazioni ruolo', () =>
    client.userRoleAssignment.deleteMany({ where: { tenantId: azienda.tenantId } })
  )
  await passo('ruoli', () => client.role.deleteMany({ where: { tenantId: azienda.tenantId } }))
  await passo('utenti', () => client.user.deleteMany({ where: { id: { in: utenti } } }))
  await passo('azienda', () => client.tenant.deleteMany({ where: { id: azienda.tenantId } }))
  return problemi
}

/** Token API di un utente dell'azienda di test (dev-login: un nuovo accesso invalida il precedente). */
export async function tokenAzienda(azienda: AziendaDiTest, ruolo: RuoloAzienda): Promise<string> {
  return (await devLoginTokens(azienda.email[ruolo])).accessToken
}

/**
 * Accesso alla UI come utente dell'azienda di test (stesso meccanismo del dev-login di
 * `fixtures/auth.ts`: token in localStorage, poi `/dashboard`), SENZA scrivere lo storage state
 * per ruolo, che resta quello dell'azienda seed e non va sovrascritto.
 */
export async function accediUiComeAzienda(
  page: Page,
  azienda: AziendaDiTest,
  ruolo: RuoloAzienda
): Promise<void> {
  const { accessToken, refreshToken } = await devLoginTokens(azienda.email[ruolo])
  await page.goto('/login')
  await page.evaluate(
    ({ a, r }) => {
      localStorage.setItem('accessToken', a)
      localStorage.setItem('refreshToken', r)
    },
    { a: accessToken, r: refreshToken }
  )
  await page.goto('/dashboard')
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

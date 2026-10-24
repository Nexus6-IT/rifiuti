/**
 * RuoloEffettivoService — il ruolo che conta è quello nell'azienda selezionata (A-C-06).
 *
 * Il ruolo del token (`User.role`) è il ruolo nell'azienda primaria dell'utente. Un
 * consulente ADMIN del proprio studio, associato a un cliente con un ruolo di sola
 * consultazione, nell'azienda del cliente non è un amministratore.
 */

import { RuoloEffettivoService } from './ruolo-effettivo.service'
import { MembershipService } from './membership.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'

const UTENTE = 'utente-uuid'
const PRIMARIO = 'tenant-primario'
const POSSEDUTO = 'tenant-posseduto'
const CLIENTE = 'tenant-cliente'
const FIGLIA = 'tenant-figlia-del-cliente'
const FIGLIA_PRIMARIO = 'tenant-figlia-del-primario'
const ESTRANEO = 'tenant-estraneo'

interface TenantFinto {
  id: string
  ownerUserId?: string | null
  parentTenantId?: string | null
}
interface AssociazioneFinta {
  consultantUserId: string
  tenantId: string
  isActive: boolean
  expiresAt: Date | null
  role: { name: string }
}

const IERI = new Date(Date.now() - 24 * 60 * 60 * 1000)
const DOMANI = new Date(Date.now() + 24 * 60 * 60 * 1000)

/**
 * Prisma finto che applica davvero i filtri `where` usati dalle due traversate
 * (`checkAccess` e `ruoloEffettivo`), così i test verificano le query e non un mock
 * compiacente, e la parità fra le due si misura sugli stessi dati.
 */
function makePrisma(tenants: TenantFinto[], associazioni: AssociazioneFinta[]) {
  const soddisfaScadenza = (a: AssociazioneFinta, or: any[] | undefined): boolean => {
    if (!or) return true
    return or.some(clausola => {
      if ('expiresAt' in clausola && clausola.expiresAt === null) return a.expiresAt === null
      if (clausola.expiresAt?.gt instanceof Date) {
        return a.expiresAt !== null && a.expiresAt > clausola.expiresAt.gt
      }
      return false
    })
  }
  const trovaAssociazione = (where: any) =>
    associazioni.find(
      a =>
        a.consultantUserId === where.consultantUserId &&
        (where.tenantId === undefined || a.tenantId === where.tenantId) &&
        (where.isActive === undefined || a.isActive === where.isActive) &&
        soddisfaScadenza(a, where.OR)
    ) ?? null

  return {
    tenant: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          tenants.find(
            t =>
              t.id === where.id &&
              (where.ownerUserId === undefined || t.ownerUserId === where.ownerUserId)
          ) ?? null
        )
      ),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(tenants.find(t => t.id === where.id) ?? null)
      ),
    },
    consultantTenantAssociation: {
      findFirst: jest.fn(({ where }: any) => {
        const a = trovaAssociazione(where)
        return Promise.resolve(a ? { id: 'assoc', role: a.role } : null)
      }),
    },
  } as any
}

const TENANTS: TenantFinto[] = [
  { id: PRIMARIO },
  { id: POSSEDUTO, ownerUserId: UTENTE },
  { id: CLIENTE },
  { id: FIGLIA, parentTenantId: CLIENTE },
  { id: FIGLIA_PRIMARIO, parentTenantId: PRIMARIO },
  { id: ESTRANEO },
]

const associazione = (
  nomeRuolo: string,
  extra: Partial<AssociazioneFinta> = {}
): AssociazioneFinta => ({
  consultantUserId: UTENTE,
  tenantId: CLIENTE,
  isActive: true,
  expiresAt: null,
  role: { name: nomeRuolo },
  ...extra,
})

const utente = (role: string) => ({ id: UTENTE, role, tenantId: PRIMARIO })

describe('RuoloEffettivoService.ruoloEffettivo', () => {
  it('SUPER_ADMIN vale SUPER_ADMIN in qualunque azienda, anche senza associazione', async () => {
    const prisma = makePrisma(TENANTS, [])
    const service = new RuoloEffettivoService(prisma)
    await expect(service.ruoloEffettivo(utente('SUPER_ADMIN'), ESTRANEO)).resolves.toBe(
      'SUPER_ADMIN'
    )
  })

  it("nel tenant primario vale il ruolo globale dell'utente", async () => {
    const service = new RuoloEffettivoService(makePrisma(TENANTS, []))
    await expect(service.ruoloEffettivo(utente('ADMIN'), PRIMARIO)).resolves.toBe('ADMIN')
    await expect(service.ruoloEffettivo(utente('OPERATOR'), PRIMARIO)).resolves.toBe('OPERATOR')
  })

  it('in un tenant di proprietà vale il ruolo globale', async () => {
    const service = new RuoloEffettivoService(makePrisma(TENANTS, []))
    await expect(service.ruoloEffettivo(utente('ADMIN'), POSSEDUTO)).resolves.toBe('ADMIN')
  })

  it('consulente ADMIN del proprio studio associato come CONSULTANT vale VIEWER', async () => {
    const service = new RuoloEffettivoService(makePrisma(TENANTS, [associazione('CONSULTANT')]))
    await expect(service.ruoloEffettivo(utente('ADMIN'), CLIENTE)).resolves.toBe('VIEWER')
  })

  it('associazione ADMIN vale ADMIN anche per un utente globale VIEWER', async () => {
    const service = new RuoloEffettivoService(makePrisma(TENANTS, [associazione('ADMIN')]))
    await expect(service.ruoloEffettivo(utente('VIEWER'), CLIENTE)).resolves.toBe('ADMIN')
  })

  it('associazione OPERATOR vale OPERATOR; COMPLIANCE_OFFICER e ruoli personalizzati VIEWER', async () => {
    for (const [nome, atteso] of [
      ['OPERATOR', 'OPERATOR'],
      ['COMPLIANCE_OFFICER', 'VIEWER'],
      ['Ruolo personalizzato', 'VIEWER'],
    ] as const) {
      const service = new RuoloEffettivoService(makePrisma(TENANTS, [associazione(nome)]))
      const ruolo = await service.ruoloEffettivo(utente('ADMIN'), CLIENTE)
      expect({ nome, ruolo }).toEqual({ nome, ruolo: atteso })
    }
  })

  it("figlia di un'azienda associata: ruolo della madre", async () => {
    const service = new RuoloEffettivoService(makePrisma(TENANTS, [associazione('OPERATOR')]))
    await expect(service.ruoloEffettivo(utente('VIEWER'), FIGLIA)).resolves.toBe('OPERATOR')
  })

  it('figlia del tenant primario: ruolo globale', async () => {
    const service = new RuoloEffettivoService(makePrisma(TENANTS, []))
    await expect(service.ruoloEffettivo(utente('ADMIN'), FIGLIA_PRIMARIO)).resolves.toBe('ADMIN')
  })

  it('azienda senza alcun legame: VIEWER, anche per un ADMIN globale (fail-closed)', async () => {
    const service = new RuoloEffettivoService(makePrisma(TENANTS, [associazione('ADMIN')]))
    await expect(service.ruoloEffettivo(utente('ADMIN'), ESTRANEO)).resolves.toBe('VIEWER')
  })

  it('associazione ADMIN scaduta o disattivata: VIEWER', async () => {
    for (const extra of [{ expiresAt: IERI }, { isActive: false }]) {
      const service = new RuoloEffettivoService(makePrisma(TENANTS, [associazione('ADMIN', extra)]))
      await expect(service.ruoloEffettivo(utente('VIEWER'), CLIENTE)).resolves.toBe('VIEWER')
    }
    const valida = new RuoloEffettivoService(
      makePrisma(TENANTS, [associazione('ADMIN', { expiresAt: DOMANI })])
    )
    await expect(valida.ruoloEffettivo(utente('VIEWER'), CLIENTE)).resolves.toBe('ADMIN')
  })

  it("un ruolo globale fuori dall'elenco applicativo vale VIEWER", async () => {
    const service = new RuoloEffettivoService(makePrisma(TENANTS, []))
    await expect(service.ruoloEffettivo(utente('DRIVER'), PRIMARIO)).resolves.toBe('VIEWER')
  })
})

describe('RuoloEffettivoService — parità con MembershipService.checkAccess (F29)', () => {
  const jwtTokens = { generateTokenPair: jest.fn() } as any
  const creaMembership = (prisma: any, jwt: any) => new MembershipService(prisma, prisma, jwt)

  // Per ognuna delle quattro sorgenti di accesso, e per l'assenza di accesso, le due
  // traversate devono essere d'accordo: dove checkAccess concede, ruoloEffettivo dà il ruolo
  // della sorgente (qui ADMIN), mai il fallback VIEWER; dove nega, VIEWER.
  const casi: Array<{ sorgente: string; tenant: string; accesso: boolean }> = [
    { sorgente: 'tenant primario', tenant: PRIMARIO, accesso: true },
    { sorgente: 'tenant di proprietà', tenant: POSSEDUTO, accesso: true },
    { sorgente: 'associazione consulente valida', tenant: CLIENTE, accesso: true },
    { sorgente: "figlia di un'azienda associata", tenant: FIGLIA, accesso: true },
    { sorgente: 'figlia del tenant primario', tenant: FIGLIA_PRIMARIO, accesso: true },
    { sorgente: 'nessun legame', tenant: ESTRANEO, accesso: false },
  ]

  it.each(casi)('$sorgente', async ({ tenant, accesso }) => {
    const prisma = makePrisma(TENANTS, [associazione('ADMIN')])
    const membership = creaMembership(prisma, jwtTokens)
    const ruoli = new RuoloEffettivoService(prisma)

    await expect(membership.checkAccess(UTENTE, tenant, PRIMARIO)).resolves.toBe(accesso)
    await expect(ruoli.ruoloEffettivo(utente('ADMIN'), tenant)).resolves.toBe(
      accesso ? 'ADMIN' : 'VIEWER'
    )
    // accesso(): null esattamente dove checkAccess nega (lo usa il refresh del token)
    await expect(ruoli.accesso(utente('ADMIN'), tenant)).resolves.toBe(accesso ? 'ADMIN' : null)
  })

  it('associazione scaduta: checkAccess nega, il ruolo è VIEWER e accesso() è null', async () => {
    const prisma = makePrisma(TENANTS, [associazione('ADMIN', { expiresAt: IERI })])
    const membership = creaMembership(prisma, jwtTokens)
    const ruoli = new RuoloEffettivoService(prisma)

    await expect(membership.checkAccess(UTENTE, CLIENTE, PRIMARIO)).resolves.toBe(false)
    await expect(ruoli.ruoloEffettivo(utente('ADMIN'), CLIENTE)).resolves.toBe('VIEWER')
    await expect(ruoli.accesso(utente('ADMIN'), CLIENTE)).resolves.toBeNull()
  })

  it('accesso(): associazione di sola consultazione dà VIEWER, non null', async () => {
    const ruoli = new RuoloEffettivoService(makePrisma(TENANTS, [associazione('CONSULTANT')]))
    await expect(ruoli.accesso(utente('ADMIN'), CLIENTE)).resolves.toBe('VIEWER')
  })
})

describe('RuoloEffettivoService — client di sistema', () => {
  it('legge aziende e associazioni dal client di sistema (azienda madre e target non sono quelle del contesto)', () => {
    // La dipendenza dichiarata e' il client di sistema: nessuna lettura passa dal client normale.
    expect(Reflect.getMetadata('design:paramtypes', RuoloEffettivoService)).toEqual([
      PrismaSistemaService,
    ])
  })
})

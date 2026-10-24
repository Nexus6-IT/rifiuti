/**
 * Creazione di un'azienda figlia dentro un gruppo.
 *
 * Tre regole, tutte fail-closed:
 *  1. gerarchia a un solo livello: non si crea una figlia sotto una figlia;
 *  2. quota: se la madre ha `aziendeLimit`, comanda quello;
 *  3. nessuna eredita' RENTRI: la figlia nasce senza credenziale.
 *
 * NB: la firma reale di `TenantService.create` e' `create(currentUser, dto)`
 * (v. tenant.controller.ts e le altre chiamate nel service stesso), quindi le
 * chiamate qui sotto passano `adminCorrente` come primo argomento e il dto
 * come secondo — l'ordine (dto, currentUser) del brief originale non
 * corrisponde alla firma esistente e avrebbe fatto fallire questi test con un
 * ConflictException spurio (dto.partitaIva letto da un oggetto sbagliato).
 *
 * NB2: il mock di `tenant.findUnique` risponde per `where.id`. La verifica di
 * unicita' della partitaIva (gia' presente in `create`, invariata da questo
 * task) interroga con `where: { partitaIva }` — senza `id` — quindi deve
 * ricevere `null` (nessun conflitto), non un tenant a caso: il fallback e'
 * esplicitamente `null`, i due rami "madre"/"figlia esistente" scattano solo
 * sull'id atteso. Lo stesso fallback `null` copre anche il caso di
 * `parentTenantId` che punta a un tenant inesistente.
 *
 * Fix round 1: `TenantService.create` ora dipende anche da
 * `MembershipService` (delega di `checkAccess` per verificare che l'ADMIN
 * abbia titolo sulla madre indicata). Qui si mocka solo l'interfaccia usata
 * (`checkAccess`), non l'implementazione reale: la logica delle quattro
 * sorgenti di membership e' gia' coperta da `membership.service.spec.ts`.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { TenantService } from './tenant.service'

const MADRE = 'tenant-madre-uuid'
const FIGLIA_ESISTENTE = 'tenant-figlia-uuid'
const MADRE_ALTRUI = 'tenant-madre-altrui-uuid'
const NON_ESISTENTE = 'tenant-inesistente-uuid'
const ADMIN = 'utente-admin-uuid'

const dtoBase = {
  partitaIva: '12345678901',
  ragioneSociale: 'Nuova Figlia Srl',
  address: 'Via Roma 1',
  city: 'Roma',
  province: 'RM',
  postalCode: '00100',
}

function makeService(opts: {
  aziendeLimit: number | null
  figlieEsistenti: number
  accessoMadre?: boolean
}) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(({ where }: any) => {
        if (where.id === MADRE) {
          return Promise.resolve({
            id: MADRE,
            parentTenantId: null,
            aziendeLimit: opts.aziendeLimit,
          })
        }
        if (where.id === FIGLIA_ESISTENTE) {
          return Promise.resolve({
            id: FIGLIA_ESISTENTE,
            parentTenantId: MADRE,
            aziendeLimit: null,
          })
        }
        if (where.id === MADRE_ALTRUI) {
          return Promise.resolve({ id: MADRE_ALTRUI, parentTenantId: null, aziendeLimit: null })
        }
        // Altre chiamate (es. verifica unicita' partitaIva su `where.partitaIva`,
        // invariata da questo task, o `parentTenantId` inesistente): nessun
        // conflitto / nessuna madre trovata.
        return Promise.resolve(null)
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(opts.figlieEsistenti),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'nuovo-uuid', ...data })),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ companyLimit: 99 }) },
    role: { findUnique: jest.fn().mockResolvedValue({ id: 'ruolo-admin' }) },
    consultantTenantAssociation: { upsert: jest.fn().mockResolvedValue({}) },
    rentriCredential: { findUnique: jest.fn().mockResolvedValue(null) },
  }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  // Default: accesso consentito, cosi' i test preesistenti (che non
  // riguardano l'accesso alla madre) restano validi senza modifiche.
  const membership: any = {
    checkAccess: jest.fn().mockResolvedValue(opts.accessoMadre ?? true),
  }
  return { prisma, membership, service: new TenantService(prisma, prisma, logger, membership) }
}

const adminCorrente = { id: ADMIN, role: 'ADMIN', tenantId: MADRE } as any
const superAdminCorrente = {
  id: 'utente-super-admin-uuid',
  role: 'SUPER_ADMIN',
  tenantId: MADRE,
} as any

describe('TenantService — creazione azienda figlia', () => {
  it('rifiuta una figlia sotto una figlia (gerarchia a un solo livello)', async () => {
    const { service } = makeService({ aziendeLimit: 5, figlieEsistenti: 0 })

    await expect(
      service.create(adminCorrente, { ...dtoBase, parentTenantId: FIGLIA_ESISTENTE } as any)
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rifiuta la creazione oltre aziendeLimit della madre', async () => {
    const { service } = makeService({ aziendeLimit: 3, figlieEsistenti: 3 })

    await expect(
      service.create(adminCorrente, { ...dtoBase, parentTenantId: MADRE } as any)
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('crea la figlia col legame alla madre quando la quota lo consente', async () => {
    const { service, prisma } = makeService({ aziendeLimit: 5, figlieEsistenti: 2 })

    await service.create(adminCorrente, { ...dtoBase, parentTenantId: MADRE } as any)

    // Prisma vuole la relazione in forma `connect`, non la FK scalare: e' la
    // stessa forma gia' usata per `tenant`/`producerUser` altrove nel progetto.
    const [{ data }] = prisma.tenant.create.mock.calls[0]
    expect(data.madre.connect.id).toBe(MADRE)
  })

  it('la figlia nasce senza configurazione RENTRI ereditata dalla madre', async () => {
    const { service, prisma } = makeService({ aziendeLimit: 5, figlieEsistenti: 0 })

    await service.create(adminCorrente, { ...dtoBase, parentTenantId: MADRE } as any)

    // Nessuna lettura della credenziale della madre e nessuna scrittura per la figlia:
    // certificato e iscrizioni appartengono a quella persona giuridica.
    expect(prisma.rentriCredential.findUnique).not.toHaveBeenCalled()
    const [{ data }] = prisma.tenant.create.mock.calls[0]
    expect(data).not.toHaveProperty('rentriCredential')
  })

  it('rifiuta un ADMIN che indica una madre a cui non ha accesso, senza scrivere nulla', async () => {
    const { service, prisma, membership } = makeService({
      aziendeLimit: null,
      figlieEsistenti: 0,
      accessoMadre: false,
    })

    await expect(
      service.create(adminCorrente, { ...dtoBase, parentTenantId: MADRE_ALTRUI } as any)
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(membership.checkAccess).toHaveBeenCalledWith(ADMIN, MADRE_ALTRUI, MADRE)
    expect(prisma.tenant.create).not.toHaveBeenCalled()
  })

  it('un ADMIN che indica la propria madre crea la figlia come gia previsto', async () => {
    const { service, prisma, membership } = makeService({
      aziendeLimit: 5,
      figlieEsistenti: 0,
      accessoMadre: true,
    })

    await service.create(adminCorrente, { ...dtoBase, parentTenantId: MADRE } as any)

    expect(membership.checkAccess).toHaveBeenCalledWith(ADMIN, MADRE, MADRE)
    const [{ data }] = prisma.tenant.create.mock.calls[0]
    expect(data.madre.connect.id).toBe(MADRE)
  })

  it('un SUPER_ADMIN puo agganciare qualunque madre, senza passare da checkAccess', async () => {
    const { service, prisma, membership } = makeService({
      aziendeLimit: null,
      figlieEsistenti: 0,
      accessoMadre: false, // anche se l'accesso sarebbe negato, il SUPER_ADMIN e' esente
    })

    await service.create(superAdminCorrente, { ...dtoBase, parentTenantId: MADRE_ALTRUI } as any)

    expect(membership.checkAccess).not.toHaveBeenCalled()
    const [{ data }] = prisma.tenant.create.mock.calls[0]
    expect(data.madre.connect.id).toBe(MADRE_ALTRUI)
  })

  it('rifiuta un parentTenantId che punta a un tenant inesistente', async () => {
    const { service, prisma } = makeService({ aziendeLimit: 5, figlieEsistenti: 0 })

    await expect(
      service.create(adminCorrente, { ...dtoBase, parentTenantId: NON_ESISTENTE } as any)
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(prisma.tenant.create).not.toHaveBeenCalled()
  })

  it('aziendeLimit a zero conta come limite valorizzato: rifiuta anche con zero figlie esistenti', async () => {
    const { service, prisma } = makeService({ aziendeLimit: 0, figlieEsistenti: 0 })

    await expect(
      service.create(adminCorrente, { ...dtoBase, parentTenantId: MADRE } as any)
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(prisma.tenant.create).not.toHaveBeenCalled()
  })
})

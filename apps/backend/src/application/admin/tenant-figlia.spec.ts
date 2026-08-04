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
 * sull'id atteso.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { TenantService } from './tenant.service'

const MADRE = 'tenant-madre-uuid'
const FIGLIA_ESISTENTE = 'tenant-figlia-uuid'
const ADMIN = 'utente-admin-uuid'

const dtoBase = {
  partitaIva: '12345678901',
  ragioneSociale: 'Nuova Figlia Srl',
  address: 'Via Roma 1',
  city: 'Roma',
  province: 'RM',
  postalCode: '00100',
}

function makeService(opts: { aziendeLimit: number | null; figlieEsistenti: number }) {
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
        // Altre chiamate (es. verifica unicita' partitaIva su `where.partitaIva`,
        // invariata da questo task): nessun conflitto.
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
  return { prisma, service: new TenantService(prisma, logger) }
}

const adminCorrente = { id: ADMIN, role: 'ADMIN', tenantId: MADRE } as any

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
})

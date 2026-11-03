import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { RentriScortaRepository } from './rentri-scorta.repository'

/**
 * Consumo concorrente della scorta, contro un **Postgres reale**.
 *
 * PERCHE' QUESTO TEST ESISTE, oltre a quello con il doppio in memoria.
 * L'atomicita' di `consumaProssimoDisponibile` era gia' provata con un finto
 * che riproduce la semantica di Postgres. Quel test dimostra l'ALGORITMO —
 * scegliere e prenotare senza cedere il controllo nel mezzo — ma non l'SQL:
 * se `FOR UPDATE SKIP LOCKED` fosse scritto male, mancasse, o la sotto-query
 * selezionasse la riga sbagliata, il finto continuerebbe a passare. Qui il
 * lock lo prende il database vero.
 *
 * E' lo stesso motivo per cui in questo progetto esiste
 * `fir-prisma.repository.postgres.spec.ts`: un controllo applicativo si
 * aggira, un vincolo del database no.
 *
 * Gira solo nel gate di integrazione (job «Test integrazione (PostgreSQL
 * reale)»), dove un Postgres e' in ascolto.
 */
describe('RentriScortaRepository — consumo concorrente su Postgres reale', () => {
  let prisma: PrismaClient
  let repo: RentriScortaRepository
  let tenantId: string

  const NUM_ISCR_SITO = 'OP9999ZZZ999999-ZZ9999'
  const CODICE_BLOCCO = 'BLK-CONCORRENZA'

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    repo = new RentriScortaRepository(prisma as never)

    const tenant = await prisma.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Scorta Concorrenza Test SRL',
        country: 'IT',
      },
    })
    tenantId = tenant.id
  })

  afterAll(async () => {
    // Con un id `undefined` (beforeAll fallito) Prisma toglie il filtro e deleteMany
    // cancellerebbe l'intera tabella: senza id non si cancella nulla.
    if (tenantId) {
      await prisma.rentriNumeroVidimato.deleteMany({ where: { tenantId } })
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
    }
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    if (tenantId) await prisma.rentriNumeroVidimato.deleteMany({ where: { tenantId } })
  })

  /** Popola la scorta con `quantita` numeri DISPONIBILI consecutivi. */
  async function popolaScorta(quantita: number): Promise<void> {
    for (let progressivo = 1; progressivo <= quantita; progressivo++) {
      await repo.inserisciDisponibile(tenantId, {
        numIscrSito: NUM_ISCR_SITO,
        codiceBlocco: CODICE_BLOCCO,
        progressivo,
        numeroFir: `TSTB${String(progressivo).padStart(5, '0')}XY`,
        qrCodeBytes: Buffer.from(`qr-${progressivo}`).toString('base64'),
        dataVidimazione: new Date(),
      })
    }
  }

  it('due consumi simultanei non ricevono mai lo stesso numero', async () => {
    await popolaScorta(2)

    const [primo, secondo] = await Promise.all([
      repo.consumaProssimoDisponibile(tenantId, {
        numIscrSito: NUM_ISCR_SITO,
        firId: randomUUID(),
      }),
      repo.consumaProssimoDisponibile(tenantId, {
        numIscrSito: NUM_ISCR_SITO,
        firId: randomUUID(),
      }),
    ])

    expect(primo).not.toBeNull()
    expect(secondo).not.toBeNull()
    expect(primo?.numeroFir).not.toBe(secondo?.numeroFir)
    expect(primo?.progressivo).not.toBe(secondo?.progressivo)
  })

  it('con dieci consumi simultanei su otto numeri, nessun numero esce due volte', async () => {
    await popolaScorta(8)

    const esiti = await Promise.all(
      Array.from({ length: 10 }, () =>
        repo.consumaProssimoDisponibile(tenantId, {
          numIscrSito: NUM_ISCR_SITO,
          firId: randomUUID(),
        })
      )
    )

    const assegnati = esiti.filter(e => e !== null).map(e => e!.numeroFir)
    // Otto numeri disponibili, dieci richieste: otto servite, due a vuoto —
    // e soprattutto nessun duplicato.
    expect(assegnati).toHaveLength(8)
    expect(new Set(assegnati).size).toBe(8)
  })

  it('a scorta esaurita restituisce null invece di riassegnare un numero gia usato', async () => {
    await popolaScorta(1)

    await repo.consumaProssimoDisponibile(tenantId, {
      numIscrSito: NUM_ISCR_SITO,
      firId: randomUUID(),
    })
    const secondo = await repo.consumaProssimoDisponibile(tenantId, {
      numIscrSito: NUM_ISCR_SITO,
      firId: randomUUID(),
    })

    expect(secondo).toBeNull()
  })
})

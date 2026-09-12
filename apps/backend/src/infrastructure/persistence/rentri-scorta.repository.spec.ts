import { RentriNumeroVidimatoStato } from '@prisma/client'
import { RentriScortaRepository } from './rentri-scorta.repository'
import { PrismaService } from './prisma.service'

/**
 * Fake in-memory del solo statement usato da `consumaProssimoDisponibile`:
 * `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ...`.
 *
 * Non è un mock "a scatola nera" che ritorna un valore fisso: modella
 * fedelmente la garanzia che PostgreSQL dà per QUESTO idioma — scelta della
 * riga e marcatura USATO in un solo statement, senza alcun punto in cui
 * un'altra query concorrente possa infilarsi fra le due. Per questo il
 * metodo `eseguiConsumo` non ha NESSUN `await` fra "trova la riga candidata"
 * e "marcala USATO": è esattamente il motivo per cui il pattern reale è
 * atomico (un solo round-trip al DB, non due). L'`await` prima del ritorno
 * simula solo la latenza di rete del round-trip, DOPO che la riga è già
 * stata riservata — e prova che due chiamate concorrenti in quella finestra
 * non riescono comunque a rubarsi la stessa riga.
 *
 * Ordine posizionale dei parametri interpolati nella tagged template di
 * `$queryRaw` (rispecchia l'ordine di comparsa nel testo SQL del
 * repository, accoppiato di proposito): firId, tenantId, numIscrSito,
 * numIscrSito, codiceBlocco, codiceBlocco.
 */
class FakeScortaDb {
  rows: Array<{
    id: string
    tenant_id: string
    num_iscr_sito: string
    codice_blocco: string
    progressivo: number
    numero_fir: string
    qr_code_bytes: string
    stato: RentriNumeroVidimatoStato
    fir_id: string | null
    data_vidimazione: Date
    data_consumo: Date | null
  }> = []

  /** Righe attualmente "in lavorazione" da uno statement in corso (equivalente del lock di riga). */
  private inLavorazione = new Set<string>()

  seed(righe: (typeof this.rows)[number][]): void {
    this.rows = righe
  }

  async queryRaw(_strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
    const [firId, tenantId, numIscrSitoA, , codiceBloccoA] = values as [
      string,
      string,
      string | null,
      string | null,
      string | null,
      string | null,
    ]

    // "SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1" — sincrono, nessun await:
    // è ciò che rende impossibile a una seconda chiamata scegliere la stessa riga.
    const candidata = this.rows
      .filter(
        r =>
          r.tenant_id === tenantId &&
          r.stato === RentriNumeroVidimatoStato.DISPONIBILE &&
          !this.inLavorazione.has(r.id) &&
          (numIscrSitoA === null || r.num_iscr_sito === numIscrSitoA) &&
          (codiceBloccoA === null || r.codice_blocco === codiceBloccoA)
      )
      .sort((a, b) => a.progressivo - b.progressivo)[0]

    if (!candidata) return []

    // Riserva la riga nello stesso "giro sincrono" della scelta — nessuna
    // finestra in cui un'altra chiamata concorrente la possa vedere ancora libera.
    this.inLavorazione.add(candidata.id)

    // Simula il round-trip di rete del singolo statement: qui possono
    // interleave altre chiamate, ma non troveranno più `candidata` libera.
    await Promise.resolve()
    await new Promise(resolve => setImmediate(resolve))

    candidata.stato = RentriNumeroVidimatoStato.USATO
    candidata.fir_id = firId
    candidata.data_consumo = new Date()
    this.inLavorazione.delete(candidata.id)

    return [candidata]
  }
}

function buildRow(overrides: Partial<{ id: string; progressivo: number }> = {}) {
  return {
    id: overrides.id ?? `num-${overrides.progressivo}`,
    tenant_id: 'tenant-1',
    num_iscr_sito: 'OP1234ABC123456-RM1234',
    codice_blocco: 'BLOCCO-A',
    progressivo: overrides.progressivo ?? 1,
    numero_fir: `FIR${overrides.progressivo}`,
    qr_code_bytes: 'YmFzZTY0',
    stato: RentriNumeroVidimatoStato.DISPONIBILE,
    fir_id: null,
    data_vidimazione: new Date('2026-09-01'),
    data_consumo: null,
  }
}

describe('RentriScortaRepository — consumo atomico', () => {
  let fakeDb: FakeScortaDb
  let prisma: { $queryRaw: jest.Mock }
  let repo: RentriScortaRepository

  beforeEach(() => {
    fakeDb = new FakeScortaDb()
    prisma = {
      $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
        fakeDb.queryRaw(strings, ...values)
      ),
    }
    repo = new RentriScortaRepository(prisma as unknown as PrismaService)
  })

  it('un solo numero disponibile: due consumi concorrenti — uno vince, l’altro resta a mani vuote', async () => {
    fakeDb.seed([buildRow({ progressivo: 1 })])

    const [esitoA, esitoB] = await Promise.all([
      repo.consumaProssimoDisponibile('tenant-1', { firId: 'fir-a' }),
      repo.consumaProssimoDisponibile('tenant-1', { firId: 'fir-b' }),
    ])

    // Esattamente uno dei due ottiene il numero, mai entrambi.
    const vincitori = [esitoA, esitoB].filter((e): e is NonNullable<typeof e> => e !== null)
    expect(vincitori).toHaveLength(1)
    expect(vincitori[0].numeroFir).toBe('FIR1')

    // Il perdente riceve null — fail-closed, mai un numero duplicato o inventato.
    const perdenti = [esitoA, esitoB].filter(e => e === null)
    expect(perdenti).toHaveLength(1)
  })

  it('cinque consumi concorrenti su tre disponibili: tre vincono con numeri distinti, due restano a mani vuote', async () => {
    fakeDb.seed([
      buildRow({ progressivo: 1 }),
      buildRow({ progressivo: 2 }),
      buildRow({ progressivo: 3 }),
    ])

    const risultati = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        repo.consumaProssimoDisponibile('tenant-1', { firId: `fir-${i}` })
      )
    )

    const vincitori = risultati.filter((e): e is NonNullable<typeof e> => e !== null)
    const perdenti = risultati.filter(e => e === null)

    expect(vincitori).toHaveLength(3)
    expect(perdenti).toHaveLength(2)

    // Nessun numero assegnato due volte.
    const numeriAssegnati = vincitori.map(v => v.numeroFir)
    expect(new Set(numeriAssegnati).size).toBe(3)
    expect(new Set(numeriAssegnati)).toEqual(new Set(['FIR1', 'FIR2', 'FIR3']))
  })

  it('nessun numero disponibile: ritorna null senza toccare righe di altri tenant', async () => {
    fakeDb.seed([{ ...buildRow({ progressivo: 1 }), tenant_id: 'tenant-altro' }])

    const esito = await repo.consumaProssimoDisponibile('tenant-1', { firId: 'fir-x' })

    expect(esito).toBeNull()
  })

  it('rispetta il filtro per unità locale: non consuma un numero di un’altra sede', async () => {
    fakeDb.seed([
      { ...buildRow({ progressivo: 1 }), num_iscr_sito: 'OP0000XXX000000-XX0000' },
      buildRow({ progressivo: 2 }), // sede di default (OP1234...)
    ])

    const esito = await repo.consumaProssimoDisponibile('tenant-1', {
      numIscrSito: 'OP1234ABC123456-RM1234',
      firId: 'fir-x',
    })

    expect(esito?.numeroFir).toBe('FIR2')
  })

  it('il progressivo più basso vince (ordine FIFO nel blocco)', async () => {
    fakeDb.seed([
      buildRow({ progressivo: 5 }),
      buildRow({ progressivo: 2 }),
      buildRow({ progressivo: 9 }),
    ])

    const esito = await repo.consumaProssimoDisponibile('tenant-1', { firId: 'fir-x' })

    expect(esito?.progressivo).toBe(2)
  })
})

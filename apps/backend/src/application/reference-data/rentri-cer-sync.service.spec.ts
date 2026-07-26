import { RentriCerSyncService } from './rentri-cer-sync.service'
import { CERCode } from '../../domain/cer/entities/cer-code.entity'
import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'

/**
 * Repository in-memory: replica lo stesso comportamento della Prisma reale
 * per le operazioni che contano in questi test (upsert additivo, marcatura
 * condizionale, mai cancellazione).
 */
class MockCERRepository implements ICERRepository {
  private cers = new Map<string, CERCode>()

  seed(cer: CERCode) {
    this.cers.set(cer.code, cer)
  }

  get(code: string): CERCode | undefined {
    return this.cers.get(code)
  }

  size(): number {
    return this.cers.size
  }

  async findByCode(code: string): Promise<CERCode | null> {
    return this.cers.get(code) ?? null
  }

  async findById(): Promise<CERCode | null> {
    return null
  }

  async search(): Promise<CERCode[]> {
    return []
  }

  async findByCategory(): Promise<CERCode[]> {
    return []
  }

  async findAllPericolosi(): Promise<CERCode[]> {
    return []
  }

  async findPaginated(): Promise<{ items: CERCode[]; total: number }> {
    return { items: [], total: 0 }
  }

  async save(cer: CERCode): Promise<void> {
    this.cers.set(cer.code, cer)
  }

  async saveMany(cers: CERCode[]): Promise<void> {
    for (const cer of cers) await this.save(cer)
  }

  async count(): Promise<number> {
    return this.cers.size
  }

  async exists(code: string): Promise<boolean> {
    return this.cers.has(code)
  }

  async isUtilizzabilePerNuovoFormulario(code: string): Promise<boolean> {
    return this.cers.get(code)?.presenteInRentri === true
  }

  async upsertFromRentri(data: {
    code: string
    description: string
    isPericoloso: boolean
  }): Promise<void> {
    const esistente = this.cers.get(data.code)
    this.cers.set(
      data.code,
      CERCode.reconstitute({
        id: esistente?.id ?? data.code,
        code: data.code,
        description: data.description,
        isPericoloso: data.isPericoloso,
        category: esistente?.category ?? data.code.slice(0, 2),
        subcategory: esistente?.subcategory ?? undefined,
        createdAt: esistente?.createdAt ?? new Date(),
        updatedAt: new Date(),
        presenteInRentri: true,
        rimossoDaRentriAl: null,
        fonte: 'rentri',
      })
    )
  }

  async marcaRimossoDaRentriSeAttivo(code: string, rimossoAl: Date): Promise<boolean> {
    const esistente = this.cers.get(code)
    if (!esistente || !esistente.presenteInRentri) return false
    this.cers.set(
      code,
      CERCode.reconstitute({
        id: esistente.id,
        code: esistente.code,
        description: esistente.description,
        isPericoloso: esistente.isPericoloso,
        category: esistente.category,
        subcategory: esistente.subcategory ?? undefined,
        createdAt: esistente.createdAt,
        updatedAt: new Date(),
        presenteInRentri: false,
        rimossoDaRentriAl: rimossoAl,
        fonte: esistente.fonte,
      })
    )
    return true
  }

  async listTuttiICodici(): Promise<string[]> {
    return Array.from(this.cers.keys())
  }
}

describe('RentriCerSyncService', () => {
  let repository: MockCERRepository
  let client: { codiciEer: jest.Mock }
  let logger: any
  let service: RentriCerSyncService

  beforeEach(() => {
    repository = new MockCERRepository()
    client = { codiciEer: jest.fn() }
    logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    service = new RentriCerSyncService(client as any, repository, logger)
  })

  it('chiama codiciEer con escludi00=false esplicito', async () => {
    client.codiciEer.mockResolvedValue([])

    await service.allinea('tenant-1')

    expect(client.codiciEer).toHaveBeenCalledWith({ escludi00: false }, 'tenant-1')
  })

  it('un codice presente in RENTRI ma sconosciuto localmente viene creato con fonte=rentri e presenteInRentri=true', async () => {
    client.codiciEer.mockResolvedValue([
      {
        id: 1,
        code: '150101',
        name: 'Imballaggi in carta e cartone',
        properties: { pericoloso: false },
      },
    ])

    const esito = await service.allinea()

    expect(esito).toEqual({ nuovi: 1, aggiornati: 0, rimossi: 0 })
    const cer = repository.get('15 01 01')
    expect(cer).toBeDefined()
    expect(cer?.fonte).toBe('rentri')
    expect(cer?.presenteInRentri).toBe(true)
    expect(cer?.description).toBe('Imballaggi in carta e cartone')
    expect(cer?.isPericoloso).toBe(false)
  })

  it("un codice noto localmente (fonte=locale) che RENTRI restituisce anch'esso: aggiorna la descrizione (fonte di verità sui testi) senza downgrade, identità invariata", async () => {
    repository.seed(
      CERCode.create({
        code: '13 02 05*',
        description: 'Descrizione locale superata',
        isPericoloso: true,
        category: '13',
      })
    )
    client.codiciEer.mockResolvedValue([
      {
        id: 2,
        code: '130205*',
        name: 'Descrizione ufficiale aggiornata da RENTRI',
        properties: { pericoloso: true },
      },
    ])

    const esito = await service.allinea()

    expect(esito).toEqual({ nuovi: 0, aggiornati: 1, rimossi: 0 })
    const cer = repository.get('13 02 05*')
    expect(cer?.code).toBe('13 02 05*') // identità invariata
    expect(cer?.description).toBe('Descrizione ufficiale aggiornata da RENTRI')
    expect(cer?.presenteInRentri).toBe(true)
  })

  it('IL TEST CHE CONTA: un codice noto localmente e usato da un FIR esistente, che RENTRI smette di restituire, resta leggibile ma non più selezionabile per un FIR nuovo', async () => {
    // Simula lo stato preesistente: codice noto (referenziato da un FIR reale
    // nel mondo applicativo — qui non serve modellare il FIR, solo il catalogo).
    repository.seed(
      CERCode.create({
        code: '20 03 01',
        description: 'Rifiuti urbani non differenziati',
        isPericoloso: false,
        category: '20',
      })
    )

    // Questo ciclo di allineamento: RENTRI NON restituisce più questo codice.
    client.codiciEer.mockResolvedValue([
      {
        id: 5,
        code: '150101',
        name: 'Imballaggi in carta e cartone',
        properties: { pericoloso: false },
      },
    ])

    const esito = await service.allinea()

    expect(esito.rimossi).toBe(1)

    // (a) la riga non è cancellata
    const cer = repository.get('20 03 01')
    expect(cer).toBeDefined()

    // (b) presenteInRentri passa a false e rimossoDaRentriAl si valorizza
    expect(cer?.presenteInRentri).toBe(false)
    expect(cer?.rimossoDaRentriAl).not.toBeNull()

    // (c) l'esistenza storica resta vera (il FIR esistente resta valido/leggibile)
    await expect(repository.exists('20 03 01')).resolves.toBe(true)

    // (d) NON è più utilizzabile per un FIR nuovo
    await expect(repository.isUtilizzabilePerNuovoFormulario('20 03 01')).resolves.toBe(false)
  })

  it('marcatura idempotente: un secondo ciclo che ancora non restituisce il codice non lo riconta tra i "rimossi"', async () => {
    repository.seed(
      CERCode.create({
        code: '20 03 01',
        description: 'Rifiuti urbani non differenziati',
        isPericoloso: false,
        category: '20',
      })
    )
    client.codiciEer.mockResolvedValue([])

    const primoCiclo = await service.allinea()
    expect(primoCiclo.rimossi).toBe(1)

    const secondoCiclo = await service.allinea()
    expect(secondoCiclo.rimossi).toBe(0) // già marcato, nessuna nuova rimozione da contare

    const cer = repository.get('20 03 01')
    expect(cer?.presenteInRentri).toBe(false)
  })

  it('un codice rimosso in un ciclo precedente che ricompare: la marcatura si ritira (presenteInRentri torna true, rimossoDaRentriAl si azzera)', async () => {
    repository.seed(
      CERCode.create({
        code: '15 01 01',
        description: 'Imballaggi in carta e cartone',
        isPericoloso: false,
        category: '15',
      })
    )
    client.codiciEer.mockResolvedValue([])
    await service.allinea() // primo ciclo: rimosso

    expect(repository.get('15 01 01')?.presenteInRentri).toBe(false)

    client.codiciEer.mockResolvedValue([
      {
        id: 9,
        code: '150101',
        name: 'Imballaggi in carta e cartone',
        properties: { pericoloso: false },
      },
    ])
    await service.allinea() // secondo ciclo: ricompare

    const cer = repository.get('15 01 01')
    expect(cer?.presenteInRentri).toBe(true)
    expect(cer?.rimossoDaRentriAl).toBeNull()
  })

  it('deriva isPericoloso dal suffisso "*" quando properties.pericoloso è assente', async () => {
    client.codiciEer.mockResolvedValue([
      { id: 3, code: '160601*', name: 'Batterie al piombo', properties: undefined },
    ])

    await service.allinea()

    expect(repository.get('16 06 01*')?.isPericoloso).toBe(true)
  })

  it('scarta voci senza codice valido (null o non a 6 cifre) senza fallire il ciclo', async () => {
    client.codiciEer.mockResolvedValue([
      { id: 1, code: null, name: 'voce senza codice', properties: null },
      { id: 2, code: '1301', name: 'voce incompleta', properties: null },
      {
        id: 3,
        code: '150101',
        name: 'Imballaggi in carta e cartone',
        properties: { pericoloso: false },
      },
    ])

    const esito = await service.allinea()

    expect(esito.nuovi).toBe(1)
    expect(repository.size()).toBe(1)
  })
})

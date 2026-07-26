import { RentriCodificheSempliciSyncService } from './rentri-codifiche-semplici-sync.service'

/** Repository in-memory: replica il comportamento Prisma reale (upsert additivo, marcatura condizionale, mai cancellazione). */
class MockRepository {
  private righe = new Map<string, { externalId: string; name: string; presenteInRentri: boolean }>()

  private chiave(tabella: string, code: string): string {
    return `${tabella}::${code}`
  }

  seed(
    tabella: string,
    code: string,
    dati: { externalId: string; name: string; presenteInRentri: boolean }
  ) {
    this.righe.set(this.chiave(tabella, code), dati)
  }

  get(tabella: string, code: string) {
    return this.righe.get(this.chiave(tabella, code))
  }

  async findByTabellaECode(tabella: string, code: string) {
    const riga = this.righe.get(this.chiave(tabella, code))
    return riga ? { presenteInRentri: riga.presenteInRentri } : null
  }

  async upsertFromRentri(data: {
    tabella: string
    code: string
    externalId: string
    name: string
  }) {
    this.righe.set(this.chiave(data.tabella, data.code), {
      externalId: data.externalId,
      name: data.name,
      presenteInRentri: true,
    })
  }

  async marcaRimossoSeAttivo(tabella: string, code: string): Promise<boolean> {
    const riga = this.righe.get(this.chiave(tabella, code))
    if (!riga || !riga.presenteInRentri) return false
    riga.presenteInRentri = false
    return true
  }

  async listTuttiICodici(tabella: string): Promise<string[]> {
    return Array.from(this.righe.keys())
      .filter(k => k.startsWith(`${tabella}::`))
      .map(k => k.slice(tabella.length + 2))
  }
}

describe('RentriCodificheSempliciSyncService', () => {
  let repository: MockRepository
  let client: { leggiTabella: jest.Mock }
  let logger: any
  let service: RentriCodificheSempliciSyncService

  beforeEach(() => {
    repository = new MockRepository()
    client = { leggiTabella: jest.fn().mockResolvedValue([]) }
    logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    service = new RentriCodificheSempliciSyncService(client as any, repository as any, logger)
  })

  it('allinea in sequenza le 4 tabelle "allinea ora", non tutte le 21 disponibili', async () => {
    await service.allinea('tenant-1')

    expect(client.leggiTabella).toHaveBeenCalledTimes(4)
    const tabelleChiamate = client.leggiTabella.mock.calls.map(c => c[0])
    expect(tabelleChiamate).toEqual([
      'unita-misura',
      'stati-fisici',
      'caratteristiche-pericolo',
      'attivita-rs',
    ])
    for (const chiamata of client.leggiTabella.mock.calls) {
      expect(chiamata[1]).toBe('tenant-1')
    }
  })

  it('una voce nuova viene creata con fonte rentri e presenteInRentri=true', async () => {
    client.leggiTabella.mockImplementation(async (tabella: string) =>
      tabella === 'unita-misura' ? [{ id: 1, code: 'Kg', name: 'Chilogrammi' }] : []
    )

    const esiti = await service.allinea()

    const esitoUnita = esiti.find(e => e.tabella === 'unita-misura')
    expect(esitoUnita).toEqual({ tabella: 'unita-misura', nuovi: 1, aggiornati: 0, rimossi: 0 })
    expect(repository.get('unita-misura', 'Kg')).toEqual({
      externalId: '1',
      name: 'Chilogrammi',
      presenteInRentri: true,
    })
  })

  it('una voce già nota viene aggiornata (non ricontata come nuova)', async () => {
    repository.seed('stati-fisici', '1', {
      externalId: '1',
      name: 'Vecchio nome',
      presenteInRentri: true,
    })
    client.leggiTabella.mockImplementation(async (tabella: string) =>
      tabella === 'stati-fisici' ? [{ id: 1, code: '1', name: 'Solido pulverulento' }] : []
    )

    const esiti = await service.allinea()

    const esito = esiti.find(e => e.tabella === 'stati-fisici')
    expect(esito).toEqual({ tabella: 'stati-fisici', nuovi: 0, aggiornati: 1, rimossi: 0 })
    expect(repository.get('stati-fisici', '1')?.name).toBe('Solido pulverulento')
  })

  it('IL TEST CHE CONTA: una voce nota (referenziata come stringa libera da un FIR/movimento storico) che RENTRI smette di restituire resta nella cache, solo marcata', async () => {
    repository.seed('caratteristiche-pericolo', 'HP7', {
      externalId: '7',
      name: 'Cancerogeno',
      presenteInRentri: true,
    })
    // Questo ciclo: RENTRI non restituisce più HP7 per questa tabella.
    client.leggiTabella.mockImplementation(async (tabella: string) =>
      tabella === 'caratteristiche-pericolo' ? [{ id: 4, code: 'HP4', name: 'Irritante' }] : []
    )

    const esiti = await service.allinea()

    const esito = esiti.find(e => e.tabella === 'caratteristiche-pericolo')
    expect(esito?.rimossi).toBe(1)

    const riga = repository.get('caratteristiche-pericolo', 'HP7')
    expect(riga).toBeDefined() // (a) mai cancellata
    expect(riga?.presenteInRentri).toBe(false) // (b) solo marcata
  })

  it('marcatura idempotente: un secondo ciclo che ancora non restituisce la voce non la riconta tra i rimossi', async () => {
    repository.seed('attivita-rs', 'R13', {
      externalId: '13',
      name: 'Messa in riserva',
      presenteInRentri: true,
    })
    client.leggiTabella.mockResolvedValue([])

    const primoCiclo = await service.allinea()
    expect(primoCiclo.find(e => e.tabella === 'attivita-rs')?.rimossi).toBe(1)

    const secondoCiclo = await service.allinea()
    expect(secondoCiclo.find(e => e.tabella === 'attivita-rs')?.rimossi).toBe(0)
  })

  it('scarta voci senza codice valido senza fallire il ciclo', async () => {
    client.leggiTabella.mockImplementation(async (tabella: string) =>
      tabella === 'unita-misura'
        ? [
            { id: 1, code: null, name: 'voce senza codice' },
            { id: 2, code: 'Kg', name: 'Chilogrammi' },
          ]
        : []
    )

    const esiti = await service.allinea()

    expect(esiti.find(e => e.tabella === 'unita-misura')?.nuovi).toBe(1)
  })
})

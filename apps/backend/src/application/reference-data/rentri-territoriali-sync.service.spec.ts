import { RentriTerritorialiSyncService } from './rentri-territoriali-sync.service'

interface RigaProvincia {
  code: string
  name: string
  regioneId: string
  attivo: boolean
  fineValidita: Date | null
  presenteInRentri: boolean
}

interface RigaComune {
  code: string
  name: string
  provinciaId: string
  cciaa: string
  attivo: boolean
  nuovoId: string | null
  fineValidita: Date | null
  presenteInRentri: boolean
}

interface RigaNazione {
  code: string
  name: string
  presenteInRentri: boolean
}

/** Repository in-memory: replica il comportamento Prisma reale (upsert additivo, marcatura condizionale, mai cancellazione). */
class MockRepository {
  province = new Map<string, RigaProvincia>()
  comuni = new Map<string, RigaComune>()
  nazioni = new Map<string, RigaNazione>()

  async findProvincia(id: string) {
    const r = this.province.get(id)
    return r ? { presenteInRentri: r.presenteInRentri } : null
  }
  async upsertProvincia(data: { id: string } & Omit<RigaProvincia, 'presenteInRentri'>) {
    this.province.set(data.id, { ...data, presenteInRentri: true })
  }
  async marcaProvinciaRimossaSeAttiva(id: string): Promise<boolean> {
    const r = this.province.get(id)
    if (!r || !r.presenteInRentri) return false
    r.presenteInRentri = false
    return true
  }
  async listTuttiGliIdProvincia(): Promise<string[]> {
    return Array.from(this.province.keys())
  }

  async findComune(id: string) {
    const r = this.comuni.get(id)
    return r ? { presenteInRentri: r.presenteInRentri } : null
  }
  async upsertComune(data: { id: string } & Omit<RigaComune, 'presenteInRentri'>) {
    this.comuni.set(data.id, { ...data, presenteInRentri: true })
  }
  async marcaComuneRimossoSeAttivo(id: string): Promise<boolean> {
    const r = this.comuni.get(id)
    if (!r || !r.presenteInRentri) return false
    r.presenteInRentri = false
    return true
  }
  async listTuttiGliIdComune(): Promise<string[]> {
    return Array.from(this.comuni.keys())
  }

  async findNazione(id: string) {
    const r = this.nazioni.get(id)
    return r ? { presenteInRentri: r.presenteInRentri } : null
  }
  async upsertNazione(data: { id: string } & Omit<RigaNazione, 'presenteInRentri'>) {
    this.nazioni.set(data.id, { ...data, presenteInRentri: true })
  }
  async marcaNazioneRimossaSeAttiva(id: string): Promise<boolean> {
    const r = this.nazioni.get(id)
    if (!r || !r.presenteInRentri) return false
    r.presenteInRentri = false
    return true
  }
  async listTuttiGliIdNazione(): Promise<string[]> {
    return Array.from(this.nazioni.keys())
  }
}

describe('RentriTerritorialiSyncService', () => {
  let repository: MockRepository
  let client: { leggiTabella: jest.Mock; comuni: jest.Mock }
  let logger: any
  let service: RentriTerritorialiSyncService

  beforeEach(() => {
    repository = new MockRepository()
    client = {
      leggiTabella: jest.fn().mockResolvedValue([]),
      comuni: jest.fn().mockResolvedValue([]),
    }
    logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    service = new RentriTerritorialiSyncService(client as any, repository as any, logger)
  })

  it('allinea in sequenza province, nazioni, comuni', async () => {
    await service.allinea('tenant-1')

    expect(client.leggiTabella).toHaveBeenNthCalledWith(1, 'province', 'tenant-1')
    expect(client.leggiTabella).toHaveBeenNthCalledWith(2, 'nazioni', 'tenant-1')
    expect(client.comuni).toHaveBeenCalledWith('tenant-1')
  })

  it('provincia nuova: upsert con attivo/fine-validita dalle properties', async () => {
    client.leggiTabella.mockImplementation(async (tabella: string) =>
      tabella === 'province'
        ? [
            {
              id: '015',
              code: 'MI',
              name: 'Milano',
              properties: { 'regione-id': '03', attivo: true, 'fine-validita': null },
            },
          ]
        : []
    )

    const [esito] = await service.allinea()

    expect(esito).toEqual({ tabella: 'province', nuovi: 1, aggiornati: 0, rimossi: 0 })
    const provincia = repository.province.get('015')
    expect(provincia).toMatchObject({ code: 'MI', name: 'Milano', regioneId: '03', attivo: true })
    expect(provincia?.fineValidita).toBeNull()
  })

  it('nazione: upsert semplice, nessuna proprietà attivo/fine-validita attesa', async () => {
    client.leggiTabella.mockImplementation(async (tabella: string) =>
      tabella === 'nazioni' ? [{ id: 'IT', code: '380', name: 'Italia' }] : []
    )

    const esiti = await service.allinea()

    expect(esiti[1]).toEqual({ tabella: 'nazioni', nuovi: 1, aggiornati: 0, rimossi: 0 })
    expect(repository.nazioni.get('IT')).toMatchObject({ code: '380', name: 'Italia' })
  })

  it('IL TEST CHE CONTA: un comune soppresso/accorpato non viene cancellato — resta con attivo=false e nuovo-id/fine-validita valorizzati, provincia derivata dal proprio codice ISTAT', async () => {
    client.comuni.mockResolvedValue([
      {
        id: '048033',
        code: 'I001',
        name: 'San Piero a Sieve',
        properties: {
          cciaa: 'FI',
          attivo: false,
          'nuovo-id': '048038',
          'fine-validita': '2014-01-01T00:00:00Z',
        },
      },
      {
        id: '048038',
        code: 'I004',
        name: 'Scarperia e San Piero',
        properties: { cciaa: 'FI', attivo: true, 'nuovo-id': null, 'fine-validita': null },
      },
    ])

    const esiti = await service.allinea()

    const esitoComuni = esiti.find(e => e.tabella === 'comuni')
    expect(esitoComuni).toEqual({ tabella: 'comuni', nuovi: 2, aggiornati: 0, rimossi: 0 })

    const soppresso = repository.comuni.get('048033')
    expect(soppresso).toBeDefined() // mai cancellato
    expect(soppresso?.attivo).toBe(false)
    expect(soppresso?.nuovoId).toBe('048038')
    expect(soppresso?.fineValidita).toEqual(new Date('2014-01-01T00:00:00Z'))
    expect(soppresso?.provinciaId).toBe('048') // derivata dal codice ISTAT del comune

    const nuovo = repository.comuni.get('048038')
    expect(nuovo?.attivo).toBe(true)
  })

  it('marcatura: una provincia nota che RENTRI smette di restituire viene marcata, mai cancellata', async () => {
    repository.province.set('999', {
      code: 'ZZ',
      name: 'Provincia fantasma',
      regioneId: '00',
      attivo: true,
      fineValidita: null,
      presenteInRentri: true,
    })
    client.leggiTabella.mockImplementation(async (tabella: string) =>
      tabella === 'province' ? [] : []
    )

    const [esito] = await service.allinea()

    expect(esito.rimossi).toBe(1)
    expect(repository.province.get('999')).toBeDefined()
    expect(repository.province.get('999')?.presenteInRentri).toBe(false)
  })

  it('marcatura idempotente su comuni: un secondo ciclo senza il comune non lo riconta tra i rimossi', async () => {
    client.comuni.mockResolvedValueOnce([
      { id: '015146', code: 'F205', name: 'Milano', properties: { cciaa: 'MI', attivo: true } },
    ])
    await service.allinea()

    client.comuni.mockResolvedValueOnce([])
    const esitiSecondoCiclo = await service.allinea()

    expect(esitiSecondoCiclo.find(e => e.tabella === 'comuni')?.rimossi).toBe(1)

    const esitiTerzoCiclo = await service.allinea()
    expect(esitiTerzoCiclo.find(e => e.tabella === 'comuni')?.rimossi).toBe(0)
  })
})

import { SystemHealthService, DURATA_CACHE_MS } from './system-health.service'
import { HealthItem } from './health-item'

function voce(key: string): HealthItem {
  return { key, label: key, state: 'ok', since: null, detail: 'prova' }
}

describe('SystemHealthService', () => {
  const evidenze = {
    freschezza: jest.fn().mockResolvedValue([]),
    credenziali: jest.fn().mockResolvedValue([]),
    verificaConnessione: jest.fn().mockResolvedValue('ok'),
    ultimoEffetto: jest.fn().mockResolvedValue(null),
  }
  const scheduler = { getCronJobs: () => new Map() }
  const config = { get: () => undefined }
  const http = { get: jest.fn() }
  const s3 = { verificaAccesso: jest.fn() }
  const email = { modalitaSviluppo: true, verificaConnessione: jest.fn() }

  let infraProbe: { raccogli: jest.Mock }
  let codeProbe: { raccogli: jest.Mock }
  let jobProbe: { raccogli: jest.Mock }
  let freschezzaProbe: { raccogli: jest.Mock }
  let credenzialiProbe: { riepilogo: jest.Mock }
  let flagProbe: { raccogli: jest.Mock }
  let service: SystemHealthService

  function costruisci() {
    return new SystemHealthService(
      evidenze as never,
      scheduler as never,
      config as never,
      http as never,
      s3 as never,
      email as never,
      codeProbe as never,
      jobProbe as never,
      infraProbe as never,
      freschezzaProbe as never,
      credenzialiProbe as never,
      flagProbe as never,
      new Map()
    )
  }

  beforeEach(() => {
    infraProbe = { raccogli: jest.fn().mockResolvedValue([voce('infra.postgres')]) }
    codeProbe = { raccogli: jest.fn().mockResolvedValue([voce('coda.rentri-sync')]) }
    jobProbe = { raccogli: jest.fn().mockResolvedValue([voce('job.x')]) }
    freschezzaProbe = { raccogli: jest.fn().mockReturnValue([voce('freschezza.x')]) }
    credenzialiProbe = { riepilogo: jest.fn().mockReturnValue(voce('credenziali.rentri')) }
    flagProbe = { raccogli: jest.fn().mockReturnValue([voce('flag.ambiente')]) }
    service = costruisci()
  })

  it('raccoglie tutte le sezioni della pagina', async () => {
    const stato = await service.stato()

    expect(Object.keys(stato)).toEqual(
      expect.arrayContaining([
        'infrastructure',
        'queues',
        'scheduledJobs',
        'freshness',
        'credentials',
        'flags',
      ])
    )
    expect(stato.cached).toBe(false)
    expect(stato.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('serve dalla cache entro la finestra, dichiarandolo e dicendo quanto e vecchia', async () => {
    await service.stato()
    const secondo = await service.stato()

    expect(secondo.cached).toBe(true)
    expect(secondo.cacheAgeSeconds).toBeGreaterThanOrEqual(0)
    // Le dipendenze esterne non vengono ricontattate a ogni apertura.
    expect(infraProbe.raccogli).toHaveBeenCalledTimes(1)
  })

  it('ricontatta le dipendenze quando la cache e scaduta', async () => {
    await service.stato()
    const scaduta = Date.now() + DURATA_CACHE_MS + 1
    jest.spyOn(Date, 'now').mockReturnValue(scaduta)

    try {
      const dopo = await service.stato()
      expect(dopo.cached).toBe(false)
      expect(infraProbe.raccogli).toHaveBeenCalledTimes(2)
    } finally {
      jest.spyOn(Date, 'now').mockRestore()
    }
  })

  it('invalida la cache su richiesta (dopo un rilancio manuale)', async () => {
    await service.stato()
    service.invalidaCache()
    const dopo = await service.stato()

    expect(dopo.cached).toBe(false)
    expect(infraProbe.raccogli).toHaveBeenCalledTimes(2)
  })

  it('una sezione che fallisce diventa una riga unknown, non una pagina vuota', async () => {
    codeProbe.raccogli.mockRejectedValue(new Error('Redis giu'))

    const stato = await service.stato()

    expect(stato.queues).toHaveLength(1)
    expect(stato.queues[0].state).toBe('unknown')
    expect(stato.queues[0].detail).toContain('Redis giu')
    // Le altre sezioni restano raccolte: il guasto e isolato.
    expect(stato.infrastructure[0].key).toBe('infra.postgres')
    expect(stato.flags[0].key).toBe('flag.ambiente')
  })
})

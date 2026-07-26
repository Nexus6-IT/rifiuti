import { PrismaClient } from '@prisma/client'
import { RentriTerritorialeRepository } from './rentri-territoriale.repository'

/**
 * R4 Task 5 — verifica contro un Postgres reale delle 3 cache territoriali
 * RENTRI (`RentriProvincia`, `RentriComune`, `RentriNazione`), DISTINTE da
 * `IstatProvincia`/`IstatComune`/`IstatNazione` (v.
 * `docs/audits/rentri-codifiche-campi-2026-07-26.md`). Il test che conta di
 * più replica lo stesso scenario del Task 4 applicato al territorio: un
 * comune soppresso/accorpato non viene mai cancellato — solo marcato, con
 * `nuovo-id`/`fine-validita` leggibili da un indirizzo storico.
 */
describe('RentriTerritorialeRepository — comportamento additivo su Postgres reale', () => {
  let prisma: PrismaClient
  let repo: RentriTerritorialeRepository

  let contatore = 0
  const idTest = () => {
    contatore += 1
    return `T${String(contatore).padStart(9, '0')}`.slice(0, 10)
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    repo = new RentriTerritorialeRepository(prisma as any)
  })

  afterAll(async () => {
    await prisma.rentriComune.deleteMany({ where: { id: { startsWith: 'T' } } })
    await prisma.rentriProvincia.deleteMany({ where: { id: { startsWith: 'T' } } })
    await prisma.rentriNazione.deleteMany({ where: { id: { startsWith: 'T' } } })
    await prisma.$disconnect()
  })

  it('provincia: creata senza specificare i nuovi campi ha i default presenteInRentri=true, fonte="rentri"', async () => {
    const id = idTest()
    await prisma.rentriProvincia.create({
      data: { id, code: 'ZZ', name: 'Provincia test', regioneId: '00' },
    })

    const record = await prisma.rentriProvincia.findUniqueOrThrow({ where: { id } })
    expect(record.presenteInRentri).toBe(true)
    expect(record.fonte).toBe('rentri')
    expect(record.rimossoDaRentriAl).toBeNull()
    expect(record.attivo).toBe(true)
  })

  it('IL TEST CHE CONTA: un comune soppresso/accorpato (nuovo-id valorizzato) non viene mai cancellato, resta leggibile per un indirizzo storico', async () => {
    const idVecchio = idTest()
    const idNuovo = idTest()
    await prisma.rentriComune.create({
      data: {
        id: idVecchio,
        code: 'X001',
        name: 'Comune soppresso di test',
        provinciaId: idVecchio.slice(0, 3),
        cciaa: 'TT',
      },
    })

    const marcato = await repo.marcaComuneRimossoSeAttivo(idVecchio, new Date())
    expect(marcato).toBe(true)

    // Simula il ciclo di sincronizzazione che scopre la fusione: aggiorna
    // nuovoId/fineValidita/attivo=false tramite upsert (stesso path del
    // sync service).
    await repo.upsertComune({
      id: idVecchio,
      code: 'X001',
      name: 'Comune soppresso di test',
      provinciaId: idVecchio.slice(0, 3),
      cciaa: 'TT',
      attivo: false,
      nuovoId: idNuovo,
      fineValidita: new Date('2014-01-01'),
    })

    const record = await prisma.rentriComune.findUnique({ where: { id: idVecchio } })
    expect(record).not.toBeNull() // mai cancellato
    expect(record?.attivo).toBe(false)
    expect(record?.nuovoId).toBe(idNuovo)
    expect(record?.fineValidita).not.toBeNull()
  })

  it('marcaComuneRimossoSeAttivo è idempotente', async () => {
    const id = idTest()
    await prisma.rentriComune.create({
      data: {
        id,
        code: 'X002',
        name: 'Test idempotenza',
        provinciaId: id.slice(0, 3),
        cciaa: 'TT',
      },
    })

    const primaVolta = await repo.marcaComuneRimossoSeAttivo(id, new Date())
    const secondaVolta = await repo.marcaComuneRimossoSeAttivo(id, new Date())

    expect(primaVolta).toBe(true)
    expect(secondaVolta).toBe(false)
  })

  it('nazione: upsert e marcatura, mai cancellazione', async () => {
    // Id a 2 caratteri fisso (non deriva dal contatore condiviso con
    // provincia/comune, che produce id più lunghi): nessuna nazione reale
    // usa questo codice nelle fixture dell'oracolo.
    const id = 'ZZ'
    await repo.upsertNazione({ id, code: '999', name: 'Nazione di test' })

    let record = await prisma.rentriNazione.findUniqueOrThrow({ where: { id } })
    expect(record.presenteInRentri).toBe(true)

    const marcata = await repo.marcaNazioneRimossaSeAttiva(id, new Date())
    expect(marcata).toBe(true)

    record = await prisma.rentriNazione.findUniqueOrThrow({ where: { id } })
    expect(record).not.toBeNull()
    expect(record.presenteInRentri).toBe(false)

    await prisma.rentriNazione.deleteMany({ where: { id } })
  })

  it('listTuttiGliIdComune/Provincia/Nazione includono le righe marcate rimosse', async () => {
    const idComune = idTest()
    await prisma.rentriComune.create({
      data: {
        id: idComune,
        code: 'X003',
        name: 'Listing',
        provinciaId: idComune.slice(0, 3),
        cciaa: 'TT',
      },
    })
    await repo.marcaComuneRimossoSeAttivo(idComune, new Date())

    const tutti = await repo.listTuttiGliIdComune()
    expect(tutti).toContain(idComune)
  })
})

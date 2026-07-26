import { PrismaClient } from '@prisma/client'
import { RentriCodificaSempliceRepository } from './rentri-codifica-semplice.repository'

/**
 * R4 Task 5 — verifica contro un Postgres reale del comportamento additivo
 * della cache generica `RentriCodificaSemplice`: default di colonna, upsert,
 * marcatura condizionale mai distruttiva. Stessa impostazione di
 * `cer-prisma.repository.postgres.spec.ts` (Task 4).
 */
describe('RentriCodificaSempliceRepository — comportamento additivo su Postgres reale', () => {
  let prisma: PrismaClient
  let repo: RentriCodificaSempliceRepository

  const TABELLA_TEST = 'unita-misura'
  let contatore = 0
  const codeTest = () => {
    contatore += 1
    return `TEST${contatore}`
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    repo = new RentriCodificaSempliceRepository(prisma as any)
  })

  afterAll(async () => {
    await prisma.rentriCodificaSemplice.deleteMany({ where: { code: { startsWith: 'TEST' } } })
    await prisma.$disconnect()
  })

  it('una riga creata senza specificare i nuovi campi ha i default: presenteInRentri=true, fonte="rentri", rimossoDaRentriAl=null', async () => {
    const code = codeTest()
    await prisma.rentriCodificaSemplice.create({
      data: { tabella: TABELLA_TEST, externalId: '1', code, name: 'Test' },
    })

    const record = await prisma.rentriCodificaSemplice.findUniqueOrThrow({
      where: { tabella_code: { tabella: TABELLA_TEST, code } },
    })

    expect(record.presenteInRentri).toBe(true)
    expect(record.fonte).toBe('rentri')
    expect(record.rimossoDaRentriAl).toBeNull()
  })

  it('upsertFromRentri su una voce nuova la crea', async () => {
    const code = codeTest()

    await repo.upsertFromRentri({
      tabella: TABELLA_TEST,
      code,
      externalId: '2',
      name: 'Chilogrammi',
    })

    const record = await prisma.rentriCodificaSemplice.findUniqueOrThrow({
      where: { tabella_code: { tabella: TABELLA_TEST, code } },
    })
    expect(record.name).toBe('Chilogrammi')
    expect(record.presenteInRentri).toBe(true)
  })

  it('IL TEST CHE CONTA: una voce esistente (referenziata come stringa libera da un FIR/movimento) marcata rimossa resta nella tabella, mai cancellata', async () => {
    const code = codeTest()
    await prisma.rentriCodificaSemplice.create({
      data: { tabella: TABELLA_TEST, externalId: '3', code, name: 'Voce storica' },
    })

    const marcata = await repo.marcaRimossoSeAttivo(TABELLA_TEST, code, new Date())
    expect(marcata).toBe(true)

    const record = await prisma.rentriCodificaSemplice.findUnique({
      where: { tabella_code: { tabella: TABELLA_TEST, code } },
    })
    expect(record).not.toBeNull() // mai cancellata
    expect(record?.presenteInRentri).toBe(false)
    expect(record?.rimossoDaRentriAl).not.toBeNull()
  })

  it('marcaRimossoSeAttivo è idempotente: una seconda chiamata su una voce già marcata restituisce false', async () => {
    const code = codeTest()
    await prisma.rentriCodificaSemplice.create({
      data: { tabella: TABELLA_TEST, externalId: '4', code, name: 'Test idempotenza' },
    })

    const primaVolta = await repo.marcaRimossoSeAttivo(TABELLA_TEST, code, new Date())
    const secondaVolta = await repo.marcaRimossoSeAttivo(TABELLA_TEST, code, new Date())

    expect(primaVolta).toBe(true)
    expect(secondaVolta).toBe(false)
  })

  it('upsertFromRentri su una voce precedentemente marcata rimossa la fa ricomparire', async () => {
    const code = codeTest()
    await prisma.rentriCodificaSemplice.create({
      data: { tabella: TABELLA_TEST, externalId: '5', code, name: 'Test riapparizione' },
    })
    await repo.marcaRimossoSeAttivo(TABELLA_TEST, code, new Date())

    await repo.upsertFromRentri({
      tabella: TABELLA_TEST,
      code,
      externalId: '5',
      name: 'Ricomparso',
    })

    const record = await prisma.rentriCodificaSemplice.findUniqueOrThrow({
      where: { tabella_code: { tabella: TABELLA_TEST, code } },
    })
    expect(record.presenteInRentri).toBe(true)
    expect(record.rimossoDaRentriAl).toBeNull()
  })

  it('il vincolo unique è per (tabella, code): lo stesso code su tabelle diverse non collide', async () => {
    const code = codeTest()
    await repo.upsertFromRentri({ tabella: 'unita-misura', code, externalId: '1', name: 'Unità' })
    await repo.upsertFromRentri({
      tabella: 'stati-fisici',
      code,
      externalId: '1',
      name: 'Stato fisico',
    })

    const unita = await prisma.rentriCodificaSemplice.findUnique({
      where: { tabella_code: { tabella: 'unita-misura', code } },
    })
    const stato = await prisma.rentriCodificaSemplice.findUnique({
      where: { tabella_code: { tabella: 'stati-fisici', code } },
    })
    expect(unita).not.toBeNull()
    expect(stato).not.toBeNull()

    await prisma.rentriCodificaSemplice.deleteMany({ where: { code } })
  })

  it('listTuttiICodici include le voci marcate come non più presenti in RENTRI (nessuna cancellazione, mai)', async () => {
    const code = codeTest()
    await prisma.rentriCodificaSemplice.create({
      data: { tabella: TABELLA_TEST, externalId: '6', code, name: 'test listing' },
    })
    await repo.marcaRimossoSeAttivo(TABELLA_TEST, code, new Date())

    const tutti = await repo.listTuttiICodici(TABELLA_TEST)
    expect(tutti).toContain(code)
  })
})

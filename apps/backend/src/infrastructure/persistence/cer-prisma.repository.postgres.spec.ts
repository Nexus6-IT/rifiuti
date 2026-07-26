import { PrismaClient } from '@prisma/client'
import { CERPrismaRepository } from './cer-prisma.repository'

/**
 * R4 Task 4 — verifica contro un Postgres reale (non un mock) del
 * comportamento additivo di `CERCode` (`presenteInRentri`, `rimossoDaRentriAl`,
 * `fonte`): default della migrazione sulle righe esistenti, upsert da RENTRI,
 * marcatura condizionale di rimozione. Il punto che conta di più — un codice
 * usato da un FIR esistente che RENTRI smette di restituire resta leggibile
 * ma non più selezionabile per un FIR nuovo — è già coperto a livello
 * applicativo in `rentri-cer-sync.service.spec.ts`; qui si dimostra che i
 * vincoli/i default sono realmente quelli della colonna Postgres, non solo
 * quelli del tipo TypeScript.
 */
describe('CERPrismaRepository — comportamento additivo RENTRI su Postgres reale', () => {
  let prisma: PrismaClient
  let repo: CERPrismaRepository

  // Categoria "99" riservata a dati di test: codici nel formato canonico
  // "NN NN NN" (VarChar(10), rispetta anche `CERCode.isValidCodeFormat` usato
  // dal test su `save()`). Un contatore garantisce l'unicità tra i test anche
  // in esecuzione ravvicinata (niente collisioni da timestamp in millisecondi
  // uguali).
  let contatore = 0
  const codiceTest = () => {
    contatore += 1
    return `99 00 ${String(contatore).padStart(2, '0')}`
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    repo = new CERPrismaRepository(prisma as any)
  })

  afterAll(async () => {
    await prisma.cERCode.deleteMany({ where: { code: { startsWith: '99 00' } } })
    await prisma.$disconnect()
  })

  it('una riga creata senza specificare i nuovi campi ha i default: presenteInRentri=true, fonte="locale", rimossoDaRentriAl=null', async () => {
    const code = codiceTest()
    await prisma.cERCode.create({
      data: { code, description: 'test default', category: '99', subcategory: '' },
    })

    const record = await prisma.cERCode.findUniqueOrThrow({ where: { code } })

    expect(record.presenteInRentri).toBe(true)
    expect(record.fonte).toBe('locale')
    expect(record.rimossoDaRentriAl).toBeNull()
  })

  it('upsertFromRentri su un codice nuovo lo crea con fonte=rentri, presenteInRentri=true', async () => {
    const code = codiceTest()

    await repo.upsertFromRentri({ code, description: 'Voce da RENTRI', isPericoloso: false })

    const record = await prisma.cERCode.findUniqueOrThrow({ where: { code } })
    expect(record.fonte).toBe('rentri')
    expect(record.presenteInRentri).toBe(true)
    expect(record.description).toBe('Voce da RENTRI')
  })

  it('IL TEST CHE CONTA: un codice esistente (fonte locale) marcato rimosso da RENTRI resta leggibile (exists=true) ma NON è più utilizzabile per un FIR nuovo', async () => {
    const code = codiceTest()
    await prisma.cERCode.create({
      data: {
        code,
        description: 'Codice storico usato da un FIR reale',
        category: '99',
        subcategory: '',
      },
    })

    const marcato = await repo.marcaRimossoDaRentriSeAttivo(code, new Date())
    expect(marcato).toBe(true)

    // (a) la riga non è cancellata
    const record = await prisma.cERCode.findUnique({ where: { code } })
    expect(record).not.toBeNull()

    // (b) presenteInRentri=false, rimossoDaRentriAl valorizzato
    expect(record?.presenteInRentri).toBe(false)
    expect(record?.rimossoDaRentriAl).not.toBeNull()

    // (c) esiste ancora per riferimento storico (letture di un FIR esistente)
    await expect(repo.exists(code)).resolves.toBe(true)

    // (d) non è più utilizzabile per un FIR NUOVO
    await expect(repo.isUtilizzabilePerNuovoFormulario(code)).resolves.toBe(false)
  })

  it('marcaRimossoDaRentriSeAttivo è idempotente: una seconda chiamata su un codice già marcato non lo "ri-marca" (restituisce false)', async () => {
    const code = codiceTest()
    await prisma.cERCode.create({
      data: { code, description: 'test idempotenza', category: '99', subcategory: '' },
    })

    const primaVolta = await repo.marcaRimossoDaRentriSeAttivo(code, new Date())
    const secondaVolta = await repo.marcaRimossoDaRentriSeAttivo(code, new Date())

    expect(primaVolta).toBe(true)
    expect(secondaVolta).toBe(false)
  })

  it('upsertFromRentri su un codice precedentemente marcato rimosso lo fa ricomparire (presenteInRentri=true, rimossoDaRentriAl azzerato)', async () => {
    const code = codiceTest()
    await prisma.cERCode.create({
      data: { code, description: 'test riapparizione', category: '99', subcategory: '' },
    })
    await repo.marcaRimossoDaRentriSeAttivo(code, new Date())

    await repo.upsertFromRentri({ code, description: 'Ricomparso', isPericoloso: false })

    const record = await prisma.cERCode.findUniqueOrThrow({ where: { code } })
    expect(record.presenteInRentri).toBe(true)
    expect(record.rimossoDaRentriAl).toBeNull()
  })

  it('save() generico (import CSV) NON declassa fonte/presenteInRentri di un codice già confermato da RENTRI', async () => {
    const code = codiceTest()
    await repo.upsertFromRentri({ code, description: 'Confermato da RENTRI', isPericoloso: false })

    const { CERCode } = await import('../../domain/cer/entities/cer-code.entity')
    const cerLocale = CERCode.create({
      code,
      description: 'Aggiornamento generico via import CSV',
      isPericoloso: false,
      category: '99',
    })
    await repo.save(cerLocale)

    const record = await prisma.cERCode.findUniqueOrThrow({ where: { code } })
    expect(record.fonte).toBe('rentri') // NON declassato a 'locale'
    expect(record.presenteInRentri).toBe(true)
    expect(record.description).toBe('Aggiornamento generico via import CSV') // i campi descrittivi restano aggiornabili
  })

  it('listTuttiICodici include i codici marcati come non più presenti in RENTRI (nessuna cancellazione, mai)', async () => {
    const code = codiceTest()
    await prisma.cERCode.create({
      data: { code, description: 'test listing', category: '99', subcategory: '' },
    })
    await repo.marcaRimossoDaRentriSeAttivo(code, new Date())

    const tutti = await repo.listTuttiICodici()
    expect(tutti).toContain(code)
  })
})

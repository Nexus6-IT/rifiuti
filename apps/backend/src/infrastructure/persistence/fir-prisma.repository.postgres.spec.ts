import { PrismaClient } from '@prisma/client'
import { AZIENDA_PIATTAFORMA_ID } from '../../core/context/azienda-piattaforma'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { SyncFIRToRENTRIUseCase } from '../../application/rentri/sync-fir-to-rentri.use-case'
import { RENTRISyncLog } from '../../domain/rentri/rentri-sync-log.aggregate'
import { TenantSenzaCertificatoRentriError } from '../rentri/rentri-credential.resolver'
import { RentriCredentialService } from '../rentri/rentri-credential.service'
import { CODICE_CERTIFICATO_MANCANTE } from '../rentri/rentri-certificato.costanti'
import { FIR, FirmaDigitale } from '../../domain/fir/aggregates/fir.aggregate'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  FirAnnullatoNelFrattempoError,
  FirNonPiuInBozzaError,
  FormularioGiaAgganciatoError,
} from '../../core/domain/errors'

/**
 * R2 Task 3, Step 4 — vincolo di unicità (tenant_id, rentri_numero_fir) su
 * "firs": contro un database Postgres reale (non un mock), non contro il
 * vincolo applicativo dell'aggregate (già coperto in fir.aggregate.spec.ts).
 * Un controllo applicativo si aggira (due scritture concorrenti passano
 * entrambe il controllo prima che una delle due arrivi al DB); solo il
 * vincolo di database garantisce l'anti-doppio-legame in ogni caso. Questo
 * test verifica che il repository traduca la violazione Postgres
 * (P2002/unique constraint) in un errore di dominio leggibile
 * (FormularioGiaAgganciatoError), non lasciarla risalire grezza.
 */
/** Tutte le aziende ammesse (come prima del filtro per modulo): i test non dipendono dal piano. */
async function tuttiGliIdDi(p: PrismaClient): Promise<string[]> {
  return (await p.tenant.findMany({ select: { id: true } })).map(t => t.id)
}

describe('FIRPrismaRepository — vincolo di unicità (tenant_id, rentri_numero_fir) su Postgres reale', () => {
  let prisma: PrismaClient
  let repo: FIRPrismaRepository
  let tenantId: string
  let userId: string
  const tuttiGliId = () => tuttiGliIdDi(prisma)

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    repo = new FIRPrismaRepository(prisma as any, prisma as any)

    const tenant = await prisma.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Vincolo Unicità Test SRL',
        country: 'IT',
      },
    })
    tenantId = tenant.id

    const user = await prisma.user.create({
      data: {
        tenantId,
        keycloakId: `keycloak-uq-${Date.now()}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `uq-${Date.now()}@example.com`,
        role: 'OPERATOR',
      },
    })
    userId = user.id
  })

  afterAll(async () => {
    // Con un id `undefined` (beforeAll fallito) Prisma toglie il filtro e deleteMany
    // cancellerebbe l'intera tabella: senza id non si cancella nulla.
    if (tenantId) {
      await prisma.fIR.deleteMany({ where: { tenantId } })
      await prisma.user.deleteMany({ where: { tenantId } })
      await prisma.tenant.deleteMany({ where: { id: tenantId } })
    }
    await prisma.$disconnect()
  })

  // producerId/carrierId/receiverId sono colonne @db.Uuid (nullable):
  // producerId/trasportatoreId/destinatarioId dell'aggregate devono quindi
  // essere UUID validi in un test contro Postgres reale (a differenza dei
  // test con Prisma mockato sopra, che non validano il formato).
  const REGISTRO_PRODUTTORE = '11111111-1111-4111-8111-111111111111'
  const REGISTRO_TRASPORTATORE = '22222222-2222-4222-8222-222222222222'
  const REGISTRO_DESTINATARIO = '33333333-3333-4333-8333-333333333333'

  function buildFirAgganciato(numeroFir: string): FIR {
    const fir = FIR.create({
      produttoreId: REGISTRO_PRODUTTORE,
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: REGISTRO_TRASPORTATORE,
      destinatarioId: REGISTRO_DESTINATARIO,
      tenantId,
      creatoDaUserId: userId,
    })
    fir.agganciaFormularioAcquisito(numeroFir)
    return fir
  }

  it('salva senza errori il primo FIR agganciato a un numero_fir', async () => {
    const fir = buildFirAgganciato(`RENTRI-UQ-${Date.now()}-A`)
    await expect(repo.save(fir)).resolves.not.toThrow()
  })

  it('rifiuta un secondo FIR dello stesso tenant agganciato allo STESSO numero_fir, con un errore di dominio leggibile', async () => {
    const numeroFir = `RENTRI-UQ-${Date.now()}-B`
    const primoFir = buildFirAgganciato(numeroFir)
    await repo.save(primoFir)

    const secondoFir = buildFirAgganciato(numeroFir)

    await expect(repo.save(secondoFir)).rejects.toThrow(FormularioGiaAgganciatoError)
    await expect(repo.save(secondoFir)).rejects.toThrow(numeroFir)
  })

  it('non impedisce due FIR NON legati (rentriNumeroFir null): NULL sono distinti fra loro in Postgres', async () => {
    const primoFir = FIR.create({
      produttoreId: REGISTRO_PRODUTTORE,
      rifiuto: { cerCode: '150101', quantita: 50 },
      trasportatoreId: REGISTRO_TRASPORTATORE,
      destinatarioId: REGISTRO_DESTINATARIO,
      tenantId,
      creatoDaUserId: userId,
    })
    const secondoFir = FIR.create({
      produttoreId: REGISTRO_PRODUTTORE,
      rifiuto: { cerCode: '150101', quantita: 60 },
      trasportatoreId: REGISTRO_TRASPORTATORE,
      destinatarioId: REGISTRO_DESTINATARIO,
      tenantId,
      creatoDaUserId: userId,
    })

    await expect(repo.save(primoFir)).resolves.not.toThrow()
    await expect(repo.save(secondoFir)).resolves.not.toThrow()
  })

  describe('rentriStatoFormulario', () => {
    // findById usa this.prisma.db: serve un client con la proprietà `db`.
    let repoLettura: FIRPrismaRepository
    beforeAll(() => {
      repoLettura = new FIRPrismaRepository(
        Object.assign(prisma, { db: prisma }) as any,
        prisma as any
      )
    })

    it('rentriStatoFormulario sopravvive a save e findById', async () => {
      const fir = buildFirAgganciato(`RENTRI-SF-${Date.now()}`)
      await repoLettura.save(fir)
      fir.applyRentriStato('Annullato')
      await repoLettura.save(fir)
      expect(
        (await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })).rentriStatoFormulario
      ).toBe('Annullato')
      expect((await repoLettura.findById(fir.id))!.rentriStatoFormulario).toBe('Annullato')
    })

    it('un salvataggio successivo non cancella lo stato dell ente', async () => {
      const fir = buildFirAgganciato(`RENTRI-SF2-${Date.now()}`)
      fir.applyRentriStato('RespintoAccettatoParzialmente')
      await repoLettura.save(fir)
      const riletto = (await repoLettura.findById(fir.id))!
      await repoLettura.save(riletto) // salvataggio per un altro motivo
      expect((await repoLettura.findById(fir.id))!.rentriStatoFormulario).toBe(
        'RespintoAccettatoParzialmente'
      )
    })

    it("un salvataggio con dati vecchi non riporta indietro un FIR annullato all'ente", async () => {
      const fir = buildFirAgganciato(`RENTRI-SF4-${Date.now()}`)
      fir.applyRentriStato('Accettato')
      await repoLettura.save(fir)
      // Copia caricata prima dell'annullamento (es. sync RENTRI in background).
      const copiaVecchia = (await repoLettura.findById(fir.id))!
      const copiaNuova = (await repoLettura.findById(fir.id))!
      copiaNuova.applyRentriStato('Annullato')
      await repoLettura.save(copiaNuova)

      // L'annullamento all'ente porta il FIR in CANCELLED: la copia vecchia
      // (COMPLETED) viene rifiutata invece di riportarlo indietro.
      await expect(repoLettura.save(copiaVecchia)).rejects.toBeInstanceOf(
        FirAnnullatoNelFrattempoError
      )

      const riga = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
      expect(riga.rentriStatoFormulario).toBe('Annullato')
      expect(riga.status).toBe('CANCELLED')
    })

    it('un FIR mai riconciliato resta con rentriStatoFormulario null', async () => {
      const fir = buildFirAgganciato(`RENTRI-SF3-${Date.now()}`)
      await repoLettura.save(fir)
      expect((await repoLettura.findById(fir.id))!.rentriStatoFormulario).toBeNull()
    })
  })

  describe('annullamento locale concorrente a un salvataggio con dati vecchi', () => {
    // findById usa this.prisma.db: serve un client con la proprietà `db`.
    let repoLettura: FIRPrismaRepository
    beforeAll(() => {
      repoLettura = new FIRPrismaRepository(
        Object.assign(prisma, { db: prisma }) as any,
        prisma as any
      )
    })

    async function salvaFirEmesso(): Promise<FIR> {
      const fir = FIR.create({
        produttoreId: REGISTRO_PRODUTTORE,
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: REGISTRO_TRASPORTATORE,
        destinatarioId: REGISTRO_DESTINATARIO,
        tenantId,
        creatoDaUserId: userId,
      })
      await repoLettura.save(fir)
      fir.emetti(`FIR-ANN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, {
        firmatario: 'Mario Rossi',
        timestamp: new Date(),
        certificato: 'x',
        userId,
      })
      await repoLettura.save(fir)
      return fir
    }

    it('un save stantio non riporta in vita un FIR annullato', async () => {
      const fir = await salvaFirEmesso()
      // Copia caricata prima dell'annullamento (es. sync RENTRI in attesa dell'esito).
      const copiaVecchia = (await repoLettura.findById(fir.id))!
      const copiaNuova = (await repoLettura.findById(fir.id))!
      copiaNuova.annulla('Errore di compilazione')
      await repoLettura.save(copiaNuova)

      await expect(repoLettura.save(copiaVecchia)).rejects.toBeInstanceOf(
        FirAnnullatoNelFrattempoError
      )

      const riga = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
      expect(riga.status).toBe('CANCELLED')
    })

    it('due salvataggi concorrenti dello stesso FIR si serializzano senza errori', async () => {
      const fir = await salvaFirEmesso()
      const a = (await repoLettura.findById(fir.id))!
      const b = (await repoLettura.findById(fir.id))!

      await expect(Promise.all([repoLettura.save(a), repoLettura.save(b)])).resolves.toEqual([
        undefined,
        undefined,
      ])

      const riga = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
      expect(riga.status).not.toBe('CANCELLED')
    })

    it('un salvataggio non aspetta il FOR KEY SHARE di una registrazione aperta sul FIR', async () => {
      const fir = await salvaFirEmesso()
      const copia = (await repoLettura.findById(fir.id))!
      let rilascia!: () => void
      const attesa = new Promise<void>(r => (rilascia = r))
      let bloccato!: () => void
      const bloccatoPronto = new Promise<void>(r => (bloccato = r))

      // È il lock che l'insert di un movimento con fir_id prende sulla riga del FIR.
      const registrazione = prisma.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT id FROM firs WHERE id = ${fir.id}::uuid FOR KEY SHARE`
          bloccato()
          await attesa
        },
        { timeout: 20_000 }
      )
      await bloccatoPronto

      try {
        const esito = await Promise.race([
          repoLettura.save(copia).then(() => 'salvato'),
          new Promise(r => setTimeout(() => r('in attesa del lock'), 3_000)),
        ])
        expect(esito).toBe('salvato')
      } finally {
        rilascia()
        await registrazione
      }
    })

    it('un FIR già annullato si può salvare di nuovo', async () => {
      const fir = await salvaFirEmesso()
      const copia = (await repoLettura.findById(fir.id))!
      copia.annulla('Errore di compilazione')
      await repoLettura.save(copia)

      const riletto = (await repoLettura.findById(fir.id))!
      await expect(repoLettura.save(riletto)).resolves.toBeUndefined()

      const riga = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
      expect(riga.status).toBe('CANCELLED')
    })
  })

  describe('atomicità di stato e firme', () => {
    function buildFirBozza(): FIR {
      return FIR.create({
        produttoreId: REGISTRO_PRODUTTORE,
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: REGISTRO_TRASPORTATORE,
        destinatarioId: REGISTRO_DESTINATARIO,
        tenantId,
        creatoDaUserId: userId,
      })
    }

    it('se la firma non si può scrivere, lo stato del FIR non cambia', async () => {
      const fir = buildFirBozza()
      await repo.save(fir) // BOZZA
      fir.emetti('FIR-2099-000001', {
        firmatario: 'Mario Rossi',
        timestamp: new Date(),
        certificato: 'x',
        // utente inesistente: la scrittura della firma viola la FK, dopo l'upsert del FIR
        userId: '99999999-9999-4999-8999-999999999999',
      })

      await expect(repo.save(fir)).rejects.toThrow()

      const riletto = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
      expect(riletto.status).toBe('DRAFT')
      expect(riletto.firNumber).toBeNull()
      expect(await prisma.fIRSignature.count({ where: { firId: fir.id } })).toBe(0)
    })

    it('con una firma scrivibile, stato e firma risultano salvati insieme', async () => {
      const fir = buildFirBozza()
      await repo.save(fir)
      fir.emetti('FIR-2099-000002', {
        firmatario: 'Mario Rossi',
        timestamp: new Date(),
        certificato: 'x',
        userId,
      })

      await repo.save(fir)

      const riletto = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
      expect(riletto.status).toBe('AWAITING_CARRIER')
      expect(riletto.firNumber).toBe('FIR-2099-000002')
      expect(await prisma.fIRSignature.count({ where: { firId: fir.id } })).toBe(1)
    })
  })

  describe('riferimento interno del FIR per tenant e anno di emissione', () => {
    // Tenant dedicato: il progressivo conta solo i FIR di questo tenant, quindi
    // i FIR creati dagli altri test non lo falsano.
    let repoNumeri: FIRPrismaRepository
    let tenantNumeri: string
    let utenteNumeri: string

    beforeAll(async () => {
      // findById usa this.prisma.db: serve un client con la proprietà `db`.
      repoNumeri = new FIRPrismaRepository(
        Object.assign(prisma, { db: prisma }) as any,
        prisma as any
      )
      const tenant = await prisma.tenant.create({
        data: {
          partitaIva: partitaIvaUnica(),
          ragioneSociale: 'Numerazione FIR Test SRL',
          country: 'IT',
        },
      })
      tenantNumeri = tenant.id
      const user = await prisma.user.create({
        data: {
          tenantId: tenantNumeri,
          keycloakId: `keycloak-nf-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `nf-${Date.now()}@example.com`,
          role: 'OPERATOR',
        },
      })
      utenteNumeri = user.id
    })

    afterAll(async () => {
      if (!tenantNumeri) return // senza id deleteMany non avrebbe filtro
      await prisma.fIR.deleteMany({ where: { tenantId: tenantNumeri } })
      await prisma.user.deleteMany({ where: { tenantId: tenantNumeri } })
      await prisma.tenant.deleteMany({ where: { id: tenantNumeri } })
    })

    function firma(uid: string): FirmaDigitale {
      return { firmatario: 'Mario Rossi', timestamp: new Date(), certificato: 'x', userId: uid }
    }

    async function bozza(): Promise<FIR> {
      const fir = FIR.create({
        produttoreId: REGISTRO_PRODUTTORE,
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: REGISTRO_TRASPORTATORE,
        destinatarioId: REGISTRO_DESTINATARIO,
        tenantId: tenantNumeri,
        creatoDaUserId: utenteNumeri,
      })
      await repoNumeri.save(fir)
      return fir
    }

    it("una bozza creata a dicembre ed emessa a gennaio conta nel progressivo dell'anno di emissione", async () => {
      const a = await bozza()
      await prisma.fIR.update({
        where: { id: a.id },
        data: { createdAt: new Date('2026-12-31T10:00:00Z') },
      })
      expect(
        await repoNumeri.emettiConNumerazione(a, 2027, n => a.emetti(n, firma(utenteNumeri)))
      ).toBe('FIR-2027-000001')
      const b = await bozza()
      expect(
        await repoNumeri.emettiConNumerazione(b, 2027, n => b.emetti(n, firma(utenteNumeri)))
      ).toBe('FIR-2027-000002')
    })

    it('due emissioni concorrenti di bozze diverse prendono numeri consecutivi senza errori', async () => {
      const [x, y] = [await bozza(), await bozza()]
      const numeri = await Promise.all([
        repoNumeri.emettiConNumerazione(x, 2028, n => x.emetti(n, firma(utenteNumeri))),
        repoNumeri.emettiConNumerazione(y, 2028, n => y.emetti(n, firma(utenteNumeri))),
      ])
      expect(numeri.sort()).toEqual(['FIR-2028-000001', 'FIR-2028-000002'])
    })

    it('la stessa bozza emessa due volte in parallelo: una sola emissione', async () => {
      const f = await bozza()
      const copia1 = (await repoNumeri.findById(f.id))!
      const copia2 = (await repoNumeri.findById(f.id))!
      const esiti = await Promise.allSettled([
        repoNumeri.emettiConNumerazione(copia1, 2029, n => copia1.emetti(n, firma(utenteNumeri))),
        repoNumeri.emettiConNumerazione(copia2, 2029, n => copia2.emetti(n, firma(utenteNumeri))),
      ])
      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(rifiutato.reason).toBeInstanceOf(FirNonPiuInBozzaError)
      expect(await prisma.fIRSignature.count({ where: { firId: f.id } })).toBe(1)
    })

    it('un FIR gia` ANNULLATO prima dell emissione: FirAnnullatoNelFrattempoError, non «non piu in bozza»', async () => {
      const f = await bozza()
      await prisma.fIR.update({ where: { id: f.id }, data: { status: 'CANCELLED' } })

      await expect(
        repoNumeri.emettiConNumerazione(f, 2031, n => f.emetti(n, firma(utenteNumeri)))
      ).rejects.toBeInstanceOf(FirAnnullatoNelFrattempoError)
    })

    it('il progressivo ignora i numeri che non hanno il formato FIR-AAAA-N', async () => {
      // Un FIR del tenant con un riferimento fuori formato (dati storici o
      // importati) non deve far fallire il cast né contare nel massimo.
      const vecchio = await bozza()
      await prisma.fIR.update({ where: { id: vecchio.id }, data: { firNumber: 'FIR-2030-ABC' } })

      const f = await bozza()
      expect(
        await repoNumeri.emettiConNumerazione(f, 2030, n => f.emetti(n, firma(utenteNumeri)))
      ).toBe('FIR-2030-000001')
    })

    it('un riferimento con troppe cifre non blocca l emissione e non conta nel massimo', async () => {
      // 11 cifre: fuori dal campo di un integer, il cast farebbe fallire ogni emissione.
      const importato = await bozza()
      await prisma.fIR.update({
        where: { id: importato.id },
        data: { firNumber: 'FIR-2031-12345678901' },
      })
      const regolare = await bozza()
      await prisma.fIR.update({
        where: { id: regolare.id },
        data: { firNumber: 'FIR-2031-000005' },
      })

      const f = await bozza()
      expect(
        await repoNumeri.emettiConNumerazione(f, 2031, n => f.emetti(n, firma(utenteNumeri)))
      ).toBe('FIR-2031-000006')
    })
  })

  describe('prenotazione atomica della trasmissione RENTRI', () => {
    let repoLettura: FIRPrismaRepository
    const creati: string[] = []
    const ORA = new Date('2026-10-23T10:00:00.000Z')
    const SOGLIA = new Date('2026-10-23T09:55:00.000Z')

    beforeAll(() => {
      repoLettura = new FIRPrismaRepository(
        Object.assign(prisma, { db: prisma }) as any,
        prisma as any
      )
    })

    afterAll(async () => {
      // Solo le righe create da questi test, mai una cancellazione senza filtro.
      if (creati.length > 0) await prisma.fIR.deleteMany({ where: { id: { in: creati } } })
    })

    async function nuovoFir(dati: Record<string, unknown> = {}): Promise<FIR> {
      const fir = FIR.create({
        produttoreId: REGISTRO_PRODUTTORE,
        rifiuto: { cerCode: '150101', quantita: 10 },
        trasportatoreId: REGISTRO_TRASPORTATORE,
        destinatarioId: REGISTRO_DESTINATARIO,
        tenantId,
        creatoDaUserId: userId,
      })
      await repoLettura.save(fir)
      creati.push(fir.id)
      if (Object.keys(dati).length > 0) {
        await prisma.fIR.update({ where: { id: fir.id }, data: dati as any })
      }
      return fir
    }

    const riga = (id: string) => prisma.fIR.findUniqueOrThrow({ where: { id } })

    it('due prenotazioni concorrenti: una sola vince', async () => {
      const fir = await nuovoFir()
      // La prima prenotazione resta in una transaction aperta (riga bloccata): la
      // seconda deve aspettarla, poi rileggere la riga già prenotata e perdere.
      let rilascia!: () => void
      const via = new Promise<void>(r => (rilascia = r))
      let primaFatta!: (v: boolean) => void
      const prima = new Promise<boolean>(r => (primaFatta = r))
      const trans = prisma.$transaction(async tx => {
        primaFatta(await repoLettura.prenotaTrasmissioneRentri(fir.id, tenantId, ORA, SOGLIA, tx))
        await via
      })
      expect(await prima).toBe(true)
      let seconda: boolean | undefined
      const secondaP = repoLettura
        .prenotaTrasmissioneRentri(fir.id, tenantId, ORA, SOGLIA)
        .then(v => (seconda = v))
      await new Promise(r => setTimeout(r, 300))
      expect(seconda).toBeUndefined() // ancora in attesa del lock della prima
      rilascia()
      await trans
      await secondaP
      expect(seconda).toBe(false)
      const r = await riga(fir.id)
      expect(r.rentriSyncStatus).toBe('SYNCING')
      expect(r.rentriSyncAvviatoAt).toEqual(ORA)
    })

    it('SYNCING recente non si riprenota, SYNCING scaduto sì', async () => {
      const recente = await nuovoFir({
        rentriSyncStatus: 'SYNCING',
        rentriSyncAvviatoAt: new Date('2026-10-23T09:58:00.000Z'),
      })
      expect(await repoLettura.prenotaTrasmissioneRentri(recente.id, tenantId, ORA, SOGLIA)).toBe(
        false
      )
      const scaduto = await nuovoFir({
        rentriSyncStatus: 'SYNCING',
        rentriSyncAvviatoAt: new Date('2026-10-23T09:00:00.000Z'),
      })
      expect(await repoLettura.prenotaTrasmissioneRentri(scaduto.id, tenantId, ORA, SOGLIA)).toBe(
        true
      )
      const senzaData = await nuovoFir({ rentriSyncStatus: 'SYNCING', rentriSyncAvviatoAt: null })
      expect(await repoLettura.prenotaTrasmissioneRentri(senzaData.id, tenantId, ORA, SOGLIA)).toBe(
        true
      )
      const fallito = await nuovoFir({ rentriSyncStatus: 'FAILED' })
      expect(await repoLettura.prenotaTrasmissioneRentri(fallito.id, tenantId, ORA, SOGLIA)).toBe(
        true
      )
    })

    it("FIR legato, CANCELLED, annullato all'ente o di un altro tenant: false", async () => {
      const legato = await nuovoFir({ rentriNumeroFir: `RENTRI-PR-${Date.now()}` })
      const annullato = await nuovoFir({ status: 'CANCELLED' })
      const annullatoEnte = await nuovoFir({ rentriStatoFormulario: 'Annullato' })
      const altroTenant = await nuovoFir()
      for (const f of [legato, annullato, annullatoEnte]) {
        expect(await repoLettura.prenotaTrasmissioneRentri(f.id, tenantId, ORA, SOGLIA)).toBe(false)
      }
      expect(
        await repoLettura.prenotaTrasmissioneRentri(
          altroTenant.id,
          '99999999-9999-4999-8999-999999999999',
          ORA,
          SOGLIA
        )
      ).toBe(false)
      expect((await riga(altroTenant.id)).rentriSyncStatus).toBe('PENDING')
    })

    it("registraTransazioneInAttesa e reload: rentriTransazioneInAttesa e rentriSyncAvviatoAt riletti dall'aggregate", async () => {
      const fir = await nuovoFir()
      // fuori da SYNCING la scrittura non deve avere effetto
      expect(
        await repoLettura.registraTransazioneInAttesa(fir.id, tenantId, 'tx-ignorata', ORA)
      ).toBe(false)
      expect((await riga(fir.id)).rentriTransazioneInAttesa).toBeNull()

      expect(await repoLettura.prenotaTrasmissioneRentri(fir.id, tenantId, ORA, SOGLIA)).toBe(true)
      expect(await repoLettura.registraTransazioneInAttesa(fir.id, tenantId, 'tx-123', ORA)).toBe(
        true
      )
      const riletto = (await repoLettura.findById(fir.id))!
      expect(riletto.rentriTransazioneInAttesa).toBe('tx-123')
      expect(riletto.rentriTransazioneId).toBe('tx-123')
      expect(riletto.rentriSyncAvviatoAt).toEqual(ORA)
    })

    it('registraTransazioneInAttesa con un avviatoAt diverso non scrive e restituisce false', async () => {
      const fir = await nuovoFir()
      await repoLettura.prenotaTrasmissioneRentri(fir.id, tenantId, ORA, SOGLIA)
      const altro = new Date('2026-10-23T10:05:00.000Z')
      expect(await repoLettura.registraTransazioneInAttesa(fir.id, tenantId, 'tx-x', altro)).toBe(
        false
      )
      expect((await riga(fir.id)).rentriTransazioneInAttesa).toBeNull()
    })

    it('prenotaTrasmissioneRentri con ora non successiva alla soglia e un errore', async () => {
      const fir = await nuovoFir()
      await expect(
        repoLettura.prenotaTrasmissioneRentri(fir.id, tenantId, SOGLIA, ORA)
      ).rejects.toThrow()
    })

    it('save di un aggregate caricato prima della prenotazione non cancella la prenotazione né la transazione in attesa', async () => {
      const fir = await nuovoFir()
      const vecchio = (await repoLettura.findById(fir.id))!
      expect(await repoLettura.prenotaTrasmissioneRentri(fir.id, tenantId, ORA, SOGLIA)).toBe(true)
      await repoLettura.registraTransazioneInAttesa(fir.id, tenantId, 'tx-viva', ORA)
      // campo senza significato RENTRI (annotazioni, campo 17): l'aggregate stantio lo scrive,
      // la prenotazione viva no, e nessun legame compare su un FIR ancora in trasmissione
      ;(vecchio as any)._annotazioni = "nota dell'aggregate stantio"
      await repoLettura.save(vecchio)
      const r = await riga(fir.id)
      expect(r.rentriSyncStatus).toBe('SYNCING')
      expect(r.rentriSyncAvviatoAt).toEqual(ORA)
      expect(r.rentriTransazioneInAttesa).toBe('tx-viva')
      expect(r.rentriTransazioneId).toBe('tx-viva')
      expect(r.wasteNotes).toBe("nota dell'aggregate stantio")
      expect(r.rentriNumeroFir).toBeNull()
    })

    it("save dell'aggregate che possiede il tentativo scrive il suo stato", async () => {
      const fir = await nuovoFir()
      await repoLettura.prenotaTrasmissioneRentri(fir.id, tenantId, ORA, SOGLIA)
      await repoLettura.registraTransazioneInAttesa(fir.id, tenantId, 'tx-mia', ORA)
      const mio = (await repoLettura.findById(fir.id))!
      expect(mio.rentriSyncAvviatoAt).toEqual(ORA)
      mio.chiudiTransazioneInAttesa()
      await repoLettura.save(mio)
      const r = await riga(fir.id)
      expect(r.rentriTransazioneInAttesa).toBeNull()
      expect(r.rentriSyncAvviatoAt).toEqual(ORA)
    })

    it('save di un aggregate con transazione in attesa azzerata la scrive NULL', async () => {
      const fir = await nuovoFir()
      fir.registraTransazioneInAttesa('tx-456')
      await repoLettura.save(fir)
      expect((await riga(fir.id)).rentriTransazioneInAttesa).toBe('tx-456')
      fir.chiudiTransazioneInAttesa()
      await repoLettura.save(fir)
      expect((await riga(fir.id)).rentriTransazioneInAttesa).toBeNull()
    })

    it('elencaTrasmissioniRentriSospese restituisce solo gli scaduti', async () => {
      const scaduto = await nuovoFir({
        rentriSyncStatus: 'SYNCING',
        rentriSyncAvviatoAt: new Date('2026-10-23T09:00:00.000Z'),
      })
      const senzaData = await nuovoFir({ rentriSyncStatus: 'SYNCING', rentriSyncAvviatoAt: null })
      const recente = await nuovoFir({
        rentriSyncStatus: 'SYNCING',
        rentriSyncAvviatoAt: new Date('2026-10-23T09:59:00.000Z'),
      })
      const pending = await nuovoFir()
      const elenco = await repoLettura.elencaTrasmissioniRentriSospese(
        SOGLIA,
        1000,
        new Date('2026-01-01T00:00:00Z'),
        await tuttiGliId()
      )
      const ids = elenco.map(e => e.firId)
      expect(ids).toEqual(expect.arrayContaining([scaduto.id, senzaData.id]))
      expect(ids).not.toContain(recente.id)
      expect(ids).not.toContain(pending.id)
      expect(elenco.find(e => e.firId === scaduto.id)!.tenantId).toBe(tenantId)
      // senza data per primo (NULLS FIRST)
      expect(ids.indexOf(senzaData.id)).toBeLessThan(ids.indexOf(scaduto.id))
    })

    describe('recupero dei PENDING mai avviati', () => {
      const VECCHIO = new Date('2026-10-20T10:00:00.000Z') // oltre SOGLIA, dentro il tetto di eta'
      const TETTO = new Date('2026-10-01T00:00:00.000Z') // "pendingAggiornatiDopo"
      const extra: { tenant: string[]; piattaformaCreata: boolean } = {
        tenant: [],
        piattaformaCreata: false,
      }

      async function creaTenant(
        modalita: 'MANUALE' | 'AUTOMATICA' | 'IBRIDA',
        subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' = 'ACTIVE',
        parentTenantId?: string
      ): Promise<string> {
        const t = await prisma.tenant.create({
          data: {
            partitaIva: partitaIvaUnica(),
            ragioneSociale: `Pending ${modalita}`,
            country: 'IT',
            rentriModalitaLegame: modalita,
            subscriptionStatus,
            ...(parentTenantId ? { parentTenantId } : {}),
          },
        })
        extra.tenant.push(t.id)
        return t.id
      }

      async function firDi(
        tenant: string,
        dati: Record<string, unknown> = {},
        aggiornatoIl: Date | null = VECCHIO
      ): Promise<string> {
        const fir = FIR.create({
          produttoreId: REGISTRO_PRODUTTORE,
          rifiuto: { cerCode: '150101', quantita: 10 },
          trasportatoreId: REGISTRO_TRASPORTATORE,
          destinatarioId: REGISTRO_DESTINATARIO,
          tenantId: tenant,
          creatoDaUserId: userId,
        })
        await repoLettura.save(fir)
        creati.push(fir.id)
        // Un FIR "emesso" (non bozza): lo stato DB che il recupero considera.
        await prisma.fIR.update({
          where: { id: fir.id },
          data: { status: 'AWAITING_CARRIER', ...dati } as any,
        })
        if (aggiornatoIl) {
          // updated_at e' @updatedAt: Prisma lo riscrive, quindi si forza in SQL (UTC).
          await prisma.$executeRaw`UPDATE firs SET updated_at = (${aggiornatoIl.toISOString()}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${fir.id}::uuid`
        }
        return fir.id
      }

      afterAll(async () => {
        if (creati.length > 0) await prisma.fIR.deleteMany({ where: { id: { in: creati } } })
        // Le figlie prima delle madri (FK `Restrict`), solo per id esatti.
        if (extra.tenant.length > 0) {
          await prisma.tenant.deleteMany({
            where: { id: { in: extra.tenant }, parentTenantId: { not: null } },
          })
          await prisma.tenant.deleteMany({ where: { id: { in: extra.tenant } } })
        }
        if (extra.piattaformaCreata)
          await prisma.tenant.deleteMany({ where: { id: AZIENDA_PIATTAFORMA_ID } })
      })

      it('PENDING in AUTOMATICA e IBRIDA: elencati con stato PENDING; esclusi MANUALE, legati, annullati, bozze, con avvio, recenti, troppo vecchi', async () => {
        const auto = await creaTenant('AUTOMATICA')
        const ibrida = await creaTenant('IBRIDA')
        const manuale = await creaTenant('MANUALE')
        const inAuto = await firDi(auto)
        const inIbrida = await firDi(ibrida)
        const inManuale = await firDi(manuale)
        const legato = await firDi(auto, { rentriNumeroFir: `RENTRI-PD-${Date.now()}` })
        const annullatoLocale = await firDi(auto, { status: 'CANCELLED' })
        const annullatoRentri = await firDi(auto, { rentriStatoFormulario: 'Annullato' })
        const bozza = await firDi(auto, { status: 'DRAFT' })
        const conAvvio = await firDi(auto, {
          rentriSyncAvviatoAt: new Date('2026-10-22T10:00:00Z'),
        })
        const recente = await firDi(auto, {}, null) // updated_at = adesso, dopo SOGLIA
        const troppoVecchio = await firDi(auto, {}, new Date('2026-08-01T10:00:00.000Z'))

        const elenco = await repoLettura.elencaTrasmissioniRentriSospese(
          SOGLIA,
          1000,
          TETTO,
          await tuttiGliId()
        )
        const ids = elenco.map(e => e.firId)

        expect(elenco.find(e => e.firId === inAuto)).toEqual({
          firId: inAuto,
          tenantId: auto,
          stato: 'PENDING',
        })
        expect(elenco.find(e => e.firId === inIbrida)!.stato).toBe('PENDING')
        for (const escluso of [
          inManuale,
          legato,
          annullatoLocale,
          annullatoRentri,
          bozza,
          conAvvio,
          recente,
          troppoVecchio,
        ]) {
          expect(ids).not.toContain(escluso)
        }
      })

      it("l'azienda piattaforma e' esclusa anche in AUTOMATICA", async () => {
        const esistente = await prisma.tenant.findUnique({ where: { id: AZIENDA_PIATTAFORMA_ID } })
        if (!esistente) {
          await prisma.tenant.create({
            data: {
              id: AZIENDA_PIATTAFORMA_ID,
              partitaIva: partitaIvaUnica(),
              ragioneSociale: 'Piattaforma test',
              country: 'IT',
            },
          })
          extra.piattaformaCreata = true
        }
        const modalitaPrima = esistente?.rentriModalitaLegame ?? 'MANUALE'
        await prisma.tenant.update({
          where: { id: AZIENDA_PIATTAFORMA_ID },
          data: { rentriModalitaLegame: 'AUTOMATICA' },
        })
        try {
          const firPiattaforma = await firDi(AZIENDA_PIATTAFORMA_ID)
          const elenco = await repoLettura.elencaTrasmissioniRentriSospese(
            SOGLIA,
            1000,
            TETTO,
            await tuttiGliId()
          )
          expect(elenco.map(e => e.firId)).not.toContain(firPiattaforma)
        } finally {
          await prisma.tenant.update({
            where: { id: AZIENDA_PIATTAFORMA_ID },
            data: { rentriModalitaLegame: modalitaPrima },
          })
        }
      })

      it('elenco di aziende vuoto: nessun errore SQL, restano i SYNCING', async () => {
        const vuoto = new FIRPrismaRepository(
          Object.assign(prisma, { db: prisma }) as any,
          {
            $queryRaw: (testo: any, ...valori: any[]) => prisma.$queryRaw(testo, ...valori),
            tenant: { findMany: async () => [] },
          } as any
        )
        const syncing = await firDi(tenantId, {
          rentriSyncStatus: 'SYNCING',
          rentriSyncAvviatoAt: new Date('2026-10-23T09:00:00.000Z'),
        })
        const elenco = await vuoto.elencaTrasmissioniRentriSospese(
          SOGLIA,
          1000,
          TETTO,
          await tuttiGliId()
        )
        expect(elenco.map(e => e.firId)).toContain(syncing)
        expect(elenco.every(e => e.stato === 'SYNCING')).toBe(true)
      })

      it('starvation: 101 SYNCING di aziende senza rentri non occupano il lotto di 100 di chi ha il modulo', async () => {
        const senzaRentri = await creaTenant('AUTOMATICA')
        const conRentri = await creaTenant('AUTOMATICA')
        const vecchio = {
          rentriSyncStatus: 'SYNCING',
          rentriSyncAvviatoAt: new Date('2000-01-01Z'),
        }
        for (let i = 0; i < 101; i++) await firDi(senzaRentri, vecchio)
        const suo = await firDi(conRentri, {
          rentriSyncStatus: 'SYNCING',
          rentriSyncAvviatoAt: new Date('2000-06-01Z'),
        })

        // Come fa il job: l'elenco delle aziende ammesse (col modulo) e' solo conRentri, e il LIMIT e' 100.
        const elenco = await repoLettura.elencaTrasmissioniRentriSospese(SOGLIA, 100, TETTO, [
          conRentri,
        ])

        expect(elenco.map(e => e.firId)).toEqual([suo])
        expect(elenco.some(e => e.tenantId === senzaRentri)).toBe(false)
      })

      it('azienda SOSPESA col modulo: il suo SYNCING si riprende (trasmissione partita), il suo PENDING no', async () => {
        const sospesa = await creaTenant('AUTOMATICA', 'SUSPENDED')
        const syncing = await firDi(sospesa, {
          rentriSyncStatus: 'SYNCING',
          rentriSyncAvviatoAt: new Date('2000-01-01Z'),
        })
        const pending = await firDi(sospesa)

        const ids = (
          await repoLettura.elencaTrasmissioniRentriSospese(SOGLIA, 100, TETTO, [sospesa])
        ).map(e => e.firId)

        expect(ids).toContain(syncing)
        expect(ids).not.toContain(pending)
      })

      it('aziende ammesse vuote: elenco vuoto, nessun errore SQL', async () => {
        const t = await creaTenant('AUTOMATICA')
        await firDi(t, {
          rentriSyncStatus: 'SYNCING',
          rentriSyncAvviatoAt: new Date('2000-01-01Z'),
        })
        await firDi(t)
        expect(await repoLettura.elencaTrasmissioniRentriSospese(SOGLIA, 100, TETTO, [])).toEqual(
          []
        )
      })

      it('i SYNCING in stallo vengono prima dei PENDING mai avviati, anche con un limite basso', async () => {
        const auto = await creaTenant('AUTOMATICA')
        for (let i = 0; i < 3; i++) await firDi(auto)
        await firDi(auto, {
          rentriSyncStatus: 'SYNCING',
          rentriSyncAvviatoAt: new Date('2026-10-23T09:00:00.000Z'),
        })
        const elenco = await repoLettura.elencaTrasmissioniRentriSospese(
          SOGLIA,
          1,
          TETTO,
          await tuttiGliId()
        )
        expect(elenco).toHaveLength(1)
        expect(elenco[0].stato).toBe('SYNCING')
      })

      it('aziende con abbonamento non ACTIVE/TRIAL (scaduto, sospeso): i loro PENDING non si riprendono', async () => {
        const attiva = await creaTenant('AUTOMATICA', 'ACTIVE')
        const prova = await creaTenant('IBRIDA', 'TRIAL')
        const scaduta = await creaTenant('AUTOMATICA', 'EXPIRED')
        const sospesa = await creaTenant('AUTOMATICA', 'SUSPENDED')
        const inAttiva = await firDi(attiva)
        const inProva = await firDi(prova)
        const inScaduta = await firDi(scaduta)
        const inSospesa = await firDi(sospesa)

        const ids = (
          await repoLettura.elencaTrasmissioniRentriSospese(SOGLIA, 1000, TETTO, await tuttiGliId())
        ).map(e => e.firId)

        expect(ids).toEqual(expect.arrayContaining([inAttiva, inProva]))
        expect(ids).not.toContain(inScaduta)
        expect(ids).not.toContain(inSospesa)
      })

      it("l'abbonamento di una figlia e' quello della madre: colonna propria divergente ignorata", async () => {
        const madreAttiva = await creaTenant('AUTOMATICA', 'ACTIVE')
        const figliaScaduta = await creaTenant('AUTOMATICA', 'EXPIRED', madreAttiva)
        const madreSospesa = await creaTenant('AUTOMATICA', 'SUSPENDED')
        const figliaAttiva = await creaTenant('AUTOMATICA', 'ACTIVE', madreSospesa)
        const inFigliaScaduta = await firDi(figliaScaduta)
        const inFigliaAttiva = await firDi(figliaAttiva)

        const ids = (
          await repoLettura.elencaTrasmissioniRentriSospese(SOGLIA, 1000, TETTO, await tuttiGliId())
        ).map(e => e.firId)

        expect(ids).toContain(inFigliaScaduta)
        expect(ids).not.toContain(inFigliaAttiva)
      })

      it("un FIR appena riaperto di un'altra azienda passa davanti a molti PENDING vecchi oltre il limite", async () => {
        const rotta = await creaTenant('AUTOMATICA')
        const sana = await creaTenant('AUTOMATICA')
        for (let i = 0; i < 12; i++) await firDi(rotta, {}, new Date('2026-10-05T10:00:00.000Z'))
        const riaperto = await firDi(sana, {}, new Date('2026-10-22T08:00:00.000Z'))

        // I SYNCING in stallo (anche di altri test) vengono comunque per primi: il limite li include.
        const tutti = await repoLettura.elencaTrasmissioniRentriSospese(
          SOGLIA,
          10000,
          TETTO,
          await tuttiGliId()
        )
        const nSyncing = tutti.filter(e => e.stato === 'SYNCING').length
        const limite = nSyncing + 5

        const elenco = await repoLettura.elencaTrasmissioniRentriSospese(
          SOGLIA,
          limite,
          TETTO,
          await tuttiGliId()
        )

        expect(elenco).toHaveLength(limite)
        // Il primo PENDING dopo i SYNCING e' il riaperto di recente.
        expect(elenco[nSyncing].firId).toBe(riaperto)
      })

      it('la soglia su updated_at non dipende dal fuso della sessione', async () => {
        const auto = await creaTenant('AUTOMATICA')
        const id = await firDi(auto, {}, new Date('2026-10-23T09:00:00.000Z'))
        const dopo = await repoLettura.elencaTrasmissioniRentriSospese(
          new Date('2026-10-23T10:00:00.000Z'),
          1000,
          TETTO,
          await tuttiGliId()
        )
        expect(dopo.map(e => e.firId)).toContain(id)
        const prima = await repoLettura.elencaTrasmissioniRentriSospese(
          new Date('2026-10-23T08:00:00.000Z'),
          1000,
          TETTO,
          await tuttiGliId()
        )
        expect(prima.map(e => e.firId)).not.toContain(id)
      })
    })

    it('rentri_sync_avviato_at è TIMESTAMPTZ: la soglia di stallo non dipende dal fuso della sessione', async () => {
      const [colonna] = await prisma.$queryRaw<{ data_type: string; datetime_precision: number }[]>`
        SELECT data_type, datetime_precision FROM information_schema.columns
        WHERE table_name = 'firs' AND column_name = 'rentri_sync_avviato_at'`
      expect(colonna).toEqual({ data_type: 'timestamp with time zone', datetime_precision: 3 })
    })

    it('transazione in attesa, certificato mancante, caricamento del certificato, riapertura e ripresa: nessuna nuova POST', async () => {
      // FIR emesso con una transazione già accettata dall'ente (polling interrotto).
      const fir = await nuovoFir({
        status: 'AWAITING_CARRIER',
        rentriSyncStatus: 'FAILED',
        rentriSyncAttempts: 1,
        rentriLastSyncError: 'Polling interrotto',
        rentriLastSyncErrorCode: 'RENTRI_API_ERROR',
        rentriTransazioneInAttesa: 'tx-attesa-certificato',
        rentriTransazioneId: 'tx-attesa-certificato',
      })

      const creaFormulario = jest.fn()
      const attendiEsito = jest
        .fn()
        .mockRejectedValueOnce(new TenantSenzaCertificatoRentriError())
        .mockResolvedValueOnce({
          errore: false,
          validazione: [],
          esito: { numero_fir: `RENTRI-B6-${Date.now()}` },
        })
      const costruisci = jest.fn()
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }
      const useCase = new SyncFIRToRENTRIUseCase(
        repoLettura,
        { creaFormulario, attendiEsito } as any,
        {
          createPending: jest.fn(async (p: any) => RENTRISyncLog.createPending(p)),
          save: jest.fn(async (l: any) => l),
        } as any,
        { publish: jest.fn() } as any,
        logger,
        { costruisci } as any
      )

      try {
        // 1. L'azienda non ha il certificato: esito definitivo, la transazione resta salvata.
        const primo = await useCase.execute(fir.id, tenantId)
        expect(primo).toMatchObject({ success: false, willRetry: false })
        const fermo = await riga(fir.id)
        expect(fermo.rentriSyncStatus).toBe('PERMANENTLY_FAILED')
        expect(fermo.rentriLastSyncErrorCode).toBe(CODICE_CERTIFICATO_MANCANTE)
        expect(fermo.rentriTransazioneInAttesa).toBe('tx-attesa-certificato')
        expect(fermo.rentriSyncAvviatoAt).not.toBeNull()

        // 2. Il certificato viene caricato: il FIR si riapre, la transazione resta.
        const credenziali = new RentriCredentialService(
          prisma as any,
          {
            credentialEncKey: 'chiave-di-test-b6',
          } as any
        )
        const riaperti = await credenziali.upsertForTenant(tenantId, {
          clientId: 'client-b6',
          certificatePem: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
          privateKeyPem: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
        })
        expect(riaperti).toContain(fir.id)
        // Il recupero lo riprende dal primo giro dopo la soglia: updated_at e' stato aggiornato
        // dalla riapertura (la azienda deve essere in trasmissione automatica).
        const modalitaPrima = (await prisma.tenant.findUnique({ where: { id: tenantId } }))!
          .rentriModalitaLegame
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { rentriModalitaLegame: 'AUTOMATICA', subscriptionStatus: 'ACTIVE' },
        })
        try {
          const aggiornatoPrima = (await riga(fir.id)).updatedAt as Date
          expect(aggiornatoPrima.getTime()).toBeGreaterThan(Date.now() - 60_000)
          await prisma.$executeRaw`UPDATE firs SET updated_at = (${new Date('2026-10-22T08:00:00.000Z').toISOString()}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${fir.id}::uuid`
          const sospese = await repoLettura.elencaTrasmissioniRentriSospese(
            SOGLIA,
            1000,
            new Date('2026-10-01T00:00:00.000Z'),
            await tuttiGliId()
          )
          expect(sospese.find(e => e.firId === fir.id)).toEqual({
            firId: fir.id,
            tenantId,
            stato: 'PENDING',
          })
        } finally {
          await prisma.tenant.update({
            where: { id: tenantId },
            data: { rentriModalitaLegame: modalitaPrima },
          })
        }
        const riaperto = await riga(fir.id)
        expect(riaperto.rentriSyncStatus).toBe('PENDING')
        expect(riaperto.rentriSyncAvviatoAt).toBeNull()
        expect(riaperto.rentriLastSyncErrorCode).toBeNull()
        expect(riaperto.rentriTransazioneInAttesa).toBe('tx-attesa-certificato')

        // 3. Il tentativo successivo riprende la transazione: nessuna POST, nessun corpo costruito.
        const secondo = await useCase.execute(fir.id, tenantId)
        expect(secondo).toMatchObject({ success: true })
        expect(creaFormulario).not.toHaveBeenCalled()
        expect(costruisci).not.toHaveBeenCalled()
        expect(attendiEsito).toHaveBeenCalledTimes(2)
        expect(attendiEsito).toHaveBeenNthCalledWith(2, tenantId, 'tx-attesa-certificato')
        const finale = await riga(fir.id)
        expect(finale.rentriSyncStatus).toBe('SYNCED')
        expect(finale.rentriNumeroFir).toMatch(/^RENTRI-B6-/)
      } finally {
        await prisma.rentriCredential.deleteMany({ where: { tenantId } })
      }
    })
  })
})

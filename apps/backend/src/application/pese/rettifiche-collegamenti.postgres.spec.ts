/**
 * Rettifiche del peso e collegamenti (FIR, registro) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS FORCE, privilegi veri) e dentro il `TenantContext` dell'azienda. Il
 * proprietario prepara aziende, utenti, FIR e annotazioni e legge cio' che e' stato scritto; la
 * pulizia cancella SOLO le aziende create qui, per id esatto (le pesate sono immutabili: la
 * cascata da `tenants` e' l'unica via).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55444/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { randomUUID } from 'crypto'
import { TenantContext } from '../../core/context/tenant-context'
import { improntaRettifica } from '../../domain/pese/impronta-pesata'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { RegistriService } from '../registro/registri.service'
import type { AperturaAccessoDati, UtentePesa } from './accessi-pesa.tipi'
import { AccessiPesaService } from './accessi-pesa.service'
import { AllegatiPesaService } from './allegati-pesa.service'
import { AutomezziService } from './automezzi.service'
import { CollegamentiAccessoService } from './collegamenti-accesso.service'
import {
  CollegamentoNonValidoError,
  RegolaPesataError,
  RuoloPesaInsufficienteError,
  StatoAccessoNonValidoError,
} from './errori-pese'
import { RettifichePesoService, AVVISO_DOCUMENTI_COLLEGATI } from './rettifiche-peso.service'
import { StrumentiPesaService } from './strumenti-pesa.service'

type Azienda = Awaited<ReturnType<typeof creaAzienda>>

let n = 0
const seme = 8_000_000 + (Date.now() % 1_000_000)
let progressivo = 0

// PDF minimo: i magic bytes bastano per il riconoscimento.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')

describe('Rettifiche e collegamenti — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let accessi: AccessiPesaService
  let rettifiche: RettifichePesoService
  let collegamenti: CollegamentiAccessoService
  const tenantCreati: string[] = []

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())
  const azienda = async () => {
    const a = await creaAzienda(owner)
    tenantCreati.push(a.tenantId)
    return a
  }
  const admin = (a: Azienda): UtentePesa => ({ id: a.utenteId, ruolo: 'ADMIN' })
  const operatore = (a: Azienda): UtentePesa => ({ id: a.utenteId, ruolo: 'OPERATOR' })

  const pesata = (peso: number) => ({
    pesoKg: peso,
    strumentoEsterno: 'Pesa del cliente',
    motivo: 'bilancia senza stampante',
    stabileDichiarato: true,
  })
  const dati = (peso: number, extra: Partial<AperturaAccessoDati> = {}): AperturaAccessoDati => ({
    chiaveIdempotenza: randomUUID(),
    verso: 'CARICO',
    modo: 'DOPPIA',
    pesata: pesata(peso),
    ...extra,
  })

  /** Accesso CHIUSO: CARICO = lordo poi tara; SCARICO = tara poi lordo. */
  async function accessoChiuso(
    a: Azienda,
    lordo = 24000,
    tara = 7000,
    extra: Partial<AperturaAccessoDati> = {}
  ) {
    const carico = (extra.verso ?? 'CARICO') === 'CARICO'
    const aperto = await nelTenant(a.tenantId, () =>
      accessi.apri(a.tenantId, operatore(a), dati(carico ? lordo : tara, extra))
    )
    // con la tara dichiarata l'apertura inserisce anche la seconda pesata e chiude
    if (extra.modo === 'TARA_ANAGRAFICA') return aperto
    return nelTenant(a.tenantId, () =>
      accessi.secondaPesata(a.tenantId, operatore(a), aperto.id, {
        chiaveIdempotenza: randomUUID(),
        pesata: pesata(carico ? tara : lordo),
      })
    )
  }
  const rettifica = (a: Azienda, pesataId: string, nuovo: number, motivo = 'errore di lettura') =>
    nelTenant(a.tenantId, () =>
      rettifiche.rettifica(a.tenantId, admin(a), pesataId, { pesoNuovoKg: nuovo, motivo })
    )
  const dettaglio = (a: Azienda, id: string) =>
    nelTenant(a.tenantId, () => accessi.dettaglio(a.tenantId, id))
  const registro = (a: Azienda) =>
    owner.registroRifiuti.findFirstOrThrow({ where: { tenantId: a.tenantId } })

  async function fir(a: Azienda, status: any = 'AWAITING_CARRIER', unit = 'KG', quantity = 17000) {
    return owner.fIR.create({
      data: {
        tenantId: a.tenantId,
        producerUserId: a.utenteId,
        producerPartitaIva: partitaIvaValida(seme + 1),
        producerName: 'Produttore',
        producerAddress: 'Via Prova 1, 20100 Milano MI',
        carrierPartitaIva: partitaIvaValida(seme + 2),
        carrierName: 'Trasportatore',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: partitaIvaValida(seme + 3),
        receiverName: 'Destinatario',
        receiverAddress: 'Via Destinazione 1, 20100 Milano MI',
        cerCode: '20 01 01',
        wasteDescription: 'Carta',
        wasteCategory: 'Non pericoloso',
        quantity,
        unit,
        status,
        firNumber: status === 'DRAFT' ? null : `F-${++progressivo}`,
        transportDate: new Date(),
      },
    })
  }

  async function movimento(
    a: Azienda,
    o: {
      type?: 'CARICO' | 'SCARICO'
      quantita?: number
      cer?: string
      tipo?: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
      rettificato?: string
      originale?: string
      registroId?: string
    } = {}
  ) {
    const reg = o.registroId ?? (await registro(a)).id
    const type = o.type ?? 'CARICO'
    const tipo = o.tipo ?? 'ORDINARIA'
    return owner.wasteMovement.create({
      data: {
        tenantId: a.tenantId,
        registroId: reg,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        type,
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'ALTRO_SCARICO',
        cerCode: o.cer ?? '20 01 01',
        quantity: o.quantita ?? 17000,
        unit: 'KG',
        tipoAnnotazione: tipo,
        movimentoRettificatoId: tipo === 'ORDINARIA' ? null : o.rettificato,
        movimentoOriginaleId: tipo === 'ORDINARIA' ? null : o.originale,
        motivoAnnotazione: tipo === 'ORDINARIA' ? null : 'correzione di prova',
      },
    })
  }

  /**
   * Simula un annullo gia' in corso: il proprietario annulla l'accesso in una transazione che
   * tiene aperta. Restituisce `rilascia` (commit) e `finita`. Chi scrive sull'accesso senza
   * prendere il suo lock non vedrebbe lo stato ANNULLATO non committato e scriverebbe lo stesso.
   */
  async function annulloInCorso(accessoId: string) {
    let rilascia!: () => void
    let pronto!: () => void
    const tenuta = new Promise<void>(r => (rilascia = r))
    const inizio = new Promise<void>(r => (pronto = r))
    const finita = owner.$transaction(
      async t => {
        await t.$executeRaw`UPDATE accessi_pesa SET stato = 'ANNULLATO', annullato_da = ${randomUUID()}::uuid,
          annullato_il = now(), motivo_annullamento = 'prova' WHERE id = ${accessoId}::uuid`
        pronto()
        await tenuta
      },
      { timeout: 30_000 }
    )
    await inizio
    return { rilascia, finita }
  }
  const attesa = (ms: number) => new Promise(r => setTimeout(r, ms))

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const allegati = new AllegatiPesaService(app)
    accessi = new AccessiPesaService(
      app,
      new RegistriService(app, logger),
      new StrumentiPesaService(app),
      new AutomezziService(app),
      allegati
    )
    rettifiche = new RettifichePesoService(app, allegati)
    collegamenti = new CollegamentiAccessoService(app)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await app.$disconnect()
    await owner.$disconnect()
  })

  describe('rettifiche', () => {
    it('una rettifica: numero 1, precedente = originale, netto ricalcolato, impronta integra', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const lordo = chiuso.pesate[0]

      const v = await rettifica(a, lordo.id, 23500)

      expect(v.pesate[0].pesoOriginaleKg).toBe(24000)
      expect(v.pesate[0].pesoEffettivoKg).toBe(23500)
      expect(v.pesate[0].rettifiche).toHaveLength(1)
      expect(v.pesate[0].rettifiche[0]).toMatchObject({
        numero: 1,
        pesoPrecedenteKg: 24000,
        pesoNuovoKg: 23500,
        integra: true,
        autore: 'Prova Rettifiche',
      })
      expect(v.netto.nettoKg).toBe(16500)
      expect(v.pesate.every(p => p.integra)).toBe(true)
    })

    it('due rettifiche concorrenti: numeri 1 e 2, la seconda parte dal valore della prima', async () => {
      for (let giro = 0; giro < 4; giro++) {
        const a = await azienda()
        const chiuso = await accessoChiuso(a)
        const id = chiuso.pesate[0].id

        const esiti = await withTimeout(
          Promise.allSettled([rettifica(a, id, 23000), rettifica(a, id, 22000)]),
          20_000
        )

        // entrambe riescono (la seconda parte dal valore della prima): mai un errore grezzo
        expect(esiti.map(e => e.status)).toEqual(['fulfilled', 'fulfilled'])
        const righe = await owner.rettificaPeso.findMany({
          where: { pesataId: id },
          orderBy: { numero: 'asc' },
        })
        expect(righe.map(r => r.numero)).toEqual([1, 2])
        expect(Number(righe[0].pesoPrecedenteKg)).toBe(24000)
        expect(Number(righe[1].pesoPrecedenteKg)).toBe(Number(righe[0].pesoNuovoKg))
        expect(new Set(righe.map(r => Number(r.pesoNuovoKg)))).toEqual(new Set([23000, 22000]))
      }
    })

    it('rettifica vs annullo simultanei: nessun deadlock, nessuna rettifica su un accesso annullato', async () => {
      for (let giro = 0; giro < 6; giro++) {
        const a = await azienda()
        const chiuso = await accessoChiuso(a)

        const [r, an] = await withTimeout(
          Promise.allSettled([
            rettifica(a, chiuso.pesate[0].id, 23000),
            nelTenant(a.tenantId, () =>
              accessi.annulla(a.tenantId, admin(a), chiuso.id, 'registrato per errore')
            ),
          ]),
          20_000
        )

        expect(an.status).toBe('fulfilled')
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(StatoAccessoNonValidoError)
          expect(
            await owner.rettificaPeso.count({ where: { pesataId: chiuso.pesate[0].id } })
          ).toBe(0)
        } else {
          expect(
            await owner.rettificaPeso.count({ where: { pesataId: chiuso.pesate[0].id } })
          ).toBe(1)
        }
        const finale = await owner.accessoPesa.findUniqueOrThrow({ where: { id: chiuso.id } })
        expect(finale.stato).toBe('ANNULLATO')
      }
    })

    it('rettifica con un annullo non ancora committato: aspetta il lock e poi trova l`accesso annullato', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const annullo = await annulloInCorso(chiuso.id)

      let conclusa = false
      const r = rettifica(a, chiuso.pesate[0].id, 23000).finally(() => (conclusa = true))
      r.catch(() => undefined)
      await attesa(600)
      expect(conclusa).toBe(false) // bloccata sul lock dell'accesso
      annullo.rilascia()
      await annullo.finita

      await expect(r).rejects.toThrow(StatoAccessoNonValidoError)
      expect(await owner.rettificaPeso.count({ where: { pesataId: chiuso.pesate[0].id } })).toBe(0)
    })

    it('rettifica di un accesso annullato → 409', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      await nelTenant(a.tenantId, () => accessi.annulla(a.tenantId, admin(a), chiuso.id, 'errore'))
      await expect(rettifica(a, chiuso.pesate[0].id, 100)).rejects.toThrow(
        StatoAccessoNonValidoError
      )
    })

    it('rettifica della tara dichiarata (fonte TARA_ANAGRAFICA) → 409, nessuna riga scritta', async () => {
      const a = await azienda()
      const automezzi = new AutomezziService(app)
      const mezzo = await nelTenant(a.tenantId, () =>
        automezzi.crea(a.tenantId, a.utenteId, { targa: 'AB123CD' })
      )
      await nelTenant(a.tenantId, () =>
        automezzi.impostaTara(a.tenantId, a.utenteId, mezzo.id, { taraKg: 7000 })
      )
      const chiuso = await accessoChiuso(a, 24000, 7000, {
        modo: 'TARA_ANAGRAFICA',
        automezzoId: mezzo.id,
      })
      const tara = chiuso.pesate.find(p => p.fonte === 'TARA_ANAGRAFICA')!

      await expect(rettifica(a, tara.id, 6500)).rejects.toThrow(
        'La tara dichiarata non si rettifica.'
      )

      expect(await owner.rettificaPeso.count({ where: { pesataId: tara.id } })).toBe(0)
    })

    it('nuovo peso uguale all`attuale → 422; ruolo operatore → 403; nessuna riga scritta', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const id = chiuso.pesate[0].id

      await expect(rettifica(a, id, 24000)).rejects.toThrow(
        'Il nuovo peso è uguale a quello attuale.'
      )
      await expect(rettifica(a, id, 24000)).rejects.toThrow(RegolaPesataError)
      await expect(
        nelTenant(a.tenantId, () =>
          rettifiche.rettifica(a.tenantId, operatore(a), id, { pesoNuovoKg: 1, motivo: 'm' })
        )
      ).rejects.toThrow(RuoloPesaInsufficienteError)
      expect(await owner.rettificaPeso.count({ where: { pesataId: id } })).toBe(0)

      await rettifica(a, id, 23000)
      // dopo la prima rettifica "l'attuale" e' 23000, non piu' 24000
      await expect(rettifica(a, id, 23000)).rejects.toThrow(RegolaPesataError)
      await expect(rettifica(a, id, 24000)).resolves.toBeDefined()
    })

    it('pesata di un`altra azienda → non trovata; allegato salvato e nell`impronta', async () => {
      const a = await azienda()
      const b = await azienda()
      const chiuso = await accessoChiuso(a)
      await expect(rettifica(b, chiuso.pesate[0].id, 100)).rejects.toThrow('Pesata non trovata.')

      const v = await nelTenant(a.tenantId, () =>
        rettifiche.rettifica(
          a.tenantId,
          admin(a),
          chiuso.pesate[0].id,
          { pesoNuovoKg: 23000, motivo: 'scontrino' },
          { nomeFile: 'scontrino.pdf', mimeDichiarato: 'application/pdf', contenuto: PDF }
        )
      )
      const r = v.pesate[0].rettifiche[0]
      expect(r.allegato).toMatchObject({ nomeFile: 'scontrino.pdf', mimeType: 'application/pdf' })
      expect(r.integra).toBe(true)
      const riga = await owner.rettificaPeso.findFirstOrThrow({
        where: { pesataId: chiuso.pesate[0].id },
      })
      const allegato = await owner.allegatoPesa.findUniqueOrThrow({
        where: { id: riga.allegatoId! },
      })
      expect(riga.impronta).toBe(
        improntaRettifica({
          tenantId: a.tenantId,
          pesataId: riga.pesataId,
          numero: 1,
          pesoPrecedenteKg: '24000.00',
          pesoNuovoKg: '23000.00',
          motivo: 'scontrino',
          autoreId: a.utenteId,
          allegatoSha256: allegato.sha256,
          createdAt: riga.createdAt,
        })
      )
    })

    it('con un collegamento attivo la risposta avvisa che i documenti non cambiano', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const f = await fir(a)
      await nelTenant(a.tenantId, () =>
        collegamenti.collegaFir(a.tenantId, operatore(a), chiuso.id, f.id)
      )

      const v = await rettifica(a, chiuso.pesate[0].id, 23000)

      expect(v.avvisi).toContain(AVVISO_DOCUMENTI_COLLEGATI)
    })
  })

  describe('collegamenti', () => {
    it('FIR emesso: collegamento, confronto col netto; bozza e annullato → 422', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const f = await fir(a, 'AWAITING_CARRIER', 'KG', 17200)

      const v = await nelTenant(a.tenantId, () =>
        collegamenti.collegaFir(a.tenantId, operatore(a), chiuso.id, f.id)
      )

      expect(v.collegamenti).toHaveLength(1)
      expect(v.collegamenti[0]).toMatchObject({
        tipo: 'FIR',
        fir: { id: f.id, stato: 'EMESSO', quantita: 17200 },
        confronto: { confrontabile: true, quantitaKg: 17200, differenzaKg: -200 },
      })
      for (const status of ['DRAFT', 'CANCELLED'] as const) {
        const x = await accessoChiuso(a)
        const g = await fir(a, status)
        await expect(
          nelTenant(a.tenantId, () => collegamenti.collegaFir(a.tenantId, operatore(a), x.id, g.id))
        ).rejects.toThrow(CollegamentoNonValidoError)
      }
    })

    it('accesso aperto o annullato non si collega; FIR di un`altra azienda non trovato', async () => {
      const a = await azienda()
      const b = await azienda()
      const aperto = await nelTenant(a.tenantId, () =>
        accessi.apri(a.tenantId, operatore(a), dati(24000))
      )
      const f = await fir(a)
      await expect(
        nelTenant(a.tenantId, () =>
          collegamenti.collegaFir(a.tenantId, operatore(a), aperto.id, f.id)
        )
      ).rejects.toThrow(StatoAccessoNonValidoError)

      const chiuso = await accessoChiuso(a)
      const fb = await fir(b)
      await expect(
        nelTenant(a.tenantId, () =>
          collegamenti.collegaFir(a.tenantId, operatore(a), chiuso.id, fb.id)
        )
      ).rejects.toThrow('FIR non trovato.')
    })

    it('doppio collegamento: stesso accesso o stesso documento → 409; due richieste in parallelo → 1 ok', async () => {
      const a = await azienda()
      const x = await accessoChiuso(a)
      const y = await accessoChiuso(a)
      const f = await fir(a)

      const esiti = await withTimeout(
        Promise.allSettled([
          nelTenant(a.tenantId, () =>
            collegamenti.collegaFir(a.tenantId, operatore(a), x.id, f.id)
          ),
          nelTenant(a.tenantId, () =>
            collegamenti.collegaFir(a.tenantId, operatore(a), y.id, f.id)
          ),
        ]),
        20_000
      )

      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(rifiutato.reason).toBeInstanceOf(StatoAccessoNonValidoError)
      expect(rifiutato.reason.message).toBe("L'accesso o il documento è già collegato.")
      expect(await owner.collegamentoAccesso.count({ where: { tenantId: a.tenantId } })).toBe(1)
    })

    it('movimento: radice ordinaria; rettifica, altro verso, altro registro, altro CER → 422', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a, 24000, 7000, { cerCode: '20 01 01' })
      const radice = await movimento(a)
      const rett = await movimento(a, {
        tipo: 'RETTIFICA',
        rettificato: radice.id,
        originale: radice.id,
      })
      const scarico = await movimento(a, { type: 'SCARICO' })
      const altroCer = await movimento(a, { cer: '17 01 01' })
      const altroReg = await owner.registroRifiuti.create({
        data: { tenantId: a.tenantId, descrizione: 'Registro B', codice: 'B' },
      })
      const inAltroReg = await movimento(a, { registroId: altroReg.id })
      const collega = (id: string) =>
        nelTenant(a.tenantId, () =>
          collegamenti.collegaMovimento(a.tenantId, operatore(a), chiuso.id, id)
        )

      await expect(collega(rett.id)).rejects.toThrow(
        "Collegare l'annotazione originale, non una sua rettifica."
      )
      for (const m of [scarico, altroCer, inAltroReg]) {
        await expect(collega(m.id)).rejects.toThrow(CollegamentoNonValidoError)
      }
      expect(await owner.collegamentoAccesso.count({ where: { tenantId: a.tenantId } })).toBe(0)
      await expect(collega(radice.id)).resolves.toBeDefined()
    })

    it('collegamento a un movimento poi rettificato: la vista mostra la testa vigente e la differenza', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a) // netto 17000
      const radice = await movimento(a, { quantita: 17000 })
      const v1 = await nelTenant(a.tenantId, () =>
        collegamenti.collegaMovimento(a.tenantId, operatore(a), chiuso.id, radice.id)
      )
      expect(v1.collegamenti[0].movimento).toMatchObject({
        id: radice.id,
        quantita: 17000,
        annullato: false,
      })
      expect(v1.collegamenti[0].confronto).toMatchObject({ differenzaKg: 0 })

      const testa = await movimento(a, {
        tipo: 'RETTIFICA',
        rettificato: radice.id,
        originale: radice.id,
        quantita: 16500,
      })
      const v2 = await dettaglio(a, chiuso.id)

      const m = v2.collegamenti[0].movimento!
      expect(m.id).toBe(radice.id)
      expect(m.numero).toBe(`${radice.progressiveNumber}/2026`)
      expect(m.numeroVigente).toBe(`${testa.progressiveNumber}/2026`)
      expect(m.quantita).toBe(16500)
      expect(v2.collegamenti[0].confronto).toMatchObject({ confrontabile: true, differenzaKg: 500 })
    })

    it('movimento annullato: vista "annotazione annullata"', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const radice = await movimento(a)
      await nelTenant(a.tenantId, () =>
        collegamenti.collegaMovimento(a.tenantId, operatore(a), chiuso.id, radice.id)
      )
      await movimento(a, { tipo: 'ANNULLAMENTO', rettificato: radice.id, originale: radice.id })

      const v = await dettaglio(a, chiuso.id)

      expect(v.collegamenti[0].movimento).toMatchObject({
        annullato: true,
        numeroVigente: null,
        quantita: null,
      })
      expect(v.collegamenti[0].confronto).toBeNull()
      // e un'annotazione gia' annullata non si collega
      const altro = await accessoChiuso(a)
      await expect(
        nelTenant(a.tenantId, () =>
          collegamenti.collegaMovimento(a.tenantId, operatore(a), altro.id, radice.id)
        )
      ).rejects.toThrow(CollegamentoNonValidoError)
    })

    it('revoca: solo il responsabile, una volta; poi l`accesso si annulla e il documento si ricollega', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const f = await fir(a)
      const v = await nelTenant(a.tenantId, () =>
        collegamenti.collegaFir(a.tenantId, operatore(a), chiuso.id, f.id)
      )
      const id = v.collegamenti[0].id
      await expect(
        nelTenant(a.tenantId, () => accessi.annulla(a.tenantId, admin(a), chiuso.id, 'm'))
      ).rejects.toThrow('Prima revocare i collegamenti.')
      await expect(
        nelTenant(a.tenantId, () => collegamenti.revoca(a.tenantId, operatore(a), id, 'm'))
      ).rejects.toThrow(RuoloPesaInsufficienteError)

      const r = await nelTenant(a.tenantId, () =>
        collegamenti.revoca(a.tenantId, admin(a), id, 'collegato per errore')
      )

      expect(r.collegamenti[0]).toMatchObject({ revocatoIl: expect.any(String) })
      await expect(
        nelTenant(a.tenantId, () => collegamenti.revoca(a.tenantId, admin(a), id, 'ancora'))
      ).rejects.toThrow('Il collegamento è già stato revocato.')
      // lo stesso FIR e lo stesso accesso tornano collegabili
      await expect(
        nelTenant(a.tenantId, () =>
          collegamenti.collegaFir(a.tenantId, operatore(a), chiuso.id, f.id)
        )
      ).resolves.toBeDefined()
      expect(await owner.collegamentoAccesso.count({ where: { tenantId: a.tenantId } })).toBe(2)
    })

    it('collegamento con un annullo non ancora committato: aspetta il lock e trova l`accesso non chiuso', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const f = await fir(a)
      const annullo = await annulloInCorso(chiuso.id)

      let conclusa = false
      const c = nelTenant(a.tenantId, () =>
        collegamenti.collegaFir(a.tenantId, operatore(a), chiuso.id, f.id)
      ).finally(() => (conclusa = true))
      c.catch(() => undefined)
      await attesa(600)
      expect(conclusa).toBe(false)
      annullo.rilascia()
      await annullo.finita

      await expect(c).rejects.toThrow(StatoAccessoNonValidoError)
      expect(await owner.collegamentoAccesso.count({ where: { accessoId: chiuso.id } })).toBe(0)
    })

    it('collegamento vs annullo simultanei: nessun deadlock e nessun collegamento attivo su un annullato', async () => {
      for (let giro = 0; giro < 6; giro++) {
        const a = await azienda()
        const chiuso = await accessoChiuso(a)
        const f = await fir(a)

        const [c, an] = await withTimeout(
          Promise.allSettled([
            nelTenant(a.tenantId, () =>
              collegamenti.collegaFir(a.tenantId, operatore(a), chiuso.id, f.id)
            ),
            nelTenant(a.tenantId, () =>
              accessi.annulla(a.tenantId, admin(a), chiuso.id, 'registrato per errore')
            ),
          ]),
          20_000
        )

        // O il collegamento vince e l'annullo trova "Prima revocare", o l'annullo vince e il
        // collegamento trova l'accesso non piu' chiuso. Mai entrambi, mai un errore grezzo.
        expect([c.status, an.status].filter(s => s === 'fulfilled')).toHaveLength(1)
        const rifiutato = (c.status === 'rejected' ? c : an) as PromiseRejectedResult
        expect(rifiutato.reason).toBeInstanceOf(StatoAccessoNonValidoError)
        const attivi = await owner.collegamentoAccesso.count({
          where: { accessoId: chiuso.id, revocatoIl: null },
        })
        const finale = await owner.accessoPesa.findUniqueOrThrow({ where: { id: chiuso.id } })
        expect(finale.stato === 'ANNULLATO' ? attivi : 1 - attivi).toBe(0)
      }
    })
  })

  describe('pesoPerConsegnaFir (D12)', () => {
    const peso = (a: Azienda, firId: string, accessoId: string) =>
      nelTenant(a.tenantId, () =>
        collegamenti.pesoPerConsegnaFir(a.tenantId, a.utenteId, firId, accessoId)
      )

    it('pesoPerConsegnaFir su FIR in T: 12.345 kg → 12,35', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a, 19345, 7000) // netto 12.345 kg
      const f = await fir(a, 'AWAITING_RECEIVER', 'T', 12.35)

      await expect(peso(a, f.id, chiuso.id)).resolves.toBe(12.35)

      const c = await owner.collegamentoAccesso.findMany({ where: { accessoId: chiuso.id } })
      expect(c).toHaveLength(1)
      expect(c[0]).toMatchObject({ tipo: 'FIR', firId: f.id, revocatoIl: null })
      const audit = await owner.activityLog.findMany({
        where: { tenantId: a.tenantId, action: 'FIR_PESO_DA_ACCESSO' },
      })
      expect(audit).toHaveLength(1)
      // ripetuto: stesso risultato, nessun secondo collegamento
      await expect(peso(a, f.id, chiuso.id)).resolves.toBe(12.35)
      expect(await owner.collegamentoAccesso.count({ where: { accessoId: chiuso.id } })).toBe(1)
    })

    it('FIR in kg: netto invariato; con la rettifica del peso il valore segue', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const f = await fir(a, 'AWAITING_RECEIVER', 'KG')
      await rettifica(a, chiuso.pesate[0].id, 23000)

      await expect(peso(a, f.id, chiuso.id)).resolves.toBe(16000)
    })

    it('pesoPerConsegnaFir su FIR in M3 → 422', async () => {
      const a = await azienda()
      const chiuso = await accessoChiuso(a)
      const f = await fir(a, 'AWAITING_RECEIVER', 'M3')

      await expect(peso(a, f.id, chiuso.id)).rejects.toThrow(CollegamentoNonValidoError)
      await expect(peso(a, f.id, chiuso.id)).rejects.toThrow(
        'Il FIR è in M3: il peso della pesa (kg) non si converte.'
      )
      expect(await owner.collegamentoAccesso.count({ where: { tenantId: a.tenantId } })).toBe(0)
    })

    it('accesso SCARICO → 422; FIR legato a RENTRI → 422; accesso collegato ad altro FIR → 409', async () => {
      const a = await azienda()
      const scarico = await accessoChiuso(a, 24000, 7000, { verso: 'SCARICO' })
      const f = await fir(a, 'AWAITING_RECEIVER')
      await expect(peso(a, f.id, scarico.id)).rejects.toThrow(CollegamentoNonValidoError)

      const chiuso = await accessoChiuso(a)
      const legato = await fir(a, 'AWAITING_RECEIVER')
      await owner.fIR.update({ where: { id: legato.id }, data: { rentriNumeroFir: 'R-1' } })
      await expect(peso(a, legato.id, chiuso.id)).rejects.toThrow(CollegamentoNonValidoError)

      await peso(a, f.id, chiuso.id)
      const altro = await fir(a, 'AWAITING_RECEIVER')
      await expect(peso(a, altro.id, chiuso.id)).rejects.toThrow(
        "L'accesso o il documento è già collegato."
      )
    })

    it('accesso o FIR di un`altra azienda → non trovato', async () => {
      const a = await azienda()
      const b = await azienda()
      const chiuso = await accessoChiuso(a)
      const fb = await fir(b, 'AWAITING_RECEIVER')
      await expect(peso(b, fb.id, chiuso.id)).rejects.toThrow('Accesso non trovato.')
      await expect(peso(a, fb.id, chiuso.id)).rejects.toThrow('FIR non trovato.')
    })
  })
})

async function creaAzienda(owner: PrismaClient) {
  n++
  const t = await owner.tenant.create({
    data: {
      partitaIva: partitaIvaValida(seme + n * 23),
      ragioneSociale: 'Rettifiche SRL',
      country: 'IT',
    },
  })
  const utente = await owner.user.create({
    data: {
      tenantId: t.id,
      keycloakId: `kc-ret-${seme}-${n}`,
      fiscalCode: `RET${seme}${n}`.slice(0, 16),
      firstName: 'Prova',
      lastName: 'Rettifiche',
      email: `ret-${seme}-${n}@example.test`,
      role: 'ADMIN',
    },
  })
  await owner.registroRifiuti.create({
    data: { tenantId: t.id, descrizione: 'Registro A', codice: 'A' },
  })
  return { tenantId: t.id, utenteId: utente.id }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout: possibile deadlock')), ms)),
  ])
}

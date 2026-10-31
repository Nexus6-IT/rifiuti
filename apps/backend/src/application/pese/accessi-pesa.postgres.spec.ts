/**
 * Accessi e pesate manuali contro un Postgres reale, collegato COME `wasteflow_app` (RLS ENABLE+
 * FORCE, privilegi veri) e dentro il `TenantContext` dell'azienda. Il proprietario prepara aziende,
 * utenti e registri e legge cio' che e' stato scritto; la pulizia cancella SOLO le aziende create
 * qui, per id esatto (le pesate sono immutabili: la cascata da `tenants` e' l'unica via).
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

import { createHash, randomUUID } from 'crypto'
import { TenantContext } from '../../core/context/tenant-context'
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
import { AlibiGiaUsatoError, RegolaPesataError, StatoAccessoNonValidoError } from './errori-pese'
import { StrumentiPesaService } from './strumenti-pesa.service'

type Azienda = Awaited<ReturnType<typeof creaAzienda>>

let n = 0
const seme = 7_000_000 + (Date.now() % 2_000_000)

describe('Accessi di pesa — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: AccessiPesaService
  let strumenti: StrumentiPesaService
  let automezzi: AutomezziService
  const tenantCreati: string[] = []

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda() {
    const a = await creaAzienda(owner)
    tenantCreati.push(a.tenantId)
    return a
  }
  const op = (a: Azienda, ruolo: UtentePesa['ruolo'] = 'ADMIN'): UtentePesa => ({
    id: a.utenteId,
    ruolo,
  })
  const dati = (extra: Partial<AperturaAccessoDati> = {}, peso = 24000): AperturaAccessoDati => ({
    chiaveIdempotenza: randomUUID(),
    verso: 'CARICO',
    modo: 'DOPPIA',
    pesata: {
      pesoKg: peso,
      strumentoEsterno: 'Pesa del cliente',
      motivo: 'bilancia senza stampante',
      stabileDichiarato: true,
    },
    ...extra,
  })
  const seconda = (peso: number) => ({
    chiaveIdempotenza: randomUUID(),
    pesata: {
      pesoKg: peso,
      strumentoEsterno: 'Pesa del cliente',
      motivo: 'bilancia senza stampante',
      stabileDichiarato: true,
    },
  })
  const apri = (a: Azienda, d: AperturaAccessoDati, file?: any) =>
    nelTenant(a.tenantId, () => service.apri(a.tenantId, op(a), d, file))
  const secondaPesata = (a: Azienda, id: string, d = seconda(7000)) =>
    nelTenant(a.tenantId, () => service.secondaPesata(a.tenantId, op(a), id, d))
  const annulla = (a: Azienda, id: string) =>
    nelTenant(a.tenantId, () => service.annulla(a.tenantId, op(a, 'ADMIN'), id, 'errore'))
  const conta = (accessoId: string) => owner.pesata.count({ where: { accessoId } })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    strumenti = new StrumentiPesaService(app)
    automezzi = new AutomezziService(app)
    service = new AccessiPesaService(
      app,
      new RegistriService(app, logger),
      strumenti,
      automezzi,
      new AllegatiPesaService(app)
    )
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await app.$disconnect()
    await owner.$disconnect()
  })

  it('doppia pesata: apertura, seconda pesata, chiusura e netto; impronte integre', async () => {
    const a = await azienda()

    const aperto = await apri(a, dati())
    expect(aperto).toMatchObject({ stato: 'APERTO', numero: `1/${new Date().getUTCFullYear()}` })
    const chiuso = await secondaPesata(a, aperto.id)

    expect(chiuso.stato).toBe('CHIUSO')
    expect(chiuso.netto).toMatchObject({
      stato: 'CALCOLATO',
      nettoKg: 17000,
      lordoKg: 24000,
      taraKg: 7000,
    })
    expect(chiuso.pesate.every(p => p.integra)).toBe(true)
    expect(chiuso.pesate[0].operatore).toBe('Prova Accessi')
    expect(chiuso.avvisi).toContain('Pesata inserita a mano: nessuna garanzia metrologica.')
    const riepilogo = await nelTenant(a.tenantId, () => service.elenca(a.tenantId, {}))
    expect(riepilogo.righe[0]).toMatchObject({ nettoKg: 17000, manuale: true, collegato: false })
  })

  it('stessa chiaveIdempotenza due volte: una sola pesata (anche in parallelo)', async () => {
    const a = await azienda()
    const d = dati()

    const [x, y] = await Promise.all([apri(a, d), apri(a, d)])
    const z = await apri(a, d)

    expect(new Set([x.id, y.id, z.id]).size).toBe(1)
    expect([x, y, z].filter(v => v.giaRegistrata)).toHaveLength(2)
    expect(await conta(x.id)).toBe(1)
    expect(await owner.accessoPesa.count({ where: { tenantId: a.tenantId } })).toBe(1)
  })

  it('due aperture concorrenti sullo stesso registro: numeri 1 e 2', async () => {
    const a = await azienda()

    const viste = await Promise.all([apri(a, dati()), apri(a, dati())])

    const numeri = viste.map(v => v.numero.split('/')[0]).sort()
    expect(numeri).toEqual(['1', '2'])
  })

  it('alibi già usato in un accesso annullato → AlibiGiaUsatoError', async () => {
    const a = await azienda()
    const s = await nelTenant(a.tenantId, () =>
      strumenti.crea(a.tenantId, a.utenteId, { descrizione: 'Pesa', portataMaxKg: 60000 })
    )
    const pesata = (alibi: string) => ({
      pesoKg: 24000,
      strumentoId: s.id,
      alibiId: alibi,
      motivo: 'm',
      stabileDichiarato: true,
    })
    const primo = await apri(a, dati({ pesata: pesata('A-1') }))
    await annulla(a, primo.id)

    await expect(apri(a, dati({ pesata: pesata('A-1') }))).rejects.toThrow(AlibiGiaUsatoError)
    await expect(apri(a, dati({ pesata: pesata('A-2') }))).resolves.toBeDefined()
    expect(await owner.accessoPesa.count({ where: { tenantId: a.tenantId } })).toBe(2)
  })

  it('alibi con strumento esterno già visto: avviso, non blocco', async () => {
    const a = await azienda()
    const p = (alibi: string) => ({
      pesoKg: 100,
      strumentoEsterno: 'Pesa del cliente',
      alibiId: alibi,
      motivo: 'm',
      stabileDichiarato: true,
    })
    await apri(a, dati({ pesata: p('B-1') }))

    const v = await apri(a, dati({ pesata: p('B-1') }))

    expect(v.pesate[0].avvisi).toContain(
      'Memoria alibi già usata con la stessa descrizione dello strumento.'
    )
  })

  it('ora strumento 2026-10-25T02:30+02:00 e +01:00 salvate come istanti diversi', async () => {
    const a = await azienda()
    const ora = (o: string) => ({ ...dati().pesata, oraStrumento: o })

    const x = await apri(a, dati({ pesata: ora('2026-10-25T02:30+02:00') }))
    const y = await apri(a, dati({ pesata: ora('2026-10-25T02:30+01:00') }))

    const righe = await owner.pesata.findMany({
      where: { accessoId: { in: [x.id, y.id] } },
      orderBy: { createdAt: 'asc' },
    })
    expect(righe[0].oraStrumento?.toISOString()).toBe('2026-10-25T00:30:00.000Z')
    expect(righe[1].oraStrumento?.toISOString()).toBe('2026-10-25T01:30:00.000Z')
  })

  it('allegato salvato con sha256 e letto uguale', async () => {
    const a = await azienda()
    const contenuto = Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(2000)])

    const v = await apri(a, dati(), {
      nomeFile: 'scontrino.pdf',
      mimeDichiarato: 'application/pdf',
      contenuto,
    })

    const allegato = v.pesate[0].allegato
    expect(allegato).toMatchObject({ nomeFile: 'scontrino.pdf', mimeType: 'application/pdf' })
    const letto = await nelTenant(a.tenantId, () =>
      new AllegatiPesaService(app).leggi(a.tenantId, allegato!.id)
    )
    expect(Buffer.compare(letto.contenuto, contenuto)).toBe(0)
    expect(letto.sha256).toBe(createHash('sha256').update(contenuto).digest('hex'))
    expect(v.pesate[0].integra).toBe(true)
  })

  it('allegato non valido: 422/415 di dominio e nessun accesso creato', async () => {
    const a = await azienda()

    await expect(
      apri(a, dati(), {
        nomeFile: 'x.exe',
        mimeDichiarato: 'application/pdf',
        contenuto: Buffer.from('MZ'),
      })
    ).rejects.toThrow('Sono ammessi solo foto JPEG o PNG e documenti PDF.')

    expect(await owner.accessoPesa.count({ where: { tenantId: a.tenantId } })).toBe(0)
  })

  it('chiusura con lordo ≤ tara: accesso resta APERTO, nessuna pesata 2', async () => {
    const a = await azienda()
    const aperto = await apri(a, dati())

    await expect(secondaPesata(a, aperto.id, seconda(24000))).rejects.toThrow(RegolaPesataError)
    await expect(secondaPesata(a, aperto.id, seconda(30000))).rejects.toThrow(/non supera la tara/)

    expect(await conta(aperto.id)).toBe(1)
    expect((await owner.accessoPesa.findUniqueOrThrow({ where: { id: aperto.id } })).stato).toBe(
      'APERTO'
    )
    await expect(secondaPesata(a, aperto.id, seconda(7000))).resolves.toMatchObject({
      stato: 'CHIUSO',
    })
  })

  it('apertura TARA_ANAGRAFICA con lordo ≤ tara: nessun accesso creato', async () => {
    const a = await azienda()
    const mezzo = await mezzoConTara(a, 'LL111LL', 25000)

    await expect(
      apri(a, dati({ modo: 'TARA_ANAGRAFICA', automezzoId: mezzo.id }, 24880))
    ).rejects.toThrow(/Il lordo \(24\.880 kg\) non supera la tara \(25\.000 kg\)/)

    expect(await owner.accessoPesa.count({ where: { tenantId: a.tenantId } })).toBe(0)
    expect(await owner.pesata.count({ where: { tenantId: a.tenantId } })).toBe(0)
  })

  describe('TARA_ANAGRAFICA corrisponde al mezzo', () => {
    it('pesata 2 con automezzo, peso = tara e tara_aggiornata_il del mezzo', async () => {
      const a = await azienda()
      const mezzo = await mezzoConTara(a, 'TT111TT', 7000)
      const riga = await owner.automezzo.findUniqueOrThrow({ where: { id: mezzo.id } })

      const v = await apri(a, dati({ modo: 'TARA_ANAGRAFICA', automezzoId: mezzo.id }))

      expect(v.stato).toBe('CHIUSO')
      expect(v.netto).toMatchObject({ nettoKg: 17000, qualita: 'TARA_DICHIARATA' })
      const p2 = await owner.pesata.findFirstOrThrow({ where: { accessoId: v.id, ordine: 2 } })
      expect(p2).toMatchObject({ fonte: 'TARA_ANAGRAFICA', automezzoId: mezzo.id })
      expect(Number(p2.pesoKg)).toBe(7000)
      expect(p2.taraAggiornataIl?.getTime()).toBe(riga.taraAggiornataIl?.getTime())
      expect(v.pesate[1].integra).toBe(true)
    })

    it('una tara cambiata in contemporanea non si infila a metà: la pesata copia la tara NUOVA se la modifica è già in corso', async () => {
      const a = await azienda()
      const mezzo = await mezzoConTara(a, 'TC111TC', 7000)
      const aperturaTara = dati({ modo: 'TARA_ANAGRAFICA', automezzoId: mezzo.id })

      // il proprietario tiene aperta una modifica della tara, non ancora committata
      let rilascia!: () => void
      const attesa = new Promise<void>(r => (rilascia = r))
      const modifica = owner.$transaction(async tx => {
        await tx.$executeRaw`UPDATE automezzi SET tara_kg = 7500, tara_aggiornata_il = '2026-10-29T09:00:00Z', updated_at = now() WHERE id = ${mezzo.id}::uuid`
        await attesa
      })
      await new Promise(r => setTimeout(r, 200))
      const chiusura = apri(a, aperturaTara)
      await new Promise(r => setTimeout(r, 400))
      rilascia()
      await modifica
      const v = await chiusura

      const p2 = await owner.pesata.findFirstOrThrow({ where: { accessoId: v.id, ordine: 2 } })
      // la lettura con FOR UPDATE ha aspettato il commit: peso e data sono quelli NUOVI, insieme
      expect(Number(p2.pesoKg)).toBe(7500)
      expect(p2.taraAggiornataIl?.toISOString()).toBe('2026-10-29T09:00:00.000Z')
    })

    it('modifiche della tara concorrenti alle aperture: la coppia (peso, data) è sempre una coppia reale', async () => {
      const a = await azienda()
      const mezzo = await mezzoConTara(a, 'TD111TD', 7000)
      const prima = await owner.automezzo.findUniqueOrThrow({ where: { id: mezzo.id } })

      const [aperture] = await Promise.all([
        Promise.all(
          [1, 2, 3, 4].map(() => apri(a, dati({ modo: 'TARA_ANAGRAFICA', automezzoId: mezzo.id })))
        ),
        nelTenant(a.tenantId, () =>
          automezzi.impostaTara(a.tenantId, a.utenteId, mezzo.id, { taraKg: 7300 })
        ),
      ])

      const dopo = await owner.automezzo.findUniqueOrThrow({ where: { id: mezzo.id } })
      const coppie = [
        [7000, prima.taraAggiornataIl?.getTime()],
        [7300, dopo.taraAggiornataIl?.getTime()],
      ]
      for (const v of aperture) {
        const p2 = await owner.pesata.findFirstOrThrow({ where: { accessoId: v.id, ordine: 2 } })
        expect(coppie).toContainEqual([Number(p2.pesoKg), p2.taraAggiornataIl?.getTime()])
      }
    })

    it('automezzo senza tara: 422 e nessun accesso', async () => {
      const a = await azienda()
      const mezzo = await nelTenant(a.tenantId, () =>
        automezzi.crea(a.tenantId, a.utenteId, { targa: 'NT111NT' })
      )

      await expect(
        apri(a, dati({ modo: 'TARA_ANAGRAFICA', automezzoId: mezzo.id }))
      ).rejects.toThrow("L'automezzo non ha una tara registrata.")
      expect(await owner.accessoPesa.count({ where: { tenantId: a.tenantId } })).toBe(0)
    })
  })

  describe('concorrenza: ordine dei lock', () => {
    it('seconda pesata e annullo nello stesso istante: nessun deadlock, nessuna pesata su accesso annullato oltre la prima', async () => {
      for (let i = 0; i < 6; i++) {
        const a = await azienda()
        const aperto = await apri(a, dati())

        const esiti = await withTimeout(
          Promise.allSettled([secondaPesata(a, aperto.id), annulla(a, aperto.id)]),
          20_000
        )

        const stato = (await owner.accessoPesa.findUniqueOrThrow({ where: { id: aperto.id } }))
          .stato
        const pesate = await conta(aperto.id)
        // nessun rifiuto "grezzo" del database: solo errori di dominio
        for (const e of esiti) {
          if (e.status === 'rejected') {
            expect(e.reason).toBeInstanceOf(StatoAccessoNonValidoError)
            expect(String(e.reason.message)).not.toMatch(/violates|trigger|deadlock/i)
          }
        }
        // l'annullo (ADMIN) riesce sempre; la seconda pesata riesce solo se passa per prima
        expect(stato).toBe('ANNULLATO')
        expect(esiti[1].status).toBe('fulfilled')
        if (esiti[0].status === 'fulfilled') expect(pesate).toBe(2)
        else expect(pesate).toBe(1)
      }
    }, 60_000)

    it('due seconde pesate concorrenti con chiavi diverse: una chiude, l’altra 409', async () => {
      const a = await azienda()
      const aperto = await apri(a, dati())

      const esiti = await Promise.allSettled([
        secondaPesata(a, aperto.id),
        secondaPesata(a, aperto.id),
      ])

      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      const no = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(no.reason).toBeInstanceOf(StatoAccessoNonValidoError)
      expect(await conta(aperto.id)).toBe(2)
    })

    it('inserimento di pesata e chiusura/annullo di accessi diversi non si bloccano a vicenda', async () => {
      const a = await azienda()
      const aperti = await Promise.all([apri(a, dati()), apri(a, dati()), apri(a, dati())])

      const esiti = await withTimeout(
        Promise.allSettled([
          secondaPesata(a, aperti[0].id),
          annulla(a, aperti[1].id),
          secondaPesata(a, aperti[2].id),
        ]),
        20_000
      )

      expect(esiti.every(e => e.status === 'fulfilled')).toBe(true)
    })
  })

  describe('concorrenza: automezzo, alibi e lettura', () => {
    it('due aperture TARA_ANAGRAFICA dello stesso mezzo su due registri: nessun deadlock, entrambe riescono', async () => {
      for (let i = 0; i < 5; i++) {
        const a = await azienda()
        const reg = await owner.registroRifiuti.findFirstOrThrow({
          where: { tenantId: a.tenantId },
        })
        const reg2 = await owner.registroRifiuti.create({
          data: { tenantId: a.tenantId, descrizione: 'Registro B', codice: 'B' },
        })
        const mezzo = await mezzoConTara(a, 'DL111DL', 7000)
        const su = (registroId: string) =>
          apri(a, dati({ modo: 'TARA_ANAGRAFICA', automezzoId: mezzo.id, registroId }))

        const esiti = await withTimeout(Promise.allSettled([su(reg.id), su(reg2.id)]), 20_000)

        for (const e of esiti) {
          if (e.status === 'rejected') throw e.reason
        }
        expect(esiti.map(e => e.status)).toEqual(['fulfilled', 'fulfilled'])
      }
    }, 60_000)

    it('due aperture parallele con lo stesso strumento+alibi: una riesce, l’altra AlibiGiaUsatoError (italiano)', async () => {
      for (let i = 0; i < 4; i++) {
        const a = await azienda()
        const s = await nelTenant(a.tenantId, () =>
          strumenti.crea(a.tenantId, a.utenteId, { descrizione: 'Pesa', portataMaxKg: 60000 })
        )
        const pesata = {
          pesoKg: 24000,
          strumentoId: s.id,
          alibiId: 'Z-1',
          motivo: 'm',
          stabileDichiarato: true,
        }

        const esiti = await Promise.allSettled([
          apri(a, dati({ pesata })),
          apri(a, dati({ pesata })),
        ])

        expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
        const no = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
        expect(no.reason).toBeInstanceOf(AlibiGiaUsatoError)
        expect(no.reason.message).toBe(
          'Questa memoria alibi è già stata usata per una pesata di questo strumento.'
        )
        expect(await owner.accessoPesa.count({ where: { tenantId: a.tenantId } })).toBe(1)
      }
    })

    it('accesso CHIUSO: gli avvisi del netto valgono al giorno della chiusura, non a oggi', async () => {
      const a = await azienda()
      const mezzo = await mezzoConTara(a, 'AV111AV', 7000)
      const giorni = (n: number) => new Date(Date.now() + n * 86_400_000)
      // tara aggiornata 300 giorni fa: alla chiusura non e' ancora "vecchia" (> 365)
      await owner.$executeRaw`UPDATE automezzi SET tara_aggiornata_il = ${giorni(-300)} WHERE id = ${mezzo.id}::uuid`
      const chiuso = await apri(a, dati({ modo: 'TARA_ANAGRAFICA', automezzoId: mezzo.id }))
      expect(chiuso.avvisi.join(' ')).not.toMatch(/più di 365 giorni/)

      // 100 giorni dopo la tara avrebbe 400 giorni: la vista dell'accesso chiuso non cambia
      ;(service as any).adesso = () => giorni(100)
      try {
        const dopo = await nelTenant(a.tenantId, () => service.dettaglio(a.tenantId, chiuso.id))
        const elenco = await nelTenant(a.tenantId, () => service.elenca(a.tenantId, {}))
        expect(dopo.avvisi.join(' ')).not.toMatch(/più di 365 giorni/)
        expect(elenco.righe[0].nettoKg).toBe(17000)
      } finally {
        ;(service as any).adesso = () => new Date()
      }
    })

    it('automezzo disattivato: 422 e nessun accesso', async () => {
      const a = await azienda()
      const m = await nelTenant(a.tenantId, () =>
        automezzi.crea(a.tenantId, a.utenteId, { targa: 'OF111OF' })
      )
      await nelTenant(a.tenantId, () =>
        automezzi.aggiorna(a.tenantId, a.utenteId, m.id, { targa: 'OF111OF', attivo: false })
      )

      await expect(apri(a, dati({ automezzoId: m.id }))).rejects.toThrow(
        "L'automezzo non è attivo."
      )
      expect(await owner.accessoPesa.count({ where: { tenantId: a.tenantId } })).toBe(0)
    })
  })

  describe('annullo e ruoli', () => {
    it('operatore: annulla un APERTO, non un CHIUSO; accesso di un’altra azienda: 404', async () => {
      const a = await azienda()
      const b = await azienda()
      const aperto = await apri(a, dati())
      const chiuso = await secondaPesata(a, (await apri(a, dati())).id)

      await expect(
        nelTenant(a.tenantId, () => service.annulla(a.tenantId, op(a, 'OPERATOR'), aperto.id, 'x'))
      ).resolves.toMatchObject({ stato: 'ANNULLATO', motivoAnnullamento: 'x' })
      await expect(
        nelTenant(a.tenantId, () => service.annulla(a.tenantId, op(a, 'OPERATOR'), chiuso.id, 'x'))
      ).rejects.toThrow(/amministratore/)
      await expect(
        nelTenant(b.tenantId, () => service.dettaglio(b.tenantId, aperto.id))
      ).rejects.toThrow('Accesso non trovato.')
    })
  })

  async function mezzoConTara(a: Azienda, targa: string, tara: number) {
    const m = await nelTenant(a.tenantId, () => automezzi.crea(a.tenantId, a.utenteId, { targa }))
    await nelTenant(a.tenantId, () =>
      automezzi.impostaTara(a.tenantId, a.utenteId, m.id, { taraKg: tara })
    )
    return m
  }
})

async function creaAzienda(owner: PrismaClient) {
  n++
  const t = await owner.tenant.create({
    data: {
      partitaIva: partitaIvaValida(seme + n * 19),
      ragioneSociale: 'Accessi SRL',
      country: 'IT',
    },
  })
  const utente = await owner.user.create({
    data: {
      tenantId: t.id,
      keycloakId: `kc-acc-${seme}-${n}`,
      fiscalCode: `ACC${seme}${n}`.slice(0, 16),
      firstName: 'Prova',
      lastName: 'Accessi',
      email: `acc-${seme}-${n}@example.test`,
      role: 'ADMIN',
    },
  })
  await owner.registroRifiuti.create({
    data: { tenantId: t.id, descrizione: 'Registro A', codice: 'A' },
  })
  return { tenantId: t.id, utenteId: utente.id }
}

function randomBytes(len: number): Buffer {
  return Buffer.from(Array.from({ length: len }, (_, i) => (i * 31 + 7) % 251))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout: possibile deadlock')), ms)),
  ])
}

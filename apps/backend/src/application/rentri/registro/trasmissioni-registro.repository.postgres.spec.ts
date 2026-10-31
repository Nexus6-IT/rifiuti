/**
 * Repository delle trasmissioni del registro a RENTRI (F2-9, Task 7) contro un Postgres reale,
 * COME `wasteflow_app` (RLS) dentro il `TenantContext`. Il proprietario prepara aziende, registri e
 * movimenti; la pulizia toglie solo gli id creati qui.
 *
 * Garanzia centrale: nulla che RENTRI possa gia' avere (IN_INVIO, ATTESA_ESITO, INCERTA, TRASMESSA)
 * torna selezionabile per un nuovo lotto.
 */
import { PrismaClient, type StatoTrasmissioneRentri } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { randomUUID } from 'crypto'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaValida } from '../../../test-support/anagrafiche-di-test'
import { TrasmissioniRegistroRepository } from './trasmissioni-registro.repository'

const IDENT_MOV = 'M0000000000000000001'

describe('TrasmissioniRegistroRepository — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let repo: TrasmissioniRegistroRepository
  const tenantCreati: string[] = []
  let n = 0
  let progressivo = 0

  async function azienda(opzioni: { identificativo?: string | null; dal?: Date | null } = {}) {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now() + ++n),
        ragioneSociale: 'Trasmissioni RENTRI SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001TR${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede.id,
        descrizione: 'Registro di prova',
        identificativoRentri:
          opzioni.identificativo === undefined ? 'RABCDE12345' : opzioni.identificativo,
        invioRentriAutomaticoDal: opzioni.dal ?? null,
      },
    })
    return { tenantId: t.id, registroId: registro.id, unitaLocaleId: sede.id }
  }

  async function movimento(
    a: { tenantId: string; registroId: string },
    extra: Record<string, unknown> = {}
  ) {
    return owner.wasteMovement.create({
      data: {
        tenantId: a.tenantId,
        registroId: a.registroId,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        cerCode: '15 01 01',
        unit: 'KG',
        wastePhysicalState: 'Solido',
        type: 'CARICO',
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 100,
        ...extra,
      } as never,
    })
  }

  async function riga(
    a: { tenantId: string; registroId: string },
    m: { id: string; type: 'CARICO' | 'SCARICO' },
    dati: Record<string, unknown> = {}
  ) {
    const stato = (dati.stato as StatoTrasmissioneRentri | undefined) ?? 'DA_TRASMETTERE'
    const bloccata = ['TRASMESSA', 'GIA_SU_RENTRI', 'INCERTA'].includes(stato)
    return owner.movimentoTrasmissioneRentri.create({
      data: {
        tenantId: a.tenantId,
        movimentoId: m.id,
        registroId: a.registroId,
        tipo: m.type,
        origine: 'MANUALE',
        bloccatoInvio: bloccata,
        motivoBlocco: bloccata ? 'prova' : null,
        ...dati,
      } as never,
    })
  }

  const stati = async (tenantId: string) =>
    Object.fromEntries(
      (await owner.movimentoTrasmissioneRentri.findMany({ where: { tenantId } })).map(r => [
        r.movimentoId,
        r.stato,
      ])
    )

  const cand = (ids: string[]) => ({ lotto: ids, nonTrasmissibili: [] })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    repo = new TrasmissioniRegistroRepository(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      // Cascata dell'azienda: righe di trasmissione, movimenti e registri (id esatti creati qui).
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('prenota: porta in IN_INVIO le righe scelte con lotto, tentativi e candidate con predecessore', async () => {
    const a = await azienda()
    const m1 = await movimento(a)
    const m2 = await movimento(a, { type: 'SCARICO', causale: 'CONFERIMENTO_TRASPORTATORE' })
    await riga(a, m1)
    await riga(a, m2)
    let viste: any[] = []
    const r = await repo.prenota(a.tenantId, a.registroId, async (_tx, candidate) => {
      viste = candidate
      return cand([m1.id, m2.id])
    })
    expect(r.esito).toBe('PRENOTATO')
    if (r.esito !== 'PRENOTATO') throw new Error('atteso PRENOTATO')
    expect(r.movimentoIds).toEqual([m1.id, m2.id])
    expect(viste.map(c => c.movimentoId)).toEqual([m1.id, m2.id])
    expect(viste[0]).toMatchObject({
      numero: { anno: 2026, progressivo: m1.progressiveNumber },
      predecessoreId: null,
      statoPredecessore: null,
    })
    const righe = await owner.movimentoTrasmissioneRentri.findMany({
      where: { tenantId: a.tenantId },
    })
    expect(righe.every(x => x.stato === 'IN_INVIO' && x.lottoId === r.lottoId)).toBe(true)
    expect(righe.every(x => x.tentativi === 1 && x.prenotatoIl !== null)).toBe(true)
  })

  it('prenota: registro senza identificativo e registro senza righe', async () => {
    const senza = await azienda({ identificativo: null })
    const m = await movimento(senza)
    await riga(senza, m)
    const prepara = jest.fn()
    expect(await repo.prenota(senza.tenantId, senza.registroId, prepara)).toEqual({
      esito: 'SENZA_IDENTIFICATIVO',
    })
    expect(prepara).not.toHaveBeenCalled()
    const vuoto = await azienda()
    expect(await repo.prenota(vuoto.tenantId, vuoto.registroId, prepara)).toEqual({
      esito: 'NIENTE',
    })
    expect(prepara).not.toHaveBeenCalled()
  })

  it('i non traducibili vanno in NON_TRASMISSIBILE con i motivi anche se il lotto resta vuoto', async () => {
    const a = await azienda()
    const m = await movimento(a)
    await riga(a, m)
    const r = await repo.prenota(a.tenantId, a.registroId, async () => ({
      lotto: [],
      nonTrasmissibili: [{ movimentoId: m.id, motivi: ['manca il codice', 'manca la sede'] }],
    }))
    expect(r).toEqual({ esito: 'NIENTE' })
    const x = await owner.movimentoTrasmissioneRentri.findFirstOrThrow({
      where: { movimentoId: m.id },
    })
    expect(x.stato).toBe('NON_TRASMISSIBILE')
    expect(x.ultimoErrore).toBe('manca il codice; manca la sede')
  })

  it('registro con una ATTESA_ESITO (o IN_INVIO): GIA_IN_CORSO', async () => {
    for (const stato of ['ATTESA_ESITO', 'IN_INVIO'] as const) {
      const a = await azienda()
      const m1 = await movimento(a)
      const m2 = await movimento(a)
      await riga(a, m1, {
        stato,
        transazioneId: stato === 'ATTESA_ESITO' ? randomUUID() : null,
        lottoId: randomUUID(),
      })
      await riga(a, m2)
      const prepara = jest.fn()
      expect(await repo.prenota(a.tenantId, a.registroId, prepara)).toEqual({
        esito: 'GIA_IN_CORSO',
      })
      expect(prepara).not.toHaveBeenCalled()
    }
  })

  it('le righe bloccate e quelle TRASMESSA non entrano mai nel lotto', async () => {
    const a = await azienda()
    const ok = await movimento(a)
    const trasmessa = await movimento(a)
    const incerta = await movimento(a)
    const gia = await movimento(a)
    const rifiutata = await movimento(a)
    await riga(a, ok)
    await riga(a, trasmessa, { stato: 'TRASMESSA' })
    await riga(a, incerta, { stato: 'INCERTA' })
    await riga(a, gia, { stato: 'GIA_SU_RENTRI', origine: 'DICHIARATA' })
    await riga(a, rifiutata, { stato: 'RIFIUTATA' })
    let viste: string[] = []
    const r = await repo.prenota(a.tenantId, a.registroId, async (_tx, candidate) => {
      viste = candidate.map(c => c.movimentoId)
      return cand(viste)
    })
    expect(viste).toEqual([ok.id])
    expect(r.esito).toBe('PRENOTATO')
    const s = await stati(a.tenantId)
    expect(s[trasmessa.id]).toBe('TRASMESSA')
    expect(s[incerta.id]).toBe('INCERTA')
    expect(s[gia.id]).toBe('GIA_SU_RENTRI')
    expect(s[rifiutata.id]).toBe('RIFIUTATA')
    // un secondo giro non trova piu' nulla da prenotare: c'e' un lotto in corso
    expect(await repo.prenota(a.tenantId, a.registroId, jest.fn())).toEqual({
      esito: 'GIA_IN_CORSO',
    })
  })

  it(
    'una scelta fuori dalle candidate e' +
      ' un errore di programmazione: rollback, nulla prenotato',
    async () => {
      const a = await azienda()
      const m = await movimento(a)
      const trasmessa = await movimento(a)
      await riga(a, m)
      await riga(a, trasmessa, { stato: 'TRASMESSA' })
      await expect(
        repo.prenota(a.tenantId, a.registroId, async () => cand([m.id, trasmessa.id]))
      ).rejects.toThrow(/non candidata/)
      const s = await stati(a.tenantId)
      expect(s[m.id]).toBe('DA_TRASMETTERE')
      expect(s[trasmessa.id]).toBe('TRASMESSA')
    }
  )

  it('correzione: la candidata porta lo stato del predecessore', async () => {
    const a = await azienda()
    const orig = await movimento(a)
    const rett = await movimento(a, {
      tipoAnnotazione: 'RETTIFICA',
      movimentoRettificatoId: orig.id,
      movimentoOriginaleId: orig.id,
      motivoAnnotazione: 'x',
    })
    await riga(a, orig, { stato: 'TRASMESSA' })
    await riga(a, rett, { origine: 'CORREZIONE' })
    let viste: any[] = []
    await repo.prenota(a.tenantId, a.registroId, async (_tx, c) => {
      viste = c
      return cand([])
    })
    expect(viste).toHaveLength(1)
    expect(viste[0]).toMatchObject({
      movimentoId: rett.id,
      predecessoreId: orig.id,
      statoPredecessore: 'TRASMESSA',
    })
  })

  it('due prenotazioni concorrenti: una sola ottiene il lotto', async () => {
    const a = await azienda()
    const ms = [await movimento(a), await movimento(a), await movimento(a)]
    for (const m of ms) await riga(a, m)
    const ids = ms.map(m => m.id)
    const prepara = jest.fn(async (_tx: unknown, c: Array<{ movimentoId: string }>) => {
      // tiene aperta la transazione: la seconda deve aspettare il lock, non sovrapporsi
      await new Promise(r => setTimeout(r, 400))
      return cand(c.map(x => x.movimentoId))
    })
    const [r1, r2, r3] = await Promise.all([
      repo.prenota(a.tenantId, a.registroId, prepara as never),
      repo.prenota(a.tenantId, a.registroId, prepara as never),
      repo.prenota(a.tenantId, a.registroId, prepara as never),
    ])
    const esiti = [r1, r2, r3].map(r => r.esito).sort()
    expect(esiti).toEqual(['GIA_IN_CORSO', 'GIA_IN_CORSO', 'PRENOTATO'])
    expect(prepara).toHaveBeenCalledTimes(1)
    const righe = await owner.movimentoTrasmissioneRentri.findMany({
      where: { tenantId: a.tenantId },
    })
    expect(righe.map(r => r.movimentoId).sort()).toEqual([...ids].sort())
    expect(new Set(righe.map(r => r.lottoId)).size).toBe(1)
    expect(righe.every(r => r.stato === 'IN_INVIO' && r.tentativi === 1)).toBe(true)
  })

  it('salvaTransazione: IN_INVIO diventa ATTESA_ESITO; su un lotto non in invio errore', async () => {
    const a = await azienda()
    const m = await movimento(a)
    await riga(a, m)
    const p = await repo.prenota(a.tenantId, a.registroId, async () => cand([m.id]))
    if (p.esito !== 'PRENOTATO') throw new Error('atteso PRENOTATO')
    const t = randomUUID()
    await repo.salvaTransazione(a.tenantId, p.lottoId, t)
    const x = await owner.movimentoTrasmissioneRentri.findFirstOrThrow({
      where: { movimentoId: m.id },
    })
    expect(x.stato).toBe('ATTESA_ESITO')
    expect(x.transazioneId).toBe(t)
    await expect(repo.salvaTransazione(a.tenantId, p.lottoId, randomUUID())).rejects.toThrow()
  })

  it('segnaIncerte: da lotto o da transazione, bloccate; mai da stati definitivi', async () => {
    const a = await azienda()
    const m1 = await movimento(a)
    const m2 = await movimento(a)
    await riga(a, m1)
    const p = await repo.prenota(a.tenantId, a.registroId, async () => cand([m1.id]))
    if (p.esito !== 'PRENOTATO') throw new Error('atteso PRENOTATO')
    expect(await repo.segnaIncerte(a.tenantId, p.lottoId, 'Esito sconosciuto')).toBe(1)
    const x = await owner.movimentoTrasmissioneRentri.findFirstOrThrow({
      where: { movimentoId: m1.id },
    })
    expect(x).toMatchObject({
      stato: 'INCERTA',
      bloccatoInvio: true,
      motivoBlocco: 'Esito sconosciuto',
    })
    // per transazione
    const t = randomUUID()
    await riga(a, m2, { stato: 'ATTESA_ESITO', transazioneId: t, lottoId: randomUUID() })
    expect(
      await repo.segnaIncerte(a.tenantId, { transazioneId: t }, 'Transazione non trovata')
    ).toBe(1)
    // una TRASMESSA non si tocca
    const m3 = await movimento(a)
    await riga(a, m3, { stato: 'TRASMESSA', transazioneId: t })
    expect(await repo.segnaIncerte(a.tenantId, { transazioneId: t }, 'ancora')).toBe(0)
    expect((await stati(a.tenantId))[m3.id]).toBe('TRASMESSA')
  })

  it("segnaRifiutate: solo IN_INVIO (la POST non e' stata accettata); una ATTESA_ESITO resta", async () => {
    const a = await azienda()
    const m1 = await movimento(a)
    const m2 = await movimento(a)
    await riga(a, m1)
    const p = await repo.prenota(a.tenantId, a.registroId, async () => cand([m1.id]))
    if (p.esito !== 'PRENOTATO') throw new Error('atteso PRENOTATO')
    expect(await repo.segnaRifiutate(a.tenantId, p.lottoId, 'Richiesta non valida')).toBe(1)
    const x = await owner.movimentoTrasmissioneRentri.findFirstOrThrow({
      where: { movimentoId: m1.id },
    })
    expect(x).toMatchObject({
      stato: 'RIFIUTATA',
      bloccatoInvio: false,
      ultimoErrore: 'Richiesta non valida',
    })
    const lotto = randomUUID()
    await riga(a, m2, { stato: 'ATTESA_ESITO', transazioneId: randomUUID(), lottoId: lotto })
    expect(await repo.segnaRifiutate(a.tenantId, lotto, 'no')).toBe(0)
    expect((await stati(a.tenantId))[m2.id]).toBe('ATTESA_ESITO')
  })

  it('applicaEsiti: TRASMESSA bloccata con identificativo; RIFIUTATA sbloccata', async () => {
    const a = await azienda()
    const m1 = await movimento(a)
    const m2 = await movimento(a)
    const m3 = await movimento(a)
    const t = randomUUID()
    const lotto = randomUUID()
    for (const m of [m1, m2, m3]) {
      await riga(a, m, { stato: 'ATTESA_ESITO', transazioneId: t, lottoId: lotto })
    }
    await repo.applicaEsiti(a.tenantId, t, [
      {
        movimentoId: m1.id,
        stato: 'TRASMESSA',
        identificativo: IDENT_MOV,
        messaggi: [],
        motivo: null,
      },
      {
        movimentoId: m2.id,
        stato: 'RIFIUTATA',
        identificativo: null,
        messaggi: [{ indice: 1, campo: 'quantita', tipo: 'Errore', codice: 'E1' }],
        motivo: 'Rifiutata da RENTRI: vedere i messaggi di validazione',
      },
      // identificativo non nel formato: la riga e' comunque TRASMESSA, identificativo null
      { movimentoId: m3.id, stato: 'TRASMESSA', identificativo: 'xx', messaggi: [], motivo: null },
    ])
    const per = Object.fromEntries(
      (await owner.movimentoTrasmissioneRentri.findMany({ where: { tenantId: a.tenantId } })).map(
        r => [r.movimentoId, r]
      )
    )
    expect(per[m1.id]).toMatchObject({
      stato: 'TRASMESSA',
      bloccatoInvio: true,
      identificativoRentri: IDENT_MOV,
      motivoBlocco: 'Trasmessa a RENTRI',
    })
    expect(per[m1.id].trasmessoIl).not.toBeNull()
    expect(per[m2.id]).toMatchObject({ stato: 'RIFIUTATA', bloccatoInvio: false })
    expect(per[m2.id].ultimoErrore).toMatch(/Rifiutata da RENTRI/)
    expect(per[m2.id].messaggi).toEqual([{ campo: 'quantita', codice: 'E1', tipo: 'Errore' }])
    expect(per[m3.id]).toMatchObject({ stato: 'TRASMESSA', identificativoRentri: null })
    // riapplicare non cambia nulla (le righe non sono piu' ATTESA_ESITO)
    await repo.applicaEsiti(a.tenantId, t, [
      { movimentoId: m1.id, stato: 'RIFIUTATA', identificativo: null, messaggi: [], motivo: 'x' },
    ])
    expect((await stati(a.tenantId))[m1.id]).toBe('TRASMESSA')
  })

  it('annotaErrorePolling lascia ATTESA_ESITO; transazioniInAttesa le elenca; ripristinaPrenotazione', async () => {
    const a = await azienda()
    const m1 = await movimento(a)
    const m2 = await movimento(a)
    const t = randomUUID()
    await riga(a, m1, {
      stato: 'ATTESA_ESITO',
      transazioneId: t,
      lottoId: randomUUID(),
      prenotatoIl: new Date('2026-03-01T10:00:00Z'),
    })
    await repo.annotaErrorePolling(a.tenantId, t, 'Timeout nella lettura')
    const x = await owner.movimentoTrasmissioneRentri.findFirstOrThrow({
      where: { movimentoId: m1.id },
    })
    expect(x.stato).toBe('ATTESA_ESITO')
    expect(x.ultimoErrore).toBe('Timeout nella lettura')
    const attese = await repo.transazioniInAttesa(a.tenantId)
    expect(attese).toEqual([
      { transazioneId: t, registroId: a.registroId, dal: new Date('2026-03-01T10:00:00Z') },
    ])

    await riga(a, m2)
    const p = await repo
      .prenota(a.tenantId, a.registroId, async () => {
        return cand([m2.id])
      })
      .catch(e => e)
    // m1 e' in ATTESA_ESITO: il registro e' in corso
    expect(p).toEqual({ esito: 'GIA_IN_CORSO' })
    const b = await azienda()
    const mb = await movimento(b)
    await riga(b, mb)
    const pb = await repo.prenota(b.tenantId, b.registroId, async () => cand([mb.id]))
    if (pb.esito !== 'PRENOTATO') throw new Error('atteso PRENOTATO')
    await repo.ripristinaPrenotazione(b.tenantId, pb.lottoId)
    const rb = await owner.movimentoTrasmissioneRentri.findFirstOrThrow({
      where: { movimentoId: mb.id },
    })
    expect(rb).toMatchObject({
      stato: 'DA_TRASMETTERE',
      lottoId: null,
      prenotatoIl: null,
      tentativi: 0,
      bloccatoInvio: false,
    })
  })

  it('stalliInInvio: IN_INVIO vecchia senza transazione diventa INCERTA; con transazione no', async () => {
    const a = await azienda()
    const vecchia = await movimento(a)
    const conTransazione = await movimento(a)
    const recente = await movimento(a)
    const lungaFa = new Date(Date.now() - 3600_000)
    await riga(a, vecchia, { stato: 'IN_INVIO', lottoId: randomUUID(), prenotatoIl: lungaFa })
    await riga(a, conTransazione, {
      stato: 'IN_INVIO',
      lottoId: randomUUID(),
      prenotatoIl: lungaFa,
      transazioneId: randomUUID(),
    })
    await riga(a, recente, { stato: 'IN_INVIO', lottoId: randomUUID(), prenotatoIl: new Date() })
    expect(await repo.stalliInInvio(a.tenantId, new Date(Date.now() - 60_000))).toBe(1)
    const s = await stati(a.tenantId)
    expect(s[vecchia.id]).toBe('INCERTA')
    expect(s[conTransazione.id]).toBe('IN_INVIO')
    expect(s[recente.id]).toBe('IN_INVIO')
    const x = await owner.movimentoTrasmissioneRentri.findFirstOrThrow({
      where: { movimentoId: vecchia.id },
    })
    expect(x.bloccatoInvio).toBe(true)
    expect(x.motivoBlocco).toMatch(/verificare prima di ritrasmettere/)
  })

  it('adottaAutomatiche: solo movimenti creati dopo invio_rentri_automatico_dal, registro senza data nessuno', async () => {
    const dal = new Date('2026-06-01T00:00:00Z')
    const a = await azienda({ dal })
    const prima = await movimento(a, { createdAt: new Date('2026-05-01T00:00:00Z') })
    const dopo1 = await movimento(a, { createdAt: new Date('2026-06-02T00:00:00Z') })
    const dopo2 = await movimento(a, { createdAt: new Date('2026-06-03T00:00:00Z') })
    // correzione di un movimento ante-data mai trasmesso: non si adotta
    const rettAnte = await movimento(a, {
      createdAt: new Date('2026-06-04T00:00:00Z'),
      tipoAnnotazione: 'RETTIFICA',
      movimentoRettificatoId: prima.id,
      movimentoOriginaleId: prima.id,
      motivoAnnotazione: 'x',
    })
    // correzione di un movimento post-data: si adotta con la catena
    const rettDopo = await movimento(a, {
      createdAt: new Date('2026-06-05T00:00:00Z'),
      tipoAnnotazione: 'RETTIFICA',
      movimentoRettificatoId: dopo1.id,
      movimentoOriginaleId: dopo1.id,
      motivoAnnotazione: 'x',
    })
    const senzaData = await azienda({ dal: null })
    const mSenza = await movimento(senzaData, { createdAt: new Date('2026-06-02T00:00:00Z') })

    expect(await repo.adottaAutomatiche(a.tenantId, 1000)).toBe(3)
    expect(await repo.adottaAutomatiche(senzaData.tenantId, 1000)).toBe(0)
    const s = await stati(a.tenantId)
    expect(s[prima.id]).toBeUndefined()
    expect(s[rettAnte.id]).toBeUndefined()
    expect(s[dopo1.id]).toBe('DA_TRASMETTERE')
    expect(s[dopo2.id]).toBe('DA_TRASMETTERE')
    expect(s[rettDopo.id]).toBe('DA_TRASMETTERE')
    expect((await stati(senzaData.tenantId))[mSenza.id]).toBeUndefined()
    const r = await owner.movimentoTrasmissioneRentri.findFirstOrThrow({
      where: { movimentoId: dopo1.id },
    })
    expect(r).toMatchObject({ origine: 'AUTOMATICA', bloccatoInvio: false, tentativi: 0 })
    // idempotente e con limite
    expect(await repo.adottaAutomatiche(a.tenantId, 1000)).toBe(0)
    const b = await azienda({ dal })
    for (let i = 0; i < 3; i++) await movimento(b, { createdAt: new Date('2026-06-02T00:00:00Z') })
    expect(await repo.adottaAutomatiche(b.tenantId, 2)).toBe(2)
  })

  it('adottaCorrezioni: rettifica di una TRASMESSA adottata, di una RIFIUTATA no', async () => {
    const a = await azienda()
    const okOrig = await movimento(a)
    const giaOrig = await movimento(a)
    const rifOrig = await movimento(a)
    const senzaOrig = await movimento(a)
    const corr = (orig: { id: string }) =>
      movimento(a, {
        tipoAnnotazione: 'RETTIFICA',
        movimentoRettificatoId: orig.id,
        movimentoOriginaleId: orig.id,
        motivoAnnotazione: 'x',
      })
    const c1 = await corr(okOrig)
    const c2 = await corr(giaOrig)
    const c3 = await corr(rifOrig)
    const c4 = await corr(senzaOrig)
    await riga(a, okOrig, { stato: 'TRASMESSA' })
    await riga(a, giaOrig, { stato: 'GIA_SU_RENTRI', origine: 'DICHIARATA' })
    await riga(a, rifOrig, { stato: 'RIFIUTATA' })
    expect(await repo.adottaCorrezioni(a.tenantId, 1000)).toBe(2)
    const s = await stati(a.tenantId)
    expect(s[c1.id]).toBe('DA_TRASMETTERE')
    expect(s[c2.id]).toBe('DA_TRASMETTERE')
    expect(s[c3.id]).toBeUndefined()
    expect(s[c4.id]).toBeUndefined()
    const r = await owner.movimentoTrasmissioneRentri.findFirstOrThrow({
      where: { movimentoId: c1.id },
    })
    expect(r.origine).toBe('CORREZIONE')
    expect(await repo.adottaCorrezioni(a.tenantId, 1000)).toBe(0)
  })

  it("nessuna riga di un'altra azienda toccata", async () => {
    const a = await azienda({ dal: new Date('2026-01-01T00:00:00Z') })
    const b = await azienda({ dal: new Date('2026-01-01T00:00:00Z') })
    const ma = await movimento(a)
    const mb = await movimento(b)
    const lotto = randomUUID()
    const t = randomUUID()
    await riga(b, mb, {
      stato: 'ATTESA_ESITO',
      transazioneId: t,
      lottoId: lotto,
      prenotatoIl: new Date('2020-01-01T00:00:00Z'),
    })
    expect(await repo.segnaIncerte(a.tenantId, lotto, 'x')).toBe(0)
    expect(await repo.segnaIncerte(a.tenantId, { transazioneId: t }, 'x')).toBe(0)
    expect(await repo.segnaRifiutate(a.tenantId, lotto, 'x')).toBe(0)
    expect(await repo.stalliInInvio(a.tenantId, new Date())).toBe(0)
    expect(await repo.transazioniInAttesa(a.tenantId)).toEqual([])
    await repo.applicaEsiti(a.tenantId, t, [
      {
        movimentoId: mb.id,
        stato: 'TRASMESSA',
        identificativo: IDENT_MOV,
        messaggi: [],
        motivo: null,
      },
    ])
    await repo.annotaErrorePolling(a.tenantId, t, 'x')
    await expect(repo.salvaTransazione(a.tenantId, lotto, randomUUID())).rejects.toThrow()
    // la prenotazione di A non vede il registro di B
    expect(await repo.prenota(a.tenantId, b.registroId, jest.fn())).toEqual({
      esito: 'SENZA_IDENTIFICATIVO',
    })
    expect(await repo.adottaAutomatiche(a.tenantId, 1000)).toBe(1)
    const sb = await stati(b.tenantId)
    expect(sb).toEqual({ [mb.id]: 'ATTESA_ESITO' })
    expect((await stati(a.tenantId))[ma.id]).toBe('DA_TRASMETTERE')
  })
})

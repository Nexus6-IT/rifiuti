/**
 * «Fatturazione da» (4.3, Task 5) contro un Postgres reale, collegato COME `wasteflow_app`, dentro
 * il `TenantContext`. Il proprietario prepara aziende e movimenti e legge lo stato finale. Pulizia
 * solo per id esatti creati.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
// Le barriere su pg_stat_activity guardano solo le connessioni del servizio di questo processo.
const NOME_APPLICAZIONE = `impostazioni-fatt-t5-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaMovimentoDiTest } from '../../test-support/legami-di-test'
import { ImpostazioniFatturazioneService } from './impostazioni-fatturazione.service'

describe('ImpostazioniFatturazioneService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: ImpostazioniFatturazioneService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new ImpostazioniFatturazioneService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const ids = { in: tenantCreati }
      // Le catene di correzione hanno FK NoAction fra loro: si cancellano in un solo statement.
      await owner.wasteMovement.deleteMany({ where: { tenantId: ids } })
      await owner.activityLog.deleteMany({ where: { tenantId: ids } })
      await owner.user.deleteMany({ where: { tenantId: ids } })
      await owner.tenant.deleteMany({ where: { id: ids } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Fatturazione da SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-fatt-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `fatt-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  /** Movimenti fatturabili (INGRESSO_ESTERNO CARICO) nei giorni indicati. */
  async function movimenti(tenantId: string, giorni: string[]) {
    const ids: string[] = []
    for (const movementDate of giorni) {
      ids.push((await creaMovimentoDiTest(owner, tenantId, { movementDate })).movimentoId)
    }
    return ids
  }

  const leggi = (t: string) => nel(t, () => service.leggi(t))
  const imposta = (
    t: string,
    u: string,
    dati: Parameters<ImpostazioniFatturazioneService['imposta']>[2]
  ) => nel(t, () => service.imposta(t, u, dati))

  it('GET senza riga: spenta, versione 0', async () => {
    const { tenantId } = await azienda()
    expect(await leggi(tenantId)).toEqual({
      fatturazioneDa: null,
      definitiveAttive: false,
      versione: 0,
      modificatoIl: null,
    })
  })

  it('prima impostazione (versione 0): 200, versione 1, data AAAA-MM-GG; poi si legge uguale', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
    expect(r).toMatchObject({ fatturazioneDa: '2026-01-01', versione: 1 })
    expect(typeof r.modificatoIl).toBe('string')
    expect(await leggi(tenantId)).toEqual(r)
    const riga = await owner.impostazioneFatturazione.findFirstOrThrow({ where: { tenantId } })
    expect(riga.modificatoDa).toBe(utenteId)
  })

  it('data null: fatturazione spenta (versione 2)', async () => {
    const { tenantId, utenteId } = await azienda()
    await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
    const r = await imposta(tenantId, utenteId, { fatturazioneDa: null, versione: 1 })
    expect(r).toMatchObject({ fatturazioneDa: null, versione: 2 })
    expect((await leggi(tenantId)).fatturazioneDa).toBeNull()
  })

  it.each(['2026-13-40', '01/01/2026', '2026-02-30'])('data %j: 400 senza scrivere', async data => {
    const { tenantId, utenteId } = await azienda()
    const err: any = await imposta(tenantId, utenteId, { fatturazioneDa: data, versione: 0 }).catch(
      e => e
    )
    expect(err.getStatus()).toBe(400)
    expect(err.getResponse().details.errori[0].campo).toBe('fatturazioneDa')
    expect(await owner.impostazioneFatturazione.count({ where: { tenantId } })).toBe(0)
  })

  it('spostare la data indietro con 3 movimenti fatturabili nell’intervallo: 409 CONFERMA_RICHIESTA, riga invariata', async () => {
    const { tenantId, utenteId } = await azienda()
    await movimenti(tenantId, ['2026-02-10', '2026-02-20', '2026-02-28', '2026-04-01'])
    // spenta -> 2026-03-01 tocca i movimenti da marzo in poi (1): si conferma
    await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-03-01',
      versione: 0,
      confermaMovimenti: 1,
    })
    const stato = await leggi(tenantId)
    expect(stato).toMatchObject({ fatturazioneDa: '2026-03-01', versione: 1 })

    const err: any = await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-02-01',
      versione: 1,
    }).catch(e => e)
    expect(err.getStatus()).toBe(409)
    expect(err.getResponse()).toMatchObject({
      error: 'CONFERMA_RICHIESTA',
      details: { movimentiToccati: 3 },
    })
    expect(await leggi(tenantId)).toEqual(stato)
    expect(await nel(tenantId, () => service.contaMovimentiToccati(tenantId, '2026-02-01'))).toBe(3)
  })

  it('con confermaMovimenti uguale al conteggio: 200; diverso: 409', async () => {
    const { tenantId, utenteId } = await azienda()
    await movimenti(tenantId, ['2026-02-10', '2026-02-20', '2026-02-28'])
    await imposta(tenantId, utenteId, { fatturazioneDa: '2026-03-01', versione: 0 }) // nessun movimento da marzo
    const sbagliata: any = await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-02-01',
      versione: 1,
      confermaMovimenti: 2,
    }).catch(e => e)
    expect(sbagliata.getStatus()).toBe(409)
    expect(sbagliata.getResponse().details.movimentiToccati).toBe(3)
    const r = await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-02-01',
      versione: 1,
      confermaMovimenti: 3,
    })
    expect(r).toMatchObject({ fatturazioneDa: '2026-02-01', versione: 2 })
  })

  it('intervallo senza movimenti fatturabili: nessuna conferma richiesta', async () => {
    const { tenantId, utenteId } = await azienda()
    await movimenti(tenantId, ['2026-06-10'])
    // Anche la prima impostazione ha un conteggio (1 movimento da marzo): si conferma
    await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-03-01',
      versione: 0,
      confermaMovimenti: 1,
    })
    const r = await imposta(tenantId, utenteId, { fatturazioneDa: '2026-02-01', versione: 1 })
    expect(r.fatturazioneDa).toBe('2026-02-01')
  })

  it('i movimenti con causale non fatturabile non contano', async () => {
    const { tenantId, utenteId } = await azienda()
    await creaMovimentoDiTest(owner, tenantId, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      movementDate: '2026-05-01',
    })
    expect(await nel(tenantId, () => service.contaMovimentiToccati(tenantId, '2026-01-01'))).toBe(0)
    const r = await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
    expect(r.versione).toBe(1)
  })

  it('conta le teste vigenti: rettifica una volta sola, catena annullata zero', async () => {
    const { tenantId } = await azienda()
    const a = await creaMovimentoDiTest(owner, tenantId, { movementDate: '2026-05-01' })
    const b = await creaMovimentoDiTest(owner, tenantId, { movementDate: '2026-05-02' })
    const origine = await owner.wasteMovement.findUniqueOrThrow({ where: { id: a.movimentoId } })
    const corregge = (tipo: 'RETTIFICA' | 'ANNULLAMENTO', id: string, progressivo: number) =>
      owner.wasteMovement.create({
        data: {
          tenantId,
          registroId: origine.registroId,
          progressiveYear: 2026,
          progressiveNumber: progressivo,
          type: 'CARICO',
          movementDate: new Date('2026-05-03T10:00:00Z'),
          causale: 'INGRESSO_ESTERNO',
          cerCode: '20 03 01',
          quantity: '90',
          tipoAnnotazione: tipo,
          movimentoRettificatoId: id,
          movimentoOriginaleId: id,
          motivoAnnotazione: 'prova',
        },
      })
    await corregge('RETTIFICA', a.movimentoId, 100)
    await corregge('ANNULLAMENTO', b.movimentoId, 101)
    // catena A: originale + rettifica = 1 testa vigente; catena B: annullata = 0
    expect(await nel(tenantId, () => service.contaMovimentiToccati(tenantId, '2026-01-01'))).toBe(1)
  })

  it('il giorno è quello italiano: 23:30 UTC del 28/02 è già il 1° marzo', async () => {
    const { tenantId } = await azienda()
    const m = await creaMovimentoDiTest(owner, tenantId, { movementDate: '2026-02-28' })
    await owner.wasteMovement.update({
      where: { id: m.movimentoId },
      data: { movementDate: new Date('2026-02-28T23:30:00Z') },
    })
    expect(await nel(tenantId, () => service.contaMovimentiToccati(tenantId, '2026-03-01'))).toBe(1)
  })

  it('versione vecchia: 409 VERSIONE_SUPERATA; prima impostazione con versione > 0: 409', async () => {
    const { tenantId, utenteId } = await azienda()
    const senzaRiga: any = await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-01-01',
      versione: 3,
    }).catch(e => e)
    expect(senzaRiga.getStatus()).toBe(409)
    expect(senzaRiga.getResponse().error).toBe('VERSIONE_SUPERATA')
    await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
    const vecchia: any = await imposta(tenantId, utenteId, {
      fatturazioneDa: null,
      versione: 0,
    }).catch(e => e)
    expect(vecchia.getStatus()).toBe(409)
    expect(vecchia.getResponse().error).toBe('VERSIONE_SUPERATA')
    expect((await leggi(tenantId)).fatturazioneDa).toBe('2026-01-01')
  })

  it('audit: valore precedente e nuovo, solo date', async () => {
    const { tenantId, utenteId } = await azienda()
    await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
    await imposta(tenantId, utenteId, { fatturazioneDa: '2026-06-01', versione: 1 })
    const righe = await owner.activityLog.findMany({
      where: { tenantId, action: 'IMPOSTAZIONE_FATTURAZIONE_MODIFICATA' },
      orderBy: { createdAt: 'asc' },
    })
    expect(righe.map(r => r.metadata)).toEqual([
      expect.objectContaining({ precedente: null, nuova: '2026-01-01', movimentiToccati: 0 }),
      expect.objectContaining({
        precedente: '2026-01-01',
        nuova: '2026-06-01',
        movimentiToccati: 0,
      }),
    ])
    expect(righe[0].userId).toBe(utenteId)
  })

  it('imposta non tocca mai legami_movimento', async () => {
    const { tenantId, utenteId } = await azienda()
    await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
    await imposta(tenantId, utenteId, { fatturazioneDa: '2027-01-01', versione: 1 })
    expect(await owner.legameMovimento.count({ where: { tenantId } })).toBe(0)
  })

  it('RLS: un altro tenant non vede la riga', async () => {
    const a = await azienda()
    const b = await azienda()
    await imposta(a.tenantId, a.utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
    expect(await leggi(b.tenantId)).toEqual({
      fatturazioneDa: null,
      definitiveAttive: false,
      versione: 0,
      modificatoIl: null,
    })
    const visibili = await nel(b.tenantId, () => app.impostazioneFatturazione.count())
    expect(visibili).toBe(0)
  })

  it('due PUT concorrenti con la stessa versione: uno 200 e uno 409 (barriera su pg_stat_activity)', async () => {
    const { tenantId, utenteId } = await azienda()
    await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })

    let rilascia!: () => void
    const barriera = new Promise<void>(r => (rilascia = r))
    let tenuto!: () => void
    const eTenuto = new Promise<void>(r => (tenuto = r))
    const tenitore = owner.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "impostazioni_fatturazione"
          WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
        tenuto()
        await barriera
      },
      { timeout: 60_000 }
    )
    await eTenuto

    const primo = imposta(tenantId, utenteId, { fatturazioneDa: '2026-02-01', versione: 1 }).then(
      r => ({ r }),
      e => ({ e })
    )
    const secondo = imposta(tenantId, utenteId, { fatturazioneDa: '2026-03-01', versione: 1 }).then(
      r => ({ r }),
      e => ({ e })
    )
    const scadenza = Date.now() + 30_000
    for (;;) {
      const r = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
          AND wait_event_type = 'Lock'`
      if (r[0].n >= 2) break
      if (Date.now() > scadenza) throw new Error('le due sessioni non sono in attesa del lock')
      await new Promise(res => setTimeout(res, 25))
    }
    rilascia()
    await tenitore
    const esiti = await Promise.all([primo, secondo])
    const riusciti = esiti.filter(e => 'r' in e)
    const falliti = esiti.filter(e => 'e' in e) as { e: any }[]
    expect(riusciti).toHaveLength(1)
    expect(falliti).toHaveLength(1)
    expect(falliti[0].e.getStatus()).toBe(409)
    expect(falliti[0].e.getResponse().error).toBe('VERSIONE_SUPERATA')
    expect((await leggi(tenantId)).versione).toBe(2)
  })

  it('PUT null senza riga: nessuna riga, nessun audit, stato attuale', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await imposta(tenantId, utenteId, { fatturazioneDa: null, versione: 0 })
    expect(r).toEqual({
      fatturazioneDa: null,
      definitiveAttive: false,
      versione: 0,
      modificatoIl: null,
    })
    expect(await owner.impostazioneFatturazione.count({ where: { tenantId } })).toBe(0)
    expect(
      await owner.activityLog.count({
        where: { tenantId, action: 'IMPOSTAZIONE_FATTURAZIONE_MODIFICATA' },
      })
    ).toBe(0)
  })

  /** Movimento fatturabile in un istante UTC preciso (il giorno italiano lo decide il servizio). */
  async function movimentoAlle(tenantId: string, istanteUtc: string) {
    const m = await creaMovimentoDiTest(owner, tenantId)
    await owner.wasteMovement.update({
      where: { id: m.movimentoId },
      data: { movementDate: new Date(istanteUtc) },
    })
  }

  it('estremi: inferiore incluso, superiore escluso, in avanti, all’indietro e verso spenta', async () => {
    const { tenantId, utenteId } = await azienda()
    // tre di febbraio, uno esattamente il 1° marzo (vecchia data), uno ad aprile
    await movimenti(tenantId, [
      '2026-02-10',
      '2026-02-20',
      '2026-02-28',
      '2026-03-01',
      '2026-04-01',
    ])
    // spenta -> 1° marzo: entrano il 1° marzo (estremo incluso) e aprile
    const errConferma: any = await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-03-01',
      versione: 0,
    }).catch(e => e)
    expect(errConferma.getResponse().details.movimentiToccati).toBe(2)
    await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-03-01',
      versione: 0,
      confermaMovimenti: 2,
    })

    // indietro 1° marzo -> 1° febbraio: [1 feb, 1 mar) = 3, il movimento del 1° marzo NON conta
    const indietro: any = await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-02-01',
      versione: 1,
    }).catch(e => e)
    expect(indietro.getResponse().details.movimentiToccati).toBe(3)
    await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-02-01',
      versione: 1,
      confermaMovimenti: 3,
    })

    // avanti 1° febbraio -> 1° marzo: stesso intervallo, stessi 3 (il 1° marzo resta fuori)
    const avanti: any = await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-03-01',
      versione: 2,
    }).catch(e => e)
    expect(avanti.getResponse().details.movimentiToccati).toBe(3)
    await imposta(tenantId, utenteId, {
      fatturazioneDa: '2026-03-01',
      versione: 2,
      confermaMovimenti: 3,
    })

    // 1° marzo -> spenta: escono quelli da marzo in poi (1° marzo incluso + aprile = 2)
    const spenta: any = await imposta(tenantId, utenteId, {
      fatturazioneDa: null,
      versione: 3,
    }).catch(e => e)
    expect(spenta.getResponse().details.movimentiToccati).toBe(2)
    const r = await imposta(tenantId, utenteId, {
      fatturazioneDa: null,
      versione: 3,
      confermaMovimenti: 2,
    })
    expect(r).toMatchObject({ fatturazioneDa: null, versione: 4 })
  })

  it.each([
    // [descrizione, istanti UTC dei movimenti, nuova data, attesi]
    [
      'fine ora legale (25/10/2026): 23:30 italiane del 25 e 00:30 del 26',
      ['2026-10-25T22:30:00Z', '2026-10-25T23:30:00Z'],
      [
        ['2026-10-25', 2],
        ['2026-10-26', 1],
      ],
    ],
    [
      'inizio ora legale (29/03/2026): 23:30 del 28, 00:30 del 29, 23:30 del 29, 00:30 del 30',
      [
        '2026-03-28T22:30:00Z',
        '2026-03-28T23:30:00Z',
        '2026-03-29T21:30:00Z',
        '2026-03-29T22:30:00Z',
      ],
      [
        ['2026-03-29', 3],
        ['2026-03-30', 1],
      ],
    ],
  ] as const)('cambio dell’ora legale — %s', async (_d, istanti, attesi) => {
    const { tenantId } = await azienda()
    for (const i of istanti) await movimentoAlle(tenantId, i)
    for (const [data, atteso] of attesi) {
      expect(await nel(tenantId, () => service.contaMovimentiToccati(tenantId, data))).toBe(atteso)
    }
  })

  describe.each(['ROLLBACK', 'COMMIT'] as const)(
    'due prime impostazioni insieme con barriera (il proprietario chiude con %s)',
    esito => {
      it('il ramo P2002 dà 409 VERSIONE_SUPERATA', async () => {
        const { tenantId, utenteId } = await azienda()
        class Annulla extends Error {}
        let tenuto!: () => void
        const eTenuto = new Promise<void>(r => (tenuto = r))
        let chiudi!: () => void
        const chiusura = new Promise<void>(r => (chiudi = r))
        // INSERT senza commit: le due sessioni del servizio non vedono la riga, arrivano alla
        // create e aspettano il lock sull'indice unico del tenant.
        const tenitore = owner
          .$transaction(
            async tx => {
              await tx.$executeRaw`INSERT INTO "impostazioni_fatturazione" (tenant_id, updated_at)
                VALUES (${tenantId}::uuid, now())`
              tenuto()
              await chiusura
              if (esito === 'ROLLBACK') throw new Annulla()
            },
            { timeout: 60_000 }
          )
          .catch(e => {
            if (!(e instanceof Annulla)) throw e
          })
        await eTenuto

        const lancia = (d: string) =>
          imposta(tenantId, utenteId, { fatturazioneDa: d, versione: 0 }).then(
            r => ({ r }),
            e => ({ e })
          )
        const a = lancia('2026-01-01')
        const b = lancia('2026-02-01')
        const scadenza = Date.now() + 30_000
        for (;;) {
          const r = await owner.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
              AND wait_event_type = 'Lock'`
          if (r[0].n >= 2) break
          if (Date.now() > scadenza) throw new Error('le due sessioni non aspettano il lock')
          await new Promise(res => setTimeout(res, 25))
        }
        chiudi()
        await tenitore
        const esiti = await Promise.all([a, b])
        const riusciti = esiti.filter(e => 'r' in e)
        const falliti = esiti.filter(e => 'e' in e) as { e: any }[]
        expect(riusciti).toHaveLength(esito === 'ROLLBACK' ? 1 : 0)
        expect(falliti).toHaveLength(esito === 'ROLLBACK' ? 1 : 2)
        for (const f of falliti) {
          expect(f.e.getStatus()).toBe(409)
          expect(f.e.getResponse().error).toBe('VERSIONE_SUPERATA')
        }
        expect(await owner.impostazioneFatturazione.count({ where: { tenantId } })).toBe(1)
      })
    }
  )

  describe('interruttore delle definitive (4.4c, Task 29b)', () => {
    const definitive = (
      t: string,
      u: string,
      b: Parameters<ImpostazioniFatturazioneService['impostaDefinitive']>[2]
    ) => nel(t, () => service.impostaDefinitive(t, u, b))

    const lettura = (t: string) =>
      owner.impostazioneFatturazione.findFirstOrThrow({ where: { tenantId: t } })

    it('accende: definitiveAttive true, versione + 1, audit con prima e dopo', async () => {
      const { tenantId, utenteId } = await azienda()
      await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
      const r = await definitive(tenantId, utenteId, { attive: true, versione: 1 })
      expect(r).toEqual({ definitiveAttive: true, versione: 2 })
      const riga = await lettura(tenantId)
      expect(riga.definitiveAttive).toBe(true)
      expect(riga.modificatoDa).toBe(utenteId)
      expect(riga.fatturazioneDa?.toISOString().slice(0, 10)).toBe('2026-01-01')
      const audit = await owner.activityLog.findMany({
        where: { tenantId, action: 'DEFINITIVE_ATTIVE_MODIFICATE' },
      })
      expect(audit).toHaveLength(1)
      expect(audit[0].userId).toBe(utenteId)
      expect(audit[0].metadata).toEqual({ precedente: false, nuova: true })
    })

    it('spegne: definitiveAttive false, versione + 1, audit true -> false', async () => {
      const { tenantId, utenteId } = await azienda()
      await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
      await definitive(tenantId, utenteId, { attive: true, versione: 1 })
      const r = await definitive(tenantId, utenteId, { attive: false, versione: 2 })
      expect(r).toEqual({ definitiveAttive: false, versione: 3 })
      expect((await lettura(tenantId)).definitiveAttive).toBe(false)
      const audit = await owner.activityLog.findMany({
        where: { tenantId, action: 'DEFINITIVE_ATTIVE_MODIFICATE' },
        orderBy: { createdAt: 'asc' },
      })
      expect(audit.map(a => a.metadata)).toEqual([
        { precedente: false, nuova: true },
        { precedente: true, nuova: false },
      ])
    })

    it('azienda senza riga: la riga si crea con fatturazione_da nullo', async () => {
      const { tenantId, utenteId } = await azienda()
      const r = await definitive(tenantId, utenteId, { attive: true, versione: 0 })
      expect(r.definitiveAttive).toBe(true)
      expect(r.versione).toBe(1)
      const riga = await lettura(tenantId)
      expect(riga.fatturazioneDa).toBeNull()
      expect(riga.definitiveAttive).toBe(true)
    })

    it('azienda senza riga e attive false: nessuna riga, nessun audit', async () => {
      const { tenantId, utenteId } = await azienda()
      const r = await definitive(tenantId, utenteId, { attive: false, versione: 0 })
      expect(r).toEqual({ definitiveAttive: false, versione: 0 })
      expect(await owner.impostazioneFatturazione.count({ where: { tenantId } })).toBe(0)
    })

    it('valore invariato: nessuna scrittura, nessun audit, versione uguale', async () => {
      const { tenantId, utenteId } = await azienda()
      await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
      const r = await definitive(tenantId, utenteId, { attive: false, versione: 1 })
      expect(r).toEqual({ definitiveAttive: false, versione: 1 })
      expect(
        await owner.activityLog.count({
          where: { tenantId, action: 'DEFINITIVE_ATTIVE_MODIFICATE' },
        })
      ).toBe(0)
    })

    it('versione vecchia: 409 VERSIONE_SUPERATA, nulla cambia', async () => {
      const { tenantId, utenteId } = await azienda()
      await imposta(tenantId, utenteId, { fatturazioneDa: '2026-01-01', versione: 0 })
      const e: any = await definitive(tenantId, utenteId, { attive: true, versione: 0 }).catch(
        x => x
      )
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse().error).toBe('VERSIONE_SUPERATA')
      const senzaRiga = await azienda()
      const e2: any = await definitive(senzaRiga.tenantId, senzaRiga.utenteId, {
        attive: true,
        versione: 4,
      }).catch(x => x)
      expect(e2.getResponse().error).toBe('VERSIONE_SUPERATA')
      expect((await lettura(tenantId)).definitiveAttive).toBe(false)
    })

    it('GET espone definitiveAttive', async () => {
      const { tenantId, utenteId } = await azienda()
      await definitive(tenantId, utenteId, { attive: true, versione: 0 })
      expect(await leggi(tenantId)).toMatchObject({ definitiveAttive: true, versione: 1 })
    })

    it('il PUT di fatturazione_da della 4.3 non cambia definitive_attive', async () => {
      const { tenantId, utenteId } = await azienda()
      await definitive(tenantId, utenteId, { attive: true, versione: 0 })
      const r = await imposta(tenantId, utenteId, { fatturazioneDa: '2026-03-01', versione: 1 })
      expect(r.definitiveAttive).toBe(true)
      expect((await lettura(tenantId)).definitiveAttive).toBe(true)
      await imposta(tenantId, utenteId, { fatturazioneDa: null, versione: 2 })
      expect((await lettura(tenantId)).definitiveAttive).toBe(true)
    })

    it('RLS: l’azienda B non vede né cambia l’interruttore di A', async () => {
      const a = await azienda()
      const b = await azienda()
      await definitive(a.tenantId, a.utenteId, { attive: true, versione: 0 })
      expect((await leggi(b.tenantId)).definitiveAttive).toBe(false)
      // Con il contesto di B e la versione di A non si tocca la riga di A: B non ha riga.
      const e: any = await definitive(b.tenantId, b.utenteId, { attive: true, versione: 1 }).catch(
        x => x
      )
      expect(e.getResponse().error).toBe('VERSIONE_SUPERATA')
      expect((await lettura(a.tenantId)).versione).toBe(1)
    })
  })
})

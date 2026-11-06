/**
 * Definitiva (fase 4.4b1, Task 19): concorrenza, interazione con la 4.3 e volume contro un Postgres
 * reale, collegato COME `wasteflow_app` (RLS FORCE). Le barriere sono vere: la definitiva si ferma
 * DOPO aver preso tutti i lock (`bloccaPerDefinitiva`) e il test osserva `pg_stat_activity`
 * (`application_name` di questo processo, `wait_event_type = 'Lock'`), mai uno sleep come
 * sincronizzazione. Pulizia solo per id esatti (anche dei DEFINITIVI, col proprietario superuser).
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t19c-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=30`

import { randomUUID } from 'node:crypto'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  completaCedenteDiTest,
  creaScenarioVolume,
  creaTabelleFatturazione,
  impostaFatturazioneDaDiTest,
} from '../../test-support/fatturazione-di-test'
import {
  creaBancoT19,
  esitoHttp as esito,
  PARAMETRI_T19,
  type BancoT19,
  type ElaborazioneT19,
} from '../../test-support/fatturazione-t19-di-test'
import type { AziendaT18 } from '../../test-support/fatturazione-t18-di-test'
import {
  creaFirDiTest,
  creaScenarioProposta,
  pulisciTenantDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import { creaAddebito, creaContrattoConElenco } from '../../test-support/listino-di-test'
import { RegistraMovimentoCommand } from '../registro/commands/registra-movimento.command'
import {
  CorreggiMovimentoUseCase,
  type DatiRettifica,
} from '../registro/use-cases/correggi-movimento.use-case'
import { RegistraMovimentoUseCase } from '../registro/use-cases/registra-movimento.use-case'
import { RegistriService } from '../registro/registri.service'
import { AggiornaPrezziService } from '../legami-movimento/aggiorna-prezzi.service'
import { LegamiService } from '../legami-movimento/conferma-legame.service'
import { PropostaLegameService } from '../legami-movimento/proposta-legame.service'
import { RigheAddebitoService } from '../listino/righe-addebito.service'
import { eseguiAnteprima } from './anteprima'
import * as lockFatturazione from './lock-fatturazione'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }
const FILE_VOLUME = join(tmpdir(), 'wasteflow-fatt-t19-volume-tenants.json')

describe('Definitiva, concorrenza e volume — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT19
  let legami: LegamiService
  let righe: RigheAddebitoService
  let aggiorna: AggiornaPrezziService
  let registra: RegistraMovimentoUseCase
  let correggi: CorreggiMovimentoUseCase
  const tenantCreati: string[] = []
  const tempi: Record<string, number> = {}

  const idVolumeSuFile = (): string[] => {
    try {
      const v: unknown = JSON.parse(readFileSync(FILE_VOLUME, 'utf8'))
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    // Aziende di volume rimaste da un giro interrotto (id scritti su file).
    const rimasti = idVolumeSuFile()
    if (rimasti.length > 0) {
      await pulisciTenantDiTest(owner, rimasti)
      writeFileSync(FILE_VOLUME, '[]')
    }
    await owner.$executeRaw`ALTER ROLE wasteflow_app RESET plan_cache_mode`
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    b = creaBancoT19({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
    legami = new LegamiService(app, new PropostaLegameService(app))
    righe = new RigheAddebitoService(app)
    aggiorna = new AggiornaPrezziService(app)
    registra = new RegistraMovimentoUseCase(
      app,
      loggerStub as never,
      new RegistriService(app, loggerStub as never)
    )
    correggi = new CorreggiMovimentoUseCase(app, loggerStub as never)
    // CER dei registri veri (come le suite dei legami).
    await owner.cERCode.upsert({
      where: { code: '20 03 01' },
      create: { code: '20 03 01', description: 'CER di test', category: '20', subcategory: '' },
      update: {},
    })
  }, 120_000)
  beforeEach(() => b.reset())
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => {
    await owner.$executeRaw`ALTER ROLE wasteflow_app RESET plan_cache_mode`
    await pulisciTenantDiTest(owner, tenantCreati)
    writeFileSync(
      FILE_VOLUME,
      JSON.stringify(idVolumeSuFile().filter(id => !tenantCreati.includes(id)))
    )
    if (process.env.TEMPI_VOLUME === '1') {
      // eslint-disable-next-line no-console
      console.info(`TEMPI VOLUME T19 (ms): ${JSON.stringify(tempi)}`)
    }
    await owner.$disconnect()
    await app?.onModuleDestroy()
  }, 300_000)

  // -------------------------------------------------------------------------------------------
  // Aziende diverse
  // -------------------------------------------------------------------------------------------

  it('8 definitive in parallelo su 8 tenant: nessuna attesa reciproca (sessioni in Lock = 0 mentre tutte tengono i loro lock)', async () => {
    const aziende: AziendaT18[] = []
    const elaborazioni: ElaborazioneT19[] = []
    for (let i = 0; i < 8; i++) {
      const az = await b.azienda()
      await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      aziende.push(az)
      elaborazioni.push(e)
    }
    // Ogni job si ferma dopo i suoi lock e aspetta che arrivino tutti e 8: se due tenant si
    // bloccassero a vicenda non arriverebbero mai, e il test scadrebbe.
    let arrivati = 0
    let tuttiArrivati!: () => void
    const eTutti = new Promise<void>(r => (tuttiArrivati = r))
    let riparti!: () => void
    const cancello = new Promise<void>(r => (riparti = r))
    const originale = lockFatturazione.bloccaPerDefinitiva
    jest
      .spyOn(lockFatturazione, 'bloccaPerDefinitiva')
      .mockImplementation(async (...a: Parameters<typeof originale>) => {
        await originale(...a)
        if (++arrivati === 8) tuttiArrivati()
        await cancello
      })
    const jobs = aziende.map((az, i) => b.eseguiJob(az, elaborazioni[i].id))
    await Promise.race([
      eTutti,
      Promise.all(jobs).then(() => {
        throw new Error('un job e finito prima di fermarsi')
      }),
    ])
    expect(arrivati).toBe(8)
    expect(await b.sessioniInLock()).toBe(0)
    riparti()
    const esiti = await Promise.all(jobs)
    expect(esiti.map(x => x.esito)).toEqual(Array(8).fill('DEFINITIVA'))
    for (const az of aziende) await b.verificaSerie(az.tenantId)
  }, 120_000)

  // -------------------------------------------------------------------------------------------
  // Con la 4.3 (conferma, listino, aggiorna prezzi, registro)
  // -------------------------------------------------------------------------------------------

  describe('con la 4.3', () => {
    it('conferma concorrente di un legame della definitiva: aspetta il commit, poi 409 e il legame resta FATTURATO senza modifiche', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const { esito: esitoJob, risultato } = await b.conDefinitivaInPausa(
        az,
        e.id,
        async rilascia => {
          let finita = false
          const conferma = esito(
            legami.conferma(az.tenantId, az.utenteId, c.legameId!, 1, {
              righe: [{ rigaAddebitoId: c.rigaCerId, quantita: '90' }],
            })
          ).finally(() => (finita = true))
          await b.attendiLock(1, () => finita)
          expect(finita).toBe(false)
          rilascia()
          return conferma
        }
      )
      expect(esitoJob.esito).toBe('DEFINITIVA')
      expect(risultato).toMatchObject({ status: 409 })
      const [l] = await b.legamiDi([c.legameId!])
      expect(l).toMatchObject({ stato: 'FATTURATO', versione: 2 })
      const [riga] = await owner.$queryRawUnsafe<{ quantita: string }[]>(
        `SELECT quantita::text FROM righe_legame_movimento WHERE legame_id = $1::uuid`,
        c.legameId
      )
      expect(Number(riga.quantita)).toBe(100)
    }, 60_000)

    it('conferma concorrente con la definitiva che dura oltre il tetto: 409 OPERAZIONE_CONCORRENTE e nessun dato incoerente', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const { esito: esitoJob, risultato } = await b.conDefinitivaInPausa(az, e.id, () =>
        // La definitiva resta ferma finche' la conferma non rinuncia (lock_timeout delle scritture).
        esito(
          legami.conferma(az.tenantId, az.utenteId, c.legameId!, 1, {
            righe: [{ rigaAddebitoId: c.rigaCerId, quantita: '90' }],
          })
        )
      )
      expect(risultato).toEqual({ status: 409, codice: 'OPERAZIONE_CONCORRENTE' })
      expect(esitoJob.esito).toBe('DEFINITIVA')
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('FATTURATO')
    }, 90_000)

    it('modifica del listino durante la definitiva: aspetta il commit (barriera), poi l’anteprima aperta ha impronta superata', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e1 = await b.pronta(az)
      const e2 = await b.pronta(az)
      await b.chiedi(az, e1.id, { impronta: e1.impronta, versione: e1.versione })
      const { esito: esitoJob, risultato } = await b.conDefinitivaInPausa(
        az,
        e1.id,
        async rilascia => {
          let finita = false
          const modifica = esito(
            righe.modifica(az.tenantId, az.utenteId, c.rigaCerId, {
              versione: 1,
              prezzo: '2',
            } as never)
          ).finally(() => (finita = true))
          await b.attendiLock(1, () => finita)
          // Durante la definitiva il listino non e' cambiato.
          const [prima] = await owner.$queryRawUnsafe<{ prezzo: string; versione: number }[]>(
            `SELECT prezzo::text, versione FROM righe_addebito WHERE id = $1::uuid`,
            c.rigaCerId
          )
          expect(prima).toMatchObject({ versione: 1 })
          expect(finita).toBe(false)
          rilascia()
          return modifica
        }
      )
      expect(esitoJob.esito).toBe('DEFINITIVA')
      expect(risultato).toBe('ok')
      const [dopo] = await owner.$queryRawUnsafe<{ prezzo: string; versione: number }[]>(
        `SELECT prezzo::text, versione FROM righe_addebito WHERE id = $1::uuid`,
        c.rigaCerId
      )
      expect(dopo.versione).toBe(2)
      // L'anteprima rimasta aperta non si puo' piu' rendere definitiva.
      await b.chiedi(az, e2.id, { impronta: e2.impronta, versione: e2.versione })
      expect((await b.eseguiJob(az, e2.id)).esito).toBe('ANTEPRIMA_SUPERATA')
      expect((await b.leggi(e2.id)).stato).toBe('ANTEPRIMA_PRONTA')
    }, 60_000)

    it('riga di listino aggiunta a un elenco di un allegato durante la definitiva: aspetta il commit (lock dell’elenco intero, Q20)', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const allegato = await creaContrattoConElenco(owner, az.tenantId, {
        clienteId: c.clienteId,
        contrattoPrincipaleId: c.contrattoId,
        codiceElenco: '010',
      })
      const addebitoTT = await creaAddebito(owner, az.tenantId, { tipo: 'TT' })
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const { esito: esitoJob, risultato } = await b.conDefinitivaInPausa(
        az,
        e.id,
        async rilascia => {
          let finita = false
          const crea = esito(
            righe.crea(az.tenantId, az.utenteId, allegato.elencoId, {
              tipo: 'TT',
              addebitoId: addebitoTT.id,
              unitaMisura: 'KG',
              prezzo: '2',
              codiceIvaId: az.listino.iva22Id,
            } as never)
          ).finally(() => (finita = true))
          await b.attendiLock(1, () => finita)
          const [{ n }] = await owner.$queryRawUnsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM righe_addebito WHERE elenco_id = $1::uuid`,
            allegato.elencoId
          )
          expect(n).toBe(0)
          expect(finita).toBe(false)
          rilascia()
          return crea
        }
      )
      expect(esitoJob.esito).toBe('DEFINITIVA')
      expect(risultato).toBe('ok')
      const [{ n }] = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM righe_addebito WHERE elenco_id = $1::uuid`,
        allegato.elencoId
      )
      expect(n).toBe(1)
    }, 60_000)

    it('«Aggiorna prezzi» dopo il commit: salta i FATTURATO', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      expect((await b.definitiva(az, e)).esito).toBe('DEFINITIVA')
      await owner.$executeRawUnsafe(
        `UPDATE righe_addebito SET prezzo = 7, versione = versione + 1 WHERE id = $1::uuid`,
        c.rigaCerId
      )
      const a = await TenantContext.run({ tenantId: az.tenantId }, () =>
        aggiorna.anteprima(az.tenantId, { contrattoId: c.contrattoId })
      )
      expect(a.cambiano).toBe(0)
      expect(a.saltati).toEqual(expect.arrayContaining([{ motivo: 'FATTURATO', numero: 1 }]))
      const [riga] = await owner.$queryRawUnsafe<{ prezzo: string }[]>(
        `SELECT prezzo::text FROM righe_legame_movimento WHERE legame_id = $1::uuid`,
        c.legameId
      )
      expect(Number(riga.prezzo)).toBe(1)
    })
  })

  // -------------------------------------------------------------------------------------------
  // Con il registro (rettifica e registrazione)
  // -------------------------------------------------------------------------------------------

  describe('con il registro dei rifiuti', () => {
    async function scenarioRegistro() {
      const s: ScenarioProposta = await creaScenarioProposta(owner, {
        onTenantCreato: id => tenantCreati.push(id),
      })
      const tab = await creaTabelleFatturazione(owner, s.tenantId)
      await completaCedenteDiTest(owner, s.tenantId, { registroIvaPredefinitoId: tab.registroId })
      await impostaFatturazioneDaDiTest(owner, s.tenantId, '2026-01-01')
      await owner.$executeRawUnsafe(
        `UPDATE impostazioni_fatturazione SET definitive_attive = true WHERE tenant_id = $1::uuid`,
        s.tenantId
      )
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: {
          registroIvaId: tab.registroId,
          condizionePagamentoId: tab.condizioneId,
          contoCorrenteId: tab.contoId,
        },
      })
      const az = {
        tenantId: s.tenantId,
        utenteId: s.utenteId,
        tab,
        listino: { iva22Id: s.ivaId },
      } as unknown as AziendaT18
      return { s, az }
    }

    async function registraMovimento(s: ScenarioProposta, data: string) {
      const base = await owner.fIR.findUniqueOrThrow({ where: { id: s.firId } })
      const f = await creaFirDiTest(owner, s.tenantId, s.utenteId, {
        producerId: base.producerId,
        producerSedeId: base.producerSedeId,
      })
      await owner.fIR.update({ where: { id: f.id }, data: { status: 'AWAITING_CARRIER' } })
      const r = await TenantContext.run({ tenantId: s.tenantId }, () =>
        registra.execute(
          new RegistraMovimentoCommand(
            s.tenantId,
            s.utenteId,
            'CARICO',
            new Date(`${data}T10:00:00Z`),
            new Date(),
            'INGRESSO_ESTERNO',
            '20 03 01',
            undefined,
            100,
            'KG',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            f.id,
            undefined,
            s.registroId,
            { azione: 'CONFERMA' }
          )
        )
      )
      expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
      return r.value
    }

    const legameDi = (radiceId: string) =>
      owner.legameMovimento.findFirstOrThrow({ where: { movimentoOriginaleId: radiceId } })

    const datiRettifica = (quantity: number): DatiRettifica => ({
      movementDate: new Date('2026-03-10T10:00:00Z'),
      causale: 'INGRESSO_ESTERNO',
      cerCode: '20 03 01',
      quantity,
      unit: 'KG',
    })
    const rettifica = (s: ScenarioProposta, movimentoId: string, quantity: number) =>
      TenantContext.run({ tenantId: s.tenantId }, () =>
        correggi.rettifica({
          tenantId: s.tenantId,
          userId: s.utenteId,
          movimentoId,
          motivo: 'errore di battitura',
          dati: datiRettifica(quantity),
        })
      )

    it('rettifica di un movimento nella definitiva (a fine scritture, lock ancora presi): la rettifica riesce sempre; il legame finisce FATTURATO con scostamento oppure DA_RIALLINEARE', async () => {
      const { s, az } = await scenarioRegistro()
      const m = await registraMovimento(s, '2026-03-10')
      expect((await legameDi(m.id)).stato).toBe('CONFERMATO')
      const e = await b.pronta(az)
      expect((await b.documenti(e.id))[0].errori).toEqual([])
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const { esito: esitoJob, risultato } = await b.conDefinitivaInChiusura(az, e.id, () =>
        rettifica(s, m.id, 70)
      )
      // La correzione del registro riesce comunque, anche con la definitiva sui lock dei legami.
      expect(risultato.movimento.tipoAnnotazione).toBe('RETTIFICA')
      expect(esitoJob.esito).toBe('DEFINITIVA')
      const l = await legameDi(m.id)
      expect(l.stato).toBe('FATTURATO')
      expect(l.documentoId).not.toBeNull()
      // Riallineato con lo scostamento, oppure rimasto indietro (DA_RIALLINEARE in lista).
      const indietro = l.movimentoVigenteId !== risultato.movimento.id
      expect(l.scostamentoDopoFattura || indietro).toBe(true)
    }, 90_000)

    it('rettifica prima che la definitiva rilegga i dati: la rettifica riesce, il legame resta DA_RIALLINEARE e la definitiva risponde ANTEPRIMA_SUPERATA senza scrivere nulla', async () => {
      const { s, az } = await scenarioRegistro()
      const m = await registraMovimento(s, '2026-03-10')
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const { esito: esitoJob, risultato } = await b.conDefinitivaInPausa(az, e.id, () =>
        rettifica(s, m.id, 70)
      )
      expect(risultato.movimento.tipoAnnotazione).toBe('RETTIFICA')
      expect(esitoJob.esito).toBe('ANTEPRIMA_SUPERATA')
      const l = await legameDi(m.id)
      expect(l.stato).toBe('CONFERMATO')
      expect(l.movimentoVigenteId).not.toBe(risultato.movimento.id)
      expect((await b.leggi(e.id)).stato).toBe('ANTEPRIMA_PRONTA')
      expect((await b.numerazioni(az.tenantId)).every(n => n.ultimo_numero === 0)).toBe(true)
    }, 90_000)

    it('registrazione di un movimento nuovo durante la definitiva: riesce senza aspettare oltre 2 s, il suo legame resta fuori dai documenti', async () => {
      const { s, az } = await scenarioRegistro()
      const m = await registraMovimento(s, '2026-03-10')
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const { esito: esitoJob, risultato } = await b.conDefinitivaInChiusura(az, e.id, async () => {
        const t0 = Date.now()
        const nuovo = await registraMovimento(s, '2026-03-20')
        return { nuovo, ms: Date.now() - t0 }
      })
      expect(esitoJob).toMatchObject({ esito: 'DEFINITIVA', documenti: 1 })
      // Con la definitiva ferma sui lock la registrazione e' passata (tetto dell'aggancio: 2 s).
      expect(risultato.ms).toBeLessThan(8_000)
      expect((await legameDi(m.id)).stato).toBe('FATTURATO')
      const nuovoLegame = await owner.legameMovimento.findFirst({
        where: { movimentoOriginaleId: risultato.nuovo.id },
      })
      // Il legame nuovo, se e' nato, non e' in nessun documento.
      expect(nuovoLegame?.documentoId ?? null).toBeNull()
      expect(nuovoLegame?.stato === 'FATTURATO').toBe(false)
    }, 90_000)
  })

  // -------------------------------------------------------------------------------------------
  // Volume
  // -------------------------------------------------------------------------------------------

  describe('volume: 10.000 legami e 500 documenti, piano generico', () => {
    it('anteprima e definitiva entro i tetti; numeri 1..500, 10.000 legami FATTURATO, serie senza buchi', async () => {
      const t = await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Volume SRL', country: 'IT' },
      })
      tenantCreati.push(t.id)
      writeFileSync(FILE_VOLUME, JSON.stringify([...idVolumeSuFile(), t.id]))
      const utente = await owner.user.create({
        data: {
          tenantId: t.id,
          keycloakId: `kc-t19-${randomUUID()}`,
          fiscalCode: `T19${partitaIvaUnica()}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Volume',
          email: `t19-${randomUUID()}@example.test`,
          role: 'ADMIN',
        },
      })
      let t0 = Date.now()
      const volume = await creaScenarioVolume(owner, t.id)
      tempi.caricamento = Date.now() - t0
      await owner.$executeRawUnsafe(
        `UPDATE impostazioni_fatturazione SET definitive_attive = true WHERE tenant_id = $1::uuid`,
        t.id
      )
      // Il piano peggiore: generico per il ruolo applicativo (connessioni nuove), statistiche vuote
      // come dopo una copia in massa. Si ripristina sempre (`afterAll` e `finally`).
      await owner.$executeRaw`ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`
      try {
        await app.$disconnect()
        await app.$connect()
        const az = { tenantId: t.id, utenteId: utente.id } as unknown as AziendaT18

        t0 = Date.now()
        const { id } = await b.nel(t.id, () =>
          b.servizio.avvia(t.id, utente.id, { ...PARAMETRI_T19 })
        )
        await b.nel(t.id, () => eseguiAnteprima(app, t.id, id, 1))
        tempi.anteprima = Date.now() - t0
        const e = await b.leggi(id)
        expect(e.stato).toBe('ANTEPRIMA_PRONTA')
        expect((await b.documenti(id)).filter(d => d.errori.length === 0)).toHaveLength(500)

        t0 = Date.now()
        await b.chiedi(az, id, { impronta: e.impronta as string, versione: e.versione })
        tempi.richiesta = Date.now() - t0

        t0 = Date.now()
        const esitoJob = await b.eseguiJob(az, id)
        tempi.definitiva = Date.now() - t0
        expect(esitoJob).toMatchObject({ esito: 'DEFINITIVA', documenti: 500 })
        expect(tempi.definitiva).toBeLessThan(120_000)
        // Il tetto della richiesta sincrona e' breve.
        expect(tempi.richiesta).toBeLessThan(10_000)

        const docs = await b.documenti(id)
        expect(docs).toHaveLength(500)
        expect(docs.every(d => d.stato === 'DEFINITIVO')).toBe(true)
        expect(docs.map(d => d.numero)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1))
        const [{ n }] = await owner.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM legami_movimento
           WHERE id = ANY($1::uuid[]) AND stato = 'FATTURATO' AND documento_id IS NOT NULL`,
          volume.legamiIds
        )
        expect(n).toBe(10_000)
        const [{ senza }] = await owner.$queryRawUnsafe<{ senza: number }[]>(
          `SELECT count(*)::int AS senza FROM righe_documento_fattura r
           JOIN documenti_fattura d ON d.id = r.documento_id
           WHERE d.elaborazione_id = $1::uuid AND r.tipo_riga = 'MOVIMENTO'
             AND (r.movimento_fatturato_id IS NULL OR r.riga_legame_id IS NOT NULL)`,
          id
        )
        expect(senza).toBe(0)
        await b.verificaSerie(t.id)
        expect(await b.conteggioAudit(t.id, 'DOCUMENTO_FATTURA_DEFINITIVO')).toBe(500)
      } finally {
        await owner.$executeRaw`ALTER ROLE wasteflow_app RESET plan_cache_mode`
        for (const tabella of [
          'documenti_fattura',
          'righe_documento_fattura',
          'legami_movimento',
          'numerazioni_fattura',
        ]) {
          await owner.$executeRawUnsafe(`ANALYZE ${tabella}`)
        }
      }
    }, 600_000)
  })
})

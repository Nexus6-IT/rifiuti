/**
 * Lista «da collegare» (fase 4.3, Task 18, spec §7.3, decisioni 5, 11 e 13) contro un Postgres
 * reale, collegato COME `wasteflow_app`. Il proprietario prepara gli scenari; la pulizia e' solo
 * per id esatti (`onTenantCreato` registra l'azienda appena esiste). Le prove di volume
 * (10.000 movimenti sempre; 200.000 con `LISTA_VOLUME=200000`) usano statistiche vere (ANALYZE) e
 * poi il piano generico forzato con `SET LOCAL` (plan_cache_mode e statement_timeout esplicito nella
 * transazione: nessuna modifica al ruolo condiviso). L'id dell'azienda di volume e' scritto su file
 * PRIMA del caricamento e ripulito (per id esatto, a blocchi) anche se un giro precedente e' stato
 * interrotto.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { clientComeRuolo, urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaDocumentoMinimoPerLegame,
  creaLegameDiTest,
  creaMovimentoDiTest,
  creaScenarioProposta,
  pulisciTenantDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import {
  ListaLegamiService,
  normalizzaFiltri,
  sqlCandidati,
  sqlConteggio,
  sqlPagina,
  type FiltriLista,
  type RigaLista,
  type StatoListaLegame,
} from './lista-legami.service'

interface Eccezione {
  status: number
  body: Record<string, unknown>
}

describe('ListaLegamiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: ListaLegamiService
  const tenantCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  // Aziende di volume: l'id va su file PRIMA del caricamento, cosi' un giro interrotto si ripulisce.
  const FILE_VOLUME =
    process.env.LISTA_VOLUME_FILE ?? join(tmpdir(), 'wasteflow-lista-volume-tenants.json')
  const idVolumeSuFile = (): string[] => {
    try {
      const v: unknown = JSON.parse(readFileSync(FILE_VOLUME, 'utf8'))
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  const scriviIdVolume = (ids: string[]) => writeFileSync(FILE_VOLUME, JSON.stringify(ids))

  /** Solo il database di test locale: host locale e nome `wasteflow_ci`, controllo esplicito. */
  function eDatabaseDiTestRigido(): boolean {
    if (!eDatabaseDiTestLocale(urlProprietario)) return false
    const u = new URL(urlProprietario)
    // Solo il database di test: host locale e nome wasteflow_ci (porta qualunque: la CI la assegna a runtime).
    return u.pathname === '/wasteflow_ci'
  }

  /**
   * Cancella (per id esatto) i movimenti di un'azienda di volume a BLOCCHI, ognuno nella sua
   * transazione breve (le correzioni prima, le ordinarie dopo), dopo righe e legami. Con
   * `session_replication_role = replica` (solo nel database di test, se il ruolo lo permette) i
   * trigger RI per riga non girano e la cancellazione e' lineare; altrimenti i blocchi restano
   * piccoli. Si puo' interrompere e riprendere.
   */
  async function pulisciVolume(tenantId: string): Promise<void> {
    if (!eDatabaseDiTestRigido()) throw new Error('pulisciVolume: solo sul database di test locale')
    let replica = true
    const blocco = async (sql: string): Promise<number> => {
      for (;;) {
        try {
          const r = await owner.$transaction([
            owner.$executeRawUnsafe(`SET LOCAL statement_timeout = '60s'`),
            ...(replica
              ? [owner.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`)]
              : []),
            owner.$executeRawUnsafe(sql, tenantId),
          ])
          return r[r.length - 1] as number
        } catch (e) {
          if (replica && /permission denied/i.test(String(e))) {
            replica = false
            continue
          }
          throw e
        }
      }
    }
    const tutto = async (sql: string) => {
      while ((await blocco(sql)) > 0) {
        /* ripete finche' restano righe */
      }
    }
    await tutto(`DELETE FROM righe_legame_movimento WHERE id IN (
      SELECT id FROM righe_legame_movimento WHERE tenant_id = $1::uuid LIMIT 20000)`)
    await tutto(`DELETE FROM legami_movimento WHERE id IN (
      SELECT id FROM legami_movimento WHERE tenant_id = $1::uuid LIMIT 20000)`)
    for (const filtro of [`tipo_annotazione <> 'ORDINARIA'`, `tipo_annotazione = 'ORDINARIA'`]) {
      await tutto(`DELETE FROM waste_movements WHERE id IN (
        SELECT id FROM waste_movements WHERE tenant_id = $1::uuid AND ${filtro} LIMIT 20000)`)
    }
  }

  const volumeCreati: string[] = []

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new ListaLegamiService(app)
    // Aziende di volume rimaste da un giro interrotto: per id esatto, una alla volta.
    for (const id of idVolumeSuFile()) {
      await pulisciVolume(id)
      await pulisciTenantDiTest(owner, [id])
    }
    scriviIdVolume([])
  }, 600_000)

  afterAll(async () => {
    for (const id of volumeCreati) await pulisciVolume(id)
    // Una alla volta: un timeout su un'azienda non blocca le altre.
    for (const id of tenantCreati) await pulisciTenantDiTest(owner, [id])
    scriviIdVolume(idVolumeSuFile().filter(id => !volumeCreati.includes(id)))
    for (const t of ['legami_movimento', 'righe_legame_movimento', 'waste_movements']) {
      await owner.$executeRawUnsafe(`ANALYZE ${t}`)
    }
    await owner.$disconnect()
    await app?.$disconnect()
  }, 900_000)

  /**
   * Azienda con il suo scenario ma SENZA il movimento di partenza (si cancella per id esatto):
   * ogni test parte da una lista vuota. «Fatturazione da» = `da` (null = spenta; `undefined` =
   * 2026-01-01).
   */
  async function scenario(
    da: string | null = '2026-01-01',
    volume = false
  ): Promise<ScenarioProposta> {
    const s = await creaScenarioProposta(owner, {
      onTenantCreato: id => {
        tenantCreati.push(id)
        if (volume) {
          // Su file PRIMA di qualunque caricamento.
          volumeCreati.push(id)
          scriviIdVolume([...idVolumeSuFile(), id])
        }
      },
    })
    await owner.wasteMovement.delete({ where: { id: s.movimentoId } })
    if (da !== null) {
      await owner.impostazioneFatturazione.create({
        data: { tenantId: s.tenantId, fatturazioneDa: new Date(`${da}T00:00:00Z`) },
      })
    }
    return s
  }

  const lista = (s: ScenarioProposta, f: FiltriLista = {}) =>
    nel(s.tenantId, () => service.lista(s.tenantId, f))
  const contatori = (s: ScenarioProposta) => nel(s.tenantId, () => service.contatori(s.tenantId))
  const ids = (righe: RigaLista[]) => righe.map(r => r.movimentoId)

  interface OpzioniNuovo {
    data?: string
    causale?: string
    type?: 'CARICO' | 'SCARICO'
    cer?: string
    stato?: Exclude<StatoListaLegame, 'MANCANTE' | 'DA_RIALLINEARE'>
    motivi?: string[]
    avvisi?: string[]
    conCliente?: boolean
    /** Solo il cliente: il legame resta senza contratto ne' elenco. */
    soloCliente?: boolean
    causaleAziendaId?: string
  }

  /** Un movimento ordinario (fatturabile di default) e, con `stato`, il suo legame. */
  async function nuovo(s: ScenarioProposta, o: OpzioniNuovo = {}) {
    const type = o.type ?? 'CARICO'
    const m = await creaMovimentoDiTest(owner, s.tenantId, {
      movementDate: o.data ?? '2026-03-01',
      causale: o.causale,
      type,
      cerCode: o.cer,
      causaleAziendaId: o.causaleAziendaId,
    })
    let legameId: string | null = null
    if (o.stato) {
      const completo = o.stato !== 'DA_COLLEGARE' && o.stato !== 'ESCLUSO'
      const l = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: m.movimentoId,
        registroId: m.registroId,
        verso: type,
        stato: o.stato,
        dataMovimento: o.data ?? '2026-03-01',
        ...(o.soloCliente
          ? { clienteId: s.clienteId }
          : completo || o.conCliente
            ? { clienteId: s.clienteId, contrattoId: s.contrattoId, elencoId: s.elencoId }
            : {}),
      })
      legameId = l.legameId
      if (o.motivi || o.avvisi) {
        await owner.$executeRaw`
          UPDATE legami_movimento SET motivi = ${o.motivi ?? []}::text[],
            avvisi = ${o.avvisi ?? []}::text[] WHERE id = ${legameId}::uuid`
      }
    }
    return { ...m, legameId }
  }

  /** Aggiunge una correzione alla testa della catena (`radiceId`, `testaId`). */
  async function correggi(
    s: ScenarioProposta,
    tipo: 'RETTIFICA' | 'ANNULLAMENTO',
    radiceId: string,
    testaId: string,
    sovrascrive: { causale?: string; movementDate?: Date } = {}
  ): Promise<string> {
    const origine = await owner.wasteMovement.findUniqueOrThrow({ where: { id: radiceId } })
    const ultimo = await owner.wasteMovement.aggregate({
      where: { registroId: origine.registroId, progressiveYear: 2026 },
      _max: { progressiveNumber: true },
    })
    const c = await owner.wasteMovement.create({
      data: {
        tenantId: s.tenantId,
        registroId: origine.registroId,
        progressiveYear: 2026,
        progressiveNumber: (ultimo._max.progressiveNumber ?? 0) + 1,
        type: origine.type,
        movementDate: sovrascrive.movementDate ?? origine.movementDate,
        causale: sovrascrive.causale ?? origine.causale,
        cerCode: origine.cerCode,
        quantity: '90',
        unit: 'KG',
        tipoAnnotazione: tipo,
        movimentoRettificatoId: testaId,
        movimentoOriginaleId: radiceId,
        motivoAnnotazione: 'prova',
      },
    })
    return c.id
  }

  async function errore(p: Promise<unknown>): Promise<Eccezione> {
    try {
      await p
    } catch (e) {
      if (e instanceof HttpException) {
        return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> }
      }
      throw e
    }
    throw new Error('attesa un’eccezione, la chiamata e’ riuscita')
  }

  describe('contatori per contratto', () => {
    const perContratto = (s: ScenarioProposta, ids?: string[]) =>
      nel(s.tenantId, () => service.contatoriPerContratto(s.tenantId, ids))

    it('stessi stati del contatore totale, raggruppati per contratto; filtro per id; isolamento', async () => {
      const s = await scenario()
      await nuovo(s, { stato: 'PROPOSTO' })
      await nuovo(s, { stato: 'DA_COLLEGARE', conCliente: true })
      await nuovo(s, { stato: 'CONFERMATO' }) // allineato: non compare
      await nuovo(s) // MANCANTE: senza cliente ne' contratto
      const altro = await scenario()
      await nuovo(altro, { stato: 'PROPOSTO' })

      const tutti = await perContratto(s)
      const totale = (await contatori(s)).daCollegare
      expect(tutti.perContratto).toEqual([{ contrattoId: s.contrattoId, daCollegare: 2 }])
      expect(totale).toBe(3) // i 2 con contratto + il MANCANTE
      expect(tutti.senzaContratto).toEqual([])

      const filtrato = await perContratto(s, [s.contrattoId])
      expect(filtrato.perContratto).toEqual(tutti.perContratto)
      expect(
        (await perContratto(s, ['22222222-2222-4222-8222-222222222222'])).perContratto
      ).toEqual([])
      expect(await perContratto(s, [])).toEqual({ perContratto: [], senzaContratto: [] })
      // Un contratto di un'altra azienda non si vede (RLS + filtro per azienda).
      expect((await perContratto(s, [altro.contrattoId])).perContratto).toEqual([])
    })

    it('legami con cliente e senza contratto: compaiono in senzaContratto, per cliente; con gli id no', async () => {
      const s = await scenario()
      await nuovo(s, { stato: 'DA_COLLEGARE', soloCliente: true })
      await nuovo(s, { stato: 'DA_COLLEGARE', soloCliente: true })
      await nuovo(s, { stato: 'PROPOSTO' })
      await nuovo(s, { stato: 'DA_COLLEGARE' }) // senza cliente ne' contratto: non compare
      await nuovo(s) // MANCANTE
      const tutti = await perContratto(s)
      expect(tutti.senzaContratto).toEqual([{ clienteId: s.clienteId, daCollegare: 2 }])
      expect(tutti.perContratto).toEqual([{ contrattoId: s.contrattoId, daCollegare: 1 }])
      expect((await perContratto(s, [s.contrattoId])).senzaContratto).toEqual([])
    })

    it('fatturazione spenta: tutto vuoto', async () => {
      const s = await scenario(null)
      await nuovo(s, { stato: 'PROPOSTO' })
      expect(await perContratto(s)).toEqual({ perContratto: [], senzaContratto: [] })
    })
  })

  describe('chi entra', () => {
    it('fatturazione spenta (nessuna riga o data vuota): lista vuota e contatori a zero', async () => {
      const senzaRiga = await scenario(null)
      await nuovo(senzaRiga)
      expect(await lista(senzaRiga)).toEqual({ elementi: [], totale: 0 })
      expect(await contatori(senzaRiga)).toEqual({
        daCollegare: 0,
        proposti: 0,
        mancanti: 0,
        daRiallineare: 0,
      })
      const vuota = await scenario(null)
      await owner.impostazioneFatturazione.create({
        data: { tenantId: vuota.tenantId, fatturazioneDa: null },
      })
      await nuovo(vuota)
      expect((await lista(vuota)).totale).toBe(0)
      expect((await contatori(vuota)).daCollegare).toBe(0)
    })

    it('movimento storico dopo «fatturazione da» senza legame: MANCANTE, con i dati del movimento', async () => {
      const s = await scenario()
      const m = await nuovo(s, { data: '2026-03-05', cer: '20 03 01' })
      await owner.wasteMovement.update({
        where: { id: m.movimentoId },
        data: { wasteDescription: 'Rifiuti urbani', quantity: '12.5', unit: 'KG' },
      })
      const r = await lista(s)
      expect(r.totale).toBe(1)
      expect(r.elementi[0]).toEqual({
        movimentoId: m.movimentoId,
        legameId: null,
        stato: 'MANCANTE',
        dataMovimento: '2026-03-05',
        cerCode: '20 03 01',
        descrizioneMovimento: 'Rifiuti urbani',
        quantita: '12.5',
        unita: 'KG',
        cliente: null,
        motivi: [],
        avvisi: [],
        versione: null,
        confermabile: false,
        fatturato: false,
      })
    })

    it('prima della data: assente; il bordo e’ il giorno ITALIANO (stesso frammento SQL del conteggio)', async () => {
      const s = await scenario('2026-01-01')
      const prima = await nuovo(s, { data: '2025-12-15' })
      const uguale = await nuovo(s, { data: '2026-01-01' })
      // 22:30 UTC del 31/12 = 23:30 a Roma del 31/12 (fuori); 23:30 UTC = 00:30 del 1/1 (dentro).
      const fuori = await nuovo(s, { data: '2025-12-31' })
      await owner.wasteMovement.update({
        where: { id: fuori.movimentoId },
        data: { movementDate: new Date('2025-12-31T22:30:00Z') },
      })
      const dentro = await nuovo(s, { data: '2025-12-31' })
      await owner.wasteMovement.update({
        where: { id: dentro.movimentoId },
        data: { movementDate: new Date('2025-12-31T23:30:00Z') },
      })
      const r = await lista(s)
      expect(new Set(ids(r.elementi))).toEqual(new Set([uguale.movimentoId, dentro.movimentoId]))
      expect(ids(r.elementi)).not.toContain(prima.movimentoId)
      expect(ids(r.elementi)).not.toContain(fuori.movimentoId)
      expect(r.totale).toBe(2)
    })

    it('un movimento “storico” che la data esclude non compare nemmeno con un legame', async () => {
      const s = await scenario('2026-06-01')
      await nuovo(s, { data: '2026-03-01', stato: 'DA_COLLEGARE' })
      expect((await lista(s)).totale).toBe(0)
    })

    it('causale non fatturabile: assente; causale aziendale fatturabile: presente, non fatturabile: assente', async () => {
      const s = await scenario()
      const scarico = await nuovo(s, { type: 'SCARICO', causale: 'AVVIO_RECUPERO' })
      const propria = async (codice: string, fatturabile: boolean) => {
        const v = await owner.causaleRegistroAzienda.create({
          data: {
            tenantId: s.tenantId,
            natura: 'PROPRIA',
            codice,
            verso: 'CARICO',
            descrizione: `Causale ${codice}`,
            ruoloMud: 'RICEVUTO_DA_TERZI',
            codiceRentri: null,
            operazione: null,
            ordine: 100,
            fatturabile,
            validaDal: new Date('2026-01-01T00:00:00Z'),
            creatoDa: s.utenteId,
          },
        })
        const m = await nuovo(s, { causale: codice, causaleAziendaId: v.id })
        return m.movimentoId
      }
      const si = await propria('AZ_SI', true)
      const no = await propria('AZ_NO', false)
      const ids_ = ids((await lista(s)).elementi)
      expect(ids_).toEqual([si])
      expect(ids_).not.toContain(scarico.movimentoId)
      expect(ids_).not.toContain(no)
    })

    it('legame CONFERMATO, FATTURATO, IMPORTATO_FATTURATO e ANNULLATO: assenti', async () => {
      const s = await scenario()
      for (const stato of [
        'CONFERMATO',
        'FATTURATO',
        'IMPORTATO_FATTURATO',
        'ANNULLATO',
      ] as const) {
        await nuovo(s, { stato })
      }
      expect(await lista(s)).toEqual({ elementi: [], totale: 0 })
    })

    it('DA_COLLEGARE con motivi e avvisi: presente; PROPOSTO senza motivi: confermabile', async () => {
      const s = await scenario()
      const a = await nuovo(s, {
        stato: 'DA_COLLEGARE',
        motivi: ['SENZA_CONTRATTO', 'SENZA_QUANTITA'],
        avvisi: ['CLIENTE_NON_DA_FIR'],
        conCliente: true,
        data: '2026-03-02',
      })
      const b = await nuovo(s, { stato: 'PROPOSTO', data: '2026-03-03' })
      const r = (await lista(s)).elementi
      const ra = r.find(x => x.movimentoId === a.movimentoId)!
      const rb = r.find(x => x.movimentoId === b.movimentoId)!
      expect(ra).toMatchObject({
        legameId: a.legameId,
        stato: 'DA_COLLEGARE',
        motivi: ['SENZA_CONTRATTO', 'SENZA_QUANTITA'],
        avvisi: ['CLIENTE_NON_DA_FIR'],
        versione: 1,
        confermabile: false,
      })
      expect(rb).toMatchObject({
        legameId: b.legameId,
        stato: 'PROPOSTO',
        motivi: [],
        confermabile: true,
      })
      const ditta = await owner.$queryRaw<{ r: string }[]>`
        SELECT dt.ragione_sociale AS r FROM clienti c JOIN ditte dt ON dt.id = c.ditta_id
        WHERE c.id = ${s.clienteId}::uuid`
      expect(rb.cliente).toEqual({ id: s.clienteId, etichetta: ditta[0].r })
    })

    it('catena rettificata con il legame indietro: una sola riga DA_RIALLINEARE sulla testa', async () => {
      const s = await scenario()
      const m = await nuovo(s, { stato: 'CONFERMATO', data: '2026-04-01' })
      const testa = await correggi(s, 'RETTIFICA', m.movimentoId, m.movimentoId)
      const r = await lista(s)
      expect(r.totale).toBe(1)
      expect(r.elementi[0]).toMatchObject({
        movimentoId: testa,
        legameId: m.legameId,
        stato: 'DA_RIALLINEARE',
      })
      // Anche un PROPOSTO o un DA_COLLEGARE rimasti indietro sono da riallineare.
      const p = await nuovo(s, { stato: 'PROPOSTO', data: '2026-04-02' })
      const testaP = await correggi(s, 'RETTIFICA', p.movimentoId, p.movimentoId)
      const r2 = await lista(s)
      expect(r2.elementi.find(x => x.movimentoId === testaP)?.stato).toBe('DA_RIALLINEARE')
      // Allineato (vigente = testa): torna lo stato vero.
      await owner.$executeRaw`
        UPDATE legami_movimento SET movimento_vigente_id = ${testaP}::uuid WHERE id = ${p.legameId}::uuid`
      const r3 = await lista(s)
      expect(r3.elementi.find(x => x.movimentoId === testaP)?.stato).toBe('PROPOSTO')
    })

    it('catena senza legame con due rettifiche: un solo MANCANTE, sulla testa vigente', async () => {
      const s = await scenario()
      const m = await nuovo(s)
      const r1 = await correggi(s, 'RETTIFICA', m.movimentoId, m.movimentoId)
      const r2 = await correggi(s, 'RETTIFICA', m.movimentoId, r1)
      const r = await lista(s)
      expect(r.totale).toBe(1)
      expect(r.elementi[0]).toMatchObject({ movimentoId: r2, stato: 'MANCANTE', legameId: null })
    })

    it('catena annullata: allineata all’annullo = assente; con il legame indietro = DA_RIALLINEARE sulla testa ANNULLAMENTO', async () => {
      const s = await scenario()
      const allineata = await nuovo(s, { stato: 'DA_COLLEGARE', data: '2026-03-02' })
      const annulloA = await correggi(
        s,
        'ANNULLAMENTO',
        allineata.movimentoId,
        allineata.movimentoId
      )
      await owner.$executeRaw`
        UPDATE legami_movimento SET movimento_vigente_id = ${annulloA}::uuid WHERE id = ${allineata.legameId}::uuid`
      expect((await lista(s)).totale).toBe(0)
      const indietro = await nuovo(s, { stato: 'CONFERMATO', data: '2026-03-03' })
      const annulloB = await correggi(s, 'ANNULLAMENTO', indietro.movimentoId, indietro.movimentoId)
      const r = await lista(s)
      expect(r.totale).toBe(1)
      expect(r.elementi[0]).toMatchObject({
        movimentoId: annulloB,
        legameId: indietro.legameId,
        stato: 'DA_RIALLINEARE',
        fatturato: false,
        confermabile: false,
      })
      expect((await contatori(s)).daRiallineare).toBe(1)
    })

    it('rettifica che rende la causale non fatturabile: con il legame indietro DA_RIALLINEARE; allineata = assente', async () => {
      const s = await scenario()
      const m = await nuovo(s, { stato: 'PROPOSTO', data: '2026-03-02' })
      const testa = await correggi(s, 'RETTIFICA', m.movimentoId, m.movimentoId, {
        causale: 'CAUSALE_NON_FATTURABILE_DI_PROVA',
      })
      const r = await lista(s)
      expect(r.elementi.map(x => [x.movimentoId, x.stato])).toEqual([[testa, 'DA_RIALLINEARE']])
      await owner.$executeRaw`
        UPDATE legami_movimento SET movimento_vigente_id = ${testa}::uuid WHERE id = ${m.legameId}::uuid`
      expect((await lista(s)).totale).toBe(0)
    })

    it('rettifica che sposta la data prima di «fatturazione da»: con il legame indietro DA_RIALLINEARE; allineata = assente', async () => {
      const s = await scenario('2026-01-01')
      const m = await nuovo(s, { stato: 'CONFERMATO', data: '2026-03-02' })
      const testa = await correggi(s, 'RETTIFICA', m.movimentoId, m.movimentoId, {
        movementDate: new Date('2025-06-01T10:00:00Z'),
      })
      expect((await lista(s)).elementi.map(x => [x.movimentoId, x.stato])).toEqual([
        [testa, 'DA_RIALLINEARE'],
      ])
      await owner.$executeRaw`
        UPDATE legami_movimento SET movimento_vigente_id = ${testa}::uuid WHERE id = ${m.legameId}::uuid`
      expect((await lista(s)).totale).toBe(0)
    })

    it('FATTURATO / IMPORTATO_FATTURATO rimasti indietro: DA_RIALLINEARE con fatturato true, non confermabili; allineati = assenti', async () => {
      const s = await scenario()
      const a = await nuovo(s, { stato: 'FATTURATO', data: '2026-03-02' })
      const b = await nuovo(s, { stato: 'IMPORTATO_FATTURATO', data: '2026-03-03' })
      const c = await nuovo(s, { stato: 'FATTURATO', data: '2026-03-04' })
      const ta = await correggi(s, 'RETTIFICA', a.movimentoId, a.movimentoId)
      const tb = await correggi(s, 'RETTIFICA', b.movimentoId, b.movimentoId)
      const tc = await correggi(s, 'RETTIFICA', c.movimentoId, c.movimentoId)
      await owner.$executeRaw`
        UPDATE legami_movimento SET movimento_vigente_id = ${tc}::uuid WHERE id = ${c.legameId}::uuid`
      const r = await lista(s)
      expect(r.elementi.map(x => [x.movimentoId, x.stato, x.fatturato, x.confermabile])).toEqual([
        [ta, 'DA_RIALLINEARE', true, false],
        [tb, 'DA_RIALLINEARE', true, false],
      ])
      expect((await contatori(s)).daRiallineare).toBe(2)
    })

    it('ESCLUSO rimasto indietro: DA_RIALLINEARE anche senza esclusi (precedenza coerente con «indietro = allineamento fallito»)', async () => {
      const s = await scenario()
      const e = await nuovo(s, { stato: 'ESCLUSO', data: '2026-03-02' })
      const t = await correggi(s, 'RETTIFICA', e.movimentoId, e.movimentoId)
      expect((await lista(s)).elementi.map(x => [x.movimentoId, x.stato])).toEqual([
        [t, 'DA_RIALLINEARE'],
      ])
    })

    it('ESCLUSO: assente; con esclusi true presente, e “stati” puo’ ridurre ai soli esclusi', async () => {
      const s = await scenario()
      const e = await nuovo(s, { stato: 'ESCLUSO', data: '2026-03-02' })
      const d = await nuovo(s, { stato: 'DA_COLLEGARE', data: '2026-03-03' })
      expect(ids((await lista(s)).elementi)).toEqual([d.movimentoId])
      const con = await lista(s, { esclusi: true })
      expect(ids(con.elementi)).toEqual([e.movimentoId, d.movimentoId])
      expect(con.elementi[0]).toMatchObject({ stato: 'ESCLUSO', legameId: e.legameId })
      const soli = await lista(s, { esclusi: true, stati: ['ESCLUSO'] })
      expect(ids(soli.elementi)).toEqual([e.movimentoId])
      // Chiedere lo stato ESCLUSO nei filtri equivale a chiedere gli esclusi.
      expect(ids((await lista(s, { stati: ['ESCLUSO'] })).elementi)).toEqual([e.movimentoId])
      // I contatori non contano gli esclusi.
      expect((await contatori(s)).daCollegare).toBe(1)
    })

    it('un altro tenant non compare (RLS), nemmeno chiedendo il suo registro o cliente', async () => {
      const a = await scenario()
      const b = await scenario()
      const mb = await nuovo(b, { stato: 'DA_COLLEGARE' })
      await nuovo(a)
      expect(ids((await lista(a)).elementi)).not.toContain(mb.movimentoId)
      expect((await lista(a, { registroId: mb.registroId })).totale).toBe(0)
      expect((await lista(a, { clienteId: b.clienteId })).totale).toBe(0)
      // Il contesto di A con il tenant di B nella chiamata e’ rifiutato (come gli altri servizi).
      await expect(nel(a.tenantId, () => service.lista(b.tenantId))).rejects.toThrow()
    })
  })

  describe('filtri, paginazione, contatori', () => {
    it('filtri cliente, periodo (estremi inclusi), registro e motivo', async () => {
      const s = await scenario()
      const x = await nuovo(s, {
        stato: 'PROPOSTO',
        data: '2026-03-10',
        conCliente: true,
      })
      const y = await nuovo(s, {
        stato: 'DA_COLLEGARE',
        data: '2026-04-10',
        motivi: ['SENZA_PREZZO'],
      })
      const z = await nuovo(s, { data: '2026-05-10' })
      // secondo registro
      const reg2 = await owner.registroRifiuti.create({
        data: { tenantId: s.tenantId, codice: 'R2', descrizione: 'Secondo registro' },
      })
      const w = await owner.wasteMovement.create({
        data: {
          tenantId: s.tenantId,
          registroId: reg2.id,
          progressiveYear: 2026,
          progressiveNumber: 1,
          type: 'CARICO',
          movementDate: new Date('2026-06-10T10:00:00Z'),
          causale: 'INGRESSO_ESTERNO',
          cerCode: '20 03 01',
          quantity: '5',
          unit: 'KG',
          tipoAnnotazione: 'ORDINARIA',
        },
      })
      expect(ids((await lista(s, { clienteId: s.clienteId })).elementi)).toEqual([x.movimentoId])
      expect(ids((await lista(s, { dal: '2026-04-10', al: '2026-05-10' })).elementi)).toEqual([
        y.movimentoId,
        z.movimentoId,
      ])
      expect(ids((await lista(s, { dal: '2026-04-11' })).elementi)).toEqual([z.movimentoId, w.id])
      expect(ids((await lista(s, { al: '2026-03-10' })).elementi)).toEqual([x.movimentoId])
      expect(ids((await lista(s, { registroId: reg2.id })).elementi)).toEqual([w.id])
      expect(ids((await lista(s, { registroId: x.registroId })).elementi)).toEqual([
        x.movimentoId,
        y.movimentoId,
        z.movimentoId,
      ])
      expect(ids((await lista(s, { motivo: 'SENZA_PREZZO' })).elementi)).toEqual([y.movimentoId])
      expect(ids((await lista(s, { stati: ['MANCANTE'] })).elementi)).toEqual([z.movimentoId, w.id])
      expect(ids((await lista(s, { stati: ['PROPOSTO', 'DA_COLLEGARE'] })).elementi)).toEqual([
        x.movimentoId,
        y.movimentoId,
      ])
      // Il giorno del filtro e’ quello italiano, come quello della lista.
      await owner.wasteMovement.update({
        where: { id: z.movimentoId },
        data: { movementDate: new Date('2026-05-09T23:30:00Z') },
      })
      expect(ids((await lista(s, { dal: '2026-05-10', al: '2026-05-10' })).elementi)).toEqual([
        z.movimentoId,
      ])
      // 23:30 UTC del 9/5 e’ gia’ il 10/5 a Roma: al 9/5 restano solo x e y.
      expect(ids((await lista(s, { al: '2026-05-09' })).elementi)).toEqual([
        x.movimentoId,
        y.movimentoId,
      ])
    })

    it('paginazione stabile: pagine disgiunte, ordine deterministico anche a parita’ di data, totale esatto', async () => {
      const s = await scenario()
      for (let i = 0; i < 7; i++) await nuovo(s, { data: '2026-03-01' }) // tutte lo stesso giorno
      for (let i = 0; i < 3; i++) await nuovo(s, { data: '2026-02-01', stato: 'DA_COLLEGARE' })
      const p1 = await lista(s, { pagina: 1, dimensione: 4 })
      const p2 = await lista(s, { pagina: 2, dimensione: 4 })
      const p3 = await lista(s, { pagina: 3, dimensione: 4 })
      const p4 = await lista(s, { pagina: 4, dimensione: 4 })
      expect([p1.totale, p2.totale, p3.totale, p4.totale]).toEqual([10, 10, 10, 10])
      expect([
        p1.elementi.length,
        p2.elementi.length,
        p3.elementi.length,
        p4.elementi.length,
      ]).toEqual([4, 4, 2, 0])
      const tutti = [...p1.elementi, ...p2.elementi, ...p3.elementi].map(r => r.movimentoId)
      expect(new Set(tutti).size).toBe(10)
      const intera = await lista(s, { dimensione: 200 })
      expect(ids(intera.elementi)).toEqual(tutti)
      // data crescente: i tre di febbraio per primi
      expect(intera.elementi.slice(0, 3).every(r => r.dataMovimento === '2026-02-01')).toBe(true)
      // due letture uguali danno lo stesso ordine
      expect(ids((await lista(s, { dimensione: 200 })).elementi)).toEqual(tutti)
      // default: pagina 1, 50 righe
      expect((await lista(s)).elementi).toHaveLength(10)
    })

    it('parametri non validi: 400 (dimensione 0, negativo, 201, non intero; pagina 0; id; date; stato; motivo)', async () => {
      const s = await scenario()
      const casi: FiltriLista[] = [
        { dimensione: 201 },
        { dimensione: 0 },
        { dimensione: -1 },
        { dimensione: 1.5 },
        { pagina: 0 },
        { pagina: 2.2 },
        { clienteId: 'non-un-uuid' },
        { registroId: 'x' },
        { contrattoId: 'non-un-uuid' },
        { dal: '2026-13-40' },
        { al: '1/2/2026' },
        { dal: '2026-05-02', al: '2026-05-01' },
        { stati: ['INVENTATO' as StatoListaLegame] },
        { motivo: 'INVENTATO' as never },
      ]
      for (const f of casi) {
        const e = await errore(lista(s, f))
        expect([JSON.stringify(f), e.status]).toEqual([JSON.stringify(f), 400])
      }
      expect((await lista(s, { dimensione: 200 })).totale).toBe(0)
    })

    it('filtro per contratto: solo i legami di quel contratto, nessuno senza contratto, isolamento fra aziende', async () => {
      const s = await scenario()
      const a = await nuovo(s, { stato: 'PROPOSTO' })
      const b = await nuovo(s, { stato: 'DA_COLLEGARE', conCliente: true })
      await nuovo(s, { stato: 'DA_COLLEGARE', soloCliente: true }) // cliente, senza contratto
      await nuovo(s, { stato: 'DA_COLLEGARE' }) // senza cliente
      await nuovo(s) // MANCANTE
      const r = await lista(s, { contrattoId: s.contrattoId, dimensione: 200 })
      expect(r.totale).toBe(2)
      expect(new Set(ids(r.elementi))).toEqual(new Set([a.movimentoId, b.movimentoId]))
      // Combinato con il cliente; un contratto sconosciuto o di un'altra azienda non da' nulla.
      expect((await lista(s, { contrattoId: s.contrattoId, clienteId: s.clienteId })).totale).toBe(
        2
      )
      expect((await lista(s, { contrattoId: '22222222-2222-4222-8222-222222222222' })).totale).toBe(
        0
      )
      const altro = await scenario()
      await nuovo(altro, { stato: 'PROPOSTO' })
      expect((await lista(s, { contrattoId: altro.contrattoId })).totale).toBe(0)
      expect((await lista(altro, { contrattoId: altro.contrattoId })).totale).toBe(1)
    })

    it('contatori coerenti con la lista: totale, proposti, mancanti, da riallineare', async () => {
      const s = await scenario()
      await nuovo(s) // mancante
      await nuovo(s)
      await nuovo(s, { stato: 'PROPOSTO' })
      await nuovo(s, { stato: 'DA_COLLEGARE' })
      await nuovo(s, { stato: 'DA_COLLEGARE' })
      await nuovo(s, { stato: 'DA_COLLEGARE' })
      await nuovo(s, { stato: 'ESCLUSO' })
      await nuovo(s, { stato: 'CONFERMATO' })
      const m = await nuovo(s, { stato: 'CONFERMATO' })
      await correggi(s, 'RETTIFICA', m.movimentoId, m.movimentoId)
      await nuovo(s, { type: 'SCARICO', causale: 'AVVIO_RECUPERO' })
      const c = await contatori(s)
      const l = await lista(s, { dimensione: 200 })
      const conta = (st: string) => l.elementi.filter(r => r.stato === st).length
      expect(c).toEqual({
        daCollegare: l.totale,
        proposti: conta('PROPOSTO'),
        mancanti: conta('MANCANTE'),
        daRiallineare: conta('DA_RIALLINEARE'),
      })
      expect(c).toEqual({ daCollegare: 7, proposti: 1, mancanti: 2, daRiallineare: 1 })
      for (const st of ['PROPOSTO', 'MANCANTE', 'DA_RIALLINEARE', 'DA_COLLEGARE'] as const) {
        expect((await lista(s, { stati: [st] })).totale).toBe(conta(st))
      }
    })
  })

  describe('prestazioni', () => {
    /** Inserisce N movimenti con legami in un’azienda, con una miscela realistica. */
    async function caricaVolume(s: ScenarioProposta, n: number) {
      // Ogni inserimento ha un timeout: un piano pessimo deve dare errore, non restare appeso.
      const conTimeout = (q: Prisma.PrismaPromise<number>) =>
        owner.$transaction([owner.$executeRawUnsafe(`SET LOCAL statement_timeout = '120s'`), q])
      await conTimeout(owner.$executeRaw`
        INSERT INTO waste_movements
          (tenant_id, registro_id, progressive_year, progressive_number, type, movement_date,
           registration_date, causale, cer_code, quantity, unit, tipo_annotazione, updated_at)
        SELECT ${s.tenantId}::uuid, ${s.registroId}::uuid, 2027, g,
               CASE WHEN g % 10 < 6 THEN 'CARICO' ELSE 'SCARICO' END::waste_movement_type,
               timestamp '2026-02-01 10:00' + (g % 700) * interval '1 day',
               timestamp '2026-02-01 10:00',
               CASE WHEN g % 10 < 6 THEN 'INGRESSO_ESTERNO' ELSE 'AVVIO_RECUPERO' END,
               '20 03 01', 10, 'KG', 'ORDINARIA', now()
        FROM generate_series(1, ${n}::int) g`)
      // Statistiche vere prima di costruire i legami (senza, il planner stima la tabella appena
      // svuotata da un giro precedente e l'INSERT ... SELECT puo' non finire per minuti).
      await owner.$executeRawUnsafe('ANALYZE waste_movements')
      // legami per i soli movimenti fatturabili: 85% FATTURATO, 9% CONFERMATO, 2% PROPOSTO,
      // 1% DA_COLLEGARE, 1% ESCLUSO, 2% nessun legame
      // 4.4a: i FATTURATO citano un documento (CHECK `legami_movimento_documento_se_fatturato`).
      const documentoVolumeId = await creaDocumentoMinimoPerLegame(owner, s.tenantId, {
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
      })
      await conTimeout(owner.$executeRaw`
        INSERT INTO legami_movimento
          (tenant_id, registro_id, verso, movimento_originale_id, movimento_vigente_id, stato,
           data_movimento, cliente_id, contratto_id, elenco_id, motivo_esclusione, fatturato_il,
           documento_id, updated_at)
        SELECT m.tenant_id, m.registro_id, m.type, m.id, m.id, x.stato::stato_legame_movimento,
               m.movement_date::date,
               CASE WHEN x.stato IN ('DA_COLLEGARE','ESCLUSO') THEN NULL ELSE ${s.clienteId}::uuid END,
               CASE WHEN x.stato IN ('DA_COLLEGARE','ESCLUSO') THEN NULL ELSE ${s.contrattoId}::uuid END,
               CASE WHEN x.stato IN ('DA_COLLEGARE','ESCLUSO') THEN NULL ELSE ${s.elencoId}::uuid END,
               CASE WHEN x.stato = 'ESCLUSO' THEN 'prova' END,
               CASE WHEN x.stato = 'FATTURATO' THEN now() END,
               CASE WHEN x.stato = 'FATTURATO' THEN ${documentoVolumeId}::uuid END,
               now()
        FROM (SELECT m.*, ((m.progressive_number / 10) % 100) AS k FROM waste_movements m
              WHERE m.tenant_id = ${s.tenantId}::uuid AND m.causale = 'INGRESSO_ESTERNO') m
        CROSS JOIN LATERAL (SELECT CASE
            WHEN m.k < 85 THEN 'FATTURATO' WHEN m.k < 94 THEN 'CONFERMATO'
            WHEN m.k < 96 THEN 'PROPOSTO' WHEN m.k < 97 THEN 'DA_COLLEGARE'
            WHEN m.k < 98 THEN 'ESCLUSO' ELSE NULL END AS stato) x
        WHERE x.stato IS NOT NULL`)
      // una rettifica ogni 7 numeri progressivi fra i fatturabili (la testa vigente e’ la rettifica)
      await conTimeout(owner.$executeRaw`
        INSERT INTO waste_movements
          (tenant_id, registro_id, progressive_year, progressive_number, type, movement_date,
           registration_date, causale, cer_code, quantity, unit, tipo_annotazione,
           movimento_rettificato_id, movimento_originale_id, motivo_annotazione, updated_at)
        SELECT m.tenant_id, m.registro_id, 2028, m.progressive_number, m.type, m.movement_date,
               m.registration_date, m.causale, m.cer_code, 9, 'KG', 'RETTIFICA', m.id, m.id,
               'prova', now()
        FROM waste_movements m
        WHERE m.tenant_id = ${s.tenantId}::uuid AND m.progressive_year = 2027
          AND m.causale = 'INGRESSO_ESTERNO' AND m.progressive_number % 7 = 0`)
      for (const t of ['waste_movements', 'legami_movimento']) {
        await owner.$executeRawUnsafe(`ANALYZE ${t}`)
      }
    }

    /**
     * Intercetta le transazioni del servizio: esegue prima `inizio` (SET LOCAL, nessuna modifica
     * al ruolo condiviso) e conta le istruzioni raw che il servizio manda al database.
     */
    function intercetta(inizio: string[] = []) {
      const testi: string[] = []
      const originale = app.$transaction.bind(app) as (...a: unknown[]) => Promise<unknown>
      const spia = jest.spyOn(app, '$transaction').mockImplementation(((
        fn: unknown,
        opz: unknown
      ) =>
        originale(async (tx: Prisma.TransactionClient) => {
          for (const q of inizio) await tx.$executeRawUnsafe(q)
          const proxy = new Proxy(tx, {
            get(t, p, r) {
              const v = Reflect.get(t, p, r)
              if (p === '$queryRaw' || p === '$executeRaw') {
                return (strings: TemplateStringsArray | Prisma.Sql, ...resto: unknown[]) => {
                  testi.push(
                    Array.isArray(strings) ? strings.join('?') : (strings as Prisma.Sql).text
                  )
                  return (v as (...x: unknown[]) => unknown).call(t, strings, ...resto)
                }
              }
              return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v
            },
          })
          return (fn as (t: Prisma.TransactionClient) => Promise<unknown>)(proxy)
        }, opz)) as never)
      return { testi, ripristina: () => spia.mockRestore() }
    }
    const conta = () => intercetta()

    /** Piano generico e timeout esplicito solo dentro le transazioni del servizio (`SET LOCAL`). */
    async function conPianoGenerico<R>(fn: () => Promise<R>): Promise<R> {
      const spia = intercetta([
        `SET LOCAL plan_cache_mode = force_generic_plan`,
        `SET LOCAL statement_timeout = '45s'`,
      ])
      try {
        return await fn()
      } finally {
        spia.ripristina()
      }
    }

    /**
     * EXPLAIN (ANALYZE, BUFFERS) delle due istruzioni della lista (le STESSE del servizio) come
     * ruolo applicativo, in un'istruzione preparata: `generico` forza il piano generico.
     */
    async function spiega(s: ScenarioProposta, f: FiltriLista, generico: boolean) {
      const client = clientComeRuolo(
        'wasteflow_app',
        process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
        urlProprietario
      )
      try {
        const n = normalizzaFiltri(f)
        const base = sqlCandidati(s.tenantId, '2026-01-01', n)
        const out: string[] = []
        for (const [nome, sql] of [
          ['pagina', sqlPagina(s.tenantId, base, n)],
          ['conteggio', sqlConteggio(base, n.stati)],
        ] as const) {
          const tipi = sql.values.map(v =>
            Array.isArray(v) ? 'text[]' : typeof v === 'number' ? 'bigint' : 'text'
          )
          // EXECUTE e' un'istruzione di utilita': i valori vanno in chiaro (qui solo id, date, interi).
          const lett = (v: unknown): string =>
            Array.isArray(v)
              ? `ARRAY[${v.map(lett).join(', ')}]::text[]`
              : typeof v === 'number'
                ? String(v)
                : `'${String(v).replace(/'/g, "''")}'`
          const segnaposto = sql.values.map(lett).join(', ')
          const piano = await client.$transaction(
            async tx => {
              await tx.$queryRaw`SELECT set_config('app.tenant_id', ${s.tenantId}, true)`
              if (generico) {
                await tx.$executeRawUnsafe(`SET LOCAL plan_cache_mode = force_generic_plan`)
              }
              await tx.$executeRawUnsafe(`PREPARE q_t18 (${tipi.join(', ')}) AS ${sql.text}`)
              const r = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
                `EXPLAIN (ANALYZE, BUFFERS) EXECUTE q_t18 (${segnaposto})`
              )
              const testo = r.map(x => x['QUERY PLAN']).join('\n')
              await tx.$executeRawUnsafe('DEALLOCATE q_t18')
              return testo
            },
            { timeout: 120_000 }
          )
          out.push(`--- ${nome} (${generico ? 'generico' : 'custom'}) ---\n${piano}`)
        }
        return out.join('\n')
      } finally {
        await client.$disconnect()
      }
    }

    async function misura(s: ScenarioProposta, etichetta: string) {
      const tempi: Record<string, number> = {}
      const t = async <R>(nome: string, fn: () => Promise<R>): Promise<R> => {
        const t0 = Date.now()
        const r = await fn()
        tempi[nome] = Date.now() - t0
        return r
      }
      const p1 = await t('pagina 1', () => lista(s, { dimensione: 50 }))
      const profonda = await t('pagina 40', () => lista(s, { pagina: 40, dimensione: 50 }))
      const filtrata = await t('cliente+periodo', () =>
        lista(s, { clienteId: s.clienteId, dal: '2026-06-01', al: '2026-06-30' })
      )
      const stato = await t('stato MANCANTE', () => lista(s, { stati: ['MANCANTE'] }))
      const c = await t('contatori', () => contatori(s))
      console.info(`[T18] ${etichetta}: ${JSON.stringify(tempi)} (totale ${p1.totale})`)
      return { tempi, p1, profonda, filtrata, stato, c }
    }

    const N = 10_000

    it('10.000 movimenti: una lista e’ un numero fisso di istruzioni (nessun N+1), statistiche vere e piano generico', async () => {
      const s = await scenario('2026-01-01', true)
      await caricaVolume(s, N)
      // Atteso calcolato in JavaScript sulla miscela inserita (una catena conta una volta):
      // PROPOSTO e DA_COLLEGARE (k 94-96) e senza legame (k >= 98) sempre; ogni altro stato con
      // legame (FATTURATO, CONFERMATO, ESCLUSO) solo se la catena e' stata rettificata (g % 7 = 0:
      // il legame resta indietro, DA_RIALLINEARE).
      let attesi = 0
      for (let g = 1; g <= N; g++) {
        if (g % 10 >= 6) continue
        const k = Math.floor(g / 10) % 100
        if ((k >= 94 && k < 97) || k >= 98) attesi++
        else if (g % 7 === 0) attesi++
      }
      const spia = conta()
      let r: Awaited<ReturnType<typeof misura>>
      try {
        r = await misura(s, `${N} movimenti, ANALYZE`)
      } finally {
        spia.ripristina()
      }
      // 5 chiamate (pagina 1, 40, filtrata, stato, contatori): 4 liste + 1 contatori.
      // Per lista: timeout + fatturazione da + pagina + conteggio; per i contatori: timeout +
      // fatturazione da + un’aggregazione. Il numero non dipende da N.
      expect(spia.testi.length).toBeLessThanOrEqual(4 * 4 + 3)
      expect(r.p1.elementi).toHaveLength(50)
      expect(r.p1.totale).toBe(attesi)
      expect(r.c.daCollegare).toBe(attesi)
      expect(r.stato.totale).toBeGreaterThan(0)
      for (const v of Object.values(r.tempi)) expect(v).toBeLessThan(3000)
      // piano generico
      const g = await conPianoGenerico(() => misura(s, `${N} movimenti, piano generico`))
      expect(g.p1.totale).toBe(r.p1.totale)
      expect(ids(g.p1.elementi)).toEqual(ids(r.p1.elementi))
      for (const v of Object.values(g.tempi)) expect(v).toBeLessThan(5000)
    }, 300_000)

    const VOLUME = Number(process.env.LISTA_VOLUME ?? 0)
    ;(VOLUME > 0 ? it : it.skip)(
      'volume grande (LISTA_VOLUME): misura con statistiche vere, piano generico, caso peggiore',
      async () => {
        const s = await scenario('2026-01-01', true)
        await caricaVolume(s, VOLUME)
        await misura(s, `${VOLUME} movimenti, ANALYZE`)
        await conPianoGenerico(() => misura(s, `${VOLUME} movimenti, piano generico`))
        if (process.env.LISTA_EXPLAIN) {
          for (const f of [{}, { clienteId: s.clienteId, dal: '2026-06-01', al: '2026-06-30' }]) {
            for (const generico of [false, true]) {
              console.info(
                `[T18 EXPLAIN] filtri ${JSON.stringify(f)}\n${await spiega(s, f, generico)}`
              )
            }
          }
        }
        // caso peggiore: lo storico intero senza legami (fatturazione appena accesa)
        await owner.$executeRaw`DELETE FROM legami_movimento WHERE tenant_id = ${s.tenantId}::uuid`
        await owner.$executeRawUnsafe('ANALYZE legami_movimento')
        const peggiore = await misura(s, `${VOLUME} movimenti, tutti MANCANTI, ANALYZE`)
        expect(peggiore.p1.totale).toBeGreaterThan(VOLUME / 2)
        await conPianoGenerico(() => misura(s, `${VOLUME} movimenti, tutti MANCANTI, generico`))
      },
      900_000
    )
  })
})

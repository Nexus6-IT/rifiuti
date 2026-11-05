/**
 * Numerazione delle fatture (4.4a, Task 8) contro un Postgres reale, collegato COME `wasteflow_app`,
 * dentro il `TenantContext`. Il proprietario prepara aziende, registri e documenti e legge lo stato
 * finale. Le barriere guardano `pg_stat_activity` (`wait_event_type = 'Lock'`) per le sole
 * connessioni di questo processo: mai `sleep` come sincronizzazione. Pulizia solo per id esatti.
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
const NOME_APPLICAZIONE = `fatt-t8-${process.pid}`
// Un pool abbastanza largo per tenere aperte 20 transazioni insieme.
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}&connection_limit=30`

import { ConflictException } from '@nestjs/common'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaDocumentoDiTest } from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import {
  numeroTesto,
  riservaNumeri,
  rilasciaUltimo,
  type NumeriRiservati,
  type RichiestaNumeri,
} from './numerazione'
import { NumerazioniService } from './numerazioni.service'

interface RigaNum {
  ultimo_numero: number
  ultima_data: string | null
  numero_partenza: number
  data_partenza: string | null
  versione: number
}

describe('Numerazione fatture — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: NumerazioniService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new NumerazioniService(app)
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda(registri = 1) {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Numerazione SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-num-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `num-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const registriIds: string[] = []
    for (let i = 1; i <= registri; i++) {
      const r = await owner.registroIva.create({
        data: { tenantId: t.id, codice: String(i).padStart(2, '0'), descrizione: `Registro ${i}` },
      })
      registriIds.push(r.id)
    }
    return { tenantId: t.id, utenteId: utente.id, registroId: registriIds[0], registriIds }
  }

  const riserva = (tenantId: string, r: RichiestaNumeri[]) =>
    nel(tenantId, () =>
      app.$transaction(tx => riservaNumeri(tx, tenantId, r), OPZIONI_TRANSAZIONE_SCRITTURA)
    )
  const richiesta = (
    registroIvaId: string,
    quanti: number,
    dataDocumento = '2026-03-15',
    anno = 2026
  ): RichiestaNumeri => ({ registroIvaId, anno, quanti, dataDocumento })

  async function riga(tenantId: string, registroId: string, anno = 2026): Promise<RigaNum | null> {
    const r = await owner.$queryRawUnsafe<RigaNum[]>(
      `SELECT ultimo_numero, ultima_data::text, numero_partenza, data_partenza::text, versione
       FROM numerazioni_fattura WHERE tenant_id = $1::uuid AND registro_iva_id = $2::uuid AND anno = $3::int`,
      tenantId,
      registroId,
      anno
    )
    return r[0] ?? null
  }

  async function partenza(
    tenantId: string,
    registroId: string,
    numero: number,
    data: string | null,
    anno = 2026
  ) {
    await owner.numerazioneFattura.create({
      data: {
        tenantId,
        registroIvaId: registroId,
        anno,
        numeroPartenza: numero,
        ultimoNumero: numero,
        dataPartenza: data ? new Date(`${data}T00:00:00Z`) : null,
        ultimaData: data ? new Date(`${data}T00:00:00Z`) : null,
      },
    })
  }

  const definitivo = (tenantId: string, registroIvaId: string, numero: number, data: string) =>
    creaDocumentoDiTest(owner, tenantId, {
      stato: 'DEFINITIVO',
      registroIvaId,
      anno: Number(data.slice(0, 4)),
      numero,
      dataDocumento: data,
    })

  // --- barriere ---------------------------------------------------------------------------------

  const inAttesa = async () => {
    const r = await owner.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
        AND wait_event_type = 'Lock'`
    return r[0].n
  }
  const finche = async (attesi: number) => {
    const scadenza = Date.now() + 30_000
    while ((await inAttesa()) < attesi) {
      if (Date.now() > scadenza) throw new Error(`sessioni in attesa di lock: attese ${attesi}`)
      await new Promise(r => setTimeout(r, 25))
    }
  }
  /** Una promessa che si risolve quando si chiama `rilascia`. */
  const barriera = () => {
    let rilascia!: () => void
    const promessa = new Promise<void>(r => (rilascia = r))
    return { promessa, rilascia }
  }
  /**
   * Una riserva che resta aperta (lock tenuto) finche' non si rilascia la barriera. Con
   * `rollback` la transazione fallisce dopo la barriera.
   */
  function riservaAperta(tenantId: string, r: RichiestaNumeri[], rollback = false) {
    const b = barriera()
    const tenuta = barriera()
    const esito = nel(tenantId, () =>
      app.$transaction(
        async tx => {
          const numeri = await riservaNumeri(tx, tenantId, r)
          tenuta.rilascia()
          await b.promessa
          if (rollback) throw new Error('rollback voluto dal test')
          return numeri
        },
        { timeout: 60_000, maxWait: 30_000 }
      )
    )
    // Evita un rifiuto non gestito se il test fallisce prima di attendere l'esito.
    esito.catch(() => undefined)
    return { esito, tenuta: tenuta.promessa, rilascia: b.rilascia }
  }

  // --- riserva -----------------------------------------------------------------------------------

  it('prima riserva: 1..3, ultimo_numero 3, ultima_data e versione', async () => {
    const { tenantId, registroId } = await azienda()
    const [r] = await riserva(tenantId, [richiesta(registroId, 3)])
    expect(r).toEqual({ registroIvaId: registroId, anno: 2026, da: 1, a: 3, suffisso: null })
    expect(await riga(tenantId, registroId)).toMatchObject({
      ultimo_numero: 3,
      ultima_data: '2026-03-15',
      numero_partenza: 0,
      versione: 2,
    })
    const [r2] = await riserva(tenantId, [richiesta(registroId, 2, '2026-03-15')])
    expect([r2.da, r2.a]).toEqual([4, 5])
  })

  it('con numero_partenza 120: 121..', async () => {
    const { tenantId, registroId } = await azienda()
    await partenza(tenantId, registroId, 120, '2026-02-28')
    const [r] = await riserva(tenantId, [richiesta(registroId, 2)])
    expect([r.da, r.a]).toEqual([121, 122])
    expect((await riga(tenantId, registroId))!.ultimo_numero).toBe(122)
  })

  it('il suffisso del registro accompagna i numeri: numeroTesto(15, "/A") = "15/A"', async () => {
    const { tenantId, registroId } = await azienda()
    await owner.registroIva.update({ where: { id: registroId }, data: { suffissoNumero: '/A' } })
    const [r] = await riserva(tenantId, [richiesta(registroId, 1)])
    expect(r.suffisso).toBe('/A')
    expect(numeroTesto(15, r.suffisso)).toBe('15/A')
    expect(numeroTesto(15, null)).toBe('15')
  })

  it('data anteriore a ultima_data: 409 DATA_ANTERIORE_ULTIMA_FATTURA, ultimo_numero invariato', async () => {
    const { tenantId, registroId } = await azienda()
    await riserva(tenantId, [richiesta(registroId, 2, '2026-03-15')])
    const prima = await riga(tenantId, registroId)
    const err = await riserva(tenantId, [richiesta(registroId, 1, '2026-03-14')]).catch(e => e)
    expect(err).toBeInstanceOf(ConflictException)
    expect(err.getResponse()).toMatchObject({ error: 'DATA_ANTERIORE_ULTIMA_FATTURA' })
    expect(await riga(tenantId, registroId)).toEqual(prima)
    // La stessa data e' ammessa.
    const [ok] = await riserva(tenantId, [richiesta(registroId, 1, '2026-03-15')])
    expect(ok.da).toBe(3)
  })

  it('un errore su una coppia non lascia scritte le altre della stessa riserva', async () => {
    const { tenantId, registriIds } = await azienda(2)
    await riserva(tenantId, [richiesta(registriIds[1], 1, '2026-05-01')])
    const err = await riserva(tenantId, [
      richiesta(registriIds[0], 2, '2026-03-15'),
      richiesta(registriIds[1], 1, '2026-04-01'),
    ]).catch(e => e)
    expect(err).toBeInstanceOf(ConflictException)
    expect((await riga(tenantId, registriIds[0]))?.ultimo_numero ?? 0).toBe(0)
    expect((await riga(tenantId, registriIds[1]))!.ultimo_numero).toBe(1)
  })

  it('richieste non valide: 400 e nulla scritto', async () => {
    const { tenantId, registroId } = await azienda()
    const casi: RichiestaNumeri[] = [
      richiesta(registroId, 0),
      richiesta(registroId, 1.5),
      richiesta(registroId, -1),
      richiesta(registroId, 1, '2026-02-30'),
      richiesta(registroId, 1, '15/03/2026'),
      richiesta(registroId, 1, '2027-01-02', 2026),
    ]
    for (const c of casi) {
      const err = await riserva(tenantId, [c]).catch(e => e)
      expect(err.getStatus?.()).toBe(400)
    }
    expect(await riga(tenantId, registroId)).toBeNull()
  })

  it('un registro di un altro tenant: 404, nulla scritto', async () => {
    const a = await azienda()
    const b = await azienda()
    const err = await riserva(a.tenantId, [richiesta(b.registroId, 1)]).catch(e => e)
    expect(err.getStatus?.()).toBe(404)
    expect(await riga(b.tenantId, b.registroId)).toBeNull()
    expect(await riga(a.tenantId, b.registroId)).toBeNull()
  })

  it('due registri nella stessa riserva, in ordine di registro_iva_id: nessun deadlock fra ordini opposti', async () => {
    const { tenantId, registriIds } = await azienda(2)
    const [x, y] = [...registriIds].sort()
    // 12 coppie di transazioni con le stesse due coppie in ordine opposto, tutte insieme.
    const lavori: Promise<NumeriRiservati[]>[] = []
    for (let i = 0; i < 12; i++) {
      lavori.push(riserva(tenantId, [richiesta(x, 1), richiesta(y, 2)]))
      lavori.push(riserva(tenantId, [richiesta(y, 1), richiesta(x, 2)]))
    }
    const esiti = await Promise.all(lavori)
    expect(esiti).toHaveLength(24)
    // 12 x (1 + 2) numeri per registro.
    expect((await riga(tenantId, x))!.ultimo_numero).toBe(36)
    expect((await riga(tenantId, y))!.ultimo_numero).toBe(36)
    // Ogni risposta e' nell'ordine delle richieste.
    expect(esiti[1].map(e => e.registroIvaId)).toEqual([y, x])
  })

  it.each([
    ["riga nuova: attesa sull'INSERT", false],
    ['riga esistente: attesa sul FOR UPDATE', true],
  ])(
    'due transazioni sulla stessa coppia (%s): la seconda aspetta (Lock) e riceve i numeri dopo la prima',
    async (_nome, esistente) => {
      const { tenantId, registroId } = await azienda()
      if (esistente) await partenza(tenantId, registroId, 0, null)
      const prima = riservaAperta(tenantId, [richiesta(registroId, 3)])
      await prima.tenuta
      let rilasciata = false
      const seconda = riserva(tenantId, [richiesta(registroId, 2)]).then(r => {
        expect(rilasciata).toBe(true) // non puo' finire prima del commit della prima
        return r
      })
      try {
        await finche(1)
      } finally {
        rilasciata = true
        prima.rilascia()
      }
      const [r1] = await prima.esito
      const [r2] = await seconda
      expect([r1.da, r1.a]).toEqual([1, 3])
      expect([r2.da, r2.a]).toEqual([4, 5])
      expect((await riga(tenantId, registroId))!.ultimo_numero).toBe(5)
    }
  )

  it('8 riserve in parallelo su 8 tenant: nessuna attesa reciproca', async () => {
    const aziende = []
    for (let i = 0; i < 8; i++) aziende.push(await azienda())
    const aperte = aziende.map(a => riservaAperta(a.tenantId, [richiesta(a.registroId, 2)]))
    await Promise.all(aperte.map(a => a.tenuta)) // tutte e 8 hanno il proprio lock insieme
    expect(await inAttesa()).toBe(0)
    aperte.forEach(a => a.rilascia())
    const esiti = await Promise.all(aperte.map(a => a.esito))
    for (const e of esiti) expect([e[0].da, e[0].a]).toEqual([1, 2])
  })

  it('20 riserve in parallelo sulla stessa coppia: numeri unici, consecutivi, ultimo_numero = somma', async () => {
    const { tenantId, registroId } = await azienda()
    const quanti = Array.from({ length: 20 }, (_, i) => (i % 5) + 1)
    const esiti = await Promise.all(quanti.map(q => riserva(tenantId, [richiesta(registroId, q)])))
    const somma = quanti.reduce((a, b) => a + b, 0)
    const numeri = esiti.flatMap(e => {
      const out: number[] = []
      for (let k = e[0].da; k <= e[0].a; k++) out.push(k)
      return out
    })
    expect(numeri).toHaveLength(somma)
    expect(new Set(numeri).size).toBe(somma)
    expect([...numeri].sort((a, b) => a - b)).toEqual(
      Array.from({ length: somma }, (_, i) => i + 1)
    )
    expect(await riga(tenantId, registroId)).toMatchObject({
      ultimo_numero: somma,
      versione: 1 + 20,
    })
  })

  it('rollback della transazione dopo la riserva: ultimo_numero invariato', async () => {
    const { tenantId, registroId } = await azienda()
    await riserva(tenantId, [richiesta(registroId, 2)])
    const prima = await riga(tenantId, registroId)
    const aperta = riservaAperta(tenantId, [richiesta(registroId, 4, '2026-04-01')], true)
    await aperta.tenuta
    aperta.rilascia()
    await expect(aperta.esito).rejects.toThrow('rollback voluto')
    expect(await riga(tenantId, registroId)).toEqual(prima)
    const [r] = await riserva(tenantId, [richiesta(registroId, 1)])
    expect(r.da).toBe(3)
  })

  it('anno nuovo: riserva al 02/01 su un registro con definitivi a dicembre → 1 (o partenza + 1)', async () => {
    const { tenantId, registriIds } = await azienda(2)
    await riserva(tenantId, [richiesta(registriIds[0], 15, '2026-12-30')])
    const [r] = await riserva(tenantId, [richiesta(registriIds[0], 1, '2027-01-02', 2027)])
    expect([r.anno, r.da, r.a]).toEqual([2027, 1, 1])
    expect((await riga(tenantId, registriIds[0], 2026))!.ultimo_numero).toBe(15)
    await partenza(tenantId, registriIds[1], 40, '2027-01-01', 2027)
    const [p] = await riserva(tenantId, [richiesta(registriIds[1], 1, '2027-01-02', 2027)])
    expect(p.da).toBe(41)
  })

  // --- rilascio dell'ultimo numero ---------------------------------------------------------------

  const rilascia = (
    tenantId: string,
    c: { registroIvaId: string; anno: number; numero: number; documentoId: string }
  ) =>
    nel(tenantId, () =>
      app.$transaction(tx => rilasciaUltimo(tx, tenantId, c), OPZIONI_TRANSAZIONE_SCRITTURA)
    )

  it("rilasciaUltimo dell'ultimo: ultimo_numero − 1 e ultima_data del precedente", async () => {
    const { tenantId, registroId } = await azienda()
    await riserva(tenantId, [richiesta(registroId, 1, '2026-03-10')])
    await riserva(tenantId, [richiesta(registroId, 1, '2026-03-20')])
    await definitivo(tenantId, registroId, 1, '2026-03-10')
    const d2 = await definitivo(tenantId, registroId, 2, '2026-03-20')
    await rilascia(tenantId, {
      registroIvaId: registroId,
      anno: 2026,
      numero: 2,
      documentoId: d2.documentoId,
    })
    expect(await riga(tenantId, registroId)).toMatchObject({
      ultimo_numero: 1,
      ultima_data: '2026-03-10',
    })
    // Il numero rilasciato si puo' riservare di nuovo.
    const [r] = await riserva(tenantId, [richiesta(registroId, 1, '2026-03-12')])
    expect(r.da).toBe(2)
  })

  it("rilasciaUltimo dell'unico definitivo dopo una partenza: ultima_data = data_partenza", async () => {
    const { tenantId, registroId } = await azienda()
    await partenza(tenantId, registroId, 120, '2026-02-28')
    await riserva(tenantId, [richiesta(registroId, 1, '2026-03-15')])
    const d = await definitivo(tenantId, registroId, 121, '2026-03-15')
    await rilascia(tenantId, {
      registroIvaId: registroId,
      anno: 2026,
      numero: 121,
      documentoId: d.documentoId,
    })
    expect(await riga(tenantId, registroId)).toMatchObject({
      ultimo_numero: 120,
      ultima_data: '2026-02-28',
    })
  })

  it('rilasciaUltimo senza partenza e senza altri definitivi: ultima_data torna nulla', async () => {
    const { tenantId, registroId } = await azienda()
    await riserva(tenantId, [richiesta(registroId, 1, '2026-03-15')])
    const d = await definitivo(tenantId, registroId, 1, '2026-03-15')
    await rilascia(tenantId, {
      registroIvaId: registroId,
      anno: 2026,
      numero: 1,
      documentoId: d.documentoId,
    })
    expect(await riga(tenantId, registroId)).toMatchObject({ ultimo_numero: 0, ultima_data: null })
  })

  it('rilasciaUltimo di un numero intermedio: 409 ANNULLO_NON_AMMESSO, nulla cambia', async () => {
    const { tenantId, registroId } = await azienda()
    await riserva(tenantId, [richiesta(registroId, 3)])
    const d1 = await definitivo(tenantId, registroId, 1, '2026-03-15')
    await definitivo(tenantId, registroId, 2, '2026-03-15')
    await definitivo(tenantId, registroId, 3, '2026-03-15')
    const prima = await riga(tenantId, registroId)
    const err = await rilascia(tenantId, {
      registroIvaId: registroId,
      anno: 2026,
      numero: 1,
      documentoId: d1.documentoId,
    }).catch(e => e)
    expect(err).toBeInstanceOf(ConflictException)
    expect(err.getResponse()).toMatchObject({ error: 'ANNULLO_NON_AMMESSO' })
    expect(await riga(tenantId, registroId)).toEqual(prima)
  })

  it('rilasciaUltimo: documento emesso, di un altro numero o inesistente → 409', async () => {
    const { tenantId, registroId } = await azienda()
    await riserva(tenantId, [richiesta(registroId, 2)])
    const d1 = await definitivo(tenantId, registroId, 1, '2026-03-15')
    const d2 = await definitivo(tenantId, registroId, 2, '2026-03-15')
    const prima = await riga(tenantId, registroId)
    const base = { registroIvaId: registroId, anno: 2026, numero: 2 }
    // Il documento indicato porta un altro numero.
    const altro = await rilascia(tenantId, { ...base, documentoId: d1.documentoId }).catch(e => e)
    expect(altro.getResponse()).toMatchObject({ error: 'ANNULLO_NON_AMMESSO' })
    // Documento inesistente.
    const nessuno = await rilascia(tenantId, {
      ...base,
      documentoId: '00000000-0000-4000-8000-000000000000',
    }).catch(e => e)
    expect(nessuno.getResponse()).toMatchObject({ error: 'ANNULLO_NON_AMMESSO' })
    // Emesso.
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura SET emesso_il = now(), updated_at = now() WHERE id = $1::uuid`,
      d2.documentoId
    )
    const emesso = await rilascia(tenantId, { ...base, documentoId: d2.documentoId }).catch(e => e)
    expect(emesso.getResponse()).toMatchObject({ error: 'ANNULLO_NON_AMMESSO' })
    expect(await riga(tenantId, registroId)).toEqual(prima)
  })

  it('rilasciaUltimo di una nota di credito TD04: 409 ANNULLO_NON_AMMESSO (decisione 18)', async () => {
    const { tenantId, registroId } = await azienda()
    await riserva(tenantId, [richiesta(registroId, 2)])
    const origine = await definitivo(tenantId, registroId, 1, '2026-03-15')
    // Nota di credito: nasce in bozza con l'origine, poi passa a DEFINITIVO col numero 2.
    const [nota] = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO documenti_fattura
         (tenant_id, stato, tipo_documento, registro_iva_id, anno, data_documento, cliente_id,
          cliente_fatturazione_id, contratto_id, elenco_id, periodo_dal, periodo_al,
          formato_trasmissione, esigibilita_iva, totale_imponibile, totale_iva, totale_documento,
          netto_a_pagare, fotografia, documento_origine_id, updated_at)
       SELECT tenant_id, 'BOZZA', 'TD04', registro_iva_id, anno, data_documento, cliente_id,
          cliente_fatturazione_id, contratto_id, elenco_id, periodo_dal, periodo_al,
          formato_trasmissione, esigibilita_iva, totale_imponibile, totale_iva, totale_documento,
          netto_a_pagare, fotografia, id, now()
       FROM documenti_fattura WHERE id = $1::uuid
       RETURNING id::text`,
      origine.documentoId
    )
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura SET stato = 'DEFINITIVO', numero = 2, numero_testo = '2',
         definito_il = now(), updated_at = now() WHERE id = $1::uuid`,
      nota.id
    )
    const err = await rilascia(tenantId, {
      registroIvaId: registroId,
      anno: 2026,
      numero: 2,
      documentoId: nota.id,
    }).catch(e => e)
    expect(err.getResponse()).toMatchObject({ error: 'ANNULLO_NON_AMMESSO' })
    expect((await riga(tenantId, registroId))!.ultimo_numero).toBe(2)
  })

  it("rilasciaUltimo di un ANNULLATO il cui numero e' stato riassegnato: 409, contatore invariato", async () => {
    const { tenantId, registroId } = await azienda()
    await riserva(tenantId, [richiesta(registroId, 1, '2026-03-10')])
    const x = await definitivo(tenantId, registroId, 1, '2026-03-10')
    // Flusso dell'annullo: rilascio mentre e' DEFINITIVO, poi ANNULLATO.
    await rilascia(tenantId, {
      registroIvaId: registroId,
      anno: 2026,
      numero: 1,
      documentoId: x.documentoId,
    })
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura SET stato = 'ANNULLATO', motivo_annullo = 'Prova', annullato_il = now(),
         updated_at = now() WHERE id = $1::uuid`,
      x.documentoId
    )
    // Il numero 1 torna libero e va a un nuovo definitivo.
    const [r] = await riserva(tenantId, [richiesta(registroId, 1, '2026-03-12')])
    expect(r.da).toBe(1)
    await definitivo(tenantId, registroId, 1, '2026-03-12')
    const prima = await riga(tenantId, registroId)
    expect(prima!.ultimo_numero).toBe(1)
    // Un retry sbagliato sul vecchio annullato non rompe la serie.
    const err = await rilascia(tenantId, {
      registroIvaId: registroId,
      anno: 2026,
      numero: 1,
      documentoId: x.documentoId,
    }).catch(e => e)
    expect(err).toBeInstanceOf(ConflictException)
    expect(err.getResponse()).toMatchObject({ error: 'ANNULLO_NON_AMMESSO' })
    expect(await riga(tenantId, registroId)).toEqual(prima)
  })

  it('un id registro in maiuscolo funziona come in minuscolo', async () => {
    const { tenantId, registroId } = await azienda()
    const [r] = await riserva(tenantId, [richiesta(registroId.toUpperCase(), 2)])
    expect([r.da, r.a, r.registroIvaId]).toEqual([1, 2, registroId])
  })

  // --- elenco e numero di partenza ---------------------------------------------------------------

  const elenco = (t: string, anno = 2026) => nel(t, () => service.elenco(t, anno))
  const imposta = (
    t: string,
    u: string,
    registroId: string,
    dati: { numeroPartenza: number; dataPartenza: string | null; versione: number },
    anno = 2026
  ) => nel(t, () => service.impostaPartenza(t, u, registroId, anno, dati))

  it('GET elenca anche i registri senza riga con ultimoNumero 0, e solo i registri attivi', async () => {
    const { tenantId, registriIds } = await azienda(3)
    await owner.registroIva.update({ where: { id: registriIds[2] }, data: { attivo: false } })
    await riserva(tenantId, [richiesta(registriIds[1], 4)])
    const v = await elenco(tenantId)
    expect(v.map(x => x.codiceRegistro)).toEqual(['01', '02'])
    expect(v[0]).toEqual({
      registroIvaId: registriIds[0],
      codiceRegistro: '01',
      anno: 2026,
      ultimoNumero: 0,
      ultimaData: null,
      numeroPartenza: 0,
      dataPartenza: null,
      partenzaModificabile: true,
      versione: 0,
    })
    expect(v[1]).toMatchObject({ ultimoNumero: 4, ultimaData: '2026-03-15', versione: 2 })
    // Un altro anno e' vuoto.
    expect((await elenco(tenantId, 2027))[1].ultimoNumero).toBe(0)
  })

  it('PUT senza definitivi: 200, ultimo_numero = numero_partenza, ultima_data = data di partenza, audit', async () => {
    const { tenantId, utenteId, registroId } = await azienda()
    const v = await imposta(tenantId, utenteId, registroId, {
      numeroPartenza: 120,
      dataPartenza: '2026-02-28',
      versione: 0,
    })
    expect(v).toMatchObject({
      ultimoNumero: 120,
      numeroPartenza: 120,
      dataPartenza: '2026-02-28',
      ultimaData: '2026-02-28',
      partenzaModificabile: true,
      versione: 1,
    })
    const [r] = await riserva(tenantId, [richiesta(registroId, 1, '2026-03-01')])
    expect(r.da).toBe(121)
    // La data di partenza vincola le date: una anteriore e' rifiutata.
    const log = await owner.activityLog.findMany({
      where: { tenantId, action: 'NUMERAZIONE_FATTURA_PARTENZA_IMPOSTATA' },
    })
    expect(log).toHaveLength(1)
    expect(log[0].userId).toBe(utenteId)
    expect(log[0].metadata).toEqual({
      registroIvaId: registroId,
      anno: 2026,
      numeroPartenza: { prima: 0, dopo: 120 },
      dataPartenza: { prima: null, dopo: '2026-02-28' },
    })
  })

  it('PUT ripetuto con la stessa versione: la seconda volta 409 VERSIONE_SUPERATA; uguale ai valori: nessuna scrittura', async () => {
    const { tenantId, utenteId, registroId } = await azienda()
    await imposta(tenantId, utenteId, registroId, {
      numeroPartenza: 5,
      dataPartenza: null,
      versione: 0,
    })
    const err = await imposta(tenantId, utenteId, registroId, {
      numeroPartenza: 6,
      dataPartenza: null,
      versione: 0,
    }).catch(e => e)
    expect(err.getResponse()).toMatchObject({ error: 'VERSIONE_SUPERATA' })
    const stessa = await imposta(tenantId, utenteId, registroId, {
      numeroPartenza: 5,
      dataPartenza: null,
      versione: 1,
    })
    expect(stessa.versione).toBe(1)
    const cambia = await imposta(tenantId, utenteId, registroId, {
      numeroPartenza: 7,
      dataPartenza: null,
      versione: 1,
    })
    expect(cambia).toMatchObject({ numeroPartenza: 7, ultimoNumero: 7, versione: 2 })
    const log = await owner.activityLog.count({
      where: { tenantId, action: 'NUMERAZIONE_FATTURA_PARTENZA_IMPOSTATA' },
    })
    expect(log).toBe(2)
  })

  it.each(['DEFINITIVO', 'ANNULLATO'] as const)(
    'PUT con un %s nella coppia: 409 PARTENZA_NON_MODIFICABILE; una BOZZA non lo impedisce',
    async stato => {
      const { tenantId, utenteId, registroId, registriIds } = await azienda(2)
      await riserva(tenantId, [richiesta(registroId, 1)])
      await creaDocumentoDiTest(owner, tenantId, {
        stato: 'BOZZA',
        registroIvaId: registroId,
        anno: 2026,
      })
      const ok = await imposta(tenantId, utenteId, registriIds[1], {
        numeroPartenza: 3,
        dataPartenza: null,
        versione: 0,
      })
      expect(ok.versione).toBe(1)
      await creaDocumentoDiTest(owner, tenantId, {
        stato,
        registroIvaId: registroId,
        anno: 2026,
        numero: 1,
      })
      const v = await elenco(tenantId)
      expect(v[0].partenzaModificabile).toBe(false)
      const err = await imposta(tenantId, utenteId, registroId, {
        numeroPartenza: 50,
        dataPartenza: null,
        versione: 2,
      }).catch(e => e)
      expect(err).toBeInstanceOf(ConflictException)
      expect(err.getResponse()).toMatchObject({ error: 'PARTENZA_NON_MODIFICABILE' })
      expect((await riga(tenantId, registroId))!.numero_partenza).toBe(0)
    }
  )

  it.each([
    ['riga nuova', false],
    ['riga esistente (attesa sul FOR UPDATE)', true],
  ])(
    'PUT della partenza contro una riserva aperta (%s): aspetta il commit e risponde 409 se la riserva ha scritto un DEFINITIVO',
    async (_nome, esistente) => {
      const { tenantId, utenteId, registroId } = await azienda()
      if (esistente) await partenza(tenantId, registroId, 0, null)
      const aperta = riservaAperta(tenantId, [richiesta(registroId, 1)])
      await aperta.tenuta
      const put = imposta(tenantId, utenteId, registroId, {
        numeroPartenza: 50,
        dataPartenza: null,
        versione: esistente ? 1 : 0,
      }).catch(e => e)
      try {
        await finche(1)
        // La riserva "diventa" una definitiva: il documento col numero 1 compare prima del commit.
        await definitivo(tenantId, registroId, 1, '2026-03-15')
      } finally {
        aperta.rilascia()
      }
      await aperta.esito
      const err = await put
      expect(err).toBeInstanceOf(ConflictException)
      expect(err.getResponse()).toMatchObject({ error: 'PARTENZA_NON_MODIFICABILE' })
      expect(await riga(tenantId, registroId)).toMatchObject({
        ultimo_numero: 1,
        numero_partenza: 0,
      })
    }
  )

  it.each([
    ['riga nuova', false],
    ['riga esistente (attesa sul FOR UPDATE)', true],
  ])(
    'PUT della partenza contro una riserva aperta poi annullata (rollback, %s): 200',
    async (_nome, esistente) => {
      const { tenantId, utenteId, registroId } = await azienda()
      if (esistente) await partenza(tenantId, registroId, 0, null)
      const aperta = riservaAperta(tenantId, [richiesta(registroId, 1)], true)
      await aperta.tenuta
      const put = imposta(tenantId, utenteId, registroId, {
        numeroPartenza: 50,
        dataPartenza: '2026-01-31',
        versione: esistente ? 1 : 0,
      }).catch(e => e)
      try {
        await finche(1)
      } finally {
        aperta.rilascia()
      }
      await expect(aperta.esito).rejects.toThrow('rollback voluto')
      const v = await put
      expect(v).toMatchObject({
        ultimoNumero: 50,
        numeroPartenza: 50,
        versione: esistente ? 2 : 1,
      })
      expect(await riga(tenantId, registroId)).toMatchObject({
        ultimo_numero: 50,
        ultima_data: '2026-01-31',
      })
    }
  )

  it('PUT non valido: numero negativo o non intero, data fuori anno o inesistente → 400', async () => {
    const { tenantId, utenteId, registroId } = await azienda()
    const prova = (numeroPartenza: number, dataPartenza: string | null) =>
      imposta(tenantId, utenteId, registroId, { numeroPartenza, dataPartenza, versione: 0 }).catch(
        e => e
      )
    for (const e of [
      await prova(-1, null),
      await prova(1.5, null),
      await prova(100_000_000, null),
      await prova(1, '2025-12-31'),
      await prova(1, '2026-02-30'),
    ]) {
      expect(e.getStatus?.()).toBe(400)
    }
    expect(await riga(tenantId, registroId)).toBeNull()
  })

  it('PUT su un registro di un altro tenant: 404', async () => {
    const a = await azienda()
    const b = await azienda()
    const err = await imposta(a.tenantId, a.utenteId, b.registroId, {
      numeroPartenza: 1,
      dataPartenza: null,
      versione: 0,
    }).catch(e => e)
    expect(err.getStatus?.()).toBe(404)
    expect(await riga(b.tenantId, b.registroId)).toBeNull()
  })

  it('PUT con dataPartenza futura (oltre oggi): 400 DATA_FUTURA, nulla scritto', async () => {
    const { tenantId, utenteId, registroId } = await azienda()
    const err = await imposta(
      tenantId,
      utenteId,
      registroId,
      { numeroPartenza: 1, dataPartenza: '2100-01-01', versione: 0 },
      2100
    ).catch(e => e)
    expect(err.getStatus?.()).toBe(400)
    expect(err.getResponse()).toMatchObject({ error: 'DATA_FUTURA' })
    expect(await riga(tenantId, registroId, 2100)).toBeNull()
  })

  it('PUT invariato su una coppia senza riga: non lascia nessuna riga e risponde versione 0', async () => {
    const { tenantId, utenteId, registroId } = await azienda()
    const v = await imposta(tenantId, utenteId, registroId, {
      numeroPartenza: 0,
      dataPartenza: null,
      versione: 0,
    })
    expect(v).toMatchObject({ numeroPartenza: 0, ultimoNumero: 0, versione: 0 })
    expect(await riga(tenantId, registroId)).toBeNull()
    expect(
      await owner.activityLog.count({
        where: { tenantId, action: 'NUMERAZIONE_FATTURA_PARTENZA_IMPOSTATA' },
      })
    ).toBe(0)
  })
})

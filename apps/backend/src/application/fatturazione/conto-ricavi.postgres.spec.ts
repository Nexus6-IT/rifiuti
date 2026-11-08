/**
 * Conto ricavi per centro di ricavo e categoria (fase 4.4c, Task 30b) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS FORCE). I codici dell'addebito sono fotografati sulle righe
 * del documento: l'anteprima li scrive, la definitiva li rilegge sotto lock, lo storno li copia,
 * dopo l'emissione nessuna modifica dell'addebito li cambia. Pulizia solo per id esatti.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t30b-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=10`

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaBancoT20, type BancoT20 } from '../../test-support/fatturazione-annullo-di-test'
import type { AziendaT18 } from '../../test-support/fatturazione-t18-di-test'
import {
  creaLegameDiTest,
  creaMovimentoDiTest,
  pulisciTenantDiTest,
} from '../../test-support/legami-di-test'
import { creaAddebito, creaRiga } from '../../test-support/listino-di-test'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { chiaveContoRicavi } from './adattatori/teamsystem.adattatore'

describe('Conto ricavi fotografato sulle righe — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  const tenantCreati: string[] = []

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    b.reset()
    b.servizio.orologio = () => new Date('2026-05-01T10:00:00Z')
  })
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  const codifica = (
    az: AziendaT18,
    genere: 'CENTRO_RICAVO' | 'CATEGORIA',
    codice: string
  ): Promise<{ id: string }> =>
    owner.codificaAddebito.create({
      data: { tenantId: az.tenantId, genere, codice, descrizione: `${genere} ${codice}` },
      select: { id: true },
    })

  const righeDocumento = (documentoId: string) =>
    owner.$queryRawUnsafe<
      {
        numero_linea: number
        tipo_riga: string
        riga_addebito_id: string | null
        centro_ricavo_codice: string | null
        categoria_codice: string | null
      }[]
    >(
      `SELECT numero_linea, tipo_riga::text, riga_addebito_id::text, centro_ricavo_codice,
              categoria_codice
       FROM righe_documento_fattura WHERE documento_id = $1::uuid ORDER BY numero_linea`,
      documentoId
    )

  /** Contratto con un solo legame confermato su una riga di listino `V` (addebito dell'archivio). */
  async function contrattoSuV(
    az: AziendaT18,
    rigaCentroId: string | null,
    rigaCategoriaId: string | null,
    addebitoCentroId: string | null,
    addebitoCategoriaId: string | null
  ) {
    const c = await b.t19.contratto(az, { senzaLegame: true })
    const addebito = await creaAddebito(owner, az.tenantId, {
      tipo: 'V',
      centroRicavoId: addebitoCentroId,
      categoriaId: addebitoCategoriaId,
    })
    const riga = await creaRiga(owner, az.tenantId, c.elencoId, {
      tipo: 'V',
      codiceIvaId: az.listino.iva22Id,
      addebitoId: addebito.id,
      altro: { centroRicavoId: rigaCentroId, categoriaId: rigaCategoriaId },
    })
    const m = await creaMovimentoDiTest(owner, az.tenantId, {
      movementDate: '2026-03-10',
      quantity: '100',
    })
    const l = await creaLegameDiTest(owner, az.tenantId, {
      movimentoOriginaleId: m.movimentoId,
      registroId: m.registroId,
      verso: m.type,
      stato: 'CONFERMATO',
      clienteId: c.clienteId,
      contrattoId: c.contrattoId,
      elencoId: c.elencoId,
      dataMovimento: '2026-03-10',
      righe: [
        { rigaAddebitoId: riga.id, codiceIvaId: az.listino.iva22Id, quantita: '100', prezzo: '1' },
      ],
    })
    return { ...c, rigaId: riga.id, addebitoId: addebito.id, legameId: l.legameId }
  }

  it("anteprima: i codici si scrivono dalla riga addebito; in mancanza dall'addebito, campo per campo; senza codici restano null", async () => {
    const az = await b.t19.azienda()
    const cr = await codifica(az, 'CENTRO_RICAVO', '010')
    const cat = await codifica(az, 'CATEGORIA', '020')
    const crAdd = await codifica(az, 'CENTRO_RICAVO', '011')
    const catAdd = await codifica(az, 'CATEGORIA', '021')

    // 1. i codici sono sulla riga di listino: vincono su quelli dell'addebito.
    const dallaRiga = await contrattoSuV(az, cr.id, cat.id, crAdd.id, catAdd.id)
    // 2. riga senza codici: dall'addebito.
    const dallAddebito = await contrattoSuV(az, null, null, crAdd.id, catAdd.id)
    // 3. solo il centro sulla riga: categoria dall'addebito (campo per campo).
    const misto = await contrattoSuV(az, cr.id, null, null, catAdd.id)
    // 4. nessun codice da nessuna parte.
    const nessuno = await contrattoSuV(az, null, null, null, null)

    const e = await b.t19.pronta(az)
    const docs = await b.t19.documenti(e.id)
    const per = new Map<string, (typeof docs)[number]>(docs.map(d => [d.contratto_id, d]))
    const codici = async (c: { contrattoId: string }) => {
      const righe = (await righeDocumento((per.get(c.contrattoId) as { id: string }).id)).filter(
        r => r.tipo_riga === 'MOVIMENTO'
      )
      expect(righe).toHaveLength(1)
      return [righe[0].centro_ricavo_codice, righe[0].categoria_codice]
    }
    expect(await codici(dallaRiga)).toEqual(['010', '020'])
    expect(await codici(dallAddebito)).toEqual(['011', '021'])
    expect(await codici(misto)).toEqual(['010', '021'])
    expect(await codici(nessuno)).toEqual([null, null])
  })

  it("definitiva: rilegge i codici sotto lock; dopo l'emissione una modifica dell'addebito non cambia la chiave del conto", async () => {
    const az = await b.t19.azienda()
    const cr = await codifica(az, 'CENTRO_RICAVO', '010')
    const cr2 = await codifica(az, 'CENTRO_RICAVO', '012')
    const cr3 = await codifica(az, 'CENTRO_RICAVO', '013')
    const c = await contrattoSuV(az, cr.id, null, null, null)
    const e = await b.t19.pronta(az)
    const [bozza] = await b.t19.documenti(e.id)
    expect((await righeDocumento(bozza.id)).find(r => r.tipo_riga === 'MOVIMENTO')).toMatchObject({
      centro_ricavo_codice: '010',
    })

    // Fra anteprima e definitiva il centro cambia (UPDATE grezzo: la versione della riga non si muove).
    await owner.$executeRawUnsafe(
      `UPDATE righe_addebito SET centro_ricavo_id = $2::uuid WHERE id = $1::uuid`,
      c.rigaId,
      cr2.id
    )
    const esito = await b.t19.definitiva(az, e)
    expect(esito.esito).toBe('DEFINITIVA')
    const dopoDefinitiva = await righeDocumento(bozza.id)
    expect(dopoDefinitiva.find(r => r.tipo_riga === 'MOVIMENTO')?.centro_ricavo_codice).toBe('012')

    // Dopo l'emissione il cambio non sposta nulla, ne' nel database ne' nella chiave dell'export.
    await owner.$executeRawUnsafe(
      `UPDATE righe_addebito SET centro_ricavo_id = $2::uuid WHERE id = $1::uuid`,
      c.rigaId,
      cr3.id
    )
    const dettaglio = await b.t19.nel(az.tenantId, () =>
      app.$transaction(tx =>
        new DocumentiFatturaService(app).dettagliInTx(tx, az.tenantId, [bozza.id])
      )
    )
    const riga = dettaglio[0].righe.find(r => r.tipoRiga === 'MOVIMENTO')
    expect(riga).toMatchObject({ centroRicavoCodice: '012', categoriaCodice: null })
    expect(chiaveContoRicavi(riga as never)).toBe('CR:012')
    expect(await righeDocumento(bozza.id)).toEqual(dopoDefinitiva)
  })

  it("storno TD04: eredita i codici dalle righe dell'origine, anche se l'addebito nel frattempo e cambiato", async () => {
    const az = await b.t19.azienda()
    const cr = await codifica(az, 'CENTRO_RICAVO', '010')
    const cat = await codifica(az, 'CATEGORIA', '020')
    const altro = await codifica(az, 'CENTRO_RICAVO', '019')
    const c = await contrattoSuV(az, cr.id, cat.id, null, null)
    const e = await b.t19.pronta(az)
    expect((await b.t19.definitiva(az, e)).esito).toBe('DEFINITIVA')
    const [origine] = await b.t19.documenti(e.id)
    await owner.$executeRawUnsafe(
      `UPDATE righe_addebito SET centro_ricavo_id = $2::uuid WHERE id = $1::uuid`,
      c.rigaId,
      altro.id
    )
    await b.storna(az, origine.id, {
      dataDocumento: '2026-04-20',
      rifatturabile: false,
      versione: await b.versioneDi(origine.id),
    })
    const td04 = await b.stornoDi(origine.id)
    expect(td04).toBeDefined()
    const righeStorno = await righeDocumento((td04 as { id: string }).id)
    const righeOrigine = await righeDocumento(origine.id)
    expect(righeStorno.length).toBeGreaterThan(0)
    expect(
      righeStorno.map(r => [r.numero_linea, r.centro_ricavo_codice, r.categoria_codice])
    ).toEqual(righeOrigine.map(r => [r.numero_linea, r.centro_ricavo_codice, r.categoria_codice]))
    expect(righeStorno.find(r => r.tipo_riga === 'MOVIMENTO')).toMatchObject({
      centro_ricavo_codice: '010',
      categoria_codice: '020',
    })
  })
})

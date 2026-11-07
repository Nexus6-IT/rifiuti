import { test, expect } from '@playwright/test'
import type { PrismaClient } from '@prisma/client'
import {
  clientDbLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { impostaFatturazioneDa, pulisciCreati, registraViaApi } from '../../utils/legami-api'
import {
  aggiungiRigaFEdElencoAlternativo,
  anteprimaPronta,
  chiama,
  creaListinoLegami,
  definitivaCompleta,
  dettaglioDocumento,
  documentiDi,
  giornoItaliano,
  leggiZip,
  ok,
  periodoDiProva,
  scarica,
  validaConScript,
  type Creato,
  type DocumentoDettaglioApi,
  type ListinoLegami,
} from '../../utils/fatturazione-api'

/**
 * E2E API — XML, emissione ed export della fatturazione (pezzo 4.4b2, Task 26b). Tutto via API,
 * contro backend, Postgres e Redis (BullMQ) reali. Stessa azienda di prova, stesso periodo e stesso
 * interruttore delle definitive del 26a (`fatturazione-api.spec.ts`): azienda propria creata in
 * `beforeAll`, interruttore acceso col client del proprietario del database (rotta ADMIN nella
 * 4.4c, scansione P34). Gli XML scaricati si validano con `apps/backend/scripts/valida-fatturapa.ts`
 * (XSD ufficiale), lanciato da `apps/backend` (scansione P45).
 *
 * Senza un database locale gli scenari si saltano con un messaggio esplicito. Documenti, numeri e
 * movimenti sono immutabili e restano, riconoscibili dall'azienda con il prefisso della run; le
 * anagrafiche e il listino si ripuliscono per id esatti in `afterAll`.
 */

const db = clientDbLocale()

test.describe('Fatturazione: XML, emissione ed export (API)', () => {
  test.skip(
    !db,
    'DATABASE_URL non e` un database locale: senza il client del proprietario non si crea ' +
      "l'azienda di test ne' si accende l'interruttore delle definitive (rotta ADMIN nella 4.4c)"
  )
  test.describe.configure({ mode: 'serial' })
  // Lo script di validazione parte con ts-node (qualche secondo a freddo) e gli scenari lo usano.
  test.setTimeout(180_000)

  const periodo = periodoDiProva()
  const creati: Creato[] = []
  let owner: PrismaClient
  let azienda: AziendaDiTest
  const tok = { admin: '', operator: '', viewer: '' }
  /** d1 viene emesso e stornato; d2 resta intatto fino all'XML_ZIP. */
  let d1: DocumentoDettaglioApi
  let d2: DocumentoDettaglioApi

  test.beforeAll(async () => {
    owner = db as PrismaClient
    azienda = await creaAziendaDiTest(owner, 'Fatturazione XML API')
    tok.admin = await tokenAzienda(azienda, 'admin')
    tok.operator = await tokenAzienda(azienda, 'operator')
    tok.viewer = await tokenAzienda(azienda, 'viewer')

    await owner.tenant.update({
      where: { id: azienda.tenantId },
      data: { civico: '10', reaNumber: '1234567' },
    })
    await ok('PUT', '/cedente-fatturazione', tok.admin, {
      regimeFiscale: 'RF01',
      reaUfficio: 'MI',
      statoLiquidazione: 'LN',
      versione: 0,
    })

    const l1: ListinoLegami = await creaListinoLegami(tok.admin, creati, {
      modalitaPagamento: 'MP01',
    })
    const l2: ListinoLegami = await creaListinoLegami(tok.admin, creati, {
      modalitaPagamento: 'MP01',
      registroIvaId: l1.registroIvaId,
    })
    await aggiungiRigaFEdElencoAlternativo(tok.admin, creati, l1, periodo.scadenzaF)
    await impostaFatturazioneDa(tok.admin, periodo.dal)
    for (const [l, kg] of [
      [l1, 20],
      [l2, 11],
    ] as const) {
      const m = await registraViaApi(tok.admin, {
        kg,
        legame: { azione: 'CONFERMA', clienteId: l.clienteId },
      })
      expect(m.legameId, 'il movimento nasce con un legame').toBeTruthy()
    }

    const n = await owner.$executeRawUnsafe(
      `UPDATE impostazioni_fatturazione SET definitive_attive = true WHERE tenant_id = $1::uuid`,
      azienda.tenantId
    )
    expect(n, 'riga delle impostazioni dell`azienda').toBe(1)

    const anteprima = await anteprimaPronta(tok.admin, periodo, giornoItaliano())
    expect(anteprima.documenti).toBe(2)
    await definitivaCompleta(tok.admin, anteprima)
    const elenco = (await documentiDi(tok.admin, anteprima.id)).elementi
    expect(elenco.every(x => x.stato === 'DEFINITIVO')).toBe(true)
    const dettagli = await Promise.all(elenco.map(x => dettaglioDocumento(tok.admin, x.id)))
    const perNumero = dettagli.sort(
      (a, b) => Number(a.numeroTesto?.split('/')[0]) - Number(b.numeroTesto?.split('/')[0])
    )
    ;[d1, d2] = perNumero
    expect(d1.emessoIl, 'd1 non ancora emesso').toBeNull()
    expect(d2.emessoIl, 'd2 non ancora emesso').toBeNull()
  })

  test.afterAll(async () => {
    if (!db) return
    try {
      const errori = await pulisciCreati(tok.admin, creati)
      if (errori.length > 0) console.warn(`[pulizia fatturazione-xml-api] ${errori.join('; ')}`)
    } finally {
      await db.$disconnect()
    }
  })

  test('XML con conferma: valido contro l`XSD, documento emesso, secondo download identico', async () => {
    const senza = await chiama<{ error: string }>(
      'POST',
      `/documenti-fattura/${d2.id}/xml`,
      tok.admin,
      { confermaEmissione: false }
    )
    expect(senza.stato, JSON.stringify(senza.corpo)).toBe(400)
    expect(senza.corpo.error).toBe('CONFERMA_EMISSIONE_RICHIESTA')
    expect((await dettaglioDocumento(tok.admin, d2.id)).emessoIl, 'd2 intatto').toBeNull()

    const r = await scarica('POST', `/documenti-fattura/${d1.id}/xml`, tok.admin, {
      confermaEmissione: true,
    })
    expect(r.stato, r.corpo.toString('utf8').slice(0, 300)).toBe(200)
    expect(r.tipo).toContain('xml')
    expect(r.corpo.toString('utf8').startsWith('<?xml')).toBe(true)
    const esito = validaConScript(r.corpo)
    expect(esito.valido, `XSD: ${esito.messaggi}`).toBe(true)

    const dopo = await dettaglioDocumento(tok.admin, d1.id)
    expect(dopo.emessoIl, 'documento emesso').not.toBeNull()
    expect(dopo.xmlGenerato).toBe(true)

    const ancora = await scarica('POST', `/documenti-fattura/${d1.id}/xml`, tok.admin, {
      confermaEmissione: true,
    })
    expect(ancora.stato).toBe(200)
    expect(ancora.corpo.equals(r.corpo), 'stessi byte: il nome file e i dati non cambiano').toBe(
      true
    )
    d1 = dopo
  })

  test('annullo dopo l`emissione: 409 ANNULLO_NON_AMMESSO con motivo EMESSO', async () => {
    const r = await chiama<{ error: string; details?: { motivo?: string } }>(
      'POST',
      `/documenti-fattura/${d1.id}/annulla`,
      tok.admin,
      { motivo: 'Prova e2e: annullo di un emesso', versione: d1.versione }
    )
    expect(r.stato, JSON.stringify(r.corpo)).toBe(409)
    expect(r.corpo.error).toBe('ANNULLO_NON_AMMESSO')
    expect(r.corpo.details?.motivo).toBe('EMESSO')
    expect((await dettaglioDocumento(tok.admin, d1.id)).stato, 'nulla cambia').toBe('DEFINITIVO')
  })

  test('storno del documento emesso: l`XML della nota di credito TD04 e` valido', async () => {
    const fresco = await dettaglioDocumento(tok.admin, d1.id)
    expect(fresco.stornabile).toBe(true)
    const s = await chiama('POST', `/documenti-fattura/${d1.id}/storno`, tok.admin, {
      motivo: 'Prova e2e: storno di un documento emesso',
      dataDocumento: giornoItaliano(),
      rifatturabile: false,
      versione: fresco.versione,
    })
    expect(s.stato, JSON.stringify(s.corpo)).toBe(200)
    const dopo = await dettaglioDocumento(tok.admin, d1.id)
    expect(dopo.stornoId).toBeTruthy()
    const nota = await dettaglioDocumento(tok.admin, dopo.stornoId!)
    expect(nota.tipoDocumento).toBe('TD04')
    expect(nota.documentoOrigineId).toBe(d1.id)

    const r = await scarica('POST', `/documenti-fattura/${nota.id}/xml`, tok.admin, {
      confermaEmissione: true,
    })
    expect(r.stato, r.corpo.toString('utf8').slice(0, 300)).toBe(200)
    const xml = r.corpo.toString('utf8')
    expect(xml, 'tipo documento nel file').toContain('<TipoDocumento>TD04</TipoDocumento>')
    const esito = validaConScript(r.corpo)
    expect(esito.valido, `XSD: ${esito.messaggi}`).toBe(true)
  })

  test('export CSV: zip con testate.csv e righe.csv', async () => {
    const r = await scarica('POST', '/documenti-fattura/export', tok.admin, {
      formato: 'CSV',
      selezione: { documentoIds: [d1.id, d2.id] },
    })
    expect(r.stato, r.corpo.toString('utf8').slice(0, 300)).toBe(200)
    expect(r.intestazioni.get('content-disposition') ?? '').toContain('attachment')
    const file = leggiZip(r.corpo)
    expect([...file.keys()].sort()).toEqual(['righe.csv', 'testate.csv'])
    const testate = file.get('testate.csv')!.toString('utf8')
    expect(testate.charCodeAt(0), 'UTF-8 con BOM').toBe(0xfeff)
    const righeTestate = testate.split(/\r?\n/).filter(x => x.length > 0)
    expect(righeTestate.length, 'intestazione + 2 documenti').toBeGreaterThanOrEqual(3)
    expect(righeTestate[1]).toContain('";"')
    expect(
      file.get('righe.csv')!.toString('utf8').split(/\r?\n/).filter(Boolean).length
    ).toBeGreaterThan(2)
  })

  test('export XML_ZIP con conferma: i file sono validi e il documento risulta emesso', async () => {
    const r = await scarica('POST', '/documenti-fattura/export', tok.admin, {
      formato: 'XML_ZIP',
      selezione: { documentoIds: [d2.id] },
      confermaEmissione: true,
    })
    expect(r.stato, r.corpo.toString('utf8').slice(0, 300)).toBe(200)
    expect(r.intestazioni.get('x-documenti-saltati')).toBe('0')
    const file = leggiZip(r.corpo)
    const xml = [...file.entries()].filter(([nome]) => nome.endsWith('.xml'))
    expect(xml, 'un file XML per documento').toHaveLength(1)
    for (const [nome, contenuto] of xml) {
      const esito = validaConScript(contenuto)
      expect(esito.valido, `${nome}: ${esito.messaggi}`).toBe(true)
    }
    expect((await dettaglioDocumento(tok.admin, d2.id)).emessoIl, 'd2 emesso').not.toBeNull()
  })

  test('VIEWER 403 su xml, OPERATOR 403 su xml ed emesso (e su XML_ZIP)', async () => {
    const corpoXml = { confermaEmissione: true }
    const viewer = await chiama('POST', `/documenti-fattura/${d2.id}/xml`, tok.viewer, corpoXml)
    expect(viewer.stato, JSON.stringify(viewer.corpo)).toBe(403)
    const opXml = await chiama('POST', `/documenti-fattura/${d2.id}/xml`, tok.operator, corpoXml)
    expect(opXml.stato, JSON.stringify(opXml.corpo)).toBe(403)
    const fresco = await dettaglioDocumento(tok.admin, d2.id)
    const opEmesso = await chiama('POST', `/documenti-fattura/${d2.id}/emesso`, tok.operator, {
      versione: fresco.versione,
    })
    expect(opEmesso.stato, JSON.stringify(opEmesso.corpo)).toBe(403)
    const opZip = await chiama('POST', '/documenti-fattura/export', tok.operator, {
      formato: 'XML_ZIP',
      selezione: { documentoIds: [d2.id] },
      confermaEmissione: true,
    })
    expect(opZip.stato, JSON.stringify(opZip.corpo)).toBe(403)
    // Nulla e` cambiato per colpa delle richieste respinte.
    expect((await dettaglioDocumento(tok.admin, d2.id)).versione).toBe(fresco.versione)
  })
})

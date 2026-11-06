import { test, expect } from '@playwright/test'
import type { PrismaClient } from '@prisma/client'
import {
  clientDbLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import {
  CHIAVI_DOCUMENTO_DETTAGLIO,
  CHIAVI_DOCUMENTO_RIGA,
  CHIAVI_ELABORAZIONE_DETTAGLIO,
  CHIAVI_RIGA_DOCUMENTO,
  CHIAVI_SCOSTAMENTO_RIGA,
} from '../../../apps/frontend/src/app/features/fatturazione/fatturazione.model'
import { impostaFatturazioneDa, pulisciCreati, registraViaApi } from '../../utils/legami-api'
import type { LegameVista } from '../../utils/legami-api'
import {
  aggiungiRigaFEdElencoAlternativo,
  anteprimaPronta,
  attendiElaborazione,
  chiama,
  chiaviUguali,
  creaListinoLegami,
  definitivaCompleta,
  dettaglioDocumento,
  documentiDi,
  giornoItaliano,
  ok,
  periodoDiProva,
  type Creato,
  type DocumentoApi,
  type ElaborazioneApi,
  type ListinoLegami,
  type NumerazioneApi,
  type PaginaApi,
  type ScostamentoApi,
} from '../../utils/fatturazione-api'
import { conPrefissoUnico } from '../../utils/run-id'

/**
 * E2E API — Fatturazione per periodo (pezzo 4.4b1, Task 26a). Tutto via API, contro backend,
 * Postgres e Redis (BullMQ) reali; nessuna interfaccia.
 *
 * Isolamento: azienda di test DEDICATA creata in `beforeAll` (stesso schema degli altri spec),
 * con cedente completo, registro IVA, cliente con P.IVA valida, contratto ATTIVO, un elenco con
 * una riga CER e una riga `F` con scadenza nel periodo. L'interruttore delle definitive
 * (`impostazioni_fatturazione.definitive_attive`) si accende col client del proprietario del
 * database, perche' la rotta ADMIN che lo governa nasce nella 4.4c (scansione P34).
 *
 * Senza un database locale (`DATABASE_URL` non locale) non si puo' creare l'azienda ne' accendere
 * l'interruttore: tutto lo spec si salta con un messaggio esplicito. Il rapporto del Task 27a
 * riporta se in CI sono stati saltati.
 *
 * Pulizia: documenti, numeri e movimenti sono immutabili (trigger, catena di hash) e restano,
 * riconoscibili dall'azienda con il prefisso della run; le anagrafiche e il listino si ripuliscono
 * per id esatti in `afterAll`.
 */

const db = clientDbLocale()

test.describe('Fatturazione per periodo (API)', () => {
  test.skip(
    !db,
    'DATABASE_URL non e` un database locale: senza il client del proprietario non si crea ' +
      "l'azienda di test ne' si accende l'interruttore delle definitive (rotta ADMIN nella 4.4c)"
  )
  test.describe.configure({ mode: 'serial' })

  const periodo = periodoDiProva()
  const dataDocumento = giornoItaliano()
  const creati: Creato[] = []
  let owner: PrismaClient
  let azienda: AziendaDiTest
  let listino: ListinoLegami
  let listino2: ListinoLegami
  const elenchi: Record<string, { alternativo: string; predefinito: string }> = {}
  const tok = { admin: '', operator: '', viewer: '' }

  // Stato condiviso fra i test seriali.
  let anteprima1: ElaborazioneApi
  let legame1: { legameId: string; movimentoId: string }
  let legame2: { legameId: string; movimentoId: string }
  let superata: { id: string; versione: number }
  let elaborazione1Definitiva: ElaborazioneApi
  const chiaviViste: {
    dettaglio?: Record<string, unknown>
    documentoRiga?: Record<string, unknown>
    documentoDettaglio?: Record<string, unknown>
    riga?: Record<string, unknown>
    scostamento?: Record<string, unknown>
  } = {}

  const registraConfermato = (kg: number, clienteId = listino.clienteId) =>
    registraViaApi(tok.admin, { kg, legame: { azione: 'CONFERMA', clienteId } })

  /** Id dei legami con righe MOVIMENTO di un documento. */
  const legamiDelDocumento = async (documentoId: string): Promise<string[]> =>
    (await dettaglioDocumento(tok.admin, documentoId)).righe
      .filter(r => r.tipoRiga === 'MOVIMENTO' && r.legameId !== null)
      .map(r => r.legameId as string)

  const legame = (id: string) => ok<LegameVista>('GET', `/legami-movimento/${id}`, tok.admin)
  const numerazioni = () => ok<NumerazioneApi[]>('GET', '/numerazioni-fattura', tok.admin)

  test.beforeAll(async () => {
    owner = db as PrismaClient
    azienda = await creaAziendaDiTest(owner, 'Fatturazione API')
    tok.admin = await tokenAzienda(azienda, 'admin')
    tok.operator = await tokenAzienda(azienda, 'operator')
    tok.viewer = await tokenAzienda(azienda, 'viewer')

    // Cedente completo: sede e numero REA sul tenant, regime e REA nella scheda del cedente.
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

    // Contanti (MP01): una modalita` bancaria richiederebbe un conto corrente del cedente.
    listino = await creaListinoLegami(tok.admin, creati, { modalitaPagamento: 'MP01' })
    // Secondo contratto e secondo cliente sullo STESSO registro IVA: la definitiva numera 1 e 2.
    listino2 = await creaListinoLegami(tok.admin, creati, {
      modalitaPagamento: 'MP01',
      registroIvaId: listino.registroIvaId,
    })
    for (const [l, scadenza] of [
      [listino, periodo.scadenzaF],
      [listino2, null],
    ] as const) {
      const { elencoAlternativoId } = await aggiungiRigaFEdElencoAlternativo(
        tok.admin,
        creati,
        l,
        scadenza
      )
      elenchi[l.clienteId] = { alternativo: elencoAlternativoId, predefinito: l.elencoId }
    }
    // «Fatturazione da» = inizio del periodo; le definitive restano spente (default).
    await impostaFatturazioneDa(tok.admin, periodo.dal)

    legame1 = await (async () => {
      const m = await registraConfermato(20)
      expect(m.legameId, 'il movimento nasce con un legame').toBeTruthy()
      return { legameId: m.legameId!, movimentoId: m.movimentoId }
    })()
    expect((await legame(legame1.legameId)).stato).toBe('CONFERMATO')
    const m2 = await registraConfermato(11, listino2.clienteId)
    expect(m2.legameId, 'il secondo movimento nasce con un legame').toBeTruthy()
    legame2 = { legameId: m2.legameId!, movimentoId: m2.movimentoId }
  })

  test.afterAll(async () => {
    if (!db) return
    try {
      const errori = await pulisciCreati(tok.admin, creati)
      // Documenti definitivi e movimenti sono immutabili: contratto, cliente e righe in uso si
      // annullano/disattivano; un errore qui non invalida i test gia` passati.
      if (errori.length > 0) console.warn(`[pulizia fatturazione-api] ${errori.join('; ')}`)
    } finally {
      await db.$disconnect()
    }
  })

  test('elaborazione completa: avvio 202, attesa ANTEPRIMA_PRONTA, documento con righe MOVIMENTO e FISSO', async () => {
    anteprima1 = await anteprimaPronta(tok.admin, periodo, dataDocumento)
    expect(anteprima1.definitiveAttive, 'interruttore ancora spento').toBe(false)
    expect(anteprima1.erroriGenerali).toEqual([])
    expect(anteprima1.errore).toBeNull()
    expect(anteprima1.documenti).toBe(2)
    expect(anteprima1.impronta).toMatch(/^[0-9a-f]{64}$/)
    chiaviViste.dettaglio = anteprima1 as unknown as Record<string, unknown>

    const pagina = await documentiDi(tok.admin, anteprima1.id)
    expect(pagina.totale).toBe(2)
    const dettagli = await Promise.all(
      pagina.elementi.map(x => dettaglioDocumento(tok.admin, x.id))
    )
    const d = dettagli.find(x => x.righe.some(r => r.legameId === legame1.legameId))!
    const bozza = pagina.elementi.find(x => x.id === d.id)!
    expect(bozza.stato).toBe('BOZZA')
    expect(bozza.numeroTesto).toBeNull()
    expect(bozza.errori).toEqual([])
    chiaviViste.documentoRiga = bozza as unknown as Record<string, unknown>

    const tipi = d.righe.map(r => r.tipoRiga)
    expect(tipi, 'righe di movimento').toContain('MOVIMENTO')
    expect(tipi, 'riga fissa con scadenza nel periodo').toContain('FISSO')
    const riga = d.righe.find(r => r.tipoRiga === 'MOVIMENTO')!
    expect(riga.legameId).toBe(legame1.legameId)
    chiaviViste.documentoDettaglio = d as unknown as Record<string, unknown>
    chiaviViste.riga = riga as unknown as Record<string, unknown>
  })

  test('definitiva con l`interruttore ancora spento: 409 DEFINITIVE_NON_ATTIVE', async () => {
    const r = await chiama<{ error: string }>(
      'POST',
      `/elaborazioni-fatturazione/${anteprima1.id}/definitiva`,
      tok.admin,
      { impronta: anteprima1.impronta, versione: anteprima1.versione }
    )
    expect(r.stato, JSON.stringify(r.corpo)).toBe(409)
    expect(r.corpo.error).toBe('DEFINITIVE_NON_ATTIVE')
    const dopo = await ok<ElaborazioneApi>(
      'GET',
      `/elaborazioni-fatturazione/${anteprima1.id}`,
      tok.admin
    )
    expect(dopo.stato, 'l`anteprima resta pronta').toBe('ANTEPRIMA_PRONTA')
  })

  test('definitiva: numeri 1..n, legami FATTURATO', async () => {
    // Rotta ADMIN dell'interruttore: nasce nella 4.4c (P34); qui col proprietario, per id esatto.
    const n = await owner.$executeRawUnsafe(
      `UPDATE impostazioni_fatturazione SET definitive_attive = true WHERE tenant_id = $1::uuid`,
      azienda.tenantId
    )
    expect(n, 'riga delle impostazioni dell`azienda').toBe(1)

    elaborazione1Definitiva = await definitivaCompleta(tok.admin, anteprima1)
    expect(elaborazione1Definitiva.stato).toBe('DEFINITIVA')

    const pagina = await documentiDi(tok.admin, anteprima1.id)
    expect(pagina.elementi).toHaveLength(2)
    expect(pagina.elementi.every(x => x.stato === 'DEFINITIVO')).toBe(true)
    expect(new Set(pagina.elementi.map(x => x.registro.id)).size, 'stesso registro').toBe(1)
    const numeri = pagina.elementi
      .map(x => Number(x.numeroTesto?.split('/')[0] ?? NaN))
      .sort((a, b) => a - b)
    expect(numeri, 'numeri progressivi senza buchi, da 1').toEqual([1, 2])
    expect((await legame(legame1.legameId)).stato).toBe('FATTURATO')
    expect((await legame(legame2.legameId)).stato).toBe('FATTURATO')
    const num = (await numerazioni()).find(x => x.registroIvaId === pagina.elementi[0].registro.id)
    expect(num?.ultimoNumero).toBe(2)
  })

  test('annullo dell`ultimo non emesso: ANNULLATO, numero rilasciato; il legame si conferma di nuovo con cambio di elenco senza errori', async () => {
    // Solo l'ultimo numero del registro e` annullabile: lo si trova, non lo si presume.
    const elenco = (await documentiDi(tok.admin, anteprima1.id)).elementi
    const annullabili = elenco.filter(x => x.annullabile)
    expect(annullabili, 'un solo documento annullabile: l`ultimo numero').toHaveLength(1)
    expect(elenco.find(x => !x.annullabile)?.motivoNonAnnullabile).toBe('NON_ULTIMO')
    const d = await dettaglioDocumento(tok.admin, annullabili[0].id)
    const [legameAnnullatoId] = await legamiDelDocumento(d.id)
    const r = await chiama<{ stato: string }>(
      'POST',
      `/documenti-fattura/${d.id}/annulla`,
      tok.admin,
      { motivo: 'Prova e2e: annullo dell`ultimo numero', versione: d.versione }
    )
    expect(r.stato, JSON.stringify(r.corpo)).toBe(200)
    expect((await dettaglioDocumento(tok.admin, d.id)).stato).toBe('ANNULLATO')

    const num = (await numerazioni()).find(x => x.registroIvaId === d.registro.id)
    expect(num?.ultimoNumero, 'numero rilasciato: da 2 a 1').toBe(1)

    // Q1: il legame torna lavorabile e si ri-conferma cambiando elenco, senza errori.
    const l = await legame(legameAnnullatoId)
    expect(l.stato).not.toBe('FATTURATO')
    const elencoDi = elenchi[l.cliente!.id]
    const conf = await chiama<LegameVista>(
      'POST',
      `/legami-movimento/${l.id}/conferma`,
      tok.admin,
      { versione: l.versione, modifiche: { elencoId: elencoDi.alternativo } }
    )
    expect(conf.stato, JSON.stringify(conf.corpo)).toBe(200)
    expect(conf.corpo.stato).toBe('CONFERMATO')
    // Rimessa sull'elenco predefinito per gli scenari successivi.
    const l2 = await legame(l.id)
    const indietro = await chiama<LegameVista>(
      'POST',
      `/legami-movimento/${l.id}/conferma`,
      tok.admin,
      { versione: l2.versione, modifiche: { elencoId: elencoDi.predefinito } }
    )
    expect(indietro.stato, JSON.stringify(indietro.corpo)).toBe(200)
  })

  test('rettifica di un movimento fatturato → scostamento in lista → storno rifatturabile → riallineamento → nuova elaborazione e definitiva', async () => {
    // Rifattura il legame annullato: dopo questa definitiva tutti e due i legami sono FATTURATO.
    test.setTimeout(180_000)
    const a = await anteprimaPronta(tok.admin, periodo, dataDocumento)
    expect(a.documenti).toBe(1)
    await definitivaCompleta(tok.admin, a)
    expect((await legame(legame1.legameId)).stato).toBe('FATTURATO')
    expect((await legame(legame2.legameId)).stato).toBe('FATTURATO')
    // Il documento definitivo di legame1: nella prima elaborazione o in questa.
    const candidati = [
      ...(await documentiDi(tok.admin, anteprima1.id)).elementi,
      ...(await documentiDi(tok.admin, a.id)).elementi,
    ]
    let doc: DocumentoApi | undefined
    for (const c of candidati) {
      const d = await dettaglioDocumento(tok.admin, c.id)
      if (d.stato === 'DEFINITIVO' && d.righe.some(r => r.legameId === legame1.legameId)) doc = c
    }
    expect(doc, 'documento definitivo del legame 1').toBeTruthy()
    doc = doc as DocumentoApi
    expect(doc.stato).toBe('DEFINITIVO')

    // Rettifica della quantita` del movimento gia` fatturato.
    const rett = await chiama<{ id?: string; movimento?: { id: string } }>(
      'POST',
      `/registro/movimenti/${legame1.movimentoId}/rettifica`,
      tok.admin,
      {
        motivo: 'Peso corretto dopo la fattura',
        movementDate: giornoItaliano(),
        causale: 'INGRESSO_ESTERNO',
        cerCode: '15 01 01',
        quantity: 25,
        unit: 'KG',
        counterpartName: conPrefissoUnico('Controparte fatturazione'),
      }
    )
    expect(rett.stato, JSON.stringify(rett.corpo)).toBe(201)
    const testaId = rett.corpo.id ?? rett.corpo.movimento?.id
    expect(testaId, 'movimento rettificato (testa della catena)').toBeTruthy()

    // Scostamento in lista.
    const lista = await ok<PaginaApi<ScostamentoApi>>(
      'GET',
      '/scostamenti-fattura?pagina=1&dimensione=50',
      tok.admin
    )
    const sc = lista.elementi.find(x => x.legameId === legame1.legameId)
    expect(sc, 'scostamento del legame rettificato').toBeTruthy()
    expect(sc!.documento.id).toBe(doc.id)
    chiaviViste.scostamento = sc as unknown as Record<string, unknown>

    // Storno rifatturabile: nota di credito, i legami tornano lavorabili.
    const d = await dettaglioDocumento(tok.admin, doc.id)
    expect(d.stornabile).toBe(true)
    const storno = await chiama('POST', `/documenti-fattura/${d.id}/storno`, tok.admin, {
      motivo: 'Prova e2e: storno per rettifica',
      dataDocumento: giornoItaliano(),
      rifatturabile: true,
      versione: d.versione,
    })
    expect(storno.stato, JSON.stringify(storno.corpo)).toBe(200)
    const dopoStorno = await dettaglioDocumento(tok.admin, d.id)
    expect(dopoStorno.stornoId, 'documento di storno collegato').toBeTruthy()
    const nota = await dettaglioDocumento(tok.admin, dopoStorno.stornoId!)
    expect(nota.tipoDocumento).toBe('TD04')
    expect(nota.documentoOrigineId).toBe(d.id)

    const scDopo = await ok<PaginaApi<ScostamentoApi>>(
      'GET',
      '/scostamenti-fattura?pagina=1&dimensione=50',
      tok.admin
    )
    expect(
      scDopo.elementi.some(x => x.legameId === legame1.legameId),
      'scostamento chiuso'
    ).toBe(false)

    // Riallineamento (4.3): dopo lo storno il legame e` indietro rispetto alla testa della catena
    // (S6); «Riallinea» lo porta al movimento rettificato, poi si conferma.
    let l = await legame(legame1.legameId)
    expect(l.stato).toBe('CONFERMATO')
    expect(l.movimentoVigenteId, 'legame indietro rispetto alla testa').not.toBe(testaId)
    const riall = await chiama('POST', `/legami-movimento/da-movimento/${testaId}`, tok.admin)
    expect(riall.stato, JSON.stringify(riall.corpo)).toBe(200)
    l = await legame(legame1.legameId)
    expect(l.movimentoVigenteId).toBe(testaId)
    if (l.stato !== 'CONFERMATO') {
      const c = await chiama('POST', `/legami-movimento/${l.id}/conferma`, tok.admin, {
        versione: l.versione,
      })
      expect(c.stato, JSON.stringify(c.corpo)).toBe(200)
      l = await legame(l.id)
    }
    expect(l.stato).toBe('CONFERMATO')
    expect(Number(l.righe.find(r => r.origine === 'PRINCIPALE')!.quantita)).toBe(25)

    // Nuova elaborazione e definitiva.
    const b = await anteprimaPronta(tok.admin, periodo, dataDocumento)
    expect(b.documenti).toBeGreaterThanOrEqual(1)
    await definitivaCompleta(tok.admin, b)
    expect((await legame(legame1.legameId)).stato).toBe('FATTURATO')
  })

  test('ANTEPRIMA_SUPERATA: un movimento confermato dopo l`anteprima', async () => {
    // Un movimento da fatturare c'e` gia` all'anteprima (altrimenti non ci sarebbe nulla da definire).
    await registraConfermato(3)
    const a = await anteprimaPronta(tok.admin, periodo, dataDocumento)
    expect(a.documenti).toBe(1)
    // Un movimento nuovo, confermato DOPO l'anteprima, cambia la selezione e quindi l'impronta.
    const nuovo = await registraConfermato(7)
    expect(nuovo.legameId).toBeTruthy()
    // Il 409 sincrono confronta solo l'impronta del corpo con quella salvata (elaborazioni.service.ts,
    // chiediDefinitiva): qui coincidono, quindi la richiesta e` accettata (202). La differenza dei
    // dati la scopre il job (definitiva.ts) e la scrive in `errore`, riportando ANTEPRIMA_PRONTA.
    const r = await chiama('POST', `/elaborazioni-fatturazione/${a.id}/definitiva`, tok.admin, {
      impronta: a.impronta,
      versione: a.versione,
    })
    expect(r.stato, JSON.stringify(r.corpo)).toBe(202)
    const dopo = await attendiElaborazione(tok.admin, a.id, ['ANTEPRIMA_PRONTA', 'DEFINITIVA'])
    expect(dopo.stato).toBe('ANTEPRIMA_PRONTA')
    expect(dopo.errore?.codice).toBe('ANTEPRIMA_SUPERATA')
    expect((await legame(nuovo.legameId!)).stato, 'il nuovo movimento non e` fatturato').toBe(
      'CONFERMATO'
    )
    superata = { id: a.id, versione: dopo.versione }
  })

  test('ANTEPRIMA_SUPERATA sincrono: impronta del corpo diversa da quella salvata, 409 e nulla cambia', async () => {
    const vecchia = await chiama<{ error: string }>(
      'POST',
      `/elaborazioni-fatturazione/${superata.id}/definitiva`,
      tok.admin,
      { impronta: '0'.repeat(64), versione: superata.versione }
    )
    expect(vecchia.stato, JSON.stringify(vecchia.corpo)).toBe(409)
    expect(vecchia.corpo.error).toBe('ANTEPRIMA_SUPERATA')
    const e = await ok<ElaborazioneApi>(
      'GET',
      `/elaborazioni-fatturazione/${superata.id}`,
      tok.admin
    )
    expect(e.stato).toBe('ANTEPRIMA_PRONTA')
    expect(e.versione, 'versione invariata: nessun job accodato').toBe(superata.versione)
    // Pulizia dello stato: l'anteprima superata si scarta.
    const s = await chiama('POST', `/elaborazioni-fatturazione/${superata.id}/scarta`, tok.admin, {
      versione: superata.versione,
    })
    expect(s.stato, JSON.stringify(s.corpo)).toBe(200)
  })

  test('VIEWER 403 su avvio, OPERATOR 403 su definitiva', async () => {
    const corpo = {
      periodoDal: periodo.dal,
      periodoAl: periodo.al,
      dataDocumento,
      raggruppamento: 'PER_CONTRATTO',
      includiArretrati: false,
      filtri: {},
    }
    const viewer = await chiama('POST', '/elaborazioni-fatturazione', tok.viewer, corpo)
    expect(viewer.stato, JSON.stringify(viewer.corpo)).toBe(403)
    const operatore = await chiama(
      'POST',
      `/elaborazioni-fatturazione/${anteprima1.id}/definitiva`,
      tok.operator,
      { impronta: anteprima1.impronta, versione: anteprima1.versione }
    )
    expect(operatore.stato, JSON.stringify(operatore.corpo)).toBe(403)
    // La lettura resta aperta a tutti i ruoli.
    const lettura = await chiama(
      'GET',
      '/elaborazioni-fatturazione?pagina=1&dimensione=5',
      tok.viewer
    )
    expect(lettura.stato).toBe(200)
  })

  test('chiavi delle risposte reali uguali alle costanti CHIAVI_* del modello del frontend (Q21)', async () => {
    chiaviUguali(
      'ElaborazioneDettaglio',
      chiaviViste.dettaglio ?? {},
      CHIAVI_ELABORAZIONE_DETTAGLIO
    )
    chiaviUguali('DocumentoRiga', chiaviViste.documentoRiga ?? {}, CHIAVI_DOCUMENTO_RIGA)
    chiaviUguali(
      'DocumentoDettaglio',
      chiaviViste.documentoDettaglio ?? {},
      CHIAVI_DOCUMENTO_DETTAGLIO
    )
    chiaviUguali('RigaDocumentoVista', chiaviViste.riga ?? {}, CHIAVI_RIGA_DOCUMENTO)
    chiaviUguali('ScostamentoRiga', chiaviViste.scostamento ?? {}, CHIAVI_SCOSTAMENTO_RIGA)
  })
})

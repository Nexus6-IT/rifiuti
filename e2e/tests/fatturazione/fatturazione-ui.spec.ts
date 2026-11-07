import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'fs'
import type { PrismaClient } from '@prisma/client'
import {
  clientDbLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER, attendiRisposta, cliccaEAttendi } from '../../utils/attese'
import { impostaFatturazioneDa, pulisciCreati, registraViaApi } from '../../utils/legami-api'
import {
  aggiungiRigaFEdElencoAlternativo,
  chiama,
  creaListinoLegami,
  dettaglioDocumento,
  documentiDi,
  giornoItaliano,
  leggiZip,
  ok,
  periodoDiProva,
  type Creato,
  type DocumentoApi,
  type ListinoLegami,
  type NumerazioneApi,
} from '../../utils/fatturazione-api'
import { FatturazionePage } from '../../pages/fatturazione.page'
import { testoPdf } from '../../utils/pdf'
import { conPrefissoUnico } from '../../utils/run-id'
import {
  ERRORI_GENERALI_VOCI,
  ERRORI_HTTP_VOCI,
} from '../../../apps/frontend/src/app/features/fatturazione/vocabolario-fatturazione'

/**
 * E2E dell'interfaccia di fatturazione (pezzo 4.4c, Task 36). I dati si preparano via API (come
 * nei Task 26a e 26b), le azioni sotto prova si fanno dalla UI con Playwright.
 *
 * Isolamento: AZIENDA DI TEST PROPRIA (`creaAziendaDiTest`), tre clienti con contratto sullo
 * stesso registro IVA, mai «Azienda Test SRL». L'interruttore delle definitive nasce SPENTO e lo
 * accende l'ADMIN dalla UI (Task 35b); la pulizia lo spegne, solo per l'azienda creata qui.
 * Senza un database locale (`DATABASE_URL`) lo spec si salta.
 *
 * Pulizia: documenti, numeri e movimenti sono immutabili (trigger, catena di hash) e restano,
 * riconoscibili dall'azienda con il prefisso della run; le anagrafiche e il listino si ripuliscono
 * per id esatti in `afterAll`.
 */

const db = clientDbLocale()

test.describe('Fatturazione per periodo (interfaccia)', () => {
  test.skip(
    !db,
    'DATABASE_URL non e` un database locale: senza il client del proprietario non si crea ' +
      "l'azienda di test"
  )
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  const periodo = periodoDiProva()
  const dataDocumento = giornoItaliano()
  const creati: Creato[] = []
  let owner: PrismaClient
  let azienda: AziendaDiTest
  const listini: ListinoLegami[] = []
  const tok = { admin: '', operator: '', viewer: '' }
  let fp: FatturazionePage
  let page: Page

  // Stato condiviso fra i test seriali.
  let elaborazioneId = ''
  let documenti: DocumentoApi[] = []
  const movimenti: { legameId: string; movimentoId: string; kg: number }[] = []

  const numerazioni = () => ok<NumerazioneApi[]>('GET', '/numerazioni-fattura', tok.admin)

  const definitiveAttive = async (): Promise<boolean> => {
    const r = await owner.$queryRawUnsafe<{ definitive_attive: boolean }[]>(
      `SELECT definitive_attive FROM impostazioni_fatturazione WHERE tenant_id = $1::uuid`,
      azienda.tenantId
    )
    return r[0]?.definitive_attive === true
  }

  test.beforeAll(async ({ browser }) => {
    owner = db as PrismaClient
    azienda = await creaAziendaDiTest(owner, 'Fatturazione UI')
    tok.admin = await tokenAzienda(azienda, 'admin')
    tok.operator = await tokenAzienda(azienda, 'operator')
    tok.viewer = await tokenAzienda(azienda, 'viewer')

    // Tre clienti con contratto sullo STESSO registro IVA. Cedente volutamente INCOMPLETO (senza
    // civico e numero REA del tenant, senza scheda del cedente): lo completa il secondo test.
    for (let i = 0; i < 3; i++) {
      const l = await creaListinoLegami(tok.admin, creati, {
        modalitaPagamento: 'MP01',
        ...(i > 0 ? { registroIvaId: listini[0].registroIvaId } : {}),
      })
      await aggiungiRigaFEdElencoAlternativo(
        tok.admin,
        creati,
        l,
        i === 0 ? periodo.scadenzaF : null
      )
      listini.push(l)
    }
    await impostaFatturazioneDa(tok.admin, periodo.dal)
    for (const [i, kg] of [20, 11, 7].entries()) {
      const m = await registraViaApi(tok.admin, {
        kg,
        legame: { azione: 'CONFERMA', clienteId: listini[i].clienteId },
      })
      expect(m.legameId, 'il movimento nasce con un legame').toBeTruthy()
      movimenti.push({ legameId: m.legameId!, movimentoId: m.movimentoId, kg })
    }
    // Un movimento registrato SENZA legame: finisce fra gli errori del periodo.
    await registraViaApi(tok.admin, { kg: 3 })

    page = await (await browser.newContext()).newPage()
    fp = new FatturazionePage(page)
    tok.admin = await fp.accedi(azienda, 'admin')
  })

  test.afterAll(async () => {
    if (!db) return
    try {
      // Interruttore: lo spegne solo per l'azienda creata da questo spec.
      if (azienda) {
        await owner.$executeRawUnsafe(
          `UPDATE impostazioni_fatturazione SET definitive_attive = false WHERE tenant_id = $1::uuid`,
          azienda.tenantId
        )
      }
      const errori = await pulisciCreati(tok.admin, creati)
      if (errori.length > 0) console.warn(`[pulizia fatturazione-ui] ${errori.join('; ')}`)
    } finally {
      await page?.context().close()
      await db.$disconnect()
    }
  })

  test('cedente incompleto: l`avvio dal dialog e` bloccato con il messaggio del cedente', async () => {
    await fp.vaiAlleElaborazioni()
    await fp.compilaNuovaElaborazione({ dal: periodo.dal, al: periodo.al, dataDocumento })
    await attendiRisposta(page, () => fp.bottone('nuova-avvia').click(), {
      metodo: 'POST',
      percorso: /^\/elaborazioni-fatturazione$/,
      stato: [400],
    })
    await expect(page.getByTestId('nuova-errore')).toContainText(
      ERRORI_GENERALI_VOCI.CEDENTE_INCOMPLETO.etichetta
    )
    // Nessuna elaborazione creata e il dialogo resta aperto.
    await expect(page.locator('#ne-dal')).toBeVisible()
    const lista = await ok<{ totale: number }>(
      'GET',
      '/elaborazioni-fatturazione?pagina=1&dimensione=5',
      tok.admin
    )
    expect(lista.totale).toBe(0)
    await fp.bottone('nuova-annulla').click()
    await expect(page.locator('#ne-dal')).toBeHidden()
  })

  test('cedente completato: nuova elaborazione dal dialog, anteprima con errori del periodo e link a «Da collegare»', async () => {
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

    await fp.vaiAlleElaborazioni()
    elaborazioneId = await fp.avviaElaborazione({
      dal: periodo.dal,
      al: periodo.al,
      dataDocumento,
    })
    await fp.attendiAnteprimaPronta()
    // Il movimento senza legame da' solo `LEGAMI_SENZA_CONTRATTO` (non bloccante): il cedente e` a posto.
    await expect(page.getByTestId('an-errori-generali')).toContainText(
      ERRORI_GENERALI_VOCI.LEGAMI_SENZA_CONTRATTO.etichetta
    )
    await expect(page.getByTestId('an-errori-generali')).not.toContainText(
      ERRORI_GENERALI_VOCI.CEDENTE_INCOMPLETO.etichetta
    )

    documenti = (await documentiDi(tok.admin, elaborazioneId)).elementi
    expect(documenti).toHaveLength(3)
    for (const d of documenti) {
      await expect(fp.rigaDocumentoAnteprima(d.id)).toBeVisible()
    }
    await expect(page.getByTestId('an-riepilogo')).toContainText('3')

    // Errori del periodo: il movimento senza legame, con il link alla pagina «Da collegare».
    await page.getByRole('tab', { name: /Errori del periodo/ }).click()
    const gruppo = page.getByTestId('errori-gruppo').first()
    await expect(gruppo).toBeVisible()
    await expect(gruppo.getByTestId('errori-quanti')).toHaveText('1')
    const link = gruppo.getByTestId('errori-link').first()
    await link.click()
    await expect(page).toHaveURL(/\/legami\/da-collegare\?.*stato=/)
    expect(page.url()).toContain(`dal=${periodo.dal}`)
    expect(page.url()).toContain(`al=${periodo.al}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: ATTESA_SERVER })
    await page.goBack()
    await fp.attendiAnteprimaPronta()
  })

  test('permessi: OPERATOR prepara ma non rende definitiva, VIEWER legge soltanto', async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    try {
      const p = await ctx.newPage()
      const altro = new FatturazionePage(p)

      tok.operator = await altro.accedi(azienda, 'operator')
      await altro.vaiAlleElaborazioni()
      await expect(p.getByTestId('nuova-elaborazione-apri')).toBeVisible()
      await altro.apriAnteprima(elaborazioneId)
      await expect(p.getByTestId('btn-ricalcola')).toBeVisible()
      await expect(p.getByTestId('btn-scarta')).toBeVisible()
      await expect(p.getByTestId('btn-definitiva')).toHaveCount(0)

      tok.viewer = await altro.accedi(azienda, 'viewer')
      await altro.vaiAlleElaborazioni()
      await expect(p.getByTestId('nuova-elaborazione-apri')).toHaveCount(0)
      await altro.apriAnteprima(elaborazioneId)
      await expect(p.getByTestId('btn-ricalcola')).toHaveCount(0)
      await expect(p.getByTestId('btn-definitiva')).toHaveCount(0)
      // La lettura resta aperta: i documenti dell'anteprima si vedono.
      await expect(altro.rigaDocumentoAnteprima(documenti[0].id)).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('interruttore spento: «Rendi definitiva» e` disattivato; l`ADMIN lo accende dalla UI con la conferma', async () => {
    // Prima: spento sul database e nella pagina.
    expect(await definitiveAttive(), 'interruttore spento in partenza').toBe(false)
    await fp.apriAnteprima(elaborazioneId)
    await expect(fp.bottone('btn-definitiva')).toBeDisabled()
    await expect(page.getByTestId('motivo-definitiva')).toHaveText(
      ERRORI_HTTP_VOCI.DEFINITIVE_NON_ATTIVE.etichetta
    )

    // Impostazioni: il rifiuto della conferma lascia l'interruttore spento.
    await page.goto('/clienti/fatturazione')
    const interruttore = page.locator('#fatt-definitive-input')
    await expect(page.getByTestId('fatt-data')).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(interruttore).not.toBeChecked()
    await page.getByText('Definitive attive', { exact: true }).click()
    const conferma = page.locator('.p-confirm-dialog')
    await expect(conferma).toContainText('commercialista')
    await conferma.getByRole('button', { name: 'Annulla' }).click()
    await expect(conferma).toBeHidden()
    await expect(interruttore).not.toBeChecked()
    expect(await definitiveAttive(), 'dopo il rifiuto resta spento').toBe(false)

    // Accensione confermata.
    await page.getByText('Definitive attive', { exact: true }).click()
    await expect(conferma).toContainText('commercialista')
    await attendiRisposta(page, () => conferma.getByRole('button', { name: 'Attiva' }).click(), {
      metodo: 'PUT',
      percorso: /^\/impostazioni-fatturazione\/definitive$/,
    })
    await expect(interruttore).toBeChecked()
    expect(await definitiveAttive(), 'acceso dalla UI').toBe(true)

    // Nell'anteprima, riletta, «Rendi definitiva» e` attivo.
    await fp.apriAnteprima(elaborazioneId)
    await fp.attendiAnteprimaPronta()
    await expect(fp.bottone('btn-definitiva')).toBeEnabled()
    await expect(page.getByTestId('motivo-definitiva')).toHaveCount(0)
  })

  test('numero di partenza: l`ADMIN lo imposta dalla UI e la numerazione prevista riparte da li`', async () => {
    await page.goto('/clienti/fatturazione')
    await page.getByRole('tab', { name: 'Numerazione' }).click()
    const riga = page.locator('[data-testid^="numerazione-riga-"]').first()
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    await riga.locator('[data-testid^="numerazione-modifica-"] button').click()
    const numero = page.locator('#num-partenza')
    await expect(numero).toBeVisible()
    await numero.click()
    await numero.press('Control+A')
    await numero.pressSequentially('120')
    await cliccaEAttendi(page, fp.bottone('partenza-salva'), {
      metodo: 'PUT',
      percorso: /^\/numerazioni-fattura\//,
    })
    await expect(riga.getByTestId('numerazione-partenza')).toContainText('120')
    const num = (await ok<NumerazioneApi[]>('GET', '/numerazioni-fattura', tok.admin)).find(
      x => x.registroIvaId === listini[0].registroIvaId
    )
    expect(num?.ultimoNumero).toBe(120)

    // La numerazione prevista e` quella del calcolo (`da` salvato con l'anteprima): dopo aver
    // cambiato la partenza si ricalcola, e riparte da 121 per tre documenti.
    await fp.apriAnteprima(elaborazioneId)
    await fp.attendiAnteprimaPronta()
    await fp.ricalcola()
    await page.getByRole('tab', { name: 'Numerazione prevista' }).click()
    await expect(page.getByTestId('numerazione-intervallo')).toHaveText('da 121 a 123')
    // Il ricalcolo rifa' le bozze: gli id dei documenti sono nuovi.
    documenti = (await documentiDi(tok.admin, elaborazioneId)).elementi
    expect(documenti).toHaveLength(3)
  })

  test('esclusione di un documento: la numerazione prevista cala; si riammette; il dettaglio mostra le righe e il PDF dell`anteprima', async () => {
    const daEscludere = documenti[2]
    await page.getByRole('tab', { name: /^Documenti/ }).click()
    await expect(fp.rigaDocumentoAnteprima(daEscludere.id)).toBeVisible()
    await cliccaEAttendi(page, fp.bottone(`escludi-${daEscludere.id}`), {
      metodo: 'POST',
      percorso: /\/escludi$/,
    })
    const riga = fp.rigaDocumentoAnteprima(daEscludere.id)
    await expect(riga.getByTestId('doc-escluso')).toBeVisible()
    await expect(page.getByTestId('numerazione-intervallo')).toHaveText('da 121 a 122')

    await cliccaEAttendi(page, fp.bottone(`riammetti-${daEscludere.id}`), {
      metodo: 'POST',
      percorso: /\/riammetti$/,
    })
    await expect(riga.getByTestId('doc-escluso')).toHaveCount(0)
    await expect(page.getByTestId('numerazione-intervallo')).toHaveText('da 121 a 123')

    // Dettaglio dell'anteprima: righe, totali e PDF di cortesia (bozza, filigrana ANTEPRIMA).
    await fp.bottone(`dettaglio-${documenti[0].id}`).click()
    await expect(page.getByTestId('doc-righe')).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(page.getByTestId('doc-totali').getByTestId('doc-totale')).toBeVisible()
    const pdf = await fp.scarica(() => fp.bottone('doc-pdf').click())
    expect(pdf.suggestedFilename()).toMatch(/^anteprima-.+\.pdf$/)
    await fp.bottone('doc-chiudi').click()
  })

  test('definitiva con conferma: numeri 121..123, legami FATTURATO, interruttore gia` acceso dalla UI', async () => {
    await expect(fp.bottone('btn-definitiva')).toBeEnabled()
    await fp.bottone('btn-definitiva').click()
    await expect(page.getByTestId('conferma-testo')).toHaveText(
      /Verranno emessi 3 documenti, numeri da 121 a 123 del registro .+, data \d{2}\/\d{2}\/\d{4}\./
    )
    await cliccaEAttendi(page, fp.bottone('conferma-ok'), {
      metodo: 'POST',
      percorso: /\/definitiva$/,
      stato: [202],
    })
    await expect(page.getByTestId('an-definitiva')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('an-stato')).toHaveText('Definitiva')

    documenti = (await documentiDi(tok.admin, elaborazioneId)).elementi
    expect(documenti.every(d => d.stato === 'DEFINITIVO')).toBe(true)
    const numeri = documenti.map(d => Number(d.numeroTesto?.split('/')[0])).sort((a, b) => a - b)
    expect(numeri).toEqual([121, 122, 123])
    for (const m of movimenti) {
      const l = await ok<{ stato: string }>('GET', `/legami-movimento/${m.legameId}`, tok.admin)
      expect(l.stato).toBe('FATTURATO')
    }
  })

  // ------------------------------------------------------------------ documenti definitivi

  /** Documento (dell'elaborazione) che contiene il legame dato. */
  const docDelLegame = async (legameId: string): Promise<DocumentoApi> => {
    for (const d of (await documentiDi(tok.admin, elaborazioneId)).elementi) {
      const dett = await dettaglioDocumento(tok.admin, d.id)
      if (dett.righe.some(r => r.legameId === legameId)) return d
    }
    throw new Error(`nessun documento per il legame ${legameId}`)
  }
  // I tre documenti per numero (l'ordine dei numeri non e` quello dei movimenti): il primo avra`
  // la presa d'atto, il secondo lo storno, l'ultimo e` l'unico annullabile.
  let docA: DocumentoApi
  let docB: DocumentoApi
  let docC: DocumentoApi
  let movA: (typeof movimenti)[number]
  let movB: (typeof movimenti)[number]
  let notaId = ''

  test('lista documenti: i tre definitivi con numero e stato; il dettaglio e il PDF della fattura', async () => {
    const perNumero = (
      await Promise.all(movimenti.map(async m => ({ m, doc: await docDelLegame(m.legameId) })))
    ).sort((x, y) => Number(x.doc.numeroTesto) - Number(y.doc.numeroTesto))
    ;[docA, docB, docC] = perNumero.map(x => x.doc)
    movA = perNumero[0].m
    movB = perNumero[1].m

    await fp.vaiAiDocumenti()
    for (const d of [docA, docB, docC]) {
      const riga = fp.rigaDocumentoPerNumero(d.numeroTesto!)
      await expect(riga).toHaveCount(1)
      await expect(riga.getByTestId('dl-stato')).toHaveText('Definitivo')
      // Le fatture dai movimenti sono differite (TD24).
      expect(d.tipoDocumento).toBe('TD24')
      await expect(riga.getByTestId('dl-tipo')).toHaveText('Fattura differita')
    }
    await expect(page.getByTestId('dl-esporta-csv')).toBeVisible()

    await fp.bottone(`dl-apri-${docA.id}`).click()
    await expect(page).toHaveURL(new RegExp(`/fatturazione/documenti/${docA.id}$`))
    await expect(page.getByTestId('dd-numero')).toHaveText(docA.numeroTesto!)
    await expect(page.getByTestId('dd-righe')).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(page.getByTestId('dd-riepilogo-iva')).toBeVisible()

    const pdf = await fp.scarica(() => fp.bottone('dd-pdf').click())
    expect(pdf.suggestedFilename()).toBe(
      `${docA.registro.codice}-${docA.numeroTesto}-${dataDocumento.slice(0, 4)}.pdf`
    )
    const byte = readFileSync((await pdf.path()) as string)
    expect(byte.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const testo = testoPdf(byte).replace(/\s+/g, ' ')
    expect(testo).toContain(`N. ${docA.numeroTesto}`)
    expect(testo).toContain('Fattura')
    expect(testo).not.toContain('ANNULLATO')
  })

  test('annullo dell`ultimo numero dalla UI: gli altri non sono annullabili; PDF del documento annullato', async () => {
    // Un documento che non e` l'ultimo: «Annulla» disattivato con il motivo in chiaro.
    await page.goto(`/fatturazione/documenti/${docA.id}`)
    await expect(page.getByTestId('dd-numero')).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(page.getByTestId('dd-annulla')).toBeDisabled()
    await expect(page.getByTestId('dd-motivo-annullo')).not.toBeEmpty()

    // L'ultimo (123): si annulla con il motivo.
    await page.goto(`/fatturazione/documenti/${docC.id}`)
    await expect(page.getByTestId('dd-numero')).toHaveText(docC.numeroTesto!)
    await expect(page.getByTestId('dd-annulla')).toBeEnabled()
    await page.getByTestId('dd-annulla').click()
    await expect(page.locator('#annulla-motivo')).toBeVisible()
    await expect(fp.bottone('annulla-conferma')).toBeDisabled()
    await page.locator('#annulla-motivo').fill('Prova e2e: documento emesso per errore')
    await cliccaEAttendi(page, fp.bottone('annulla-conferma'), {
      metodo: 'POST',
      percorso: /\/annulla$/,
    })
    await expect(page.getByTestId('dd-annullato')).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(page.getByTestId('dd-stato')).toHaveText('Annullato')
    const numero = (await numerazioni()).find(x => x.registroIvaId === listini[0].registroIvaId)
    expect(numero?.ultimoNumero, 'numero rilasciato').toBe(122)

    // PDF: nome con `annullato-` e filigrana ANNULLATO.
    const pdf = await fp.scarica(() => fp.bottone('dd-pdf').click())
    expect(pdf.suggestedFilename()).toMatch(/^annullato-.+\.pdf$/)
    const testo = testoPdf(readFileSync((await pdf.path()) as string)).replace(/\s+/g, ' ')
    expect(testo).toContain('ANNULLATO')

    // Nella lista: riga barrata e filtro per stato.
    await fp.vaiAiDocumenti()
    const riga = fp.rigaDocumentoPerNumero(docC.numeroTesto!)
    await expect(riga.getByTestId('dl-stato')).toHaveText('Annullato')
    await expect(riga.getByTestId('dl-data')).toHaveClass(/dl-annullato/)
  })

  // ------------------------------------------------------------------ scostamenti e storno

  const rettifica = async (movimentoId: string, kg: number) => {
    const r = await chiama<{ id?: string; movimento?: { id: string } }>(
      'POST',
      `/registro/movimenti/${movimentoId}/rettifica`,
      tok.admin,
      {
        motivo: 'Peso corretto dopo la fattura',
        movementDate: giornoItaliano(),
        causale: 'INGRESSO_ESTERNO',
        cerCode: '15 01 01',
        quantity: kg,
        unit: 'KG',
        counterpartName: conPrefissoUnico('Controparte fatturazione'),
      }
    )
    expect(r.stato, JSON.stringify(r.corpo)).toBe(201)
  }

  test('scostamenti: due movimenti fatturati e poi rettificati; presa d`atto con nota dall`ADMIN, OPERATOR in sola lettura', async ({
    browser,
  }) => {
    await rettifica(movA.movimentoId, movA.kg + 5)
    await rettifica(movB.movimentoId, movB.kg + 4)

    await page.goto('/fatturazione/scostamenti')
    const rigaA = page.getByTestId(`scostamento-${movA.legameId}`)
    const rigaB = page.getByTestId(`scostamento-${movB.legameId}`)
    await expect(rigaA).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(rigaB).toBeVisible()
    await expect(rigaA.getByTestId('sc-documento')).toContainText(docA.numeroTesto!)
    await expect(rigaB.getByTestId('sc-documento')).toContainText(docB.numeroTesto!)
    await expect(rigaA.getByTestId('sc-qta-fatturata')).toContainText(`${movA.kg}`)
    await expect(rigaA.getByTestId('sc-qta-attuale')).toContainText(`${movA.kg + 5}`)
    await expect(rigaB.getByTestId('sc-qta-attuale')).toContainText(`${movB.kg + 4}`)

    // OPERATOR: legge, senza le azioni.
    const ctx = await browser.newContext()
    try {
      const p = await ctx.newPage()
      tok.operator = await new FatturazionePage(p).accedi(azienda, 'operator')
      await p.goto('/fatturazione/scostamenti')
      await expect(p.getByTestId(`scostamento-${movA.legameId}`)).toBeVisible({
        timeout: ATTESA_SERVER,
      })
      await expect(p.getByTestId(`presa-atto-${movA.legameId}`)).toHaveCount(0)
      await expect(p.getByTestId(`storna-${movA.legameId}`)).toHaveCount(0)
    } finally {
      await ctx.close()
    }

    // Presa d'atto di A: la nota e` obbligatoria.
    await fp.bottone(`presa-atto-${movA.legameId}`).click()
    await expect(page.locator('#presa-atto-nota')).toBeVisible()
    await expect(fp.bottone('presa-atto-conferma')).toBeDisabled()
    await page.locator('#presa-atto-nota').fill('Prova e2e: differenza di peso accettata')
    await expect(page.getByTestId('presa-atto-contatore')).toContainText('/ 200')
    await cliccaEAttendi(page, fp.bottone('presa-atto-conferma'), {
      metodo: 'POST',
      percorso: /\/presa-atto-scostamento$/,
    })
    await expect(rigaA).toHaveCount(0)
    await expect(rigaB).toBeVisible()
  })

  test('«Storna e rifattura» porta allo storno con «rifatturabile» gia` spuntato; la nota di credito ha il PDF con la riga dello storno', async () => {
    await page.goto('/fatturazione/scostamenti')
    await expect(page.getByTestId(`scostamento-${movB.legameId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await page.getByTestId(`storna-${movB.legameId}`).click()
    await expect(page).toHaveURL(new RegExp(`/fatturazione/documenti/${docB.id}\\?.*storno=1`))
    await expect(page.locator('#storno-motivo')).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(page.locator('#storno-rifatturabile')).toBeChecked()
    await page.locator('#storno-motivo').fill('Prova e2e: storno per rettifica del peso')
    // La data della nota di credito parte da oggi: si lascia, se non lo e`, la si imposta.
    if ((await page.locator('#storno-data').inputValue()) === '') {
      await fp.scriviData('storno-data', dataDocumento)
    }
    await cliccaEAttendi(page, fp.bottone('storno-conferma'), {
      metodo: 'POST',
      percorso: /\/storno$/,
    })
    const link = page.getByTestId('dd-nota-storno')
    await expect(link).toBeVisible({ timeout: ATTESA_SERVER })
    await link.click()

    // Dettaglio della nota di credito: TD04 con il rimando al documento stornato.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nota di credito', {
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId('dd-origine')).toBeVisible()
    notaId = page.url().split('/').pop()!.split('?')[0]
    const nota = await dettaglioDocumento(tok.admin, notaId)
    expect(nota.tipoDocumento).toBe('TD04')
    expect(nota.documentoOrigineId).toBe(docB.id)

    const pdf = await fp.scarica(() => fp.bottone('dd-pdf').click())
    const testo = testoPdf(readFileSync((await pdf.path()) as string)).replace(/\s+/g, ' ')
    const [g, m, a] = dataDocumento.split('-').reverse()
    expect(testo).toContain('Nota di credito')
    expect(testo).toContain(`Storno della fattura N. ${docB.numeroTesto} del ${g}/${m}/${a}`)

    // Lo scostamento di B e` chiuso.
    await page.goto('/fatturazione/scostamenti')
    await expect(page.getByTestId('scostamenti-vuota')).toBeVisible({ timeout: ATTESA_SERVER })
  })

  // ------------------------------------------------------------------ export

  /** Seleziona tutti i documenti della pagina nella lista. */
  const selezionaPagina = async (): Promise<void> => {
    await expect(page.locator('[data-testid^="documento-"]').first()).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await page.getByTestId('dl-seleziona-pagina').click()
    await expect(fp.bottone('dl-esporta-csv')).toBeEnabled()
  }

  test('export CSV (senza conferma) e XML zip (con conferma di emissione): file scaricati, annullati lasciati fuori', async () => {
    await fp.vaiAiDocumenti()
    // Quattro documenti: due fatture definitive, la nota di credito e l'annullato.
    await expect(page.locator('[data-testid^="documento-"]')).toHaveCount(4)
    await expect(fp.bottone('dl-esporta-csv')).toBeDisabled()
    await expect(page.getByTestId('dl-serve-selezione')).toBeVisible()
    await selezionaPagina()

    // CSV: nessuna conferma, ZIP con testate.csv e righe.csv.
    const csv = await fp.scarica(() => fp.bottone('dl-esporta-csv').click())
    const voci = leggiZip(readFileSync((await csv.path()) as string))
    expect([...voci.keys()].sort()).toEqual(['righe.csv', 'testate.csv'])
    const testate = voci.get('testate.csv')!.toString('utf8')
    expect(testate).toContain(`"${docA.numeroTesto}`)
    expect(testate).toContain(`"${docB.numeroTesto}`)

    // XML (zip): serve la conferma, perche' i documenti diventano «emessi».
    await fp.bottone('dl-esporta-xml').click()
    await expect(page.getByTestId('conferma-emissione-testo')).toBeVisible()
    const zip = await fp.scarica(() => fp.bottone('conferma-emissione-ok').click())
    const xml = leggiZip(readFileSync((await zip.path()) as string))
    expect(
      [...xml.keys()].filter(n => n.endsWith('.xml')),
      'un XML per fattura definitiva e per la nota; l`annullato e` escluso'
    ).toHaveLength(3)
    await expect(page.getByTestId('dl-saltati')).toContainText('1 documento annullato non incluso')
    for (const id of [docA.id, docB.id, notaId]) {
      expect((await dettaglioDocumento(tok.admin, id)).emessoIl, 'emesso dopo l`XML').not.toBeNull()
    }
  })

  test('export TeamSystem: etichetta «non verificato», mappature mancanti (409) con link, chiavi dopo il ricaricamento, poi export riuscito', async () => {
    const adattatori = await ok<{ codice: string; nome: string; verificato: boolean }[]>(
      'GET',
      '/export-contabile/adattatori',
      tok.admin
    )
    const ts = adattatori.find(a => /teamsystem/i.test(a.nome))
    expect(ts, 'adattatore TeamSystem registrato').toBeTruthy()
    expect(ts!.verificato).toBe(false)
    const bottoneTs = `dl-esporta-${ts!.codice}`

    await fp.vaiAiDocumenti()
    await selezionaPagina()
    await fp.bottone(bottoneTs).click()
    // Etichetta «non verificato» nella conferma.
    await expect(page.getByTestId('conferma-emissione-avviso')).toContainText(
      "non verificato su un'installazione reale"
    )
    await attendiRisposta(page, () => fp.bottone('conferma-emissione-ok').click(), {
      metodo: 'POST',
      percorso: /\/documenti-fattura\/export$/,
      stato: [409],
    })
    await expect(page.getByTestId('dl-mancanti')).toBeVisible({ timeout: ATTESA_SERVER })
    expect(await page.getByTestId('dl-mancante').count()).toBeGreaterThan(0)

    // Alle mappature: le chiavi mancanti restano anche dopo il ricaricamento della pagina.
    await fp.bottone('dl-completa-mappature').click()
    await expect(page).toHaveURL(new RegExp(`/fatturazione/export-contabile/${ts!.codice}$`))
    await expect(page.getByTestId('mappature-non-verificato')).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId('mappature-mancanti')).toBeVisible({ timeout: ATTESA_SERVER })
    const campi = page.locator('[data-testid^="mappature-valore-"]')
    const quanti = await campi.count()
    expect(quanti).toBeGreaterThan(0)
    await page.reload()
    await expect(page.getByTestId('mappature-mancanti')).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(campi).toHaveCount(quanti)

    // Completamento: codici numerici della larghezza che il tracciato richiede.
    const larghezza: Record<string, number> = {
      CODICE_IVA: 3,
      CONTO_RICAVI: 7,
      CLIENTE: 5,
      PAGAMENTO: 3,
      REGISTRO: 2,
    }
    for (let i = 0; i < quanti; i++) {
      const testid = (await campi.nth(i).getAttribute('data-testid')) as string
      const tipo = testid.replace('mappature-valore-', '').split('-')[0]
      const n = larghezza[tipo]
      expect(n, `tipo di mappatura ${tipo}`).toBeTruthy()
      await campi.nth(i).fill(String(i + 1).padStart(n, '0'))
    }
    await cliccaEAttendi(page, fp.bottone('mappature-salva'), {
      metodo: 'PUT',
      percorso: /\/mappature$/,
    })

    // Di nuovo alla lista: l'export riesce.
    await fp.vaiAiDocumenti()
    await selezionaPagina()
    await fp.bottone(bottoneTs).click()
    await expect(page.getByTestId('conferma-emissione-avviso')).toContainText('non verificato')
    const file = await fp.scarica(() => fp.bottone('conferma-emissione-ok').click())
    expect(file.suggestedFilename()).not.toBe('')
    expect(readFileSync((await file.path()) as string).length).toBeGreaterThan(0)
    await expect(page.getByTestId('dl-mancanti')).toHaveCount(0)
  })
})

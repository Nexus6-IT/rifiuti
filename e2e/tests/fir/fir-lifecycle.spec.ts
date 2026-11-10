import { test, expect, type Page } from '@playwright/test'
import {
  accediUiComeAzienda,
  assicuraDbLocale,
  clientDbLocale,
  MOTIVO_DB_NON_LOCALE,
  saltaSeDbNonLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER, attendiRisposta } from '../../utils/attese'
import {
  creaAnagrafiche,
  creaFirBozza,
  creaFirInStato,
  eliminaAnagrafiche,
  leggiFir,
  type AnagraficaCreata,
  type Anagrafiche,
} from '../../utils/fir-api'
import { CER_A, chiama } from '../../utils/legami-api'
import { registra } from '../../fixtures/risorse'
import { FirListPage } from '../../pages/fir-list.page'
import { LegamiPage } from '../../pages/legami.page'

/**
 * Ciclo di vita FIR: BOZZA -> EMESSO -> IN_TRANSITO -> CONSEGNATO, dall'interfaccia della lista
 * «Gestione FIR» (UAT critico #2: area con bug storici, priorita' massima di re-test).
 *
 * Isolamento. Il database della CI parte vuoto e quello locale dura nel tempo, quindi niente
 * dipende da righe preesistenti: `beforeAll` crea un'AZIENDA DI TEST dedicata (admin / operator /
 * viewer) con produttore, trasportatore e destinatario, e ogni test prepara via API il FIR nello
 * stato di partenza, poi fa dall'interfaccia SOLO il passo sotto test.
 *
 * Pulizia. I FIR non hanno una cancellazione HTTP: li registra `creaFirBozza` e li toglie il
 * teardown globale dal database (per id, e solo se lo snapshot porta il prefisso della run). Le
 * anagrafiche si cancellano qui per id esatti con il token dell'azienda che le possiede. L'azienda
 * e i suoi utenti restano nel database di test, riconoscibili dal prefisso della run.
 *
 * Mai testato: `POST /fir/:id/annulla` (irreversibile su un documento legale, in blacklist).
 *
 * Sessione unica per utente: un nuovo accesso invalida il precedente. Gli spec dell'azienda girano
 * in serie; la UI entra come OPERATOR, il setup via API usa il token dell'ADMIN preso una volta.
 */

const db = clientDbLocale()

let azienda: AziendaDiTest
let tokenAdmin: string
let anagrafiche: Anagrafiche
const anagraficheCreate: AnagraficaCreata[] = []

/** Entra nella lista «Gestione FIR» come OPERATOR dell'azienda dedicata. */
async function apriLista(page: Page): Promise<FirListPage> {
  await accediUiComeAzienda(page, azienda, 'operator')
  const lista = new FirListPage(page)
  await lista.goto()
  await expect(page.getByRole('heading', { name: 'Gestione FIR' })).toBeVisible({
    timeout: ATTESA_SERVER,
  })
  return lista
}

/** Conferma il dialog di conferma (`p-confirmDialog`) con il bottone di accettazione. */
async function confermaDialog(page: Page, etichetta: string, percorso: RegExp): Promise<void> {
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).last()
  await attendiRisposta(page, () => dialog.getByRole('button', { name: etichetta }).click(), {
    metodo: 'POST',
    percorso,
  })
}

test.describe('Ciclo di vita FIR completo', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 })
  test.skip(saltaSeDbNonLocale(db), MOTIVO_DB_NON_LOCALE)

  test.beforeAll(async () => {
    assicuraDbLocale(db)
    azienda = await creaAziendaDiTest(db, 'ciclo FIR')
    // RENTRI e' un modulo a parte, non incluso nel piano PROFESSIONAL: si aggiunge a questa azienda.
    await db.tenant.update({
      where: { id: azienda.tenantId },
      data: { featureFlags: ['rentri'] },
    })
    tokenAdmin = await tokenAzienda(azienda, 'admin')
    anagrafiche = await creaAnagrafiche(tokenAdmin, anagraficheCreate)
  })

  test.afterAll(async () => {
    if (!db) return
    try {
      if (!azienda) return
      const errori = await eliminaAnagrafiche(
        await tokenAzienda(azienda, 'admin'),
        anagraficheCreate
      )
      expect(errori, 'pulizia delle anagrafiche create dallo spec').toEqual([])
    } finally {
      // L'azienda resta (i suoi FIR sono tolti dal teardown globale, dopo questo hook).
      await db.$disconnect()
    }
  })

  test('crea un nuovo FIR dalla finestra «Nuovo FIR» (anagrafiche già presenti)', async ({
    page,
  }) => {
    const lista = await apriLista(page)
    await lista.openNuovoFirDialog()
    const finestra = page.locator('.fir-dialog')
    await expect(finestra).toBeVisible()

    // Senza i campi obbligatori non si crea nulla: la finestra resta aperta con l'avviso.
    await finestra.getByTestId('fir-dialog-salva').click()
    await expect(page.getByText('Controlla i campi evidenziati e riprova.')).toBeVisible()

    // Il pannello si apre solo se e' chiuso; si ripete finche' l'etichetta mostrata e' quella scelta
    // (le opzioni arrivano dal server e il clic puo' cadere mentre il pannello si ridisegna).
    const scegli = async (inputId: string, opzione: string) => {
      const menu = finestra.locator(`p-dropdown:has(#${inputId})`)
      const voce = page.getByRole('option', { name: opzione, exact: true })
      await expect(async () => {
        if (!(await voce.isVisible())) await menu.click()
        await voce.click({ timeout: 3_000 })
        // L'elenco delle opzioni sta dentro lo stesso componente: si legge solo l'etichetta mostrata.
        await expect(menu.getByRole('combobox')).toHaveText(opzione, { timeout: 2_000 })
      }).toPass({ timeout: ATTESA_SERVER })
    }
    await scegli('new-produttore', anagrafiche.produttore.ragioneSociale)
    await scegli('new-trasportatore', anagrafiche.trasportatore.ragioneSociale)
    await scegli('new-destinatario', anagrafiche.destinatario.ragioneSociale)
    await new LegamiPage(page).scegliCer('#new-cer', CER_A)
    const quantita = finestra.locator('#new-qta')
    await quantita.click()
    await quantita.press('Control+A')
    await quantita.pressSequentially('12,5')
    await scegli('new-provenienza', 'Speciale')
    await scegli('new-tipo-tratta-principale', 'Terrestre')

    const risposta = await attendiRisposta(
      page,
      () => finestra.getByTestId('fir-dialog-salva').click(),
      { metodo: 'POST', percorso: /^\/fir(\?|$)/ }
    )
    const creato = (await risposta.json()) as { id: string; stato: string }
    registra('fir', creato.id)
    expect(creato.stato).toBe('BOZZA')

    await expect(finestra).toBeHidden({ timeout: ATTESA_SERVER })
    const riga = lista.rigaPerId(creato.id)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(lista.statoPerId(creato.id)).toHaveText(/bozza/i)
    await expect(riga).toContainText(CER_A)
    await expect(riga).toContainText('N/D')
    // Una bozza si emette o si modifica, ma non ha ancora azioni di trasporto.
    await expect(lista.actionButtonInRow(riga, /Emetti/)).toBeVisible()
    await expect(lista.actionButtonInRow(riga, /Presa in carico/)).toHaveCount(0)

    const salvato = await leggiFir(tokenAdmin, creato.id)
    expect(salvato.rifiuto.quantita).toBe(12.5)
    expect(salvato.stato).toBe('BOZZA')
  })

  test('emette il FIR (BOZZA -> EMESSO): numero progressivo assegnato', async ({ page }) => {
    const fir = await creaFirBozza(tokenAdmin, anagrafiche)
    const lista = await apriLista(page)
    const riga = lista.rigaPerId(fir.id)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(riga).toContainText('N/D')

    await lista.emetti(riga)
    await confermaDialog(page, 'Emetti', /\/fir\/[^/]+\/emetti/)

    await expect(lista.statoPerId(fir.id)).toHaveText(/emesso/i, { timeout: ATTESA_SERVER })
    await expect(riga).toContainText(/FIR-\d{4}-\d{6}/)
    await expect(riga).not.toContainText('N/D')
    // Da EMESSO l'azione di trasporto e' la presa in carico; l'emissione non si ripete.
    await expect(lista.actionButtonInRow(riga, /Presa in carico/)).toBeVisible()
    await expect(lista.actionButtonInRow(riga, /Emetti/)).toHaveCount(0)
    expect((await leggiFir(tokenAdmin, fir.id)).stato).toBe('EMESSO')
  })

  test('presa in carico del FIR (EMESSO -> IN_TRANSITO)', async ({ page }) => {
    const fir = await creaFirInStato(tokenAdmin, anagrafiche, 'EMESSO')
    const lista = await apriLista(page)
    const riga = lista.rigaPerId(fir.id)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })

    await lista.presaInCarico(riga)
    await confermaDialog(page, 'Presa in carico', /\/fir\/[^/]+\/presa-in-carico/)

    await expect(lista.statoPerId(fir.id)).toHaveText(/in transito/i, { timeout: ATTESA_SERVER })
    await expect(lista.actionButtonInRow(riga, /Conferma consegna/)).toBeVisible()
    expect((await leggiFir(tokenAdmin, fir.id)).stato).toBe('IN_TRANSITO')
  })

  test('conferma consegna (IN_TRANSITO -> CONSEGNATO) con la quantità verificata', async ({
    page,
  }) => {
    const fir = await creaFirInStato(tokenAdmin, anagrafiche, 'IN_TRANSITO', { quantita: 10 })
    const lista = await apriLista(page)
    const riga = lista.rigaPerId(fir.id)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })

    await lista.confermaConsegna(riga)
    const dialog = page.getByRole('dialog', { name: 'Conferma Consegna' })
    await expect(dialog).toBeVisible()
    const peso = dialog.locator('#peso-effettivo')
    // Il dialog propone la quantita' dichiarata; si corregge con quella verificata a destino.
    await expect(peso).toHaveValue('10,00')
    await peso.click()
    await peso.press('Control+A')
    await peso.pressSequentially('9,5')
    await peso.blur()
    await attendiRisposta(page, () => dialog.getByRole('button', { name: 'Conferma' }).click(), {
      metodo: 'POST',
      percorso: /\/fir\/[^/]+\/conferma-consegna/,
    })

    await expect(lista.statoPerId(fir.id)).toHaveText(/consegnato/i, { timeout: ATTESA_SERVER })
    // A consegna avvenuta il ciclo e' chiuso: nessuna azione di trasporto sulla riga.
    await expect(lista.actionButtonInRow(riga, /Conferma consegna/)).toHaveCount(0)
    const consegnato = (await leggiFir(tokenAdmin, fir.id)) as {
      stato: string
      pesoEffettivo: number
    }
    expect(consegnato.stato).toBe('CONSEGNATO')
    expect(consegnato.pesoEffettivo).toBe(9.5)
  })

  test('sul telefono (375 px) la scheda del FIR porta le azioni e il ciclo prosegue', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    const fir = await creaFirBozza(tokenAdmin, anagrafiche)
    const lista = await apriLista(page)
    const riga = lista.rigaPerId(fir.id)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    const emetti = lista.actionButtonInRow(riga, /Emetti/)
    await expect(emetti).toBeVisible()
    // Nessuno scorrimento orizzontale della pagina: la tabella e' diventata una scheda.
    const scorre = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(scorre, 'la pagina non deve scorrere in orizzontale a 375 px').toBe(false)

    await emetti.click()
    await confermaDialog(page, 'Emetti', /\/fir\/[^/]+\/emetti/)
    await expect(lista.statoPerId(fir.id)).toHaveText(/emesso/i, { timeout: ATTESA_SERVER })
  })

  // Le firme si appongono con le azioni di ciclo (Emetti, Presa in carico, Conferma consegna): ogni
  // passo firma da se' (SIGNATURE_PROVIDER sandbox in CI). La verifica pubblica
  // (GET /fir/:id/verify, la stessa del QR sulla copia cartacea) ricalcola le firme.
  test('firma digitale: un FIR consegnato porta tre firme valide, verifica pubblica allValid', async () => {
    const fir = await creaFirInStato(tokenAdmin, anagrafiche, 'CONSEGNATO')
    const verifica = await chiama<{
      allValid: boolean
      isCompleted: boolean
      signatureCount: number
      signatures: { role: string; isValid: boolean }[]
    }>('GET', `/fir/${fir.id}/verify`, tokenAdmin)
    expect(verifica.stato, JSON.stringify(verifica.corpo)).toBe(200)
    expect(verifica.corpo.signatureCount).toBe(3)
    // I ruoli della verifica sono in inglese (PRODUCER, CARRIER, RECEIVER).
    expect(verifica.corpo.signatures.map(s => s.role).sort()).toEqual([
      'CARRIER',
      'PRODUCER',
      'RECEIVER',
    ])
    expect(
      verifica.corpo.signatures.filter(s => !s.isValid).map(s => s.role),
      'firme non valide'
    ).toEqual([])
    expect(verifica.corpo.allValid).toBe(true)
    expect(verifica.corpo.isCompleted).toBe(true)
  })

  test('firma dall’interfaccia: Conferma consegna dal dettaglio, poi la pagina pubblica /verify mostra le firme valide', async ({
    page,
    browser,
  }) => {
    const fir = await creaFirInStato(tokenAdmin, anagrafiche, 'IN_TRANSITO', { quantita: 10 })
    await accediUiComeAzienda(page, azienda, 'operator')
    await page.goto(`/fir/${fir.id}`)
    await expect(page.getByTestId('fir-detail-stato')).toContainText(/in transito/i, {
      timeout: ATTESA_SERVER,
    })

    await page.getByTestId('fir-detail-conferma-consegna').click()
    const dialog = page.getByTestId('fir-detail-consegna-dialog')
    await expect(dialog).toBeVisible()
    const peso = dialog.locator('#consegna-peso')
    await peso.click()
    await peso.pressSequentially('9,5')
    await peso.blur()
    await attendiRisposta(page, () => page.getByTestId('fir-detail-consegna-conferma').click(), {
      metodo: 'POST',
      percorso: /\/fir\/[^/]+\/conferma-consegna/,
    })
    await expect(page.getByTestId('fir-detail-stato')).toContainText(/consegnato/i, {
      timeout: ATTESA_SERVER,
    })
    expect((await leggiFir(tokenAdmin, fir.id)).stato).toBe('CONSEGNATO')

    // Pagina pubblica: contesto nuovo, senza sessione ne' token.
    const pubblico = await browser.newContext()
    try {
      const verifica = await pubblico.newPage()
      await verifica.goto(`/verify/${fir.id}`)
      await expect(
        verifica.getByRole('heading', { name: 'Verifica Firme Digitali FIR' })
      ).toBeVisible()
      await expect(verifica.getByText('Firme Valide', { exact: true })).toBeVisible({
        timeout: ATTESA_SERVER,
      })
      await expect(verifica.getByText('3 / 3')).toBeVisible()
      await expect(verifica.getByText('Completato', { exact: true })).toBeVisible()
      await expect(verifica.getByText('Firme Non Valide')).toHaveCount(0)
    } finally {
      await pubblico.close()
    }
  })

  test('sync RENTRI in batch: i FIR emessi vengono accodati, una bozza viene saltata', async () => {
    // Si verifica l'accodamento (202 con il conteggio), non l'esito verso l'ente: il test non ha
    // un'azienda con credenziale RENTRI e non parla mai con l'ente vero. Il sync singolo, lo stato
    // in lista e in dettaglio e la cronologia sono in tests/fir/fir-rentri-status.spec.ts.
    const emessi = [
      await creaFirInStato(tokenAdmin, anagrafiche, 'EMESSO'),
      await creaFirInStato(tokenAdmin, anagrafiche, 'EMESSO'),
    ]
    const bozza = await creaFirBozza(tokenAdmin, anagrafiche)
    const r = await chiama<{ batchJobId: string; queuedCount: number; skippedCount: number }>(
      'POST',
      '/rentri/sync/batch',
      tokenAdmin,
      { firIds: [...emessi.map(f => f.id), bozza.id] }
    )
    expect(r.stato, JSON.stringify(r.corpo)).toBe(202)
    expect(r.corpo.queuedCount).toBe(2)
    expect(r.corpo.skippedCount).toBe(1)
    expect(r.corpo.batchJobId).toBeTruthy()
    // Un elenco vuoto e' rifiutato.
    const vuoto = await chiama('POST', '/rentri/sync/batch', tokenAdmin, { firIds: [] })
    expect(vuoto.stato).toBe(400)
  })
})

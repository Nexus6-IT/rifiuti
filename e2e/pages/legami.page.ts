import { expect, type Locator, type Page, type Response } from '@playwright/test'
import { ATTESA_SERVER, attendiRisposta, cliccaEAttendi } from '../utils/attese'
import { giornoItaliano } from '../utils/legami-api'

/**
 * Page Object dell'interfaccia del legame movimento (pezzo 4.3c): registro (form di registrazione,
 * dettaglio col riquadro, rettifica e annullo), pagina «Da collegare» con la sua finestra e la
 * finestra «Aggiorna prezzi». Solo selettori `data-testid` (e gli id dei campi dei form), mai testi
 * che cambiano con la lingua o con i dati.
 */
export class LegamiPage {
  constructor(readonly page: Page) {}

  /**
   * Il `button` nativo dentro un `p-button` (il `data-testid` sta sul componente): serve per
   * verificare abilitato/disabilitato, che il componente da solo non espone allo stato nativo.
   */
  bottone(testid: string): Locator {
    return this.page.getByTestId(testid).locator('button')
  }

  // ---------------------------------------------------------------- registro: registrazione

  async vaiAlRegistro(): Promise<void> {
    await this.page.goto('/registro')
    await expect(
      this.page.getByRole('button', { name: 'Registra un nuovo movimento' })
    ).toBeVisible({ timeout: ATTESA_SERVER })
  }

  get bloccoFatturazione(): Locator {
    return this.page.getByTestId('blocco-fatturazione')
  }

  /** Apre il form «Registra movimento» e compila un carico da esterno (la causale fatturabile). */
  async compilaCarico(dati: { cer: string; quantita: string; controparte: string }): Promise<void> {
    await this.page.getByRole('button', { name: 'Registra un nuovo movimento' }).click()
    const form = this.page.locator('form.mov-form')
    await expect(form).toBeVisible()

    // Il form si apre con la data di oggi gia' scritta nel campo (nessun inserimento a mano): se
    // restasse vuoto, senza data le causali non si caricano e il blocco «Fatturazione» non compare.
    const oggi = giornoItaliano().split('-').reverse().join('/')
    await expect(this.page.locator('#movementDate')).toHaveValue(oggi)

    // Le opzioni si ricaricano anche all'apertura: scegliere la causale e' un tentativo da
    // ripetere finche' l'etichetta mostrata (non il pannello aperto) e' quella scelta.
    const causale = this.page.locator('p-dropdown:has(#causale) .p-dropdown-label')
    const opzione = this.page.getByRole('option', { name: 'Ingresso da esterno' })
    await expect(async () => {
      // Il pannello si apre solo se e' chiuso (un secondo clic lo richiuderebbe).
      if (!(await opzione.isVisible())) await this.page.locator('p-dropdown:has(#causale)').click()
      await opzione.click({ timeout: 3_000 })
      await expect(causale).toHaveText('Ingresso da esterno', { timeout: 2_000 })
    }).toPass({ timeout: ATTESA_SERVER })

    await this.scegliCer('#cerCode', dati.cer)

    const quantita = this.page.locator('#quantity')
    await quantita.click()
    await quantita.press('Control+A')
    await quantita.pressSequentially(dati.quantita)
    await quantita.blur()

    await this.page.locator('#counterpartName').fill(dati.controparte)
    await expect(causale).toHaveText('Ingresso da esterno')
  }

  /** Autocomplete CER: digita il codice senza spazi e sceglie l'opzione che lo contiene. */
  async scegliCer(selettoreInput: string, cer: string): Promise<void> {
    const input = this.page.locator(selettoreInput)
    await input.click()
    await input.press('Control+A')
    const ricerca = this.page.waitForResponse(
      r => r.url().includes('/cer/search') && r.request().method() === 'GET',
      { timeout: ATTESA_SERVER }
    )
    await input.pressSequentially(cer.replace(/ /g, ''))
    await ricerca
    await this.page.getByRole('option', { name: new RegExp(`^\\s*${cer}`) }).click()
  }

  /** Sceglie il cliente nel menu del blocco «Fatturazione» (cercando per ragione sociale). */
  async scegliCliente(ragioneSociale: string): Promise<void> {
    const menu = this.page.getByTestId('fatt-cliente-menu')
    const opzione = this.page.getByRole('option', { name: new RegExp(ragioneSociale) })
    // La ricerca sul server (debounce di 300 ms dopo il filtro) sostituisce le opzioni del menu
    // mentre il clic e' in corso: su un runner lento il clic puo' andare perso senza errore e il
    // blocco resta senza cliente. Si ripete finche' il menu sparisce (cliente scelto: la
    // proposta lo mostra al suo posto), non finche' il clic "riesce".
    await expect(async () => {
      if (!(await menu.isVisible())) return
      if (!(await opzione.isVisible())) await menu.click()
      await this.page.locator('.p-dropdown-panel .p-dropdown-filter').fill(ragioneSociale)
      await opzione.click({ timeout: 3_000 })
      await expect(menu).toBeHidden({ timeout: 3_000 })
    }).toPass({ timeout: ATTESA_SERVER })
    await expect(this.page.getByTestId('fatt-cliente')).toContainText(ragioneSociale, {
      timeout: ATTESA_SERVER,
    })
  }

  /** Riga di una tabella delle righe del legame (blocco, riquadro) per id della riga di listino. */
  rigaTabella(rigaAddebitoId: string): Locator {
    return this.page.getByTestId(`riga-${rigaAddebitoId}`)
  }

  campoQuantita(rigaAddebitoId: string): Locator {
    return this.page.locator(`#qta-${rigaAddebitoId}`)
  }

  campoPrezzo(rigaAddebitoId: string): Locator {
    return this.page.locator(`#prezzo-${rigaAddebitoId}`)
  }

  /** Sostituisce il contenuto di un campo numerico digitando (come l'utente, tasto per tasto). */
  async digita(campo: Locator, testo: string): Promise<void> {
    await campo.click()
    await campo.press('Control+A')
    await campo.pressSequentially(testo)
  }

  /** Clicca «Registra e conferma legame» e restituisce l'id del movimento registrato. */
  async registraEConferma(): Promise<string> {
    return this.registra('registra-e-conferma')
  }

  /** Clicca «Registra senza collegare» e restituisce l'id del movimento registrato. */
  async registraSenzaCollegare(): Promise<string> {
    return this.registra('registra-senza-collegare')
  }

  private async registra(testid: string): Promise<string> {
    const risposta = await cliccaEAttendi(this.page, this.page.getByTestId(testid), {
      metodo: 'POST',
      percorso: /^\/registro(\?|$)/,
    })
    const corpo = (await risposta.json()) as { id?: string; movimento?: { id: string } }
    const id = corpo.id ?? corpo.movimento?.id
    expect(id, 'id del movimento registrato').toBeTruthy()
    await expect(this.page.locator('form.mov-form')).toBeHidden({ timeout: ATTESA_SERVER })
    return id!
  }

  // ---------------------------------------------------------------- registro: dettaglio

  /** Apre il dettaglio del movimento (riquadro del legame). */
  async apriDettaglio(movimentoId: string): Promise<void> {
    await this.page.getByTestId(`registro-dettaglio-${movimentoId}`).click()
    await expect(this.page.getByTestId('registro-dettaglio')).toBeVisible({
      timeout: ATTESA_SERVER,
    })
  }

  async chiudiDettaglio(): Promise<void> {
    await this.page.getByRole('button', { name: 'Chiudi il dettaglio del movimento' }).click()
    await expect(this.page.getByTestId('registro-dettaglio')).toBeHidden()
  }

  get riquadro(): Locator {
    return this.page.getByTestId('riquadro-legame')
  }

  get statoRiquadro(): Locator {
    return this.page.getByTestId('riquadro-stato')
  }

  /** «Salva modifiche» del riquadro: attende il PUT del legame. */
  async salvaRiquadro(): Promise<Response> {
    return cliccaEAttendi(this.page, this.page.getByTestId('riquadro-salva'), {
      metodo: 'PUT',
      percorso: '/legami-movimento/',
    })
  }

  /** «Conferma legame» del riquadro: attende la POST di conferma. */
  async confermaDalRiquadro(): Promise<Response> {
    return cliccaEAttendi(this.page, this.page.getByTestId('riquadro-conferma'), {
      metodo: 'POST',
      percorso: /\/legami-movimento\/[^/]+\/conferma/,
    })
  }

  // ---------------------------------------------------------------- registro: rettifica e annullo

  async apriRettifica(movimentoId: string): Promise<void> {
    await this.page.getByTestId(`registro-rettifica-${movimentoId}`).click()
    await expect(this.page.getByTestId('correzione-riepilogo')).toBeVisible({
      timeout: ATTESA_SERVER,
    })
  }

  async apriAnnullo(movimentoId: string): Promise<void> {
    await this.page.getByTestId(`registro-annulla-${movimentoId}`).click()
    await expect(this.page.getByTestId('correzione-riepilogo')).toBeVisible({
      timeout: ATTESA_SERVER,
    })
  }

  async scriviMotivoCorrezione(motivo: string): Promise<void> {
    await this.page.getByTestId('correzione-motivo').fill(motivo)
  }

  /** Invia la correzione con il pulsante dato e attende la POST; restituisce la risposta. */
  async inviaCorrezione(
    testid: 'correzione-invia' | 'correzione-invia-conferma',
    percorso: RegExp
  ): Promise<Response> {
    return cliccaEAttendi(this.page, this.page.getByTestId(testid), { metodo: 'POST', percorso })
  }

  // ---------------------------------------------------------------- «Da collegare»

  /**
   * Contenuto delle finestre: il `p-dialog` (dove sta il `data-testid`) e' un host senza
   * dimensioni, che Playwright considera sempre nascosto; si guarda un elemento al suo interno.
   */
  get finestraLegame(): Locator {
    return this.page.getByTestId('legame-stato')
  }

  get finestraAggiornaPrezzi(): Locator {
    return this.page.getByTestId('ap-chiudi')
  }

  async vaiADaCollegare(): Promise<void> {
    await this.page.goto('/legami/da-collegare')
    await expect(this.page.getByRole('heading', { name: 'Da collegare' }).first()).toBeVisible({
      timeout: ATTESA_SERVER,
    })
  }

  rigaLista(movimentoId: string): Locator {
    return this.page.getByTestId(`riga-${movimentoId}`)
  }

  /** Apre la finestra del legame dalla riga della lista (la lista si filtra sul solo stato). */
  async apriDallaLista(movimentoId: string): Promise<void> {
    await this.page.getByTestId(`apri-${movimentoId}`).click()
    await expect(this.finestraLegame).toBeVisible({ timeout: ATTESA_SERVER })
  }

  /** «Conferma» della finestra del legame: attende la POST di conferma. */
  async confermaDallaFinestra(): Promise<Response> {
    return cliccaEAttendi(this.page, this.page.getByTestId('legame-conferma'), {
      metodo: 'POST',
      percorso: /\/legami-movimento\/[^/]+\/conferma/,
    })
  }

  // ---------------------------------------------------------------- «Aggiorna prezzi»

  get pulsanteAggiornaPrezzi(): Locator {
    return this.page.getByTestId('aggiorna-prezzi-apri')
  }

  async apriAggiornaPrezzi(): Promise<void> {
    await this.pulsanteAggiornaPrezzi.click()
    await expect(this.finestraAggiornaPrezzi).toBeVisible({ timeout: ATTESA_SERVER })
  }

  /** Sceglie il contratto cercandolo per numero (ricerca sul server). */
  async scegliContrattoAggiornamento(numero: string): Promise<void> {
    await this.page.getByTestId('ap-contratto').click()
    const ricerca = this.page.waitForResponse(
      r => r.url().includes('/contratti-clienti') && r.request().method() === 'GET',
      { timeout: ATTESA_SERVER }
    )
    await this.page.locator('.p-dropdown-panel .p-dropdown-filter').fill(numero)
    await ricerca
    await this.page.getByRole('option', { name: new RegExp(numero) }).click()
  }

  /** «Mostra anteprima»: attende la POST senza firma e la sezione dell'anteprima. */
  async mostraAnteprima(): Promise<void> {
    await attendiRisposta(this.page, () => this.page.getByTestId('ap-anteprima').click(), {
      metodo: 'POST',
      percorso: '/legami-movimento/aggiorna-prezzi',
    })
    await expect(this.page.getByTestId('ap-anteprima-sezione')).toBeVisible({
      timeout: ATTESA_SERVER,
    })
  }

  /** Spunta la conferma esplicita e applica; attende la POST con la firma. */
  async applicaAggiornamento(): Promise<Response> {
    await this.page.getByTestId('ap-conferma').check()
    return cliccaEAttendi(this.page, this.page.getByTestId('ap-applica'), {
      metodo: 'POST',
      percorso: '/legami-movimento/aggiorna-prezzi',
    })
  }

  // ---------------------------------------------------------------- listino del contratto

  /** Apre il listino del contratto e sceglie l'elenco (le righe si vedono solo dopo la scelta). */
  async vaiAlListino(contrattoId: string, elencoId: string): Promise<void> {
    await this.page.goto(`/contratti-clienti/${contrattoId}/listino`)
    await this.page.getByTestId(`listino-scegli-${elencoId}`).click()
  }

  /** Apre il menu ⋯ della riga del listino e restituisce la voce «Elimina» (disabilitata se la riga e' in uso). */
  async voceEliminaRiga(rigaId: string): Promise<Locator> {
    const riga = this.page.getByTestId(`listino-riga-${rigaId}`)
    await riga.getByTestId('azioni-altre').click()
    return this.page.getByRole('menuitem', { name: /^Elimina/ })
  }

  /** Chiude il menu aperto da `voceEliminaRiga`. */
  async chiudiMenuRiga(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await this.page.getByRole('menuitem').first().waitFor({ state: 'hidden' })
  }

  suggerimentoEliminaRiga(rigaId: string): Locator {
    return this.page.getByTestId(`listino-in-uso-${rigaId}`)
  }
}

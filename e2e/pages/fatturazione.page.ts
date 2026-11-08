import { expect, type Download, type Locator, type Page } from '@playwright/test'
import { devLoginTokens } from '../utils/api-client'
import type { AziendaDiTest, RuoloAzienda } from '../utils/azienda-di-test'
import { ATTESA_SERVER, attendiElenco, attendiRisposta, cliccaEAttendi } from '../utils/attese'
import { dataItaliana, scriviData as scriviDataCampo } from '../utils/campo-data'

/**
 * Page Object dell'interfaccia di fatturazione (pezzo 4.4c): elaborazioni, anteprima, documenti,
 * scostamenti, mappature dell'export contabile e impostazioni. Solo selettori `data-testid`
 * (e gli id dei campi dei form PrimeNG, che non portano il testid sull'`input`).
 */

/** `AAAA-MM-GG` -> `gg/mm/aaaa`, il formato dei campi data PrimeNG dell'interfaccia. */
export const dataIt = dataItaliana

export class FatturazionePage {
  constructor(readonly page: Page) {}

  /** Il `button` nativo dentro un `p-button` (il testid sta sul componente). */
  bottone(testid: string): Locator {
    return this.page.getByTestId(testid).locator('button')
  }

  /**
   * Accesso alla UI come utente dell'azienda di test, e restituisce il token: il dev-login
   * invalida l'accesso precedente dello stesso utente, quindi chi chiama l'API con quell'utente
   * deve usare il token nuovo.
   */
  async accedi(azienda: AziendaDiTest, ruolo: RuoloAzienda): Promise<string> {
    const { accessToken, refreshToken } = await devLoginTokens(azienda.email[ruolo])
    await this.page.goto('/login')
    await this.page.evaluate(
      ({ a, r }) => {
        localStorage.setItem('accessToken', a)
        localStorage.setItem('refreshToken', r)
      },
      { a: accessToken, r: refreshToken }
    )
    await this.page.goto('/dashboard')
    await this.page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    return accessToken
  }

  // ------------------------------------------------------------------ elaborazioni

  async vaiAlleElaborazioni(): Promise<void> {
    const lista = attendiElenco(this.page, /^\/elaborazioni-fatturazione$/)
    await this.page.goto('/fatturazione/elaborazioni')
    await lista
    await expect(this.page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: ATTESA_SERVER,
    })
  }

  /** Scrive una data in un `p-calendar` (digitando `gg/mm/aaaa`) e ne chiude il pannello. */
  async scriviData(inputId: string, iso: string): Promise<void> {
    await scriviDataCampo(this.page, this.page.locator(`#${inputId}`), iso)
  }

  /** Apre «Nuova elaborazione» e compila periodo e data documento (senza avviare). */
  async compilaNuovaElaborazione(p: {
    dal: string
    al: string
    dataDocumento: string
  }): Promise<void> {
    await this.bottone('nuova-elaborazione-apri').click()
    // Il testid sta sull'host `p-dialog` (senza dimensioni): il dialogo e` aperto se il suo campo si vede.
    await expect(this.page.locator('#ne-dal')).toBeVisible()
    await this.scriviData('ne-dal', p.dal)
    await this.scriviData('ne-al', p.al)
    await this.scriviData('ne-doc', p.dataDocumento)
    await expect(this.bottone('nuova-avvia')).toBeEnabled()
  }

  /** Apre «Nuova elaborazione», compila, avvia (202) e attende la pagina dell'anteprima. */
  async avviaElaborazione(p: { dal: string; al: string; dataDocumento: string }): Promise<string> {
    await this.compilaNuovaElaborazione(p)
    const avvia = this.bottone('nuova-avvia')
    const risposta = await attendiRisposta(this.page, () => avvia.click(), {
      metodo: 'POST',
      percorso: /^\/elaborazioni-fatturazione$/,
      stato: [202],
    })
    const { id } = (await risposta.json()) as { id: string }
    await this.page.waitForURL(new RegExp(`/fatturazione/elaborazioni/${id}$`))
    return id
  }

  /** Attende che l'anteprima sia pronta: lo stato nella barra e le schede dei risultati. */
  async attendiAnteprimaPronta(): Promise<void> {
    await expect(this.page.getByTestId('an-stato')).toHaveText('Anteprima pronta', {
      timeout: 60_000,
    })
    await expect(this.page.getByTestId('an-riepilogo')).toBeVisible()
  }

  /** Apre una pagina di anteprima per id, direttamente dall'indirizzo. */
  async apriAnteprima(id: string): Promise<void> {
    await this.page.goto(`/fatturazione/elaborazioni/${id}`)
    await expect(this.page.getByTestId('an-stato')).toBeVisible({ timeout: ATTESA_SERVER })
  }

  rigaDocumentoAnteprima(documentoId: string): Locator {
    return this.page.getByTestId(`documento-${documentoId}`)
  }

  /** Clicca «Ricalcola» e attende il nuovo calcolo. */
  async ricalcola(): Promise<void> {
    await cliccaEAttendi(this.page, this.bottone('btn-ricalcola'), {
      metodo: 'POST',
      percorso: /\/ricalcola$/,
    })
    await this.attendiAnteprimaPronta()
  }

  // ------------------------------------------------------------------ download

  /** Esegue `azione` e restituisce il file scaricato dal browser. */
  async scarica(azione: () => Promise<void>): Promise<Download> {
    const attesa = this.page.waitForEvent('download', { timeout: ATTESA_SERVER })
    attesa.catch(() => undefined)
    await azione()
    return attesa
  }

  // ------------------------------------------------------------------ documenti

  async vaiAiDocumenti(): Promise<void> {
    const lista = attendiElenco(this.page, /^\/documenti-fattura$/)
    await this.page.goto('/fatturazione/documenti')
    await lista
    await expect(this.page.getByTestId('dl-filtri')).toBeVisible({ timeout: ATTESA_SERVER })
  }

  /** Riga della lista dei documenti con quel numero (`N/AAAA` o con suffisso). */
  rigaDocumentoPerNumero(numeroTesto: string): Locator {
    return this.page
      .locator('[data-testid^="documento-"]')
      .filter({ has: this.page.getByTestId('dl-numero').filter({ hasText: numeroTesto }) })
  }
}

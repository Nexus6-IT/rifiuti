import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Page Object per /fir/:id (FirDetailComponent — R1 Task 4/6,
 * features/fir/fir-detail.component.ts). Tutti i selettori sono
 * `data-testid` — la pagina è nata già con testabilità come requisito, a
 * differenza di FirListPage (v. e2e/SELECTORS-DEBT.md).
 *
 * NOTA: `fir-list.component.ts` non ha (ancora) un link/routerLink verso
 * questa pagina — non è raggiungibile cliccando una riga della lista. La
 * navigazione qui avviene per URL diretto (`goto(id)`), con l'id ottenuto
 * fuori banda (tipicamente da una chiamata API nel test). Segnalato anche
 * in e2e/SELECTORS-DEBT.md come gap di UX/testabilità non coperto da R1.
 */
export class FirDetailPage {
  readonly page: Page

  readonly root: Locator
  readonly back: Locator
  readonly loading: Locator
  readonly error: Locator

  readonly numero: Locator
  readonly stato: Locator
  readonly produttore: Locator
  readonly trasportatore: Locator
  readonly destinatario: Locator

  readonly rentriStatus: Locator
  readonly rentriMessaggioErrore: Locator
  readonly rentriNumeroUfficiale: Locator
  readonly rentriNumeroProposto: Locator
  readonly rentriOrigine: Locator

  readonly actions: Locator
  readonly emetti: Locator
  readonly presaInCarico: Locator
  readonly rentriTrasmetti: Locator
  readonly rentriRiprova: Locator
  readonly rentriVediCertificato: Locator
  readonly rentriConfermaLegame: Locator
  /** R2 Task 8 — rilascio del legame con un formulario agganciato (aggancio manuale/da terzi). */
  readonly rentriRilasciaLegame: Locator
  readonly rentriRilasciaLegameConfirmDialog: Locator

  readonly syncLogs: Locator
  readonly syncLogsTable: Locator
  readonly syncLogsRefresh: Locator
  readonly syncLogsEmpty: Locator

  constructor(page: Page) {
    this.page = page

    this.root = page.getByTestId('fir-detail-page')
    this.back = page.getByTestId('fir-detail-back')
    this.loading = page.getByTestId('fir-detail-loading')
    this.error = page.getByTestId('fir-detail-error')

    this.numero = page.getByTestId('fir-detail-numero')
    this.stato = page.getByTestId('fir-detail-stato')
    this.produttore = page.getByTestId('fir-detail-produttore')
    this.trasportatore = page.getByTestId('fir-detail-trasportatore')
    this.destinatario = page.getByTestId('fir-detail-destinatario')

    this.rentriStatus = page.getByTestId('fir-detail-rentri-status')
    this.rentriMessaggioErrore = page.getByTestId('fir-detail-rentri-messaggio-errore')
    this.rentriNumeroUfficiale = page.getByTestId('fir-detail-rentri-numero-ufficiale')
    this.rentriNumeroProposto = page.getByTestId('fir-detail-rentri-numero-proposto')
    this.rentriOrigine = page.getByTestId('fir-detail-rentri-origine')

    this.actions = page.getByTestId('fir-detail-actions')
    this.emetti = page.getByTestId('fir-detail-emetti')
    this.presaInCarico = page.getByTestId('fir-detail-presa-in-carico')
    this.rentriTrasmetti = page.getByTestId('fir-detail-rentri-trasmetti')
    this.rentriRiprova = page.getByTestId('fir-detail-rentri-riprova')
    this.rentriVediCertificato = page.getByTestId('fir-detail-rentri-vedi-certificato')
    this.rentriConfermaLegame = page.getByTestId('fir-detail-rentri-conferma-legame')
    this.rentriRilasciaLegame = page.getByTestId('fir-detail-rentri-rilascia-legame')
    this.rentriRilasciaLegameConfirmDialog = page.getByTestId(
      'fir-detail-rentri-rilascia-legame-confirm-dialog'
    )

    this.syncLogs = page.getByTestId('rentri-sync-logs')
    this.syncLogsTable = page.getByTestId('rentri-sync-logs-table')
    this.syncLogsRefresh = page.getByTestId('rentri-sync-logs-refresh')
    this.syncLogsEmpty = page.getByTestId('rentri-sync-logs-empty')
  }

  async goto(id: string) {
    await this.page.goto(`/fir/${id}`)
  }

  async expectLoaded() {
    await expect(this.loading).toBeHidden()
    await expect(this.root).toBeVisible()
  }

  /** Badge di sincronizzazione RENTRI dentro la sezione "Stato verso RENTRI" (stesso componente riusato dalla lista). */
  rentriBadge(numeroFir: string): Locator {
    return this.rentriStatus.locator(`[data-testid="rentri-sync-badge-${numeroFir}"]`)
  }

  syncLogRow(logId: string): Locator {
    return this.page.getByTestId(`rentri-sync-logs-row-${logId}`)
  }
}

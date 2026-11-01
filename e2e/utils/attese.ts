import { expect, type Locator, type Page, type Response } from '@playwright/test'
import { getApiUrl } from './env'

/**
 * Attese deterministiche sulle risposte del server (non sul tempo).
 *
 * Su un runner lento un salvataggio o una lettura possono impiegare molti secondi: aspettare
 * "che il dialog si chiuda" con il timeout di default (5 s) fa fallire il test per la lentezza,
 * non per un difetto. Qui si aspetta la risposta della chiamata e solo dopo l'effetto sulla UI.
 */

/** Timeout generoso per le risposte del server e per le conseguenze visibili in UI. */
export const ATTESA_SERVER = 30_000

const MUTAZIONI = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

export interface OpzioniRisposta {
  metodo?: string
  /** Frammento del percorso API (dopo `/api/v1`), oppure una regex sul percorso completo. */
  percorso?: string | RegExp
  /** Stato atteso: `'ok'` (2xx, default), oppure l'elenco degli stati ammessi. */
  stato?: 'ok' | number[]
  timeout?: number
}

function corrisponde(r: Response, o: OpzioniRisposta): boolean {
  const req = r.request()
  if (!r.url().startsWith(getApiUrl())) return false
  if (o.metodo ? req.method() !== o.metodo : !MUTAZIONI.has(req.method())) return false
  if (!o.percorso) return true
  const percorso = new URL(r.url()).pathname + new URL(r.url()).search
  return typeof o.percorso === 'string' ? percorso.includes(o.percorso) : o.percorso.test(percorso)
}

/**
 * Avvia l'attesa della risposta PRIMA di `azione` (tipicamente un click), poi la verifica.
 * Senza `metodo` accetta la prima mutazione (POST/PATCH/PUT/DELETE) verso l'API.
 */
export async function attendiRisposta(
  page: Page,
  azione: () => Promise<void>,
  opzioni: OpzioniRisposta = {}
): Promise<Response> {
  const attesa = page.waitForResponse(r => corrisponde(r, opzioni), {
    timeout: opzioni.timeout ?? ATTESA_SERVER,
  })
  // Se l'azione fallisce l'attesa pendente va assorbita, altrimenti diventa un rifiuto non gestito.
  attesa.catch(() => undefined)
  await azione()
  const risposta = await attesa
  const stato = opzioni.stato ?? 'ok'
  const ammessa = stato === 'ok' ? risposta.ok() : stato.includes(risposta.status())
  expect(
    ammessa,
    `${risposta.request().method()} ${new URL(risposta.url()).pathname} -> ${risposta.status()}: ` +
      (await risposta.text().catch(() => ''))
  ).toBe(true)
  return risposta
}

/** Clicca `bottone` e attende la risposta della mutazione che ne segue. */
export function cliccaEAttendi(
  page: Page,
  bottone: Locator,
  opzioni: OpzioniRisposta = {}
): Promise<Response> {
  return attendiRisposta(page, () => bottone.click(), opzioni)
}

/** Clicca `bottone`, attende la mutazione e poi la chiusura di `dlg` (con timeout generoso). */
export async function cliccaEChiudi(
  page: Page,
  bottone: Locator,
  dlg: Locator,
  opzioni: OpzioniRisposta = {}
): Promise<void> {
  // `Salva` resta spento finche' il dialog non ha caricato le sue opzioni (modalita', tabelle
  // collegate): su un runner lento puo' volerci piu' del timeout di azione. Si attende abilitato.
  await expect(bottone).toBeEnabled({ timeout: ATTESA_SERVER })
  await cliccaEAttendi(page, bottone, opzioni)
  await expect(dlg).toBeHidden({ timeout: ATTESA_SERVER })
}

/**
 * Avvia l'attesa del prossimo ricaricamento di un elenco (GET con il percorso dato). Va chiamata
 * PRIMA dell'azione che lo provoca; il risultato si attende dopo. Evita di affidarsi al tempo
 * perche' la riga appena salvata compaia: su un runner lento la GET dell'elenco puo' arrivare
 * dopo molti secondi.
 */
export function attendiElenco(
  page: Page,
  percorso: RegExp,
  timeout = ATTESA_SERVER
): Promise<void> {
  const attesa = page
    .waitForResponse(
      r =>
        r.request().method() === 'GET' &&
        r.url().startsWith(getApiUrl()) &&
        percorso.test(new URL(r.url()).pathname),
      { timeout }
    )
    .then(r => {
      expect(r.ok(), `GET ${new URL(r.url()).pathname} -> ${r.status()}`).toBe(true)
    })
  attesa.catch(() => undefined)
  return attesa
}

/**
 * Aggiunge una rata (giorni) nel dialog delle condizioni di pagamento e verifica che compaia fra
 * le rate: su un runner lento il click puo' arrivare prima che il form sia pronto e andare perso
 * (visto in CI: la condizione veniva salvata con la sola seconda rata). Ritentabile senza
 * duplicare: se la rata c'e' gia' non la riaggiunge.
 */
export async function aggiungiRata(dlg: Locator, giorni: string): Promise<void> {
  const chip = dlg.getByTestId('cond-dlg-rate').getByText(new RegExp(`^\\s*${giorni} gg`))
  await expect(async () => {
    if ((await chip.count()) === 0) {
      await dlg.getByLabel('Rate (giorni dalla fattura)').fill(giorni)
      await dlg.getByRole('button', { name: 'Aggiungi rata' }).click()
    }
    await expect(chip).toHaveCount(1, { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

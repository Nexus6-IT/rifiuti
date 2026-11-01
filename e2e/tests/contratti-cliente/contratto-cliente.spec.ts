import { test, expect, type Locator, type Page } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { apiLogin, apiGet, apiDelete, ApiClientError } from '../../utils/api-client'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { conPrefisso } from '../../utils/run-id'

/**
 * E2E — Contratto cliente (pezzo 4.1b, Task 28): dalle tabelle di fatturazione all'annullo.
 *
 * Percorso (un solo cliente, un solo contratto, in sequenza):
 *   1. `/clienti/tabelle`: condizione di pagamento 30-60 fine mese e registro IVA.
 *   2. `/clienti`: cliente su ditta nuova; dal suo dialog si crea in linea un conto corrente e
 *      una spesa di bollo ("Nuovo conto", "Nuovo bollo"), si sceglie la condizione.
 *   3. `/contratti-clienti`: contratto trimestrale con una categoria creata in linea (modalita'
 *      rapida: solo la descrizione); l'attivazione senza registro IVA e' rifiutata col messaggio
 *      del backend; si sceglie il registro e si attiva.
 *   4. Contratto attivo: il cliente e' bloccato; si carica un PDF.
 *   5. Sospensione "solo movimenti", rinnovo (la fine passa di un anno).
 *   6. Annullo con un motivo codificato creato in linea.
 *   7. VIEWER: vede gli elenchi senza pulsanti di scrittura ne' "Nuovo ...".
 *
 * Mappa letta da:
 * - `apps/frontend/src/app/features/clienti/{clienti-list,cliente-dialog,scelta-con-nuovo}.component.ts`
 * - `apps/frontend/src/app/features/contratti-cliente/*.component.ts` (elenco, dialog, sezioni,
 *   periodi, allegati, annullo)
 * - `apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.ts` (messaggi di D8)
 *
 * Il database di CI viene riusato fra due passate: codici, partita IVA, IBAN e numero del
 * contratto sono casuali per esecuzione. Pulizia in `afterAll` via API: un cliente con contratti
 * non si elimina (409) e un contratto annullato nemmeno; quello che resta in uso viene
 * DISATTIVATO (cliente, tabelle, codifiche) e non cancellato.
 */

type Tabella =
  | 'condizioni-pagamento'
  | 'conti-correnti'
  | 'spese-accessorie'
  | 'registri-iva'
  | 'codifiche-contratto'
  | 'clienti'

interface RigaApi {
  id: string
  versione: number
  codice?: string | null
  descrizione?: string
  ditta?: { ragioneSociale: string }
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const carattereCasuale = () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]

function codiceCasuale(n: number, prefisso = ''): string {
  let c = prefisso
  while (c.length < n) c += carattereCasuale()
  return c
}

/** IBAN italiano valido con numero di conto casuale (stesso algoritmo dello spec delle tabelle). */
function ibanCasualeValido(): string {
  const cifre = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
  const bban = `X${cifre(5)}${cifre(5)}${cifre(12)}`
  const numerico = (bban + 'IT00')
    .split('')
    .map(ch => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch))
    .join('')
  const resto = Number(BigInt(numerico) % 97n)
  return `IT${String(98 - resto).padStart(2, '0')}${bban}`
}

/** PDF minimo ma riconoscibile dal backend (firma `%PDF-`). */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
)

const dati = {
  condizione: codiceCasuale(8, 'E'),
  conto: codiceCasuale(8, 'E'),
  bollo: codiceCasuale(8, 'E'),
  registro: String(10 + Math.floor(Math.random() * 90)),
  iban: ibanCasualeValido(),
  partitaIva: partitaIvaCasualeValida(),
  numero: `E2E-${codiceCasuale(8)}`,
  nomeFile: `${codiceCasuale(6)}.pdf`,
}
const nomi = {
  condizione: conPrefisso('Condizione del cliente'),
  conto: conPrefisso('Conto cliente'),
  bollo: conPrefisso('Bollo cliente'),
  registro: conPrefisso('Registro contratti'),
  cliente: conPrefisso('Cliente contratto'),
  contratto: conPrefisso('Contratto trimestrale'),
  categoria: conPrefisso('Categoria del contratto'),
  motivo: conPrefisso('Motivo rapido'),
}

/** Cio' che il test ha creato, nell'ordine in cui va ripulito (cliente prima delle tabelle). */
const creati: { tabella: Tabella; trova: (r: RigaApi) => boolean; query?: string }[] = []

function elencoApi(tabella: Tabella, token: string, query = ''): Promise<RigaApi[]> {
  const sep = query ? `&${query}` : ''
  if (tabella === 'clienti') {
    return apiGet<{ elementi?: RigaApi[]; righe?: RigaApi[] } | RigaApi[]>(
      `/clienti?dimensione=100&testo=${encodeURIComponent(nomi.cliente)}`,
      token
    ).then(r => (Array.isArray(r) ? r : (r.elementi ?? r.righe ?? [])))
  }
  return apiGet<RigaApi[]>(`/${tabella}?incluseDisattivate=true${sep}`, token)
}

async function disattiva(tabella: Tabella, riga: RigaApi, token: string): Promise<void> {
  const campo = tabella === 'conti-correnti' || tabella === 'registri-iva' ? 'attivo' : 'attiva'
  const corpo = { [tabella === 'clienti' ? 'attivo' : campo]: false, versione: riga.versione }
  const r = await fetch(`${getApiUrl()}/${tabella}/${riga.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  })
  if (!r.ok) throw new Error(`PATCH ${tabella}/${riga.id} fallita: ${r.status} ${await r.text()}`)
}

/** Tutto cio' che non e' un dialog o un'opzione appesa al body si cerca in `#main-content`. */
function contenuto(page: Page) {
  return page.locator('#main-content')
}

function dialogo(page: Page, nome: string | RegExp): Locator {
  return page.getByRole('dialog', { name: nome })
}

/** Riempie `campo` e verifica che `Salva` si abiliti: se il form viene azzerato si riparte. */
async function compilaESalva(dlg: Locator, riempi: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await riempi()
    await expect(dlg.getByRole('button', { name: 'Salva' })).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
  await dlg.getByRole('button', { name: 'Salva' }).click()
  await expect(dlg).toBeHidden()
}

/** Sceglie in un `<select>` nativo la voce il cui testo contiene `testo`. */
async function scegliVoce(select: Locator, testo: string): Promise<void> {
  const valore = await select.locator('option', { hasText: testo }).first().getAttribute('value')
  expect(valore, `voce "${testo}" assente dal campo`).toBeTruthy()
  await select.selectOption(valore!)
}

function rigaContratto(page: Page): Locator {
  return contenuto(page).getByRole('row', { name: new RegExp(dati.numero) })
}

async function apriContratti(page: Page): Promise<void> {
  await page.goto('/contratti-clienti')
  await expect(
    contenuto(page).getByRole('heading', { level: 1, name: 'Contratti clienti' })
  ).toBeVisible()
}

/** Apre "Modifica" sul contratto e attende che il dialog abbia letto il contratto. */
async function apriModificaContratto(page: Page): Promise<Locator> {
  await rigaContratto(page).getByRole('button', { name: 'Modifica' }).click()
  const dlg = dialogo(page, 'Modifica contratto')
  await expect(dlg).toBeVisible()
  await expect(dlg.getByText('Caricamento…')).toBeHidden()
  return dlg
}

test.describe('Contratto cliente — operatore', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test.beforeEach(async ({ page, context }) => {
    await loginAndSaveState(page, context, 'operator')
  })

  test.afterAll(async () => {
    if (!hasRoleCredentials('operator') || creati.length === 0) return
    const token = await apiLogin('operator')
    const errori: string[] = []
    // Dal piu' recente: il cliente usa le tabelle, quindi va prima di loro.
    for (const { tabella, trova, query } of [...creati].reverse()) {
      try {
        const riga = (await elencoApi(tabella, token, query)).find(trova)
        if (!riga) continue
        try {
          await apiDelete(`/${tabella}/${riga.id}?versione=${riga.versione}`, token)
        } catch (e) {
          // In uso (cliente con contratti, tabelle e codifiche usate): non si elimina, si disattiva.
          if (!(e instanceof ApiClientError) || e.status !== 409) throw e
          await disattiva(tabella, riga, token)
        }
      } catch (e) {
        errori.push(`${tabella}: ${(e as Error).message}`)
      }
    }
    expect(errori, 'pulizia delle righe create dallo spec').toEqual([])
  })

  test('tabelle: condizione di pagamento 30-60 fine mese e registro IVA', async ({ page }) => {
    creati.push({ tabella: 'condizioni-pagamento', trova: r => r.codice === dati.condizione })
    creati.push({ tabella: 'registri-iva', trova: r => r.codice === dati.registro })

    await page.goto('/clienti/tabelle')
    await expect(
      contenuto(page).getByRole('heading', { level: 1, name: 'Tabelle di fatturazione' })
    ).toBeVisible()

    await contenuto(page).getByRole('tab', { name: 'Condizioni di pagamento' }).click()
    await contenuto(page).getByRole('button', { name: 'Nuova condizione' }).click()
    const cond = dialogo(page, 'Nuova condizione di pagamento')
    await cond.getByLabel('Codice').fill(dati.condizione)
    await cond.getByLabel('Descrizione').fill(nomi.condizione)
    const giorno = cond.getByLabel('Rate (giorni dalla fattura)')
    await giorno.fill('30')
    await cond.getByRole('button', { name: 'Aggiungi rata' }).click()
    await giorno.fill('60')
    await cond.getByRole('button', { name: 'Aggiungi rata' }).click()
    await cond.getByText('Fine mese', { exact: true }).click()
    await cond.getByRole('button', { name: 'Salva' }).click()
    await expect(cond).toBeHidden()
    await expect(
      contenuto(page).getByRole('row', { name: new RegExp(dati.condizione) })
    ).toContainText('30-60 gg fine mese')

    await contenuto(page).getByRole('tab', { name: 'Registri IVA' }).click()
    await contenuto(page).getByRole('button', { name: 'Nuovo registro' }).click()
    const reg = dialogo(page, 'Nuovo registro IVA')
    await compilaESalva(reg, async () => {
      await reg.getByLabel('Codice').fill(dati.registro)
      await reg.getByLabel('Descrizione').fill(nomi.registro)
    })
    await expect(contenuto(page).getByTestId(`registro-riga-${dati.registro}`)).toContainText(
      nomi.registro
    )
  })

  test('cliente su ditta nuova: conto corrente e bollo creati dal suo dialog', async ({ page }) => {
    creati.push({ tabella: 'clienti', trova: r => r.ditta?.ragioneSociale === nomi.cliente })
    creati.push({ tabella: 'conti-correnti', trova: r => r.codice === dati.conto })
    creati.push({ tabella: 'spese-accessorie', trova: r => r.codice === dati.bollo })

    await page.goto('/')
    // La voce di menu "Clienti" porta all'elenco (la voce "Contratti clienti" e' sotto).
    await page.getByRole('link', { name: 'Clienti', exact: true }).click()
    await expect(contenuto(page).getByRole('heading', { level: 1, name: 'Clienti' })).toBeVisible()

    await contenuto(page).getByRole('button', { name: 'Nuovo cliente' }).click()
    const dlg = dialogo(page, 'Nuovo cliente')
    await expect(dlg).toBeVisible()

    await expect(async () => {
      await dlg.getByLabel('Ragione sociale').fill(nomi.cliente)
      await dlg.getByLabel('Partita IVA').fill(dati.partitaIva)
      await dlg.getByLabel('Via', { exact: true }).fill('Via delle Prove')
      await dlg.getByLabel('Civico').fill('7')
      await dlg.getByLabel('CAP').fill('20100')
      await dlg.getByLabel('Comune').fill('Milano')
      await dlg.getByLabel('Provincia').fill('MI')
      await expect(dlg.getByLabel('Ragione sociale')).toHaveValue(nomi.cliente, { timeout: 1_000 })
    }).toPass({ timeout: 10_000 })

    // Condizione scelta fra quelle gia' create dalle tabelle.
    await scegliVoce(dlg.getByLabel('Condizione di pagamento'), dati.condizione)

    // Conto corrente in linea: si salva e si seleziona da solo.
    await dlg.getByRole('button', { name: 'Nuovo conto' }).click()
    const conto = dialogo(page, 'Nuovo conto corrente')
    await expect(conto).toBeVisible()
    await compilaESalva(conto, async () => {
      await conto.getByLabel('Codice').fill(dati.conto)
      await conto.getByLabel('Descrizione').fill(nomi.conto)
      await conto.getByLabel('Banca').fill('Banca di prova')
      await conto.getByLabel('IBAN').fill(dati.iban)
    })
    await expect(dlg.getByLabel('Ns. coordinate bancarie (conto del gestore)')).toHaveValue(/.+/)

    // Bollo in linea (il tipo e' fisso).
    await dlg.getByRole('button', { name: 'Nuovo bollo' }).click()
    const bollo = dialogo(page, 'Nuova spesa accessoria')
    await expect(bollo.getByTestId('spesa-dlg-tipo-fisso')).toHaveText('Bollo')
    await compilaESalva(bollo, async () => {
      await bollo.getByLabel('Codice').fill(dati.bollo)
      await bollo.getByLabel('Descrizione').fill(nomi.bollo)
      await bollo.getByLabel('Importo (euro)').fill('2,00')
    })
    await expect(dlg.getByLabel('Bollo', { exact: true })).toHaveValue(/.+/)

    await expect(dlg.getByRole('button', { name: 'Salva' })).toBeEnabled()
    await dlg.getByRole('button', { name: 'Salva' }).click()
    await expect(dlg).toBeHidden()

    const riga = contenuto(page).getByRole('row', { name: new RegExp(nomi.cliente) })
    await expect(riga).toContainText(dati.partitaIva)
    await expect(riga).toContainText(nomi.condizione)
  })

  test('contratto trimestrale: categoria in linea, bozza e attivazione negata senza registro', async ({
    page,
  }) => {
    creati.push({
      tabella: 'codifiche-contratto',
      trova: r => r.descrizione === nomi.categoria,
      query: 'genere=CATEGORIA',
    })

    await page.goto('/')
    await page.getByRole('link', { name: 'Contratti clienti', exact: true }).click()
    await expect(
      contenuto(page).getByRole('heading', { level: 1, name: 'Contratti clienti' })
    ).toBeVisible()

    await contenuto(page).getByRole('button', { name: 'Nuovo contratto' }).click()
    const dlg = dialogo(page, 'Nuovo contratto')
    await expect(dlg).toBeVisible()

    // Il cliente si cerca per testo e si sceglie fra i suggerimenti: precompila la condizione.
    const cliente = dlg.getByRole('combobox', { name: 'Cliente', exact: true })
    await cliente.fill(nomi.cliente)
    await page.getByRole('option', { name: new RegExp(nomi.cliente) }).click()
    await expect(page.getByRole('option', { name: new RegExp(nomi.cliente) })).toBeHidden()
    await expect(dlg.getByLabel('Condizione di pagamento')).not.toHaveValue('')

    // Categoria in linea, modalita' rapida: solo la descrizione, il codice lo da' il server.
    await dlg.getByRole('button', { name: 'Nuova categoria' }).click()
    const cat = dialogo(page, 'Nuova categoria')
    await expect(cat).toBeVisible()
    await expect(cat.getByLabel('Codice', { exact: false })).toHaveCount(0)
    await compilaESalva(cat, async () => {
      await cat.getByLabel('Descrizione').fill(nomi.categoria)
    })
    await expect(dlg.getByLabel('Categoria', { exact: true })).not.toHaveValue('')

    await expect(async () => {
      await dlg.getByLabel('Numero', { exact: true }).fill(dati.numero)
      await dlg.getByLabel('Descrizione', { exact: true }).fill(nomi.contratto)
      await dlg.getByLabel('Data di inizio').fill('2026-01-01')
      await dlg.getByLabel('Data di fine').fill('2027-12-31')
      await expect(dlg.getByLabel('Numero', { exact: true })).toHaveValue(dati.numero, {
        timeout: 1_000,
      })
      await expect(dlg.getByLabel('Data di fine')).toHaveValue('2027-12-31', { timeout: 1_000 })
    }).toPass({ timeout: 10_000 })

    // Periodi: la frequenza genera i quattro trimestri.
    await dlg.getByRole('button', { name: 'Trimestrale' }).click()
    await expect(
      dlg.getByRole('table', { name: 'Periodi di fatturazione' }).getByRole('row')
    ).toHaveCount(5) // intestazione + 4 periodi

    await dlg.getByRole('button', { name: 'Salva' }).click()
    await expect(dlg).toBeHidden()

    const riga = rigaContratto(page)
    await expect(riga).toContainText('Bozza')
    await expect(riga).toContainText(nomi.cliente)
    await expect(riga).toContainText(nomi.categoria)
    // Prossima fatturazione: con i trimestri generati e' una data (colonna non vuota).
    await expect(riga).toContainText(
      /\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}/
    )

    // Attivazione senza registro IVA: rifiutata col messaggio del backend, resta in bozza.
    await riga.getByRole('button', { name: 'Attiva' }).click()
    await expect(page.getByText('Per attivare il contratto indica il registro IVA.')).toBeVisible()
    await expect(riga).toContainText('Bozza')
  })

  test('completa con il registro e attiva', async ({ page }) => {
    await apriContratti(page)
    const dlg = await apriModificaContratto(page)
    await scegliVoce(dlg.getByLabel('Registro IVA', { exact: true }), nomi.registro)
    await dlg.getByRole('button', { name: 'Salva' }).click()
    await expect(dlg).toBeHidden()

    const riga = rigaContratto(page)
    await riga.getByRole('button', { name: 'Attiva' }).click()
    await expect(riga).toContainText('Attivo')
    await expect(riga.getByRole('button', { name: 'Sospendi solo movimenti' })).toBeVisible()
  })

  test('contratto attivo: cliente bloccato e PDF caricato', async ({ page }) => {
    await apriContratti(page)
    const dlg = await apriModificaContratto(page)

    // Il cliente di un contratto attivo non si cambia: campo disabilitato e niente "Nuovo cliente".
    await expect(dlg.getByRole('combobox', { name: 'Cliente', exact: true })).toBeDisabled()
    // "Nuovo cliente" accanto al campo del cliente (quello della fatturazione puo' restare).
    await expect(dlg.getByTestId('contratto-dlg-nuovo-cliente')).toHaveCount(0)

    // PDF 1: l'input e' nascosto, il pulsante "Carica" lo apre.
    await dlg.getByTestId('allegato-file-1').setInputFiles({
      name: dati.nomeFile,
      mimeType: 'application/pdf',
      buffer: PDF,
    })
    await expect(dlg.getByTestId('allegato-nome-1')).toContainText(dati.nomeFile)
    await expect(dlg.getByTestId('allegato-nome-2')).toContainText('Nessun file')
    await expect(dlg.getByTestId('allegati-errore')).toHaveCount(0)

    await dlg.getByRole('button', { name: 'Annulla', exact: true }).click()
    await expect(dlg).toBeHidden()
  })

  test('sospende solo i movimenti e rinnova', async ({ page }) => {
    await apriContratti(page)
    const riga = rigaContratto(page)
    await expect(riga).toContainText('31/12/2027')

    await riga.getByRole('button', { name: 'Sospendi solo movimenti' }).click()
    await expect(riga).toContainText('Sospeso (solo movimenti)')

    await riga.getByRole('button', { name: 'Rinnova' }).click()
    const conferma = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog', { name: /rinnovo/i }))
    await expect(conferma).toContainText('31/12/2027')
    await expect(conferma).toContainText('31/12/2028')
    await conferma.getByRole('button', { name: 'Rinnova', exact: true }).click()
    await expect(conferma).toBeHidden()
    await expect(riga).toContainText('31/12/2028')
    // Il rinnovo non cambia lo stato.
    await expect(riga).toContainText('Sospeso (solo movimenti)')
  })

  test('annulla con un motivo codificato creato in linea', async ({ page }) => {
    creati.push({
      tabella: 'codifiche-contratto',
      trova: r => r.descrizione === nomi.motivo,
      query: 'genere=MOTIVO_ANNULLO',
    })

    await apriContratti(page)
    const riga = rigaContratto(page)
    await riga.getByRole('button', { name: 'Annulla', exact: false }).click()

    const annullo = dialogo(page, new RegExp(`Annulla il contratto ${dati.numero}`))
    await expect(annullo).toBeVisible()
    // Senza motivo il pulsante di conferma e' spento.
    await expect(annullo.getByRole('button', { name: 'Annulla il contratto' })).toBeDisabled()

    await annullo.getByRole('button', { name: 'Nuovo motivo' }).click()
    const motivo = dialogo(page, /^Nuovo motivo/)
    await expect(motivo).toBeVisible()
    await compilaESalva(motivo, async () => {
      await motivo.getByLabel('Descrizione').fill(nomi.motivo)
    })

    await expect(annullo.getByRole('button', { name: 'Annulla il contratto' })).toBeEnabled()
    await annullo.getByRole('button', { name: 'Annulla il contratto' }).click()
    await expect(annullo).toBeHidden()

    await expect(riga).toContainText('Annullato')
    // Annullato = definitivo: nessuna transizione, nessun rinnovo, nessuna eliminazione.
    await expect(
      riga.getByRole('button', { name: /Attiva|Riattiva|Sospendi|Rinnova|Elimina/ })
    ).toHaveCount(0)
  })
})

test.describe('Contratto cliente — VIEWER', () => {
  test.skip(!hasRoleCredentials('viewer'), skipReason('viewer'))

  test('vede clienti e contratti senza pulsanti di scrittura', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'viewer')

    await page.goto('/contratti-clienti')
    await expect(
      contenuto(page).getByRole('heading', { level: 1, name: 'Contratti clienti' })
    ).toBeVisible()
    await expect(contenuto(page).getByRole('table')).toBeVisible()
    await expect(contenuto(page).getByRole('button', { name: 'Nuovo contratto' })).toHaveCount(0)
    await expect(contenuto(page).getByRole('button', { name: 'Proroga scadenze' })).toHaveCount(0)
    await expect(contenuto(page).getByRole('columnheader', { name: 'Azioni' })).toHaveCount(0)
    await expect(
      contenuto(page).getByRole('button', {
        name: /^(Modifica|Attiva|Riattiva|Sospendi|Annulla|Rinnova|Elimina)/,
      })
    ).toHaveCount(0)

    await page.goto('/clienti')
    await expect(contenuto(page).getByRole('heading', { level: 1, name: 'Clienti' })).toBeVisible()
    await expect(contenuto(page).getByRole('table')).toBeVisible()
    await expect(contenuto(page).getByRole('button', { name: 'Nuovo cliente' })).toHaveCount(0)
    await expect(
      contenuto(page).getByRole('button', { name: /^(Modifica|Disattiva|Riattiva|Elimina)/ })
    ).toHaveCount(0)
  })
})

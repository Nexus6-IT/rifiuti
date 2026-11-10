import { test, expect, type Page } from '@playwright/test'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  eliminaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER, attendiRisposta } from '../../utils/attese'
import { eliminaFirConPrefisso } from '../../utils/db-locale'
import { registra } from '../../fixtures/risorse'
import { chiama, giornoItaliano } from '../../utils/legami-api'
import { conPrefissoUnico } from '../../utils/run-id'
import { eseguiAzioneRiga } from '../../utils/azioni-riga'
import {
  annullaFir,
  creaAnagraficheRitiri,
  creaRitiri,
  eliminaAnagraficheRitiri,
  generaFirRitiri,
  leggiRitiro,
  type AnagraficaCreata,
  type AnagraficheRitiri,
  type RitiroVisto,
} from '../../utils/ritiri-api'

/**
 * E2E UI — Ritiri programmati e modelli di stampa (4.7, T15).
 *
 * Scenari:
 *   1. ritiro ripetuto 3 volte → «Genera FIR» → 3 bozze con link al FIR → annullo di un FIR →
 *      il ritiro torna «Da generare» (con il FIR annullato fra i precedenti) → rigenerazione;
 *   2. telefono a 360 px su `/ritiri/giorno`: ordine di giro, PDF del FIR, «Non eseguito» con
 *      motivo, nessuno scorrimento orizzontale;
 *   3. azienda TRIAL: `/ritiri` non accessibile (toast e dashboard), nessun 403 nella pagina né
 *      nella console; l'API risponde 403 MODULO_NON_ATTIVO;
 *   4. modelli di stampa: crea un modello e lo rende predefinito.
 * L'emissione in serie e la distinta sono della PR successiva: non si coprono qui.
 *
 * Isolamento. Due aziende dedicate create in `beforeAll` (PROFESSIONAL e TRIAL), mai l'azienda
 * seed. Nessuna dipendenza da dati preesistenti. Pulizia per id ESATTI in `afterAll`: FIR generati,
 * ritiri, modelli, anagrafiche, poi utenti e aziende (i ritiri non hanno cancellazione HTTP, quindi
 * si tolgono dal database locale, dopo i FIR che li referenziano).
 *
 * Sessione unica per utente: un nuovo accesso invalida il precedente, quindi durante un test le
 * chiamate API riusano il token della pagina (`tokenDellaPagina`).
 */

const db = clientDbLocale()

let pro: AziendaDiTest
let trial: AziendaDiTest
let anagrafiche: AnagraficheRitiri
const anagraficheCreate: AnagraficaCreata[] = []
const ritiriCreati: string[] = []
const firCreati = new Set<string>()
const modelliCreati: string[] = []

async function tokenDellaPagina(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('accessToken'))
  expect(token, 'token di sessione nella pagina').toBeTruthy()
  return token!
}

/** Tiene traccia dei ritiri creati e dei FIR (anche quelli che nascono dalla generazione). */
function ricorda(ritiri: RitiroVisto[]): string[] {
  ritiri.forEach(r => ritiriCreati.push(r.id))
  return ritiri.map(r => r.id)
}

function ricordaFir(firId: string): void {
  firCreati.add(firId)
  registra('fir', firId)
}

test.describe('Ritiri programmati e modelli di stampa', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 })
  test.skip(
    db === null,
    'Serve un database locale (DATABASE_URL su localhost) per creare le aziende di test dedicate'
  )

  test.beforeAll(async () => {
    if (!db) return
    pro = await creaAziendaDiTest(db, 'ritiri PRO', 'PROFESSIONAL')
    trial = await creaAziendaDiTest(db, 'ritiri TRIAL', 'TRIAL')
    anagrafiche = await creaAnagraficheRitiri(await tokenAzienda(pro, 'admin'), anagraficheCreate)
  })

  test.afterAll(async () => {
    if (!db) return
    const problemi: string[] = []
    try {
      // Ordine imposto dalle chiavi esterne: FIR → ritiri → modelli e anagrafiche → aziende.
      const esitoFir = await eliminaFirConPrefisso([...firCreati])
      problemi.push(...esitoFir.residue)
      if (ritiriCreati.length) {
        await db.ritiro
          .deleteMany({ where: { id: { in: ritiriCreati }, tenantId: pro.tenantId } })
          .catch(e => problemi.push(`ritiri: ${(e as Error).message.split('\n').pop()}`))
      }
      if (pro) {
        const token = await tokenAzienda(pro, 'admin')
        for (const id of modelliCreati) {
          const m = await chiama<{ versione: number }>('GET', '/modelli-stampa', token)
          const riga = (m.corpo as unknown as Array<{ id: string; versione: number }>).find(
            x => x.id === id
          )
          if (riga) await chiama('DELETE', `/modelli-stampa/${id}?versione=${riga.versione}`, token)
        }
        problemi.push(...(await eliminaAnagraficheRitiri(token, anagraficheCreate)))
        problemi.push(...(await eliminaAziendaDiTest(db, pro)))
      }
      if (trial) problemi.push(...(await eliminaAziendaDiTest(db, trial)))
      expect(problemi, 'pulizia dei dati creati dallo spec').toEqual([])
    } finally {
      await db.$disconnect()
    }
  })

  test('ritiro ripetuto 3 volte: genera i FIR, annulla un FIR, il ritiro torna da generare', async ({
    page,
  }) => {
    await accediUiComeAzienda(page, pro, 'admin')
    const token = await tokenDellaPagina(page)
    // Ogni 7 giorni da domani a +15: tre occorrenze (domani, +8, +15 non entra: +1, +8, +15 <= +16).
    const serie = await creaRitiri(token, anagrafiche, {
      data: giornoItaliano(1),
      ripetizione: { ogniGiorni: 7, fino: giornoItaliano(15) },
    })
    expect(serie).toHaveLength(3)
    const ids = ricorda(serie)
    expect(new Set(serie.map(r => r.serieId)).size, 'una sola serie').toBe(1)

    await page.goto('/ritiri')
    for (const id of ids) {
      const riga = page.getByTestId(`ri-riga-${id}`)
      await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
      await expect(riga).toContainText('Da generare')
    }

    // Seleziona i tre e genera i FIR.
    for (const id of ids) await page.getByTestId(`ri-sel-${id}`).check()
    await attendiRisposta(page, () => page.getByTestId('ri-genera').click(), {
      metodo: 'POST',
      percorso: '/ritiri/genera-fir',
    })
    await expect(page.getByTestId('eg-riepilogo')).toBeVisible({ timeout: ATTESA_SERVER })
    const firDa: Record<string, string> = {}
    for (const id of ids) {
      const link = page.getByTestId(`eg-fir-${id}`)
      await expect(link).toBeVisible()
      const href = await link.getAttribute('href')
      expect(href, `link al FIR del ritiro ${id}`).toMatch(/\/fir\/[0-9a-f-]{36}$/)
      firDa[id] = href!.split('/').pop()!
      ricordaFir(firDa[id])
    }
    await page.getByTestId('eg-chiudi').click()

    // Tre bozze, ciascuna con il link al proprio FIR.
    for (const id of ids) {
      const riga = page.getByTestId(`ri-riga-${id}`)
      await expect(riga).toContainText('FIR in bozza', { timeout: ATTESA_SERVER })
      await expect(page.getByTestId(`ri-fir-${id}`)).toHaveAttribute('href', `/fir/${firDa[id]}`)
    }

    // Annulla il FIR del secondo ritiro: il ritiro torna «Da generare» e si puo' rigenerare.
    const [, secondo] = ids
    await annullaFir(token, firDa[secondo])
    await page.getByTestId('ri-cerca').click()
    const rigaSecondo = page.getByTestId(`ri-riga-${secondo}`)
    await expect(rigaSecondo).toContainText('Da generare', { timeout: ATTESA_SERVER })
    await expect(page.getByTestId(`ri-fir-${secondo}`)).toHaveCount(0)
    const dopo = await leggiRitiro(token, secondo)
    expect(dopo.fir).toBeNull()
    expect(dopo.firPrecedenti?.map(f => f.id)).toEqual([firDa[secondo]])
    // Gli altri due non cambiano.
    await expect(page.getByTestId(`ri-riga-${ids[0]}`)).toContainText('FIR in bozza')
    await expect(page.getByTestId(`ri-riga-${ids[2]}`)).toContainText('FIR in bozza')

    // Rigenera solo quel ritiro: nuova bozza, con un FIR diverso dal precedente.
    await page.getByTestId(`ri-sel-${secondo}`).check()
    await attendiRisposta(page, () => page.getByTestId('ri-genera').click(), {
      metodo: 'POST',
      percorso: '/ritiri/genera-fir',
    })
    const nuovoLink = page.getByTestId(`eg-fir-${secondo}`)
    await expect(nuovoLink).toBeVisible({ timeout: ATTESA_SERVER })
    const nuovoFir = (await nuovoLink.getAttribute('href'))!.split('/').pop()!
    ricordaFir(nuovoFir)
    expect(nuovoFir).not.toBe(firDa[secondo])
    await page.getByTestId('eg-chiudi').click()
    await expect(rigaSecondo).toContainText('FIR in bozza', { timeout: ATTESA_SERVER })
    const finale = await leggiRitiro(token, secondo)
    expect(finale.fir?.id).toBe(nuovoFir)
  })

  test('telefono 360 px su /ritiri/giorno: ordine di giro, PDF del FIR, «non eseguito» con motivo', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await accediUiComeAzienda(page, pro, 'admin')
    const token = await tokenDellaPagina(page)
    const oggi = giornoItaliano()
    // Creati in ordine diverso da quello di giro: secondo, primo, senza ordine.
    const [secondo] = await creaRitiri(token, anagrafiche, { data: oggi, ordineGiro: 2 })
    const [primo] = await creaRitiri(token, anagrafiche, { data: oggi, ordineGiro: 1 })
    const [senza] = await creaRitiri(token, anagrafiche, { data: oggi })
    ricorda([secondo, primo, senza])
    // Il «primo» ha gia' il FIR (PDF); il «secondo» resta programmato (non eseguito).
    const [esito] = await generaFirRitiri(token, [primo.id])
    expect(esito.esito).toBe('CREATO')
    ricordaFir(esito.firId!)

    await page.goto('/ritiri/giorno')
    const schede = page.locator('ol.schede > li')
    await expect(schede).toHaveCount(3, { timeout: ATTESA_SERVER })
    const ordine = await schede.evaluateAll(els => els.map(e => e.getAttribute('data-testid')))
    expect(ordine, 'ordine di giro: 1, 2, poi senza ordine').toEqual([
      `rg-${primo.id}`,
      `rg-${secondo.id}`,
      `rg-${senza.id}`,
    ])

    // Nessuno scorrimento orizzontale a 360 px e bersagli di tocco da almeno 44 px.
    const larghezze = await page.evaluate(() => ({
      pagina: document.documentElement.scrollWidth,
      finestra: document.documentElement.clientWidth,
    }))
    expect(larghezze.pagina, 'scorrimento orizzontale').toBeLessThanOrEqual(larghezze.finestra)
    for (const testid of [`rg-pdf-${primo.id}`, `rg-ne-${secondo.id}`]) {
      const box = await page.getByTestId(testid).boundingBox()
      expect(box, testid).not.toBeNull()
      expect(box!.height, `altezza di ${testid}`).toBeGreaterThanOrEqual(44)
    }
    // Il bottone «Non eseguito» c'e' solo sui programmati senza FIR; il PDF solo con il FIR.
    await expect(page.getByTestId(`rg-pdf-${secondo.id}`)).toHaveCount(0)
    await expect(page.getByTestId(`rg-ne-${primo.id}`)).toHaveCount(0)

    // PDF del FIR: la rotta risponde 200 con un PDF.
    const rispostaPdf = await attendiRisposta(
      page,
      () => page.getByTestId(`rg-pdf-${primo.id}`).click(),
      {
        metodo: 'GET',
        percorso: `/pdf/fir/${esito.firId}`,
      }
    )
    expect(rispostaPdf.headers()['content-type']).toContain('application/pdf')
    expect((await rispostaPdf.body()).subarray(0, 4).toString()).toBe('%PDF')

    // «Non eseguito»: il motivo e' obbligatorio, poi la scheda mostra stato e motivo.
    await page.getByTestId(`rg-ne-${secondo.id}`).click()
    await page.getByTestId('ne-conferma').click()
    await expect(page.getByTestId('ne-errore')).toBeVisible()
    await page.getByTestId('ne-motivo').fill('Cliente assente')
    await attendiRisposta(page, () => page.getByTestId('ne-conferma').click(), {
      metodo: 'POST',
      percorso: `/ritiri/${secondo.id}/non-eseguito`,
    })
    const scheda = page.getByTestId(`rg-${secondo.id}`)
    await expect(scheda).toContainText('Non eseguito', { timeout: ATTESA_SERVER })
    await expect(page.getByTestId(`rg-motivo-${secondo.id}`)).toContainText('Cliente assente')
    await expect(page.getByTestId(`rg-ne-${secondo.id}`)).toHaveCount(0)
    const dopo = await leggiRitiro(await tokenDellaPagina(page), secondo.id)
    expect(dopo.statoVisibile).toBe('NON_ESEGUITO')
    expect(dopo.motivo).toBe('Cliente assente')
  })

  test('azienda TRIAL: /ritiri non e` accessibile e non produce nessun 403', async ({ page }) => {
    const risposte403: string[] = []
    const errori403: string[] = []
    page.on('response', r => {
      if (r.status() === 403) risposte403.push(`${r.request().method()} ${r.url()}`)
    })
    page.on('console', m => {
      if (m.type() === 'error' && /403|forbidden/i.test(m.text())) errori403.push(m.text())
    })

    await accediUiComeAzienda(page, trial, 'admin')
    await page.goto('/ritiri')
    // Il deep link a un modulo non attivo porta alla dashboard.
    await page.waitForURL(/\/dashboard/, { timeout: ATTESA_SERVER })
    await expect(page.getByRole('link', { name: /^Ritiri/ })).toHaveCount(0)
    await page.goto('/ritiri/giorno')
    await page.waitForURL(/\/dashboard/, { timeout: ATTESA_SERVER })
    await expect(page.getByTestId('ri-nuovo')).toHaveCount(0)

    expect(risposte403, 'nessuna risposta 403 durante la navigazione').toEqual([])
    expect(errori403, 'nessun errore 403 in console').toEqual([])

    // Lato API il modulo e' chiuso con il codice previsto.
    const r = await chiama<{ error?: string }>('GET', '/ritiri', await tokenDellaPagina(page))
    expect(r.stato).toBe(403)
    expect(r.corpo.error).toBe('MODULO_NON_ATTIVO')
  })

  test('modelli di stampa: crea un modello e lo imposta come predefinito', async ({ page }) => {
    await accediUiComeAzienda(page, pro, 'admin')
    await page.goto('/impostazioni/modelli-stampa')
    await expect(page.getByTestId('modelli-vuoto')).toBeVisible({ timeout: ATTESA_SERVER })

    const nome = conPrefissoUnico('Modello FIR')
    await page.getByTestId('modello-nuovo').click()
    await page.getByTestId('modello-dlg-nome').fill(nome)
    await page.getByTestId('modello-dlg-copie').fill('2')
    const crea = await attendiRisposta(page, () => page.getByTestId('modello-dlg-salva').click(), {
      metodo: 'POST',
      percorso: '/modelli-stampa',
    })
    const creato = (await crea.json()) as { id: string }
    modelliCreati.push(creato.id)

    const riga = page.getByTestId(`modello-riga-${creato.id}`)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(riga).toContainText(nome)
    // Mai predefinito alla creazione.
    await expect(riga.getByText('Predefinito', { exact: true })).toHaveCount(0)

    await attendiRisposta(page, () => eseguiAzioneRiga(page, riga, 'Rendi predefinito'), {
      metodo: 'POST',
      percorso: `/modelli-stampa/${creato.id}/predefinito`,
    })
    await expect(riga.getByText('Predefinito', { exact: true }).first()).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await expect(riga.getByRole('menuitem', { name: 'Rendi predefinito' })).toHaveCount(0)
  })
})

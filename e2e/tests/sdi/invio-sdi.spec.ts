import { createHmac } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import type { PrismaClient } from '@prisma/client'
import {
  clientDbLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { impostaFatturazioneDa, pulisciCreati, registraViaApi } from '../../utils/legami-api'
import {
  anteprimaPronta,
  creaListinoLegami,
  definitivaCompleta,
  documentiDi,
  giornoItaliano,
  ok,
  periodoDiProva,
  type Creato,
  type ListinoLegami,
} from '../../utils/fatturazione-api'
import { FatturazionePage } from '../../pages/fatturazione.page'
import { ATTESA_SERVER, attendiRisposta } from '../../utils/attese'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { getApiUrl } from '../../utils/env'

/**
 * E2E dell'invio allo SDI (pezzo 4.5b, T4) col provider `fake` in-process. I dati si preparano via API
 * (azienda ENTERPRISE propria, un documento DEFINITIVO, configurazione SDI verificata e invio attivo),
 * le azioni sotto prova si fanno dalla UI: «Invia allo SDI» dalla lista dei documenti e attesa del
 * badge «Inviata», scritto dal job d'invio del backend (cron ogni minuto).
 *
 * Il backend dell'e2e deve girare con `SDI_INVII_ATTIVI=true` (l'interruttore globale e' SPENTO di
 * default: lo accende il passo «Avvia il backend» della CI, mai la produzione). Senza, l'accodamento
 * risponde 409 `INVII_SDI_SOSPESI` e il test fallisce con quel messaggio. La partita IVA del cliente
 * si sceglie con ultima cifra 0 o 9: per il fake vuol dire «accettato, consegnato» (le altre cifre
 * simulano scarti, errori e incertezze).
 *
 * Pezzo 4.5c: la ricevuta di consegna arriva dal webhook (firmato con HMAC come fa il fake) e il badge
 * passa a «Consegnata»; la cronologia del dettaglio mostra la notifica. L'inbox la elabora il job
 * degli eventi (ogni 30 secondi).
 *
 * Senza un database locale (`DATABASE_URL`) lo spec si salta. Documenti e movimenti sono immutabili e
 * restano, riconoscibili dall'azienda con il prefisso della run; anagrafiche e listino si ripuliscono
 * per id esatti in `afterAll`.
 */

const db = clientDbLocale()

const SEGRETO_WEBHOOK = 'segreto-webhook-e2e'

/** Partita IVA valida con ultima cifra 0 o 9 (esito «accettato» del fake). */
function partitaIvaPerFake(): string {
  for (let i = 0; i < 500; i++) {
    const p = partitaIvaCasualeValida()
    if (p.endsWith('0') || p.endsWith('9')) return p
  }
  throw new Error('nessuna partita IVA valida con ultima cifra 0 o 9')
}

test.describe('Invio allo SDI (interfaccia, provider fake)', () => {
  test.skip(
    !db,
    'DATABASE_URL non e` un database locale: senza il client del proprietario non si crea ' +
      "l'azienda di test"
  )
  test.describe.configure({ mode: 'serial' })
  // Il job d'invio e' un cron al minuto: l'attesa del badge puo' durare fino a ~70 secondi.
  test.setTimeout(240_000)

  const periodo = periodoDiProva()
  const creati: Creato[] = []
  let owner: PrismaClient
  let azienda: AziendaDiTest
  const tok = { admin: '', operator: '' }
  let documentoId = ''
  let tokenWebhook = ''
  let fp: FatturazionePage
  let page: Page

  test.beforeAll(async ({ browser }) => {
    owner = db as PrismaClient
    azienda = await creaAziendaDiTest(owner, 'Invio SDI', 'ENTERPRISE')
    tok.admin = await tokenAzienda(azienda, 'admin')
    tok.operator = await tokenAzienda(azienda, 'operator')

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

    const l: ListinoLegami = await creaListinoLegami(tok.admin, creati, {
      modalitaPagamento: 'MP01',
    })
    // Il cliente cambia partita IVA PRIMA della definitiva (la fotografia la copia in quel momento).
    await owner.$executeRawUnsafe(
      `UPDATE ditte SET partita_iva = $1 WHERE id = (SELECT ditta_id FROM clienti WHERE id = $2::uuid)`,
      partitaIvaPerFake(),
      l.clienteId
    )
    await impostaFatturazioneDa(tok.admin, periodo.dal)
    const m = await registraViaApi(tok.admin, {
      kg: 20,
      legame: { azione: 'CONFERMA', clienteId: l.clienteId },
    })
    expect(m.legameId, 'il movimento nasce con un legame').toBeTruthy()
    const n = await owner.$executeRawUnsafe(
      `UPDATE impostazioni_fatturazione SET definitive_attive = true WHERE tenant_id = $1::uuid`,
      azienda.tenantId
    )
    expect(n, 'riga delle impostazioni dell`azienda').toBe(1)

    const anteprima = await anteprimaPronta(tok.admin, periodo, giornoItaliano())
    expect(anteprima.documenti).toBe(1)
    await definitivaCompleta(tok.admin, anteprima)
    const [d] = (await documentiDi(tok.admin, anteprima.id)).elementi
    expect(d.stato).toBe('DEFINITIVO')
    documentoId = d.id

    // Configurazione SDI: provider fake, verificata e con l'invio acceso.
    const creata = await ok<{ versione: number; webhookToken?: string }>(
      'PUT',
      '/sdi/configurazione',
      tok.admin,
      { provider: 'fake', ambiente: 'SANDBOX', segretoWebhook: SEGRETO_WEBHOOK, versione: 0 }
    )
    expect(creata.webhookToken, 'il token del webhook si vede alla creazione').toBeTruthy()
    tokenWebhook = creata.webhookToken!
    const verificata = await ok<{ esito: { ok: boolean }; configurazione: { versione: number } }>(
      'POST',
      '/sdi/configurazione/verifica',
      tok.admin,
      {}
    )
    expect(verificata.esito.ok, 'verifica del fake').toBe(true)
    await ok('PUT', '/sdi/configurazione/invio-attivo', tok.admin, {
      attivo: true,
      versione: verificata.configurazione.versione ?? creata.versione,
    })

    page = await (await browser.newContext()).newPage()
    fp = new FatturazionePage(page)
    tok.admin = await fp.accedi(azienda, 'admin')
  })

  test.afterAll(async () => {
    if (!db) return
    try {
      if (azienda) {
        await owner.$executeRawUnsafe(
          `UPDATE impostazioni_fatturazione SET definitive_attive = false WHERE tenant_id = $1::uuid`,
          azienda.tenantId
        )
      }
      const errori = await pulisciCreati(tok.admin, creati)
      if (errori.length > 0) console.warn(`[pulizia invio-sdi] ${errori.join('; ')}`)
    } finally {
      await page?.context().close()
      await db.$disconnect()
    }
  })

  test('OPERATOR vede la colonna SDI ma non il pulsante «Invia allo SDI»', async ({ browser }) => {
    const ctx = await browser.newContext()
    try {
      const p = await ctx.newPage()
      const altro = new FatturazionePage(p)
      tok.operator = await altro.accedi(azienda, 'operator')
      await p.goto('/fatturazione/documenti')
      await expect(p.getByTestId(`documento-${documentoId}`)).toBeVisible({
        timeout: ATTESA_SERVER,
      })
      await expect(p.getByTestId('dl-filtro-stato-sdi')).toBeVisible()
      await expect(p.getByTestId('dl-invia-sdi')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('ADMIN: il documento e` senza stato SDI; «Invia allo SDI» chiede conferma e accoda', async () => {
    await page.goto('/fatturazione/documenti')
    const riga = page.getByTestId(`documento-${documentoId}`)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(riga.getByTestId('dl-sdi')).toHaveText('—')
    await expect(fp.bottone('dl-invia-sdi')).toBeDisabled()

    await page.getByTestId(`dl-sel-${documentoId}`).click()
    await expect(fp.bottone('dl-invia-sdi')).toBeEnabled()
    await fp.bottone('dl-invia-sdi').click()
    await expect(page.getByTestId('invio-sdi-conteggio')).toContainText('1 documento selezionato')
    // Mai emesso prima: niente conferma dei «gia emessi».
    await expect(page.getByTestId('invio-sdi-gia-emessi')).toHaveCount(0)

    await attendiRisposta(page, () => fp.bottone('invio-sdi-ok').click(), {
      metodo: 'POST',
      percorso: /^\/documenti-fattura\/invio-sdi$/,
      stato: [202],
    })
    await expect(page.getByTestId('invio-sdi-esito')).toContainText('1 documento accodato')
    await expect(page.getByTestId('invio-sdi-saltate')).toHaveCount(0)
    await fp.bottone('invio-sdi-chiudi').click()

    // Subito dopo: in coda (o gia in invio, se il cron e` appena passato).
    const dbRiga = await owner.$queryRawUnsafe<{ stato: string }[]>(
      `SELECT stato::text FROM trasmissioni_sdi WHERE documento_id = $1::uuid`,
      documentoId
    )
    expect(dbRiga).toHaveLength(1)
    // Il documento e` diventato emesso.
    const emesso = await owner.$queryRawUnsafe<{ emesso_il: Date | null }[]>(
      `SELECT emesso_il FROM documenti_fattura WHERE id = $1::uuid`,
      documentoId
    )
    expect(emesso[0].emesso_il).not.toBeNull()
  })

  test('il job d`invio spedisce al fake: il badge passa a «Inviata» senza ricaricare', async () => {
    const riga = page.getByTestId(`documento-${documentoId}`)
    // La lista si rilegge da sola finche' l'invio e` in lavorazione (polling): nessun reload.
    await expect(riga.getByTestId('dl-sdi').locator('[data-stato-sdi]')).toHaveAttribute(
      'data-stato-sdi',
      /^(INVIATA|CONSEGNATA)$/,
      { timeout: 150_000 }
    )
    await expect(riga.getByTestId('dl-sdi')).toContainText(/Inviata|Consegnata/)
    const t = await owner.$queryRawUnsafe<
      { stato: string; id_provider: string | null; tentativi: number }[]
    >(
      `SELECT stato::text, id_provider, tentativi::int FROM trasmissioni_sdi WHERE documento_id = $1::uuid`,
      documentoId
    )
    expect(t).toHaveLength(1)
    expect(t[0].stato).toBe('INVIATA')
    expect(t[0].id_provider).toMatch(/^fake-/)
    expect(t[0].tentativi).toBe(1)
  })

  test('un secondo invio dello stesso documento e` saltato (invio gia in corso o concluso)', async () => {
    await page.goto('/fatturazione/documenti')
    await expect(page.getByTestId(`documento-${documentoId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await page.getByTestId(`dl-sel-${documentoId}`).click()
    await fp.bottone('dl-invia-sdi').click()
    // Il documento e` gia emesso: serve la conferma esplicita.
    await expect(page.getByTestId('invio-sdi-gia-emessi')).toBeVisible()
    await expect(fp.bottone('invio-sdi-ok')).toBeDisabled()
    await page.getByTestId('invio-sdi-conferma-gia-emesso').click()
    await attendiRisposta(page, () => fp.bottone('invio-sdi-ok').click(), {
      metodo: 'POST',
      percorso: /^\/documenti-fattura\/invio-sdi$/,
      stato: [202],
    })
    await expect(page.getByTestId('invio-sdi-esito')).toContainText('0 documenti accodati')
    await expect(page.getByTestId('invio-sdi-saltato')).toContainText(
      'Ha già un invio in corso o concluso'
    )
    const conta = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM trasmissioni_sdi WHERE documento_id = $1::uuid`,
      documentoId
    )
    expect(conta[0].n).toBe(1)
  })

  test('webhook: la ricevuta di consegna firmata porta il badge a «Consegnata» e la cronologia la mostra', async () => {
    const [t] = await owner.$queryRawUnsafe<{ id_provider: string }[]>(
      `SELECT id_provider FROM trasmissioni_sdi WHERE documento_id = $1::uuid`,
      documentoId
    )
    const corpo = Buffer.from(
      JSON.stringify({
        id: `evt-e2e-${Date.now()}`,
        idProvider: t.id_provider,
        notifica: {
          tipo: 'RC',
          esitoCommittente: null,
          codiciErrore: [],
          dataRicezioneSdi: new Date().toISOString(),
          idNotifica: `${t.id_provider}-RC`,
        },
      })
    )
    const ts = Math.floor(Date.now() / 1000)
    const firma = createHmac('sha256', SEGRETO_WEBHOOK).update(`${ts}.`).update(corpo).digest('hex')
    const url = `${getApiUrl()}/sdi/webhook/fake/${tokenWebhook}`
    const invia = (intestazione: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sdi-signature': intestazione },
        body: corpo,
      })
    // Firma sbagliata: 401, nessun dato dell'azienda nella risposta.
    const rifiutata = await invia(`t=${ts},v1=${'0'.repeat(64)}`)
    expect(rifiutata.status).toBe(401)
    expect(await rifiutata.text()).not.toContain(azienda.tenantId)
    const buona = `t=${ts},v1=${firma}`
    expect((await invia(buona)).status).toBe(200)
    // Consegna ripetuta: stesso 200, un solo evento.
    expect((await invia(buona)).status).toBe(200)
    const eventi = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM eventi_sdi_ricevuti WHERE tenant_id = $1::uuid`,
      azienda.tenantId
    )
    expect(eventi[0].n).toBe(1)

    // La lista si rilegge da sola solo per gli invii in lavorazione (DA_INVIARE, IN_INVIO, INCERTA):
    // «Inviata» e` uno stato d'attesa senza polling, quindi dopo il webhook (l'inbox la elabora il job
    // ogni 30 secondi) si ricarica la pagina a ogni tentativo invece di aspettare un badge che non cambia.
    const riga = page.getByTestId(`documento-${documentoId}`)
    await expect(async () => {
      await page.goto('/fatturazione/documenti')
      await expect(riga.getByTestId('dl-sdi')).toContainText('Consegnata', { timeout: 5_000 })
    }).toPass({ timeout: 120_000, intervals: [2_000, 5_000, 10_000] })

    await page.goto(`/fatturazione/documenti/${documentoId}`)
    await expect(page.getByTestId('sc-stato')).toContainText('Consegnata', {
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId('sc-esito-fiscale')).toContainText('Fattura emessa')
    await expect(page.getByTestId('sc-notifiche')).toContainText('Ricevuta di consegna')
    await expect(page.getByTestId('sc-notifiche')).toContainText('Webhook')
  })
})

import { test, expect } from '@playwright/test'
import { getApiUrl } from '../../utils/env'
import { apiPost } from '../../utils/api-client'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { conPrefissoUnico } from '../../utils/run-id'
import { ATTESA_SERVER } from '../../utils/attese'

/**
 * E2E leggero — impostazioni di fatturazione del pezzo 4.4a (Task 12).
 *
 *   1. ADMIN imposta il cedente (e lo rilegge); OPERATOR legge ma la scrittura da' 403.
 *   2. Le numerazioni dell'anno elencano il registro con ultimo numero 0.
 *   3. ADMIN imposta il numero di partenza 120; un numero non valido da' 400 PARTENZA_NON_VALIDA;
 *      OPERATOR 403.
 *   4. Una spesa accessoria si crea con il codice IVA e il registro ha il suffisso.
 *   5. Nessuna rotta di elaborazione esiste ancora: POST /elaborazioni-fatturazione = 404.
 *   6. Schermata: la scheda «Dati del cedente» si apre (screenshot per la revisione del menu
 *      «Socio unico»).
 *
 * Isolamento: AZIENDA DI TEST PROPRIA (`creaAziendaDiTest`); i dati creati dallo spec si
 * ripuliscono solo per id esatti (mai per nome o per data). L'azienda e i dati che non si
 * cancellano (cedente, numerazione) restano nel database di test, riconoscibili dal prefisso
 * della run nella ragione sociale. Nessuna elaborazione ne' documento viene creato.
 */

interface Risposta<T = unknown> {
  stato: number
  corpo: T
}

interface Versionata {
  id: string
  versione: number
}

interface CedenteLetto {
  regimeFiscale: string | null
  reaUfficio: string | null
  capitaleSociale: string | null
  socioUnico: string | null
  statoLiquidazione: string
  versione: number
}

interface Numerazione {
  registroIvaId: string
  codiceRegistro: string
  anno: number
  ultimoNumero: number
  numeroPartenza: number
  dataPartenza: string | null
  partenzaModificabile: boolean
  versione: number
}

interface Spesa extends Versionata {
  codiceIvaId: string | null
}

interface RegistroLetto extends Versionata {
  suffissoNumero: string | null
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function codiceCasuale(n: number): string {
  let c = ''
  while (c.length < n) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  return c
}

/** Chiamata API che restituisce stato e corpo senza lanciare: serve per leggere 400/403/404. */
async function chiama<T = unknown>(
  metodo: string,
  percorso: string,
  token: string,
  corpo?: unknown
): Promise<Risposta<T>> {
  const r = await fetch(`${getApiUrl()}${percorso}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const testo = await r.text()
  let json: unknown = testo
  try {
    json = testo ? JSON.parse(testo) : null
  } catch {
    /* corpo non JSON: resta il testo */
  }
  return { stato: r.status, corpo: json as T }
}

/** Anno corrente (UTC va bene: l'anno del test non cambia a cavallo di mezzanotte in modo utile). */
const ANNO = new Date().getFullYear()

const dbLocale = clientDbLocale()
let azienda: AziendaDiTest

/** Risorse create dallo spec, cancellate in `afterAll` per id esatto, in ordine inverso. */
const creati: { tipo: string; id: string }[] = []
const d = { registroId: '', codiceIvaId: '', spesaId: '' }

test.describe('Impostazioni di fatturazione 4.4a (cedente, numerazione, spese)', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(
    dbLocale === null,
    "Serve un database locale (DATABASE_URL su localhost) per creare l'azienda di test dedicata"
  )

  test.beforeAll(async () => {
    if (!dbLocale) return
    creati.length = 0
    azienda = await creaAziendaDiTest(dbLocale, 'impostazioni fatturazione 4-4')
    const token = await tokenAzienda(azienda, 'admin')
    // Registro con suffisso (azienda nuova: il codice 01 e' libero).
    const registro = await apiPost<RegistroLetto>(
      '/registri-iva',
      {
        codice: '01',
        descrizione: conPrefissoUnico('Registro 4.4a'),
        ricevuteSplit: false,
        suffissoNumero: '/A',
      },
      token
    )
    creati.push({ tipo: 'registri-iva', id: registro.id })
    d.registroId = registro.id
    const iva = await apiPost<Versionata>(
      '/codici-iva',
      { codice: codiceCasuale(3), descrizione: conPrefissoUnico('IVA 22'), aliquota: '22' },
      token
    )
    creati.push({ tipo: 'codici-iva', id: iva.id })
    d.codiceIvaId = iva.id
  })

  test.afterAll(async () => {
    await dbLocale?.$disconnect()
    if (!azienda) return
    const token = await tokenAzienda(azienda, 'admin')
    const errori: string[] = []
    for (const { tipo, id } of [...creati].reverse()) {
      try {
        let r = await chiama('DELETE', `/${tipo}/${id}`, token)
        if (r.stato < 400) continue
        // In uso (per esempio un registro con la numerazione): si disattiva.
        const riga = await chiama<Versionata>('GET', `/${tipo}/${id}`, token)
        if (riga.stato >= 400) {
          errori.push(`${tipo}/${id}: lettura ${riga.stato}`)
          continue
        }
        const campo = tipo === 'spese-accessorie' ? 'attiva' : 'attivo'
        r = await chiama('PATCH', `/${tipo}/${id}`, token, {
          [campo]: false,
          versione: riga.corpo.versione,
        })
        if (r.stato >= 400) errori.push(`${tipo}/${id}: ${r.stato}`)
      } catch (e) {
        errori.push(`${tipo}/${id}: ${(e as Error).message}`)
      }
    }
    expect(errori, 'pulizia dei dati creati dallo spec').toEqual([])
  })

  test('ADMIN imposta il cedente; OPERATOR lo legge ma non lo scrive (403)', async () => {
    const admin = await tokenAzienda(azienda, 'admin')
    const prima = await chiama<CedenteLetto>('GET', '/cedente-fatturazione', admin)
    expect(prima.stato).toBe(200)
    expect(prima.corpo.versione).toBe(0)
    expect(prima.corpo.socioUnico).toBeNull()

    const corpo = {
      regimeFiscale: 'RF01',
      reaUfficio: 'MI',
      capitaleSociale: '1000.50',
      socioUnico: null,
      statoLiquidazione: 'LN',
      versione: prima.corpo.versione,
    }
    const salvato = await chiama<CedenteLetto>('PUT', '/cedente-fatturazione', admin, corpo)
    expect(salvato.stato, JSON.stringify(salvato.corpo)).toBe(200)
    expect(salvato.corpo.regimeFiscale).toBe('RF01')
    expect(salvato.corpo.reaUfficio).toBe('MI')
    expect(salvato.corpo.capitaleSociale).toBe('1000.50')
    expect(salvato.corpo.socioUnico).toBeNull()
    expect(salvato.corpo.versione).toBe(1)

    // Versione vecchia: 409, nulla cambia. Regime non ammesso: 400.
    const vecchia = await chiama('PUT', '/cedente-fatturazione', admin, { ...corpo, versione: 0 })
    expect(vecchia.stato).toBe(409)
    const errato = await chiama('PUT', '/cedente-fatturazione', admin, {
      ...corpo,
      regimeFiscale: 'XX99',
      versione: 1,
    })
    expect(errato.stato).toBe(400)

    const operator = await tokenAzienda(azienda, 'operator')
    const letto = await chiama<CedenteLetto>('GET', '/cedente-fatturazione', operator)
    expect(letto.stato).toBe(200)
    expect(letto.corpo.regimeFiscale).toBe('RF01')
    const vietato = await chiama('PUT', '/cedente-fatturazione', operator, {
      ...corpo,
      versione: 1,
    })
    expect(vietato.stato).toBe(403)

    const rilettura = await chiama<CedenteLetto>('GET', '/cedente-fatturazione', admin)
    expect(rilettura.corpo.versione).toBe(1)
    expect(rilettura.corpo.capitaleSociale).toBe('1000.50')
  })

  test("le numerazioni dell'anno elencano il registro con ultimo numero 0", async () => {
    const token = await tokenAzienda(azienda, 'operator')
    const r = await chiama<Numerazione[]>('GET', `/numerazioni-fattura?anno=${ANNO}`, token)
    expect(r.stato).toBe(200)
    const mia = r.corpo.find(n => n.registroIvaId === d.registroId)
    expect(mia, 'il registro creato compare fra le numerazioni').toBeDefined()
    expect(mia).toMatchObject({
      codiceRegistro: '01',
      anno: ANNO,
      ultimoNumero: 0,
      numeroPartenza: 0,
      dataPartenza: null,
      partenzaModificabile: true,
      versione: 0,
    })
  })

  test('ADMIN imposta il numero di partenza 120; valori non validi e OPERATOR respinti', async () => {
    const admin = await tokenAzienda(azienda, 'admin')
    const percorso = `/numerazioni-fattura/${d.registroId}/${ANNO}`

    const salvata = await chiama<Numerazione>('PUT', percorso, admin, {
      numeroPartenza: 120,
      dataPartenza: null,
      versione: 0,
    })
    expect(salvata.stato, JSON.stringify(salvata.corpo)).toBe(200)
    expect(salvata.corpo.numeroPartenza).toBe(120)
    expect(salvata.corpo.ultimoNumero).toBe(120)
    expect(salvata.corpo.partenzaModificabile).toBe(true)

    const elenco = await chiama<Numerazione[]>('GET', `/numerazioni-fattura?anno=${ANNO}`, admin)
    const mia = elenco.corpo.find(n => n.registroIvaId === d.registroId)
    expect(mia?.ultimoNumero).toBe(120)
    expect(mia?.numeroPartenza).toBe(120)

    // Data di un altro anno: PARTENZA_NON_VALIDA (400), nulla cambia.
    const altroAnno = await chiama<{ error: string }>('PUT', percorso, admin, {
      numeroPartenza: 5,
      dataPartenza: `${ANNO - 1}-01-15`,
      versione: salvata.corpo.versione,
    })
    expect(altroAnno.stato).toBe(400)
    expect(altroAnno.corpo.error).toBe('PARTENZA_NON_VALIDA')
    const invariata = await chiama<Numerazione[]>('GET', `/numerazioni-fattura?anno=${ANNO}`, admin)
    expect(invariata.corpo.find(n => n.registroIvaId === d.registroId)?.ultimoNumero).toBe(120)

    const operator = await tokenAzienda(azienda, 'operator')
    const vietato = await chiama('PUT', percorso, operator, {
      numeroPartenza: 7,
      dataPartenza: null,
      versione: salvata.corpo.versione,
    })
    expect(vietato.stato).toBe(403)
  })

  test('una spesa accessoria si crea con il codice IVA; il registro porta il suffisso', async () => {
    const token = await tokenAzienda(azienda, 'admin')
    const spesa = await apiPost<Spesa>(
      '/spese-accessorie',
      {
        tipo: 'INCASSO',
        codice: codiceCasuale(6),
        descrizione: conPrefissoUnico('Spesa di incasso'),
        importo: '2.50',
        codiceIvaId: d.codiceIvaId,
      },
      token
    )
    creati.push({ tipo: 'spese-accessorie', id: spesa.id })
    d.spesaId = spesa.id
    expect(spesa.codiceIvaId).toBe(d.codiceIvaId)

    const letta = await chiama<Spesa>('GET', `/spese-accessorie/${spesa.id}`, token)
    expect(letta.stato).toBe(200)
    expect(letta.corpo.codiceIvaId).toBe(d.codiceIvaId)

    const registro = await chiama<RegistroLetto>('GET', `/registri-iva/${d.registroId}`, token)
    expect(registro.stato).toBe(200)
    expect(registro.corpo.suffissoNumero).toBe('/A')

    // Codice IVA inesistente: la spesa non si crea.
    const inesistente = await chiama('POST', '/spese-accessorie', token, {
      tipo: 'INCASSO',
      codice: codiceCasuale(6),
      descrizione: conPrefissoUnico('Spesa senza IVA valida'),
      importo: '1.00',
      codiceIvaId: '00000000-0000-4000-8000-000000000000',
    })
    expect(inesistente.stato).toBeGreaterThanOrEqual(400)
    expect(inesistente.stato).toBeLessThan(500)
  })

  test('nessuna rotta di elaborazione esiste ancora (4.4b): POST /elaborazioni-fatturazione = 404', async () => {
    const token = await tokenAzienda(azienda, 'admin')
    const r = await chiama('POST', '/elaborazioni-fatturazione', token, {})
    expect(r.stato).toBe(404)
  })

  test('la scheda «Dati del cedente» si apre e mostra il menu «Socio unico»', async ({ page }) => {
    await accediUiComeAzienda(page, azienda, 'admin')
    await page.goto('/clienti/fatturazione')
    const pagina = page.locator('#main-content')
    await expect(
      pagina.getByRole('heading', { level: 1, name: 'Impostazioni di fatturazione' })
    ).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await pagina.getByRole('tab', { name: 'Dati del cedente' }).click()
    await expect(pagina.getByTestId('cedente-socio')).toBeVisible({ timeout: ATTESA_SERVER })
    // Nessun valore scelto: il menu mostra il segnaposto «Non indicato».
    await expect(pagina.getByTestId('cedente-socio')).toContainText('Non indicato')
    const percorsoScreenshot = process.env.E2E_SCREENSHOT_CEDENTE
    if (percorsoScreenshot) {
      await page.screenshot({ path: percorsoScreenshot, fullPage: true })
    }
  })
})

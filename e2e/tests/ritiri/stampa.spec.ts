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
import { chiama, chiamaBinario, giornoItaliano } from '../../utils/legami-api'
import {
  creaAnagraficheRitiri,
  creaRitiri,
  eliminaAnagraficheRitiri,
  leggiRitiro,
  type AnagraficaCreata,
  type AnagraficheRitiri,
  type RitiroVisto,
} from '../../utils/ritiri-api'

/**
 * E2E UI — Stampa ed emissione in serie dai ritiri (4.7, T19).
 *
 * Scenario: tre ritiri di oggi in ordine di giro → «Genera FIR» sui primi due → «Emetti FIR» in serie
 * (numeri consecutivi nell'ordine della lista) → «Stampa FIR» dalla UI (il frontend manda solo i ritiri con FIR:
 * `X-Ritiri-Saltati: 0`) e via API con anche il terzo, senza FIR, che viene saltato (`X-Ritiri-Saltati: 1`) → «Distinta» del giorno. Lato API: «stampa FIR» di un solo
 * ritiro senza FIR risponde 400 `NESSUN_FIR_DA_STAMPARE`.
 * La mancanza di firma o di certificato durante l'emissione non si puo' provocare in modo
 * deterministico da qui: la copre lo spec Karma del dialog di emissione.
 *
 * Isolamento. Un'azienda PROFESSIONAL dedicata creata in `beforeAll`, mai l'azienda seed. Pulizia per
 * id ESATTI in `afterAll`: FIR, ritiri (non hanno cancellazione HTTP: si tolgono dal database
 * locale dopo i FIR che li referenziano), anagrafiche, poi utenti e azienda.
 *
 * Sessione unica per utente: durante il test le chiamate API riusano il token della pagina.
 */

const db = clientDbLocale()

let pro: AziendaDiTest
let anagrafiche: AnagraficheRitiri
const anagraficheCreate: AnagraficaCreata[] = []
const ritiriCreati: string[] = []
const firCreati = new Set<string>()

async function tokenDellaPagina(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('accessToken'))
  expect(token, 'token di sessione nella pagina').toBeTruthy()
  return token!
}

function ricorda(ritiri: RitiroVisto[]): void {
  ritiri.forEach(r => ritiriCreati.push(r.id))
}

test.describe('Stampa ed emissione in serie dai ritiri', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(
    db === null,
    'Serve un database locale (DATABASE_URL su localhost) per creare l’azienda di test dedicata'
  )

  test.beforeAll(async () => {
    if (!db) return
    pro = await creaAziendaDiTest(db, 'ritiri stampa', 'PROFESSIONAL')
    anagrafiche = await creaAnagraficheRitiri(await tokenAzienda(pro, 'admin'), anagraficheCreate)
  })

  test.afterAll(async () => {
    if (!db) return
    const problemi: string[] = []
    try {
      // Ordine imposto dalle chiavi esterne: FIR → ritiri → anagrafiche → azienda.
      const esitoFir = await eliminaFirConPrefisso([...firCreati])
      problemi.push(...esitoFir.residue)
      if (ritiriCreati.length) {
        await db.ritiro
          .deleteMany({ where: { id: { in: ritiriCreati }, tenantId: pro.tenantId } })
          .catch(e => problemi.push(`ritiri: ${(e as Error).message.split('\n').pop()}`))
      }
      if (pro) {
        const token = await tokenAzienda(pro, 'admin')
        problemi.push(...(await eliminaAnagraficheRitiri(token, anagraficheCreate)))
        problemi.push(...(await eliminaAziendaDiTest(db, pro)))
      }
      expect(problemi, 'pulizia dei dati creati dallo spec').toEqual([])
    } finally {
      await db.$disconnect()
    }
  })

  test('genera i FIR, li emette in serie, stampa i FIR e scarica la distinta del giorno', async ({
    page,
  }) => {
    await accediUiComeAzienda(page, pro, 'admin')
    const token = await tokenDellaPagina(page)
    const oggi = giornoItaliano()
    // Creati in ordine diverso da quello di giro: secondo, primo, terzo.
    const [secondo] = await creaRitiri(token, anagrafiche, { data: oggi, ordineGiro: 2 })
    const [primo] = await creaRitiri(token, anagrafiche, { data: oggi, ordineGiro: 1 })
    const [terzo] = await creaRitiri(token, anagrafiche, { data: oggi, ordineGiro: 3 })
    ricorda([secondo, primo, terzo])

    await page.goto('/ritiri')
    for (const r of [primo, secondo, terzo]) {
      await expect(page.getByTestId(`ri-riga-${r.id}`)).toContainText('Da generare', {
        timeout: ATTESA_SERVER,
      })
    }

    // 1. Genera le bozze dei primi due.
    await page.getByTestId(`ri-sel-${primo.id}`).check()
    await page.getByTestId(`ri-sel-${secondo.id}`).check()
    await attendiRisposta(page, () => page.getByTestId('ri-genera').click(), {
      metodo: 'POST',
      percorso: '/ritiri/genera-fir',
    })
    await expect(page.getByTestId('eg-riepilogo')).toBeVisible({ timeout: ATTESA_SERVER })
    await page.getByTestId('eg-chiudi').click()
    for (const r of [primo, secondo]) {
      await expect(page.getByTestId(`ri-riga-${r.id}`)).toContainText('FIR in bozza', {
        timeout: ATTESA_SERVER,
      })
      const firId = (await leggiRitiro(token, r.id)).fir?.id
      expect(firId, `FIR del ritiro ${r.id}`).toBeTruthy()
      firCreati.add(firId!)
      registra('fir', firId!)
    }
    await expect(page.getByTestId(`ri-riga-${terzo.id}`)).toContainText('Da generare')

    // 2. Emissione in serie: «Emetti FIR» considera solo le bozze spuntate.
    await page.getByTestId(`ri-sel-${primo.id}`).check()
    await page.getByTestId(`ri-sel-${secondo.id}`).check()
    await page.getByTestId(`ri-sel-${terzo.id}`).check()
    await page.getByTestId('ri-emetti').click()
    await expect(page.getByTestId('em-chiudi')).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(page.getByTestId('em-riepilogo')).toContainText('2 emessi')
    await expect(page.getByTestId('em-stop')).toHaveCount(0)
    await expect(page.getByTestId(`em-riga-${primo.id}`)).toContainText('Emesso')
    await expect(page.getByTestId(`em-riga-${secondo.id}`)).toContainText('Emesso')
    await page.getByTestId('em-chiudi').click()
    for (const r of [primo, secondo]) {
      await expect(page.getByTestId(`ri-riga-${r.id}`)).toContainText('FIR emesso', {
        timeout: ATTESA_SERVER,
      })
    }
    // Numeri progressivi nell'ordine della lista (giro 1, poi 2) e senza buchi.
    const numero = async (id: string): Promise<number> => {
      const n = (await leggiRitiro(token, id)).fir?.numero ?? ''
      const m = /^FIR-\d{4}-(\d{6})$/.exec(n)
      expect(m, `numero del FIR del ritiro ${id}`).not.toBeNull()
      return Number(m![1])
    }
    expect(await numero(secondo.id)).toBe((await numero(primo.id)) + 1)

    // 3. Stampa FIR dalla UI: tre ritiri spuntati, ma il frontend manda solo quelli con un FIR
    //    (il terzo non ne ha): la richiesta porta due id e nessuno e' saltato.
    await page.getByTestId(`ri-sel-${primo.id}`).check()
    await page.getByTestId(`ri-sel-${secondo.id}`).check()
    await page.getByTestId(`ri-sel-${terzo.id}`).check()
    const stampa = await attendiRisposta(page, () => page.getByTestId('ri-stampa-fir').click(), {
      metodo: 'POST',
      percorso: '/ritiri/stampa-fir',
    })
    expect(stampa.headers()['content-type']).toContain('application/pdf')
    expect((stampa.request().postDataJSON() as { ritiroIds: string[] }).ritiroIds.sort()).toEqual(
      [primo.id, secondo.id].sort()
    )
    expect(stampa.headers()['x-ritiri-saltati']).toBe('0')
    expect((await stampa.body()).subarray(0, 4).toString()).toBe('%PDF')

    // Lato API: con anche il terzo ritiro (senza FIR) il backend lo salta e lo conta.
    const conSaltato = await chiamaBinario('POST', '/ritiri/stampa-fir', token, {
      ritiroIds: [primo.id, secondo.id, terzo.id],
    })
    expect(conSaltato.stato).toBe(200)
    expect(conSaltato.headers.get('x-ritiri-saltati')).toBe('1')
    expect(conSaltato.corpo.subarray(0, 4).toString()).toBe('%PDF')

    // 4. Distinta del giorno (nessun filtro: propone oggi, tutti i mezzi).
    await page.getByTestId('ri-distinta').click()
    const distinta = await attendiRisposta(page, () => page.getByTestId('di-scarica').click(), {
      metodo: 'GET',
      percorso: '/ritiri/distinta.pdf',
    })
    expect(distinta.headers()['content-type']).toContain('application/pdf')
    expect(distinta.headers()['content-disposition']).toContain('distinta-ritiri-')
    expect((await distinta.body()).subarray(0, 4).toString()).toBe('%PDF')

    // Emettere di nuovo un FIR gia' emesso: 409 col codice che il frontend legge come «gia' emesso».
    const firPrimo = (await leggiRitiro(token, primo.id)).fir!.id
    const doppia = await chiama<{ error?: string }>('POST', `/fir/${firPrimo}/emetti`, token, {})
    expect(doppia.stato).toBe(409)
    expect(doppia.corpo.error).toBe('FIR_NON_PIU_IN_BOZZA')

    // Lato API: un solo ritiro, e senza FIR, non da' nessun PDF.
    const nessuno = await chiama<{ error?: string }>('POST', '/ritiri/stampa-fir', token, {
      ritiroIds: [terzo.id],
    })
    expect(nessuno.stato).toBe(400)
    expect(nessuno.corpo.error).toBe('NESSUN_FIR_DA_STAMPARE')
  })

  test('un VIEWER seleziona i ritiri e stampa i FIR, senza comandi di scrittura', async ({
    page,
  }) => {
    // il ritiro lo crea l'admin via API (non apre una sessione UI), il VIEWER lo vede e basta
    const tokenAdmin = await tokenAzienda(pro, 'admin')
    const [ritiro] = await creaRitiri(tokenAdmin, anagrafiche, {
      data: giornoItaliano(),
      ordineGiro: 9,
    })
    ricorda([ritiro])

    await accediUiComeAzienda(page, pro, 'viewer')
    await page.goto('/ritiri')
    const riga = page.getByTestId(`ri-riga-${ritiro.id}`)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(page.getByTestId(`ri-sel-${ritiro.id}`)).toBeEnabled()
    await expect(page.getByTestId('ri-sel-tutti')).toBeVisible()
    await expect(page.getByTestId('ri-stampa-fir')).toBeVisible()
    await expect(page.getByTestId('ri-distinta')).toBeVisible()
    for (const id of ['ri-genera', 'ri-emetti', 'ri-nuovo', `ri-azioni-${ritiro.id}`]) {
      await expect(page.getByTestId(id), id).toHaveCount(0)
    }
  })
})

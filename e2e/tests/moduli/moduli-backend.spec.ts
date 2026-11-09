import { test, expect } from '@playwright/test'
import type { PrismaClient } from '@prisma/client'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  creaSuperAdminDiTest,
  eliminaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { devLoginTokens } from '../../utils/api-client'
import { getApiUrl } from '../../utils/env'
import { attendiElenco, ATTESA_SERVER, percorsoApi } from '../../utils/attese'
import { chiama } from '../../utils/legami-api'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { conPrefissoUnico } from '../../utils/run-id'

/**
 * E2E dei moduli commerciali chiusi nel backend (T13), contro backend, Postgres e Redis reali.
 *
 * Due aziende di prova create qui: TRIAL (fir, cer, anagrafiche, registro) e PROFESSIONAL (+ mud,
 * giacenze, contratti, esg, anomalie, pese; senza rentri), piu' un SUPER_ADMIN nella PROFESSIONAL.
 * Si lavora SOLO su queste: nessun modulo di aziende altrui viene toccato.
 *
 * API: i moduli mancanti rispondono 403 `MODULO_NON_ATTIVO`; il SUPER_ADMIN attiva e toglie moduli
 * (PUT /admin/tenants/:id) e l'effetto vale dalla richiesta successiva.
 * UI: un deep link a un modulo non attivo porta alla dashboard con il toast; con PROFESSIONAL il
 * dettaglio FIR e il registro si aprono senza redirect e senza chiamate RENTRI (C1 della revisione).
 *
 * Pulizia per id esatti: il FIR e le tre anagrafiche, poi utenti e aziende. Senza un database
 * locale (client del proprietario) lo spec si salta con un messaggio.
 */

const db = clientDbLocale()
const MESSAGGIO = "Il modulo non è attivo per l'azienda selezionata."
const MODULI_TRIAL = ['fir', 'cer', 'anagrafiche', 'registro']

const SEDE = { via: 'Via Roma', civico: '1', cap: '20100', comune: 'Milano', provincia: 'MI' }

test.describe('Moduli chiusi nel backend', () => {
  test.skip(
    !db,
    'DATABASE_URL non e` un database locale: senza il client del proprietario non si creano ' +
      'le aziende di prova TRIAL e PROFESSIONAL'
  )
  test.describe.configure({ mode: 'serial' })

  let owner: PrismaClient
  let trial: AziendaDiTest
  let pro: AziendaDiTest
  let superAdmin: { id: string; email: string }
  let firId = ''
  const anagrafiche: Array<{ percorso: string; id: string }> = []
  const problemiPulizia: string[] = []

  const token = (a: AziendaDiTest, ruolo: 'admin' | 'viewer' = 'admin') => tokenAzienda(a, ruolo)

  /** Corpo di un 403 per modulo non attivo, con le chiavi che avrebbero consentito l'accesso. */
  const moduloNonAttivo = (moduli: string[]) => ({
    error: 'MODULO_NON_ATTIVO',
    message: MESSAGGIO,
    details: { moduli },
  })

  async function creaAnagrafica(
    tk: string,
    percorso: 'produttori' | 'trasportatori' | 'destinatari',
    corpo: Record<string, unknown>
  ): Promise<string> {
    const r = await chiama<{ id: string }>('POST', `/registry/${percorso}`, tk, {
      ragioneSociale: conPrefissoUnico(`Moduli ${percorso}`),
      partitaIVA: partitaIvaCasualeValida(),
      pec: 'pec@esempio.it',
      ...corpo,
    })
    expect(r.stato, `POST /registry/${percorso}: ${JSON.stringify(r.corpo)}`).toBe(201)
    anagrafiche.push({ percorso, id: r.corpo.id })
    return r.corpo.id
  }

  /** Crea un FIR in BOZZA nella PROFESSIONAL (cerca un CER accettato dal catalogo). */
  async function creaFir(tk: string): Promise<string> {
    const produttoreId = await creaAnagrafica(tk, 'produttori', { sedeLegale: SEDE })
    const trasportatoreId = await creaAnagrafica(tk, 'trasportatori', {
      sedeLegale: SEDE,
      numeroIscrizione: `MI/${Math.floor(Math.random() * 900000 + 100000)}`,
    })
    const destinatarioId = await creaAnagrafica(tk, 'destinatari', {
      sede: SEDE,
      numeroAutorizzazione: `AUT/2026/${Math.floor(Math.random() * 9000 + 1000)}`,
    })
    const catalogo = await chiama<{ items: Array<{ code: string }> }>('GET', '/cer?limit=50', tk)
    expect(catalogo.stato).toBe(200)
    let ultimo = ''
    for (const voce of catalogo.corpo.items) {
      const r = await chiama<{ id: string }>('POST', '/fir', tk, {
        produttoreId,
        trasportatoreId,
        destinatarioId,
        rifiuto: { cerCode: voce.code, quantita: 10 },
        provenienza: 'SPECIALE',
        tipoTrattaPrincipale: 'TERRESTRE',
      })
      if (r.stato === 201) return r.corpo.id
      ultimo = `${r.stato} ${JSON.stringify(r.corpo)}`
      // Si prova un altro CER solo se e' il catalogo a rifiutare il codice.
      if (!/CER code not found|non è più valido/i.test(ultimo)) break
    }
    throw new Error(`nessun FIR creabile nella PROFESSIONAL: ${ultimo}`)
  }

  /** Imposta i moduli di UN'azienda creata da questo spec, come SUPER_ADMIN (PUT /admin/tenants/:id). */
  async function impostaModuli(azienda: AziendaDiTest, moduli: string[] | null): Promise<void> {
    const tk = (await devLoginTokens(superAdmin.email)).accessToken
    const r = await chiama('PUT', `/admin/tenants/${azienda.tenantId}`, tk, {
      featureFlags: moduli,
    })
    expect(r.stato, `PUT /admin/tenants/${azienda.tenantId}: ${JSON.stringify(r.corpo)}`).toBe(200)
  }

  test.beforeAll(async () => {
    owner = db!
    trial = await creaAziendaDiTest(owner, 'Moduli TRIAL', 'TRIAL')
    pro = await creaAziendaDiTest(owner, 'Moduli PRO', 'PROFESSIONAL')
    superAdmin = await creaSuperAdminDiTest(owner, pro.tenantId, 'Moduli')
    firId = await creaFir(await token(pro))
  })

  test.afterAll(async () => {
    if (!owner) return
    try {
      const tk = await token(pro)
      // Il FIR non ha un endpoint di cancellazione: per id esatto sul database di test.
      if (firId) await owner.fIR.deleteMany({ where: { id: firId } })
      for (const { percorso, id } of [...anagrafiche].reverse()) {
        const r = await chiama('DELETE', `/registry/${percorso}/${id}`, tk)
        if (r.stato >= 400 && r.stato !== 404) problemiPulizia.push(`${percorso}/${id}: ${r.stato}`)
      }
    } catch (e) {
      problemiPulizia.push(`anagrafiche/FIR: ${(e as Error).message}`)
    }
    if (trial) problemiPulizia.push(...(await eliminaAziendaDiTest(owner, trial)))
    if (pro) problemiPulizia.push(...(await eliminaAziendaDiTest(owner, pro, [superAdmin.id])))
    if (problemiPulizia.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[moduli] pulizia incompleta (warning): ${problemiPulizia.join(' | ')}`)
    }
    await owner.$disconnect()
  })

  test.describe('API con azienda TRIAL', () => {
    for (const percorso of ['/clienti', '/documenti-fattura', '/giacenze', '/rentri/credential']) {
      test(`GET ${percorso} -> 403 MODULO_NON_ATTIVO`, async () => {
        const r = await chiama<Record<string, unknown>>('GET', percorso, await token(trial))
        expect(r.stato, JSON.stringify(r.corpo)).toBe(403)
        expect(r.corpo).toMatchObject({ error: 'MODULO_NON_ATTIVO', message: MESSAGGIO })
        expect(r.corpo).toHaveProperty('details.moduli')
      })
    }

    test('/pdf/mud/:year -> 403 su TRIAL, e il modulo richiesto e` mud', async () => {
      const r = await chiama<Record<string, unknown>>('GET', '/pdf/mud/2025', await token(trial))
      expect(r.stato, JSON.stringify(r.corpo)).toBe(403)
      expect(r.corpo).toMatchObject(moduloNonAttivo(['mud']))
    })

    test('/fir e /registro (moduli del piano) -> 200', async () => {
      const tk = await token(trial)
      for (const percorso of ['/fir', '/registro']) {
        const r = await chiama('GET', percorso, tk)
        expect(r.stato, `${percorso}: ${JSON.stringify(r.corpo)}`).toBe(200)
      }
    })

    test('/cer senza token -> 401 (mai aperto)', async () => {
      const r = await fetch(`${getApiUrl()}/cer?limit=1`)
      expect(r.status).toBe(401)
    })

    test('un utente VIEWER di TRIAL riceve lo stesso 403 (il modulo e` dell azienda, non del ruolo)', async () => {
      const r = await chiama('GET', '/clienti', await token(trial, 'viewer'))
      expect(r.stato).toBe(403)
      expect((r.corpo as { error: string }).error).toBe('MODULO_NON_ATTIVO')
    })
  })

  test.describe('API con azienda PROFESSIONAL', () => {
    test('i moduli del piano rispondono 200 e rentri resta chiuso', async () => {
      const tk = await token(pro)
      for (const percorso of ['/clienti', '/documenti-fattura', '/giacenze', '/fir', '/registro']) {
        const r = await chiama('GET', percorso, tk)
        expect(r.stato, `${percorso}: ${JSON.stringify(r.corpo)}`).toBe(200)
      }
      const rentri = await chiama('GET', '/rentri/credential', tk)
      expect(rentri.stato).toBe(403)
      expect((rentri.corpo as { error: string }).error).toBe('MODULO_NON_ATTIVO')
    })

    test('/pdf/mud/:year non e` respinto per modulo (mud e` nel piano)', async () => {
      const r = await chiama<{ error?: string }>('GET', '/pdf/mud/2025', await token(pro))
      expect(r.corpo?.error).not.toBe('MODULO_NON_ATTIVO')
    })
  })

  test.describe('SUPER_ADMIN cambia i moduli di un azienda: vale subito', () => {
    test('attiva `contratti` sulla TRIAL -> 200 subito; toglie `fir` -> 403; poi ripristina il piano', async () => {
      try {
        expect((await chiama('GET', '/clienti', await token(trial))).stato).toBe(403)

        await impostaModuli(trial, [...MODULI_TRIAL, 'contratti'])
        const aperto = await chiama('GET', '/clienti', await token(trial))
        expect(aperto.stato, JSON.stringify(aperto.corpo)).toBe(200)

        // Senza `fir`: le rotte solo-fir si chiudono...
        await impostaModuli(trial, ['cer', 'anagrafiche', 'registro', 'contratti'])
        const tk = await token(trial)
        const idQualunque = '00000000-0000-4000-8000-000000000001'
        for (const percorso of [`/fir/${idQualunque}`, `/pdf/fir/${idQualunque}`]) {
          const r = await chiama<Record<string, unknown>>('GET', percorso, tk)
          expect(r.stato, `${percorso}: ${JSON.stringify(r.corpo)}`).toBe(403)
          expect(r.corpo).toMatchObject(moduloNonAttivo(['fir']))
        }
        // ...mentre la lista FIR resta leggibile per `registro` (lettura trasversale) e contratti passa.
        expect((await chiama('GET', '/fir', tk)).stato).toBe(200)
        expect((await chiama('GET', '/clienti', tk)).stato).toBe(200)
      } finally {
        await impostaModuli(trial, null) // torna al solo piano TRIAL
      }
      const dopo = await token(trial)
      expect((await chiama('GET', '/clienti', dopo)).stato).toBe(403)
      expect((await chiama('GET', '/fir', dopo)).stato).toBe(200)
    })

    test('SUPER_ADMIN con X-Tenant-ID verso la TRIAL vale come la TRIAL; senza header vale la sua azienda', async () => {
      const tk = (await devLoginTokens(superAdmin.email)).accessToken
      const conHeader = await fetch(`${getApiUrl()}/clienti`, {
        headers: { Authorization: `Bearer ${tk}`, 'X-Tenant-ID': trial.tenantId },
      })
      expect(conHeader.status).toBe(403)
      expect(((await conHeader.json()) as { error: string }).error).toBe('MODULO_NON_ATTIVO')
      // Senza header: azienda di casa (PROFESSIONAL, ha contratti).
      expect((await chiama('GET', '/clienti', tk)).stato).toBe(200)
    })
  })

  test.describe('UI', () => {
    test('TRIAL: /fatturazione scritto a mano porta alla dashboard con il toast', async ({
      page,
    }) => {
      await accediUiComeAzienda(page, trial, 'admin')
      await page.goto('/fatturazione')
      await expect(page).toHaveURL(/\/dashboard/, { timeout: ATTESA_SERVER })
      await expect(page.getByText(MESSAGGIO).first()).toBeVisible({ timeout: ATTESA_SERVER })
    })

    test('PROFESSIONAL: il dettaglio FIR si apre senza redirect e senza chiamate RENTRI', async ({
      page,
    }) => {
      await accediUiComeAzienda(page, pro, 'admin')

      const richieste: Array<{ metodo: string; percorso: string }> = []
      const respinte: string[] = []
      page.on('request', r => {
        const percorso = percorsoApi(r.url())
        if (percorso) richieste.push({ metodo: r.method(), percorso })
      })
      page.on('response', r => {
        if (r.status() === 403 && percorsoApi(r.url())) respinte.push(percorsoApi(r.url())!)
      })

      const dettaglio = attendiElenco(page, new RegExp(`^/fir/${firId}$`))
      await page.goto(`/fir/${firId}`)
      await dettaglio
      await expect(page.getByTestId('fir-detail-numero')).toBeVisible({ timeout: ATTESA_SERVER })
      await expect(page).toHaveURL(new RegExp(`/fir/${firId}$`))
      // Lasciamo scorrere il tempo in cui i pannelli RENTRI (se ci fossero) farebbero la loro chiamata.
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(new RegExp(`/fir/${firId}$`))

      expect(
        richieste.filter(r => r.percorso.startsWith('/rentri')),
        'nessuna chiamata RENTRI senza il modulo rentri'
      ).toEqual([])
      expect(respinte, 'nessuna chiamata respinta con 403').toEqual([])
    })

    test('PROFESSIONAL: il registro si apre senza redirect e senza chiamate RENTRI', async ({
      page,
    }) => {
      await accediUiComeAzienda(page, pro, 'admin')

      const rentri: string[] = []
      const respinte: string[] = []
      page.on('request', r => {
        const percorso = percorsoApi(r.url())
        if (percorso?.startsWith('/rentri')) rentri.push(`${r.method()} ${percorso}`)
      })
      page.on('response', r => {
        if (r.status() === 403 && percorsoApi(r.url())) respinte.push(percorsoApi(r.url())!)
      })

      const elenco = attendiElenco(page, /^\/registro$/)
      await page.goto('/registro')
      await elenco
      // La lista puo' essere vuota: basta che la pagina sia quella del registro.
      await expect(page.getByTestId('registro-nuovo')).toBeVisible({ timeout: ATTESA_SERVER })
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/registro$/)

      expect(rentri, 'nessuna chiamata RENTRI senza il modulo rentri').toEqual([])
      expect(respinte, 'nessuna chiamata respinta con 403').toEqual([])
    })
  })
})

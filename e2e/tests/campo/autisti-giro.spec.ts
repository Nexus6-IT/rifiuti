import { test, expect } from '@playwright/test'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  eliminaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { devLoginTokens } from '../../utils/api-client'
import { ATTESA_SERVER, attendiRisposta } from '../../utils/attese'
import { chiama, giornoItaliano, ok } from '../../utils/legami-api'
import {
  creaAnagraficheRitiri,
  creaRitiri,
  eliminaAnagraficheRitiri,
  type AnagraficaCreata,
  type AnagraficheRitiri,
} from '../../utils/ritiri-api'

/**
 * E2E - App campo P1 (T4): anagrafica autisti in ufficio, assegnazione ai ritiri e giro
 * dell'autista; un utente AUTISTA non raggiunge nessuna rotta d'ufficio.
 *
 * Isolamento: un'azienda ENTERPRISE dedicata (il modulo `campo` e' solo ENTERPRISE) creata in
 * `beforeAll`, mai l'azienda seed; l'utente AUTISTA e' creato qui direttamente nel database locale
 * (la creazione utenti passa da Keycloak). Pulizia per id ESATTI: ritiri, autisti, anagrafiche,
 * poi utenti e azienda.
 *
 * Sessione unica per utente: un nuovo accesso invalida il precedente, quindi ogni ruolo fa il
 * login solo quando serve e i token si riusano.
 */

const db = clientDbLocale()

type AziendaCampo = AziendaDiTest & { emailAutista: [string, string]; utentiAutista: string[] }

let az: AziendaCampo
let anagrafiche: AnagraficheRitiri
const anagraficheCreate: AnagraficaCreata[] = []
const ritiriCreati: string[] = []
const autistiCreati: string[] = []

interface AutistaVisto {
  id: string
  nome: string
  cognome: string
  userId: string | null
}
interface Giro {
  data: string
  autista: { id: string }
  ritiri: Array<{ id: string; ordineGiro: number | null }>
}

test.describe('App campo P1: autisti e giro', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 })
  test.skip(
    db === null,
    'Serve un database locale (DATABASE_URL su localhost) per creare le aziende di test dedicate'
  )

  test.beforeAll(async () => {
    if (!db) return
    const base = await creaAziendaDiTest(db, 'campo', 'ENTERPRISE')
    const unico = Date.now().toString(36)
    const utentiAutista: string[] = []
    const emailAutista: string[] = []
    for (const n of [1, 2]) {
      const email = `e2e-campo-${unico}-aut${n}@test.invalid`
      const u = await db.user.create({
        data: {
          tenantId: base.tenantId,
          keycloakId: `e2e-campo-${unico}-aut${n}`,
          fiscalCode: `E2EA${n}${unico.toUpperCase()}`.slice(0, 16).padEnd(16, 'X'),
          firstName: `Autista${n}`,
          lastName: 'Campo',
          email,
          role: 'AUTISTA',
        },
      })
      utentiAutista.push(u.id)
      emailAutista.push(email)
    }
    az = { ...base, emailAutista: emailAutista as [string, string], utentiAutista }
    anagrafiche = await creaAnagraficheRitiri(await tokenAzienda(az, 'admin'), anagraficheCreate)
  })

  test.afterAll(async () => {
    if (!db) return
    const problemi: string[] = []
    try {
      if (az) {
        // Ordine imposto dalle chiavi esterne: ritiri -> autisti -> anagrafiche -> utenti e azienda.
        if (ritiriCreati.length) {
          await db.ritiro
            .deleteMany({ where: { id: { in: ritiriCreati }, tenantId: az.tenantId } })
            .catch(e => problemi.push(`ritiri: ${(e as Error).message.split('\n').pop()}`))
        }
        await db.autista
          .deleteMany({ where: { tenantId: az.tenantId } })
          .catch(e => problemi.push(`autisti: ${(e as Error).message.split('\n').pop()}`))
        problemi.push(
          ...(await eliminaAnagraficheRitiri(await tokenAzienda(az, 'admin'), anagraficheCreate))
        )
        problemi.push(...(await eliminaAziendaDiTest(db, az, az.utentiAutista)))
      }
      expect(problemi, 'pulizia dei dati creati dallo spec').toEqual([])
    } finally {
      await db.$disconnect()
    }
  })

  test('in ufficio: crea un autista dalla UI collegato all utente e lo assegna a due ritiri', async ({
    page,
  }) => {
    await accediUiComeAzienda(page, az, 'admin')
    await page.goto('/autisti')
    await expect(page.getByTestId('au-vuota')).toBeVisible({ timeout: ATTESA_SERVER })

    await page.getByTestId('au-nuovo').click()
    await page.locator('#au-nome').fill('Luca')
    await page.locator('#au-cognome').fill('Bianchi')
    await page.locator('#au-cf').fill('BNCLCU80A01H501Z')
    await page.locator('#au-patente-scadenza').fill('2030-05-31')
    // L'amministratore elenca gli utenti: la scelta dell'utente dell'app campo e' disponibile.
    await page.locator('#au-utente').selectOption(az.utentiAutista[0])
    const risposta = await attendiRisposta(page, () => page.getByTestId('au-salva').click(), {
      metodo: 'POST',
      percorso: '/autisti',
    })
    const creato = (await risposta.json()) as AutistaVisto
    autistiCreati.push(creato.id)
    expect(creato.userId, 'utente collegato').toBeTruthy()
    await expect(page.getByTestId(`au-riga-${creato.id}`)).toContainText('Bianchi Luca', {
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId(`au-riga-${creato.id}`)).toContainText('BNCLCU80A01H501Z')

    // Secondo autista via API, collegato all'altro utente.
    const token = await page.evaluate(() => localStorage.getItem('accessToken'))
    expect(token).toBeTruthy()
    expect(creato.userId).toBe(az.utentiAutista[0])
    const altroUtente = az.utentiAutista[1]
    const secondo = await ok<AutistaVisto>('POST', '/autisti', token!, {
      nome: 'Anna',
      cognome: 'Verdi',
      userId: altroUtente,
    })
    autistiCreati.push(secondo.id)

    // Ritiri di domani: due al primo autista (ordine 2 e 1), uno al secondo, uno senza autista.
    const mio = async (autistaId: string | undefined, ordineGiro: number) => {
      const [r] = await creaRitiri(token!, anagrafiche, {
        data: giornoItaliano(1),
        ordineGiro,
        autistaId,
      })
      ritiriCreati.push(r.id)
      return r.id
    }
    const due = await mio(creato.id, 2)
    const uno = await mio(creato.id, 1)
    const altrui = await mio(secondo.id, 1)
    const senza = await mio(undefined, 3)

    // L'autista compare nella colonna dell'elenco ritiri.
    await page.goto('/ritiri')
    await expect(page.getByTestId(`ri-riga-${due}`)).toContainText('Bianchi Luca', {
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId(`ri-riga-${altrui}`)).toContainText('Verdi Anna')
    await expect(page.getByTestId(`ri-riga-${senza}`)).toBeVisible()
    expect(uno).toBeTruthy()

    // Un autista non si cancella: si disattiva, e il ritiro resta modificabile (nessun 400).
    const disattiva = await chiama('PUT', `/autisti/${secondo.id}`, token!, {
      nome: 'Anna',
      cognome: 'Verdi',
      userId: altroUtente,
      attivo: false,
    })
    expect(disattiva.stato).toBe(200)
  })

  test('l autista vede solo il suo giro, in ordine, e nessuna rotta d ufficio', async () => {
    const { accessToken } = await devLoginTokens(az.emailAutista[0])
    const giorno = giornoItaliano(1)
    // Il primo utente e' collegato a Luca Bianchi (due ritiri di domani, ordine 1 e 2).
    const giro = await chiama<Giro>('GET', `/campo/giro?data=${giorno}`, accessToken)
    expect(giro.stato).toBe(200)
    expect(
      giro.corpo.ritiri.map(r => r.ordineGiro),
      'solo i suoi, in ordine di giro'
    ).toEqual([1, 2])
    expect(giro.corpo.ritiri.map(r => r.id)).toEqual(
      ritiriCreati.slice(1, 2).concat(ritiriCreati.slice(0, 1))
    )

    // Un altro giorno: nessun ritiro.
    const vuoto = await chiama<Giro>('GET', `/campo/giro?data=${giornoItaliano(30)}`, accessToken)
    expect(vuoto.corpo.ritiri).toEqual([])

    // Non puo scegliere l'autista.
    const altro = await chiama(
      'GET',
      `/campo/giro?data=${giorno}&autistaId=${giro.corpo.autista.id}`,
      accessToken
    )
    expect(altro.stato).toBe(400)

    // Nessuna rotta d'ufficio: 403 con il codice dell'interceptor.
    for (const [metodo, percorso] of [
      ['GET', '/ritiri'],
      ['GET', '/fir'],
      ['GET', '/autisti'],
      ['GET', '/registro'],
      ['GET', '/pese/automezzi'],
    ] as const) {
      const r = await chiama<{ error?: string }>(metodo, percorso, accessToken)
      expect(r.stato, `${metodo} ${percorso}`).toBe(403)
      expect(JSON.stringify(r.corpo)).toContain('ROTTA_NON_CONSENTITA_ALL_AUTISTA')
    }
    // /admin/users ha un RolesGuard di classe che risponde 403 prima dell'interceptor:
    // qui conta solo che l'autista sia respinto, non quale presidio lo respinge.
    const admin = await chiama('GET', '/admin/users', accessToken)
    expect(admin.stato).toBe(403)
    const scrittura = await chiama('POST', '/ritiri', accessToken, {})
    expect(scrittura.stato).toBe(403)

    // Il profilo resta leggibile.
    const profilo = await chiama('GET', '/auth/profile', accessToken)
    expect(profilo.stato).toBe(200)
  })

  test('un utente d ufficio non puo usare il giro; senza il modulo campo il giro e chiuso', async () => {
    const admin = await tokenAzienda(az, 'admin')
    const r = await chiama('GET', `/campo/giro?data=${giornoItaliano(1)}`, admin)
    expect(r.stato).toBe(403)
    expect(JSON.stringify(r.corpo)).toContain('GIRO_RISERVATO_AGLI_AUTISTI')

    const trial = await creaAziendaDiTest(db!, 'campo TRIAL', 'TRIAL')
    try {
      const t = await tokenAzienda(trial, 'admin')
      const senzaModulo = await chiama('GET', '/autisti', t)
      expect(senzaModulo.stato).toBe(403)
      expect(JSON.stringify(senzaModulo.corpo)).toContain('MODULO_NON_ATTIVO')
    } finally {
      const problemi = await eliminaAziendaDiTest(db!, trial)
      expect(problemi).toEqual([])
    }
  })
})

import { test, expect, type Page } from '@playwright/test'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER } from '../../utils/attese'
import { conPrefissoUnico } from '../../utils/run-id'
import {
  CER_A,
  CER_B,
  chiama,
  creaListinoLegami,
  giornoItaliano,
  impostaFatturazioneDa,
  legame,
  legamePerMovimento,
  ok,
  pulisciCreati,
  registraViaApi,
  rigaPrincipale,
  type Creato,
  type ListinoLegami,
  type Versionata,
} from '../../utils/legami-api'
import { LegamiPage } from '../../pages/legami.page'

/**
 * E2E UI — Legame movimento, cliente e prezzo: interfaccia del pezzo 4.3c (Task 31).
 *
 * Scenari (dati preparati via API come nel Task 23, azioni e verifiche dall'interfaccia):
 *   1. registrazione con proposta e «Registra e conferma legame» dal form;
 *   2. «Registra senza collegare» e poi conferma dalla lista «Da collegare»;
 *   3. rettifica che cambia il CER: avviso, legame «Proposto», nuova conferma dal riquadro;
 *   4. annullo del movimento: stato «Annullato» nel riquadro;
 *   5. «Aggiorna prezzi» (ADMIN): anteprima, conferma esplicita, applica;
 *   6. OPERATOR: nessun pulsante «Aggiorna prezzi»;
 *   7. quantita' manuale: virgola accettata, punto rifiutato, zero rifiutato;
 *   8. prezzo modificato a mano: badge, escluso da «Aggiorna prezzi» e invariato dopo l'applica
 *      mentre le altre righe cambiano;
 *   9. riga di listino usata da un legame: «Elimina» disattivato, una riga libera no.
 *
 * Isolamento. Tutto in un'AZIENDA DI TEST DEDICATA creata in `beforeAll` (tre utenti ADMIN /
 * OPERATOR / VIEWER), mai l'azienda seed: «fatturazione da» e il registro sono per azienda. I
 * movimenti del registro non si cancellano (catena di hash): l'azienda, i suoi utenti e i suoi
 * movimenti RESTANO nel database di test, riconoscibili dal prefisso della run nella ragione
 * sociale. Le anagrafiche e il listino creati dallo spec si ripuliscono per id ESATTI in
 * `afterAll` (mai per nome, data o filtri larghi).
 *
 * Sessione unica per utente: un nuovo accesso invalida il precedente, quindi le chiamate API fatte
 * durante un test riusano il token della sessione della pagina (`tokenDellaPagina`) e non ne
 * chiedono uno nuovo per lo stesso utente.
 */

const db = clientDbLocale()

let azienda: AziendaDiTest
let listino: ListinoLegami
let creati: Creato[] = []
/** Prezzo corrente della riga CER A nel listino. */
let prezzoListinoA = 10

/** Token dell'utente gia' collegato nella pagina (stessa sessione, nessun nuovo login). */
async function tokenDellaPagina(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('accessToken'))
  expect(token, 'token di sessione nella pagina').toBeTruthy()
  return token!
}

/** Accesso alla UI come ADMIN dell'azienda dedicata; restituisce il token della sessione. */
async function entraComeAdmin(page: Page): Promise<string> {
  await accediUiComeAzienda(page, azienda, 'admin')
  return tokenDellaPagina(page)
}

/** Cambia il prezzo della riga CER A nel listino (via API) e lo ricorda. */
async function cambiaPrezzoListinoA(token: string, nuovo: number): Promise<void> {
  const riga = await ok<Versionata>('GET', `/righe-addebito/${listino.rigaCerA.id}`, token)
  const mod = await ok<Versionata>('PATCH', `/righe-addebito/${listino.rigaCerA.id}`, token, {
    prezzo: nuovo.toFixed(2),
    versione: riga.versione,
  })
  listino.rigaCerA = { id: listino.rigaCerA.id, versione: mod.versione }
  prezzoListinoA = nuovo
}

test.describe('Legame movimento — interfaccia 4.3c', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 })
  test.skip(
    db === null,
    'Serve un database locale (DATABASE_URL su localhost) per creare l’azienda di test dedicata'
  )

  test.beforeAll(async () => {
    if (!db) return
    creati = []
    prezzoListinoA = 10
    azienda = await creaAziendaDiTest(db, 'legami UI')
    const token = await tokenAzienda(azienda, 'admin')
    listino = await creaListinoLegami(token, creati)
    await impostaFatturazioneDa(token, giornoItaliano(-30))
  })

  test.afterAll(async () => {
    if (!db) return
    try {
      if (!azienda) return
      // Nuovo accesso (invalida la sessione dell'ultimo test, ormai finito) per la pulizia.
      const errori = await pulisciCreati(await tokenAzienda(azienda, 'admin'), creati)
      expect(errori, 'pulizia dei dati creati dallo spec').toEqual([])
    } finally {
      await db.$disconnect()
    }
  })

  test('registrazione dal form: proposta, scelta del cliente e «Registra e conferma legame»', async ({
    page,
  }) => {
    const token = await entraComeAdmin(page)
    const legami = new LegamiPage(page)
    await legami.vaiAlRegistro()
    await legami.compilaCarico({
      cer: CER_A,
      quantita: '12,5',
      controparte: conPrefissoUnico('Controparte UI 1'),
    })

    // Il blocco «Fatturazione» compare per la causale fatturabile; senza cliente non si conferma.
    await expect(legami.bloccoFatturazione).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(legami.bottone('registra-e-conferma')).toBeDisabled()

    await legami.scegliCliente(listino.clienteEtichetta)
    await expect(page.getByTestId('fatt-contratto')).toContainText(listino.contrattoNumero, {
      timeout: ATTESA_SERVER,
    })
    // Proposta: riga CER a 10 per 12,5 kg e riga V aggiuntiva proposta dal listino.
    const principale = legami.rigaTabella(listino.rigaCerA.id)
    await expect(principale).toBeVisible()
    await expect(legami.campoPrezzo(listino.rigaCerA.id)).toHaveValue('10')
    await expect(legami.campoQuantita(listino.rigaCerA.id)).toHaveValue('12,5')
    await expect(legami.rigaTabella(listino.rigaV.id)).toContainText('Aggiuntiva')

    await expect(legami.bottone('registra-e-conferma')).toBeEnabled()
    const movimentoId = await legami.registraEConferma()

    const l = await legamePerMovimento(token, movimentoId)
    expect(l.stato).toBe('CONFERMATO')
    expect(l.movimentoOriginaleId).toBe(movimentoId)
    expect(Number(rigaPrincipale(l).prezzo)).toBe(10)
    expect(Number(rigaPrincipale(l).quantita)).toBe(12.5)
    expect(l.righe.every(r => r.congelataIl !== null)).toBe(true)

    // Il dettaglio del registro mostra il riquadro col legame confermato.
    await legami.apriDettaglio(movimentoId)
    await expect(legami.statoRiquadro).toHaveText(/Confermato/, { timeout: ATTESA_SERVER })
    await expect(page.getByTestId('riquadro-congelati')).toBeVisible()
  })

  test('«Registra senza collegare», poi conferma dalla lista «Da collegare»', async ({ page }) => {
    const token = await entraComeAdmin(page)
    const legami = new LegamiPage(page)
    await legami.vaiAlRegistro()
    await legami.compilaCarico({
      cer: CER_A,
      quantita: '7',
      controparte: conPrefissoUnico('Controparte UI 2'),
    })
    await expect(legami.bloccoFatturazione).toBeVisible({ timeout: ATTESA_SERVER })
    await legami.scegliCliente(listino.clienteEtichetta)
    await expect(page.getByTestId('fatt-contratto')).toContainText(listino.contrattoNumero, {
      timeout: ATTESA_SERVER,
    })
    const movimentoId = await legami.registraSenzaCollegare()

    // Mai confermato da solo: il legame nasce «Proposto».
    const proposto = await legamePerMovimento(token, movimentoId)
    expect(proposto.stato).toBe('PROPOSTO')

    await legami.vaiADaCollegare()
    const riga = legami.rigaLista(movimentoId)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(page.getByTestId(`stato-${movimentoId}`)).toHaveText(/Proposto/)
    await legami.apriDallaLista(movimentoId)
    await legami.confermaDallaFinestra()
    await expect(legami.finestraLegame).toBeHidden({ timeout: ATTESA_SERVER })

    expect((await legame(token, proposto.id)).stato).toBe('CONFERMATO')
  })

  test('rettifica che cambia il CER: avviso, legame «Proposto» e nuova conferma', async ({
    page,
  }) => {
    const token = await entraComeAdmin(page)
    const m = await registraViaApi(token, {
      kg: 8,
      legame: { azione: 'CONFERMA', clienteId: listino.clienteId },
    })
    expect(m.legameId).toBeTruthy()
    const legami = new LegamiPage(page)
    await legami.vaiAlRegistro()
    await expect(page.getByTestId(`registro-rettifica-${m.movimentoId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await legami.apriRettifica(m.movimentoId)

    // Il legame esistente e' confermato: nessun avviso finche' il CER non cambia.
    await expect(page.getByTestId('correzione-legame-attuale')).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId('correzione-cer-cambiato')).toBeHidden()
    await legami.scegliCer('#corr-cer', CER_B)
    await expect(page.getByTestId('correzione-cer-cambiato')).toBeVisible()
    await legami.scriviMotivoCorrezione('Codice CER errato in fase di registrazione')
    await legami.inviaCorrezione('correzione-invia', /\/registro\/movimenti\/[^/]+\/rettifica/)
    await expect(page.getByTestId('correzione-riepilogo')).toBeHidden({ timeout: ATTESA_SERVER })

    // Il legame segue il nuovo CER e chiede una nuova conferma esplicita.
    const l = await legamePerMovimento(token, m.movimentoId)
    expect(l.stato).toBe('PROPOSTO')
    expect(l.avvisi).toContain('CAMBIO_CER_DA_CONFERMARE')
    expect(rigaPrincipale(l).rigaAddebitoId).toBe(listino.rigaCerB.id)
    expect(l.movimentoVigenteId).not.toBe(l.movimentoOriginaleId)

    // Nuova conferma dal riquadro del movimento vigente.
    await expect(page.getByTestId(`registro-dettaglio-${l.movimentoVigenteId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await legami.apriDettaglio(l.movimentoVigenteId)
    await expect(legami.statoRiquadro).toHaveText(/Proposto/, { timeout: ATTESA_SERVER })
    await expect(page.getByTestId('riquadro-avviso-CAMBIO_CER_DA_CONFERMARE')).toBeVisible()
    await legami.confermaDalRiquadro()
    await expect(legami.statoRiquadro).toHaveText(/Confermato/, { timeout: ATTESA_SERVER })
    expect((await legame(token, l.id)).stato).toBe('CONFERMATO')
  })

  test('annullo del movimento: il riquadro mostra lo stato «Annullato»', async ({ page }) => {
    const token = await entraComeAdmin(page)
    const m = await registraViaApi(token, {
      kg: 4,
      legame: { azione: 'CONFERMA', clienteId: listino.clienteId },
    })
    const legami = new LegamiPage(page)
    await legami.vaiAlRegistro()
    await expect(page.getByTestId(`registro-annulla-${m.movimentoId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await legami.apriAnnullo(m.movimentoId)
    await legami.scriviMotivoCorrezione('Registrato per errore')
    await legami.inviaCorrezione('correzione-invia', /\/registro\/movimenti\/[^/]+\/annullamento/)
    await expect(page.getByTestId('correzione-riepilogo')).toBeHidden({ timeout: ATTESA_SERVER })

    expect((await legamePerMovimento(token, m.movimentoId)).stato).toBe('ANNULLATO')
    await legami.apriDettaglio(m.movimentoId)
    await expect(legami.statoRiquadro).toHaveText(/Annullato/, { timeout: ATTESA_SERVER })
  })

  test('«Aggiorna prezzi» (ADMIN): anteprima, conferma esplicita e applica', async ({ page }) => {
    const token = await entraComeAdmin(page)
    const m = await registraViaApi(token, {
      kg: 6,
      legame: { azione: 'CONFERMA', clienteId: listino.clienteId },
    })
    const prima = await legamePerMovimento(token, m.movimentoId)
    expect(Number(rigaPrincipale(prima).prezzo)).toBe(prezzoListinoA)

    // Il listino cambia: il legame confermato resta ai valori congelati finche' non si aggiorna.
    const nuovo = prezzoListinoA + 2
    await cambiaPrezzoListinoA(token, nuovo)
    expect(Number(rigaPrincipale(await legame(token, prima.id)).prezzo)).toBe(prezzoListinoA - 2)

    const legami = new LegamiPage(page)
    await legami.vaiADaCollegare()
    await legami.apriAggiornaPrezzi()
    // Senza contratto non si puo' chiedere l'anteprima e non si puo' applicare.
    await expect(legami.bottone('ap-anteprima')).toBeDisabled()
    await expect(legami.bottone('ap-applica')).toBeDisabled()
    await legami.scegliContrattoAggiornamento(listino.contrattoNumero)
    await legami.mostraAnteprima()
    await expect(page.getByTestId('ap-riepilogo')).toContainText(/cambi/)
    await expect(page.getByTestId('ap-esempi')).toBeVisible()
    // Senza la casella di conferma «Applica» resta disattivato; l'anteprima non ha scritto nulla.
    await expect(legami.bottone('ap-applica')).toBeDisabled()
    expect(Number(rigaPrincipale(await legame(token, prima.id)).prezzo)).toBe(nuovo - 2)

    await legami.applicaAggiornamento()
    await expect(legami.finestraAggiornaPrezzi).toBeHidden({ timeout: ATTESA_SERVER })
    const dopo = await legame(token, prima.id)
    expect(dopo.stato).toBe('CONFERMATO')
    expect(Number(rigaPrincipale(dopo).prezzo)).toBe(nuovo)
  })

  test('OPERATOR: la pagina «Da collegare» non offre «Aggiorna prezzi»', async ({ page }) => {
    await accediUiComeAzienda(page, azienda, 'operator')
    const legami = new LegamiPage(page)
    await legami.vaiADaCollegare()
    // La pagina e' caricata (barra delle azioni presente) ma il pulsante degli amministratori no.
    await expect(page.getByTestId('legami-azioni-pagina')).toBeAttached()
    await expect(legami.pulsanteAggiornaPrezzi).toHaveCount(0)
  })

  test('quantita` manuale: la virgola si accetta, il punto e lo zero si rifiutano', async ({
    page,
  }) => {
    const token = await entraComeAdmin(page)
    const m = await registraViaApi(token, {
      kg: 5,
      legame: { azione: 'PROPOSTA', clienteId: listino.clienteId },
    })
    const proposto = await legamePerMovimento(token, m.movimentoId)
    const rigaId = rigaPrincipale(proposto).rigaAddebitoId
    const legami = new LegamiPage(page)
    await legami.vaiAlRegistro()
    await expect(page.getByTestId(`registro-dettaglio-${m.movimentoId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await legami.apriDettaglio(m.movimentoId)
    await expect(legami.campoQuantita(rigaId)).toBeVisible({ timeout: ATTESA_SERVER })

    // Il punto decimale e' rifiutato dal campo: non entra nel valore e si spiega perche'.
    await legami.digita(legami.campoQuantita(rigaId), '3.')
    await expect(page.getByTestId(`errore-qta-${rigaId}`)).toContainText(/virgola/i)
    await expect(legami.campoQuantita(rigaId)).toHaveValue('3')
    await expect(legami.bottone('riquadro-salva')).toBeDisabled()

    // Zero non e' una quantita': errore e «Salva modifiche» spento, nulla parte verso il server.
    await legami.digita(legami.campoQuantita(rigaId), '0')
    await expect(page.getByTestId(`errore-qta-${rigaId}`)).toBeVisible()
    await expect(legami.bottone('riquadro-salva')).toBeDisabled()
    expect((await legame(token, proposto.id)).versione).toBe(proposto.versione)

    // La virgola va bene: il valore si salva ed e' marcato come scritto a mano.
    await legami.digita(legami.campoQuantita(rigaId), '3,5')
    await expect(page.getByTestId(`errore-qta-${rigaId}`)).toBeHidden()
    await expect(legami.bottone('riquadro-salva')).toBeEnabled()
    await legami.salvaRiquadro()
    const dopo = await legame(token, proposto.id)
    expect(Number(rigaPrincipale(dopo).quantita)).toBe(3.5)
    expect(rigaPrincipale(dopo).quantitaOrigine).toBe('MANUALE')
    await expect(legami.campoQuantita(rigaId)).toHaveValue('3,5')
  })

  test('prezzo modificato a mano: badge, escluso da «Aggiorna prezzi» e invariato dopo l’applica', async ({
    page,
  }) => {
    const token = await entraComeAdmin(page)
    const manuale = await registraViaApi(token, {
      kg: 5,
      legame: { azione: 'PROPOSTA', clienteId: listino.clienteId },
    })
    const confermato = await registraViaApi(token, {
      kg: 3,
      legame: { azione: 'CONFERMA', clienteId: listino.clienteId },
    })
    const proposto = await legamePerMovimento(token, manuale.movimentoId)
    const rigaId = rigaPrincipale(proposto).rigaAddebitoId
    expect(rigaId).toBe(listino.rigaCerA.id)

    // Prezzo scritto a mano (15) dal riquadro del dettaglio.
    const legami = new LegamiPage(page)
    await legami.vaiAlRegistro()
    await expect(page.getByTestId(`registro-dettaglio-${manuale.movimentoId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await legami.apriDettaglio(manuale.movimentoId)
    await expect(legami.campoPrezzo(rigaId)).toBeVisible({ timeout: ATTESA_SERVER })
    await legami.digita(legami.campoPrezzo(rigaId), '15')
    await legami.salvaRiquadro()
    await expect(page.getByTestId(`badge-prezzo-manuale-${rigaId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId('riquadro-avviso-PREZZO_MANUALE')).toBeVisible()
    const salvato = await legame(token, proposto.id)
    expect(Number(rigaPrincipale(salvato).prezzo)).toBe(15)
    expect(rigaPrincipale(salvato).prezzoManuale).toBe(true)
    await legami.chiudiDettaglio()

    // Il listino cambia ancora: le righe non manuali seguono, quella a mano no.
    const nuovo = prezzoListinoA + 1
    await cambiaPrezzoListinoA(token, nuovo)

    await legami.vaiADaCollegare()
    await legami.apriAggiornaPrezzi()
    await legami.scegliContrattoAggiornamento(listino.contrattoNumero)
    await legami.mostraAnteprima()
    await expect(page.getByTestId('ap-riepilogo')).toContainText(
      /esclus[ae], prezzo modificato a mano/
    )
    await expect(page.getByTestId('ap-esempi')).toBeVisible()
    await legami.applicaAggiornamento()
    await expect(legami.finestraAggiornaPrezzi).toBeHidden({ timeout: ATTESA_SERVER })

    const dopoManuale = await legame(token, proposto.id)
    expect(Number(rigaPrincipale(dopoManuale).prezzo), 'il prezzo a mano resta 15').toBe(15)
    expect(rigaPrincipale(dopoManuale).prezzoManuale).toBe(true)
    const dopoConfermato = await legamePerMovimento(token, confermato.movimentoId)
    expect(Number(rigaPrincipale(dopoConfermato).prezzo), 'le altre righe cambiano').toBe(nuovo)

    // Nell'interfaccia il prezzo a mano e il badge ci sono ancora.
    await legami.vaiAlRegistro()
    await expect(page.getByTestId(`registro-dettaglio-${manuale.movimentoId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await legami.apriDettaglio(manuale.movimentoId)
    await expect(legami.campoPrezzo(rigaId)).toHaveValue('15', { timeout: ATTESA_SERVER })
    await expect(page.getByTestId(`badge-prezzo-manuale-${rigaId}`)).toBeVisible()
  })

  test('riga di listino usata da un legame: «Elimina» disattivato, una riga libera no', async ({
    page,
  }) => {
    const token = await entraComeAdmin(page)
    // La riga CER A e' citata dai legami dei test precedenti.
    const legami = new LegamiPage(page)
    await legami.vaiAlListino(listino.contrattoId, listino.elencoId)
    await expect(legami.eliminaRiga(listino.rigaCerA.id)).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(legami.eliminaRiga(listino.rigaCerA.id)).toBeDisabled()
    await expect(legami.suggerimentoEliminaRiga(listino.rigaCerA.id)).toHaveAttribute(
      'title',
      /In uso/
    )
    await expect(legami.eliminaRiga(listino.rigaLibera.id)).toBeEnabled()
    // Anche per il server la riga usata non si elimina; resta nell'elenco.
    const r = await chiama<{ error?: string }>(
      'DELETE',
      `/righe-addebito/${listino.rigaCerA.id}?versione=${listino.rigaCerA.versione}`,
      token
    )
    expect(r.stato).toBe(409)
    expect(r.corpo.error).toBe('RIGA_ADDEBITO_IN_USO')
  })
})

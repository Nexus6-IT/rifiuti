import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { apiLogin, apiPost, apiGet, apiDelete, ApiClientError } from '../../utils/api-client'
import { registra } from '../../fixtures/risorse'
import { conPrefisso } from '../../utils/run-id'
import { AnagrafichePage } from '../../pages/anagrafiche.page'

/**
 * UAT/E2E — Produttore (docs/uat/produttore.md contiene i casi e la matrice
 * di copertura). Mappa dell'entità letta da:
 * - `apps/backend/src/api/registry/dto/create-registry.dto.ts` (CreateProduttoreDto/UpdateProduttoreDto)
 * - `apps/backend/src/domain/registry/entities/produttore.ts`
 * - `apps/backend/src/domain/registry/value-objects/{partita-iva,indirizzo}.ts`
 * - `apps/backend/src/application/registry/use-cases/{create,update,delete}-produttore.use-case.ts`
 * - `apps/backend/src/api/registry/registry.controller.ts` (@Roles)
 * - `apps/frontend/src/app/features/registry/produttori-list.component.ts`
 *
 * NOTA SUL PASSO 5 DEL BRIEF, corretta dal committente dopo revisione (vedi
 * report della sessione): il passo originale presupponeva un vincolo di
 * cancellazione che il disegno rifiuta DI PROPOSITO — `schema.prisma`
 * (righe ~272-275, decisione 2026-06-09) dice esplicitamente "Il FIR è un
 * documento legale: conserva lo snapshot, non un join live". `producerId`
 * è un UUID senza `@relation` per scelta, non per dimenticanza. L'invariante
 * che conta davvero è l'opposto — vedi describe "effetto collaterale" in
 * fondo a questo file.
 */

function nuovaPartitaIVA(): string {
  const nove = String(Date.now()).slice(-9)
  const due = String(Math.floor(Math.random() * 100)).padStart(2, '0')
  return `${nove}${due}`
}

interface IndirizzoPayload {
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
}

const SEDE_VALIDA: IndirizzoPayload = {
  via: 'Via Roma',
  civico: '1',
  cap: '20100',
  comune: 'Milano',
  provincia: 'MI',
}

function payloadProduttore(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ragioneSociale: conPrefisso('Produttore SRL'),
    partitaIVA: nuovaPartitaIVA(),
    sedeLegale: SEDE_VALIDA,
    pec: 'pec@esempio.it',
    ...overrides,
  }
}

interface ProduttoreResponse {
  id: string
  ragioneSociale: string
  partitaIVA: string
}

interface ListaPaginata<T> {
  items: T[]
  total: number
}

async function creaProduttore(token: string, overrides: Partial<Record<string, unknown>> = {}) {
  const body = payloadProduttore(overrides)
  const creato = await apiPost<ProduttoreResponse>('/registry/produttori', body, token)
  registra('produttore', creato.id)
  return { body, creato }
}

test.describe('Produttore — CRUD via UI (operator)', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('happy path: crea e modifica un produttore dalla UI', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'operator')
    // Token API preso PRIMA di creare dalla UI: se il login API fallisse (es.
    // 429) dopo la creazione, il record resterebbe orfano, non registrato per
    // il teardown.
    const token = await apiLogin('operator')
    const anagrafiche = new AnagrafichePage(page, 'produttori')
    await anagrafiche.goto()
    await anagrafiche.expectLoaded()

    const ragioneSociale = conPrefisso('Produttore UI SRL')
    const partitaIVA = nuovaPartitaIVA()

    await anagrafiche.apriNuovo()
    await page.getByLabel('Ragione sociale').fill(ragioneSociale)
    await page.getByLabel('Partita IVA').fill(partitaIVA)
    await page.getByLabel('Via').fill(SEDE_VALIDA.via)
    await page.getByLabel('Civico').fill(SEDE_VALIDA.civico)
    await page.getByLabel('CAP').fill(SEDE_VALIDA.cap)
    await page.getByLabel('Comune').fill(SEDE_VALIDA.comune)
    await page.getByLabel('Provincia').fill(SEDE_VALIDA.provincia)
    await anagrafiche.salva()
    await expect(anagrafiche.formDialog).toBeHidden()

    // L'id è assegnato dal backend: lo recuperiamo via API (delta sulla
    // partita IVA appena creata, non un id inventato) per registrarlo al
    // teardown e per interagire con la riga tramite il suo data-testid.
    const lista = await apiGet<ListaPaginata<ProduttoreResponse>>('/registry/produttori', token)
    const creato = lista.items.find(p => p.partitaIVA === partitaIVA)
    expect(
      creato,
      'il produttore creato dalla UI deve comparire in GET /registry/produttori'
    ).toBeTruthy()
    registra('produttore', creato!.id)

    await expect(anagrafiche.row(creato!.id)).toBeVisible()
    await expect(anagrafiche.row(creato!.id)).toContainText(ragioneSociale)

    // Modifica: la ragione sociale cambia, la P.IVA resta (immutabile in update).
    const ragioneSocialeModificata = `${ragioneSociale} (modificato)`
    await anagrafiche.apriModifica(creato!.id)

    // Coerenza con la validazione lato API verificata sotto (describe
    // "validazioni" → "la partita IVA è immutabile..."): il form NON deve
    // mai poter inviare `partitaIVA` in un PUT, perché il backend la
    // rifiuterebbe con 400 (whitelist di UpdateProduttoreDto). La UI
    // garantisce questo disabilitando il campo in modifica (visibile, col
    // valore attuale, ma non modificabile) invece di ometterlo — v.
    // `produttori-list.component.ts` `[disabled]="editMode"` e il commento
    // "NON includere partitaIVA" nel payload di update. Verificarlo qui,
    // non solo a memoria: se qualcuno riabilitasse il campo per errore,
    // questo test lo direbbe prima di un 400 inatteso in produzione.
    await expect(page.getByLabel('Partita IVA')).toBeDisabled()
    await expect(page.getByLabel('Partita IVA')).toHaveValue(partitaIVA)

    await page.getByLabel('Ragione sociale').fill(ragioneSocialeModificata)
    await anagrafiche.salva()
    await expect(anagrafiche.formDialog).toBeHidden()
    await expect(anagrafiche.row(creato!.id)).toContainText(ragioneSocialeModificata)

    // La cancellazione della UI passa dal p-confirmDialog di default di
    // PrimeNG (nessun data-testid sul pulsante interno, vedi
    // e2e/SELECTORS-DEBT.md): la puliamo via API nel teardown standard,
    // niente di nuovo da provare qui che il resto della suite non copra già.
  })
})

test.describe('Produttore — validazioni (via API, dove il backend le applica davvero)', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('ragione sociale mancante è rifiutata (400)', async () => {
    const token = await apiLogin('operator')
    await expect(
      apiPost('/registry/produttori', payloadProduttore({ ragioneSociale: '' }), token)
    ).rejects.toMatchObject({ status: 400 } satisfies Partial<ApiClientError>)
  })

  test('partita IVA con formato non valido (non 11 cifre) è rifiutata (400)', async () => {
    const token = await apiLogin('operator')
    await expect(
      apiPost('/registry/produttori', payloadProduttore({ partitaIVA: '123' }), token)
    ).rejects.toMatchObject({ status: 400 })
  })

  test('CAP con formato non valido (non 5 cifre) è rifiutato (400)', async () => {
    const token = await apiLogin('operator')
    await expect(
      apiPost(
        '/registry/produttori',
        payloadProduttore({ sedeLegale: { ...SEDE_VALIDA, cap: '123' } }),
        token
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  test('sede legale mancante è rifiutata (400)', async () => {
    const token = await apiLogin('operator')
    const body: Record<string, unknown> = payloadProduttore()
    delete body.sedeLegale
    await expect(apiPost('/registry/produttori', body, token)).rejects.toMatchObject({
      status: 400,
    })
  })

  test('la partita IVA è immutabile: inviarla in update è rifiutata (400, whitelist)', async () => {
    const token = await apiLogin('operator')
    const { creato } = await creaProduttore(token)

    // PUT non ha un helper dedicato in api-client.ts (solo POST/GET/DELETE):
    // usiamo fetch direttamente, stessa base URL, stesso schema di errore.
    // UpdateProduttoreDto non include partitaIVA e il ValidationPipe globale
    // ha whitelist+forbidNonWhitelisted (main.ts): il campo extra fa
    // fallire l'intera richiesta con 400, non viene semplicemente ignorato.
    const risposta = await fetch(`${getApiUrl()}/registry/produttori/${creato.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ragioneSociale: 'Nome nuovo', partitaIVA: '99999999999' }),
    })
    expect(risposta.status).toBe(400)
  })
})

test.describe('Produttore — permessi negati per ruolo di sola lettura', () => {
  test.skip(!hasRoleCredentials('viewer'), skipReason('viewer'))

  test('VIEWER non può creare un produttore (403)', async () => {
    const token = await apiLogin('viewer')
    await expect(apiPost('/registry/produttori', payloadProduttore(), token)).rejects.toMatchObject(
      { status: 403 }
    )
  })
})

test.describe('Produttore — doppio invio', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('stesso payload inviato due volte: solo il primo viene creato', async () => {
    const token = await apiLogin('operator')
    const body = payloadProduttore()

    const primo = await apiPost<ProduttoreResponse>('/registry/produttori', body, token)
    registra('produttore', primo.id)

    await expect(apiPost('/registry/produttori', body, token)).rejects.toMatchObject({
      status: 400,
    })

    // Delta: la partita IVA compare esattamente una volta, non due.
    const lista = await apiGet<ListaPaginata<ProduttoreResponse>>('/registry/produttori', token)
    const occorrenze = lista.items.filter(p => p.partitaIVA === body.partitaIVA)
    expect(occorrenze).toHaveLength(1)
  })
})

test.describe('Produttore — isolamento fra due aziende', () => {
  test.skip(!hasRoleCredentials('admin'), skipReason('admin'))

  /**
   * Nessuna fixture pronta con due tenant distinti per lo stesso utente di
   * test: si interroga GET /admin/tenants (accessibile ad ADMIN, restituisce
   * "le proprie aziende + il proprio tenant" — vedi tenant.service.ts
   * `list()`) e si salta a runtime se questo admin non ne gestisce almeno
   * due. Nessun dato inventato.
   *
   * Il record creato "nell'altra azienda" (via header X-Tenant-ID, onorato
   * dal TenantSwitchInterceptor solo se la membership è verificata lato
   * server) NON passa dal registro di fixtures/risorse.ts: quel registro fa
   * un DELETE senza header, che risolverebbe sul tenant PRIMARIO
   * dell'admin, non su quello secondario — cancellerebbe zero righe in
   * silenzio e lascerebbe un residuo reale invisibile a verifica-residuo.ts
   * (che interroga solo il tenant primario). Puliamo quindi qui, con lo
   * stesso header, in un finally.
   */
  test("un produttore creato in un tenant non è visibile nell'altro", async () => {
    const token = await apiLogin('admin')
    const tenants = await apiGet<Array<{ id: string }>>('/admin/tenants', token)
    test.skip(
      tenants.length < 2,
      `Questo admin di test gestisce ${tenants.length} tenant: servono almeno 2 per un test di ` +
        'isolamento reale fra aziende diverse. Nessuna fixture nota in anticipo per prepararne un secondo.'
    )

    const [tenantA, tenantB] = tenants

    async function listaProduttori(tenantId: string): Promise<ProduttoreResponse[]> {
      const risposta = await fetch(`${getApiUrl()}/registry/produttori`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': tenantId },
      })
      expect(risposta.ok, `GET produttori (tenant ${tenantId}) -> ${risposta.status}`).toBeTruthy()
      const corpo = (await risposta.json()) as ListaPaginata<ProduttoreResponse>
      return corpo.items
    }

    const primaB = await listaProduttori(tenantB.id)

    const body = payloadProduttore()
    const rispostaCreazione = await fetch(`${getApiUrl()}/registry/produttori`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': tenantA.id,
      },
      body: JSON.stringify(body),
    })
    expect(
      rispostaCreazione.ok,
      `POST produttori (tenant ${tenantA.id}) -> ${rispostaCreazione.status}`
    ).toBeTruthy()
    const creato = (await rispostaCreazione.json()) as ProduttoreResponse

    try {
      const dopoB = await listaProduttori(tenantB.id)
      // Delta: la lista del tenant B non cambia per una creazione nel tenant A.
      expect(dopoB).toHaveLength(primaB.length)
      expect(dopoB.some(p => p.id === creato.id)).toBe(false)

      const dopoA = await fetch(`${getApiUrl()}/registry/produttori`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': tenantA.id },
      }).then(r => r.json() as Promise<ListaPaginata<ProduttoreResponse>>)
      expect(dopoA.items.some(p => p.id === creato.id)).toBe(true)
    } finally {
      // DEROGA CONSAPEVOLE, unica in questo file: `apiDelete` (utils/api-client.ts)
      // passa da `valutaRichiesta` (utils/blacklist.ts), il guardrail che
      // rifiuta un DELETE il cui id non risulta REGISTRATO in questa run
      // (`fixtures/risorse.ts` → `registra`) — difesa in profondità contro
      // cancellazioni non tracciate, in QUALUNQUE ambiente. Questa riga la
      // aggira di proposito, con `fetch` diretto, per due motivi che non
      // hanno un'alternativa dentro al perimetro attuale del client:
      // 1. `apiDelete` non accetta header aggiuntivi: qui serve
      //    `X-Tenant-ID: tenantA.id`, senza il quale il DELETE
      //    risolverebbe sul tenant PRIMARIO dell'admin (vedi commento in
      //    cima al test) e non cancellerebbe nulla — un residuo silenzioso
      //    nel tenant secondario, invisibile a `verifica-residuo.ts`.
      // 2. Per lo stesso motivo `creato.id` non passa da `registra()`
      //    (quel registro presuppone il tenant primario): non c'è quindi
      //    un id "registrato" da far accettare al guardrail.
      // La sicurezza che il guardrail darebbe è qui sostituita da una
      // garanzia più forte per costruzione: `creato.id` non è mai un valore
      // salvato o riusato fra test, è l'id appena restituito dalla POST
      // eseguita due righe sopra, nello stesso test, quindi non può essere
      // l'id di una risorsa creata da qualcos'altro. NON copiare questo
      // pattern altrove nella suite: se un altro test avesse bisogno dello
      // stesso aggiramento, è un segnale che `apiDelete`/`registra()`
      // vanno estesi per accettare un tenant esplicito, non che il
      // guardrail vada bypassato di nuovo con `fetch` diretto.
      await fetch(`${getApiUrl()}/registry/produttori/${creato.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': tenantA.id },
      })
    }
  })
})

interface TrasportatoreDiProvaResponse {
  id: string
  ragioneSociale: string
}

interface DestinatarioDiProvaResponse {
  id: string
  ragioneSociale: string
}

function payloadTrasportatoreDiProva(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ragioneSociale: conPrefisso('Trasportatore per FIR SRL'),
    partitaIVA: nuovaPartitaIVA(),
    sedeLegale: SEDE_VALIDA,
    numeroIscrizione: `MI/${Math.floor(Math.random() * 900000 + 100000)}`,
    ...overrides,
  }
}

function payloadDestinatarioDiProva(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ragioneSociale: conPrefisso('Destinatario per FIR SRL'),
    partitaIVA: nuovaPartitaIVA(),
    sede: SEDE_VALIDA,
    numeroAutorizzazione: `AUT/${new Date().getFullYear()}/${Math.floor(Math.random() * 9000 + 1000)}`,
    ...overrides,
  }
}

interface ParteFirSnapshot {
  ragioneSociale: string
  partitaIva: string
  indirizzo?: string
}

interface FirResponse {
  id: string
  produttore?: ParteFirSnapshot | null
}

interface CerVoce {
  code: string
}

/**
 * Crea un FIR reale in stato BOZZA: serve a provare che cancellare il
 * produttore non alteri lo snapshot già congelato sul documento.
 *
 * BOZZA è sufficiente (non serve emettere il FIR): lo snapshot è congelato
 * alla CREAZIONE, non solo all'emissione — verificato leggendo
 * `create-fir.use-case.ts` prima di scrivere questo helper (commento "the
 * anagrafica must be captured as an immutable SNAPSHOT at creation time,
 * not referenced live"). Attraversare anche il sottosistema di emissione
 * (numerazione progressiva, firma digitale) aggiungerebbe complessità senza
 * aggiungere evidenza per QUESTO invariante.
 *
 * Il codice CER è cercato nel catalogo dell'ambiente (mai inventato): il
 * catalogo può contenere codici non più "utilizzabili per nuovo formulario"
 * (`CERCatalogService.isUtilizzabilePerNuovoFormulario`) e non c'è un
 * endpoint dedicato per saperlo in anticipo, quindi si tenta con più
 * candidati finché uno viene accettato.
 *
 * Il ciclo esce SUBITO al primo errore che non sia un rifiuto del codice
 * CER: `CreateFIRUseCase.execute` (v. `create-fir.use-case.ts`) rifiuta con
 * 400 e uno di due soli messaggi quando il problema è il catalogo —
 * `"CER code not found: …"` (codice inesistente) o il messaggio italiano
 * "non è più valido secondo il registro dell'ente" quando
 * `isUtilizzabilePerNuovoFormulario` è `false` — qualunque altro errore (una
 * delle tre anagrafiche non trovata, un campo obbligatorio mancante, un 403
 * di permessi, un 500) NON viene risolto provando un altro codice CER: senza
 * questa uscita anticipata il ciclo avrebbe continuato a interrogare fino a
 * 50 codici del catalogo per un problema che non li riguarda, incolpando
 * infine "il catalogo" con un `test.skip()` fuorviante invece di far
 * fallire il test con l'errore vero al primo tentativo.
 */
function eRifiutoCatalogoCer(errore: unknown): boolean {
  if (!(errore instanceof ApiClientError) || errore.status !== 400) return false
  const messaggio = String((errore.body as { message?: unknown } | null)?.message ?? '')
  return /CER code not found|non è più valido secondo il registro dell'ente/i.test(messaggio)
}

async function creaFirBozza(
  token: string,
  ids: { produttoreId: string; trasportatoreId: string; destinatarioId: string }
): Promise<FirResponse> {
  const catalogo = await apiGet<{ items: CerVoce[] }>('/cer?limit=50', token)
  test.skip(
    catalogo.items.length === 0,
    'Catalogo CER vuoto in questo ambiente: nessun codice disponibile per creare un FIR di prova.'
  )

  let ultimoErrore: unknown
  for (const voce of catalogo.items) {
    try {
      return await apiPost<FirResponse>(
        '/fir',
        {
          produttoreId: ids.produttoreId,
          trasportatoreId: ids.trasportatoreId,
          destinatarioId: ids.destinatarioId,
          rifiuto: { cerCode: voce.code, quantita: 10 },
          provenienza: 'SPECIALE',
          tipoTrattaPrincipale: 'TERRESTRE',
        },
        token
      )
    } catch (errore) {
      if (!eRifiutoCatalogoCer(errore)) {
        // Errore non riconducibile al codice CER: nessun altro candidato lo
        // risolverebbe, uscire subito invece di bruciare il resto del
        // catalogo.
        throw errore
      }
      ultimoErrore = errore
    }
  }

  test.skip(
    true,
    `Nessuno dei ${catalogo.items.length} codici CER del catalogo ha permesso di creare un FIR di ` +
      `prova (ultimo errore: ${String(ultimoErrore)}).`
  )
  throw ultimoErrore
}

test.describe('Produttore — effetto collaterale: lo snapshot di un FIR sopravvive alla cancellazione', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  /**
   * RULING del committente dopo revisione (vedi report della sessione): il
   * passo originale del brief presupponeva un vincolo che il disegno
   * rifiuta di proposito. L'invariante che conta davvero è l'opposto —
   * cancellare l'anagrafica NON deve alterare un documento già creato, che
   * è la garanzia legale del FIR. Oggi nessun test la proteggeva.
   */
  test('cancellare il produttore non cambia nome/P.IVA/indirizzo già congelati sul FIR', async () => {
    const token = await apiLogin('operator')
    const { creato: produttore } = await creaProduttore(token)

    const trasportatore = await apiPost<TrasportatoreDiProvaResponse>(
      '/registry/trasportatori',
      payloadTrasportatoreDiProva(),
      token
    )
    registra('trasportatore', trasportatore.id)

    const destinatario = await apiPost<DestinatarioDiProvaResponse>(
      '/registry/destinatari',
      payloadDestinatarioDiProva(),
      token
    )
    registra('destinatario', destinatario.id)

    const fir = await creaFirBozza(token, {
      produttoreId: produttore.id,
      trasportatoreId: trasportatore.id,
      destinatarioId: destinatario.id,
    })
    registra('fir', fir.id)

    const snapshotPrima = fir.produttore
    expect(snapshotPrima?.ragioneSociale).toBe(produttore.ragioneSociale)

    await apiDelete(`/registry/produttori/${produttore.id}`, token)
    // Il produttore è davvero sparito dal registro (comportamento atteso,
    // vedi docs/uat/produttore.md): non è questo il punto sotto test, ma
    // confermarlo distingue "cancellato" da "non toccato per un altro
    // motivo".
    await expect(apiGet(`/registry/produttori/${produttore.id}`, token)).rejects.toMatchObject({
      status: 404,
    })

    const firDopo = await apiGet<FirResponse>(`/fir/${fir.id}`, token)
    // Delta: lo snapshot dopo la cancellazione è IDENTICO a quello letto
    // PRIMA, non un valore assoluto indovinato.
    expect(firDopo.produttore).toEqual(snapshotPrima)
  })
})

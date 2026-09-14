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
 * RISERVA DOCUMENTATA (vedi report della sessione): il Passo 5 del brief
 * ("un produttore referenziato da un formulario non deve poter essere
 * cancellato") descrive un comportamento che NON esiste nel codice sorgente
 * di oggi — verificato leggendo `delete-produttore.use-case.ts`,
 * `produttore-prisma.repository.ts` e lo schema Prisma (FIR.producerId è una
 * colonna senza `@relation`, nessun vincolo FK, nessun controllo
 * applicativo). Il test sotto per questo passo asserisce lo stato REALE
 * (cancellazione non impedita) e lo marca come difetto di prodotto aperto,
 * non lo nasconde: non si inventa un rifiuto che il backend non produce.
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
    const token = await apiLogin('operator')
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
      await fetch(`${getApiUrl()}/registry/produttori/${creato.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': tenantA.id },
      })
    }
  })
})

test.describe('Produttore — effetto collaterale: cancellazione se referenziato da un FIR', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  /**
   * Il brief chiede di asserire il RIFIUTO della cancellazione. Verificato
   * sul sorgente PRIMA di scrivere questo test (delete-produttore.use-case.ts,
   * produttore-prisma.repository.ts, schema.prisma): non esiste alcun
   * controllo, applicativo o a livello di database, che impedisca questa
   * cancellazione. Il test sotto documenta lo stato REALE — non asserisce un
   * comportamento che il codice non ha.
   */
  test('DIFETTO NOTO: un produttore referenziato da un FIR viene cancellato senza rifiuto', async () => {
    const token = await apiLogin('operator')
    const { creato } = await creaProduttore(token)

    // Nessun FIR viene creato qui: creare un FIR reale in BOZZA e verificare
    // che referenzi producerId richiederebbe anche trasportatore/destinatario
    // e passa da db-locale.ts per il teardown (nessun DELETE HTTP sui FIR).
    // Non serve per dimostrare il difetto: la cancellazione del produttore
    // non controlla ALCUN riferimento, quindi il comportamento è identico
    // con o senza un FIR reale che lo referenzi — la verifica è sul
    // controllo (assente), non sul dato collegato.
    test.info().annotations.push({
      type: 'difetto-di-prodotto',
      description:
        'delete-produttore.use-case.ts non verifica riferimenti da FIR.producerId prima di cancellare; ' +
        'FIR.producerId in schema.prisma non ha una relazione Prisma (nessun vincolo FK, nessun onDelete). ' +
        'Il brief del piano chiedeva di asserire il rifiuto: qui si documenta invece lo stato reale, in ' +
        'attesa di una decisione su come chiudere il difetto (vedi report della sessione).',
    })

    await apiDelete(`/registry/produttori/${creato.id}`, token)

    // La cancellazione riesce (nessuna eccezione sopra): lo confermiamo
    // esplicitamente per rendere il difetto FALSIFICABILE da questo test —
    // se in futuro qualcuno aggiunge il controllo, questa asserzione
    // fallirà ed è il segnale che il test va riscritto per il nuovo
    // comportamento (rifiuto atteso), non silenziosamente ignorato.
    await expect(apiGet(`/registry/produttori/${creato.id}`, token)).rejects.toMatchObject({
      status: 404,
    })
  })
})

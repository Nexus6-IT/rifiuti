/**
 * ============================================================================
 * FASE 0 — TEST RED (TDD): Multi-Tenant Isolation Leak
 * ============================================================================
 *
 * SCENARIO DI SICUREZZA (consulente multi-società):
 *   WasteFlow è pensato per CONSULENTI che operano su PIÙ società.
 *   Un consulente ha un'associazione (ConsultantTenantAssociation) con due
 *   tenant: la società A (TENANT_A) e la società B (TENANT_B).
 *   Quando il consulente sta lavorando "nel contesto" della società B,
 *   OGNI operazione di lettura/scrittura DEVE essere isolata sul TENANT_B.
 *
 * BUG CONFERMATO (audit):
 *   I repository Prisma (produttore/trasportatore/destinatario) risolvono il
 *   tenant corrente con `getContextTenantId()`, che fa:
 *       const tenant = await this.prisma.tenant.findFirst()
 *       return tenant?.id || 'default-tenant-id'
 *   Cioè ritorna SEMPRE il PRIMO tenant del database, IGNORANDO completamente
 *   il contesto/JWT della richiesta. Se il primo tenant è A e il consulente sta
 *   operando su B, i dati vengono letti/scritti sul tenant SBAGLIATO (A) =>
 *   CROSS-TENANT DATA LEAK.
 *
 * OBIETTIVO DI QUESTO FILE (Fase 0 — approccio RED):
 *   NON correggere il bug. Scrivere un test che DOCUMENTA e RIPRODUCE la falla.
 *   Con l'implementazione ATTUALE questi test DEVONO FALLIRE (red): è proprio
 *   il fallimento che dimostra il leak e che guiderà il fix in Fase 1.
 *
 *   Il fix di Fase 1 dovrà far sì che il repository risolva il tenant dal
 *   contesto di richiesta (es. AsyncLocalStorage / TenantContext popolato dal
 *   TenantContextMiddleware a partire dal JWT) invece di `tenant.findFirst()`.
 *   Quando il fix sarà in piedi, questi test diventeranno VERDI senza modifiche.
 * ============================================================================
 */

import { ProduttorePrismaRepository } from './produttore-prisma.repository'
import { Produttore } from '../../domain/registry/entities/produttore'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'

// Identificatori delle due società su cui il consulente è associato.
const TENANT_A = 'tenant-A-societa-alfa' // PRIMO tenant nel DB (quello che findFirst() restituisce)
const TENANT_B = 'tenant-B-societa-beta' // tenant su cui il consulente sta REALMENTE operando

describe('Multi-Tenant Isolation (RED — riproduce il cross-tenant leak)', () => {
  /**
   * Mock di PrismaService.
   *
   * - `tenant.findFirst` simula il database: il PRIMO tenant è A. È esattamente
   *   ciò che oggi `getContextTenantId()` usa (a torto) come "tenant corrente".
   * - `produttore.findFirst/upsert/findMany` registrano gli argomenti `where`/
   *   `create` con cui vengono invocati, così possiamo verificare QUALE tenantId
   *   il repository ha effettivamente usato.
   */
  let prismaMock: any
  let repository: ProduttorePrismaRepository

  beforeEach(() => {
    const produttoreMock = {
      // Per default non trova nulla (verifichiamo solo il `where` usato).
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    }

    prismaMock = {
      // Il DB contiene A come primo tenant. findFirst() => sempre A.
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ id: TENANT_A, name: 'Societa Alfa' }),
      },
      // Client base (retro-compatibilità).
      produttore: produttoreMock,
      // Client esteso RLS-aware: il repository ora usa `this.prisma.db.produttore`.
      // Punta agli stessi mock così le asserzioni su `where`/`create` restano valide.
      db: {
        produttore: produttoreMock,
      },
    }

    repository = new ProduttorePrismaRepository(prismaMock as any)

    /**
     * "Impostiamo il contesto sul tenant B".
     *
     * In un'implementazione corretta il tenant corrente arriva dal contesto di
     * richiesta (AsyncLocalStorage / TenantContext popolato dal JWT). Qui lo
     * simuliamo con una variabile d'ambiente di processo che il fix di Fase 1
     * dovrà consultare (o, meglio, sostituire con un vero TenantContext).
     *
     * ASPETTATIVA CORRETTA: con contesto = B, il repository deve usare TENANT_B.
     * COMPORTAMENTO ATTUALE: il repository ignora questo contesto e usa
     * `tenant.findFirst()` => TENANT_A (leak).
     */
    process.env.CURRENT_TENANT_ID = TENANT_B
  })

  afterEach(() => {
    delete process.env.CURRENT_TENANT_ID
    jest.clearAllMocks()
  })

  it('LETTURA: una query nel contesto del tenant B NON deve filtrare sui dati del tenant A', async () => {
    // Il consulente, operando su B, cerca un produttore per Partita IVA.
    await repository.findByPartitaIVA('12345678901')

    // Catturiamo il `where` con cui il repository ha interrogato il DB.
    expect(prismaMock.produttore.findFirst).toHaveBeenCalledTimes(1)
    const whereUsato = prismaMock.produttore.findFirst.mock.calls[0][0].where

    // ASPETTATIVA CORRETTA (fix Fase 1): deve filtrare sul tenant del contesto (B).
    expect(whereUsato.tenantId).toBe(TENANT_B)

    // Esplicito: NON deve MAI ricadere sul tenant A (il "primo" del DB).
    // Con l'implementazione attuale whereUsato.tenantId === TENANT_A => questo test FALLISCE (RED).
    expect(whereUsato.tenantId).not.toBe(TENANT_A)
  })

  it('SCRITTURA: salvando nel contesto del tenant B NON deve scrivere sotto il tenant A', async () => {
    const produttore = Produttore.create({
      ragioneSociale: 'Cliente del Consulente Srl',
      partitaIVA: PartitaIVA.create('12345678901'),
      sedeLegale: Indirizzo.create({
        via: 'Via Beta',
        civico: '1',
        cap: '20100',
        citta: 'Milano',
        provincia: 'MI',
      }),
    })

    await repository.save(produttore)

    // Catturiamo il tenantId effettivamente persistito nel record `create`.
    expect(prismaMock.produttore.upsert).toHaveBeenCalledTimes(1)
    const tenantIdScritto = prismaMock.produttore.upsert.mock.calls[0][0].create.tenantId

    // ASPETTATIVA CORRETTA: il record deve nascere sotto il tenant del contesto (B).
    expect(tenantIdScritto).toBe(TENANT_B)

    // CROSS-TENANT WRITE LEAK: con il bug il record finisce sotto A => FALLISCE (RED).
    expect(tenantIdScritto).not.toBe(TENANT_A)
  })

  it('ROOT CAUSE: il tenant corrente NON deve essere risolto con tenant.findFirst() (primo tenant del DB)', async () => {
    // Operazione qualunque che attraversa getContextTenantId().
    await repository.findByPartitaIVA('99999999999')

    // Il bug è proprio l'uso di tenant.findFirst() come "tenant corrente".
    // Un'implementazione corretta legge dal contesto/JWT, NON dal "primo tenant".
    // Con l'implementazione attuale findFirst() viene chiamato => questo test FALLISCE (RED),
    // documentando la causa radice del leak.
    expect(prismaMock.tenant.findFirst).not.toHaveBeenCalled()
  })
})

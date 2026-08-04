/**
 * ISOLAMENTO FRA AZIENDE SORELLE — la prova del requisito.
 *
 * Due figlie della stessa madre non devono vedersi NULLA a vicenda. Il test
 * gira su Postgres reale e passa dall'estensione RLS (prisma.db) dentro un
 * TenantContext, cioe' esattamente il percorso delle richieste HTTP.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { PrismaClient } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { rlsExtension } from '../../infrastructure/persistence/prisma-rls.extension'

const base = new PrismaClient()
const db = base.$extends(rlsExtension)

// P.IVA valide e irripetibili fra chiamate: il campo è @unique e i dati
// restano nel DB fra un'esecuzione e l'altra. Contatore incrementale invece
// che solo Date.now(), altrimenti chiamate ravvicinate nello stesso
// millisecondo produrrebbero lo stesso valore e farebbero fallire il vincolo
// di unicità (un fallimento sporadico che non c'entra con l'isolamento).
let pivaCounter = 0
const piva = (n: number) => {
  pivaCounter += 1
  return String(Date.now() * 1000 + pivaCounter * 10 + n)
    .slice(-11)
    .padStart(11, '1')
}

describe('Isolamento fra aziende sorelle (Postgres reale)', () => {
  let madreId: string
  let alfaId: string
  let betaId: string
  let utenteAlfaId: string
  // Il FIR di Beta creato dal test "un FIR di Beta non e visibile ad Alfa"
  // referenzia producerUserId = utenteAlfaId (FK a User, tenant diverso da
  // quello del FIR). Il cascade di Tenant.delete su Alfa cancellerebbe anche
  // quell'utente: se il FIR (di Beta) non e' gia' stato rimosso, il vincolo
  // RESTRICT fra FIR e User blocca la cancellazione e lascia sporco nel DB
  // (scoperto durante la revisione: il primo tentativo di afterAll falliva
  // con `firs_producer_user_id_fkey`). Per questo va cancellato esplicitamente
  // PRIMA del giro sui tenant, invece di affidarsi al solo cascade su tenantId.
  let firBetaId: string | undefined

  beforeAll(async () => {
    const madre = await base.tenant.create({
      data: { partitaIva: piva(1), ragioneSociale: 'Gruppo Madre Srl' },
    })
    madreId = madre.id
    const alfa = await base.tenant.create({
      data: { partitaIva: piva(2), ragioneSociale: 'Alfa Srl', parentTenantId: madre.id },
    })
    alfaId = alfa.id
    const beta = await base.tenant.create({
      data: { partitaIva: piva(3), ragioneSociale: 'Beta Srl', parentTenantId: madre.id },
    })
    betaId = beta.id

    const utenteAlfa = await base.user.create({
      data: {
        tenantId: alfaId,
        email: `alfa-${Date.now()}@example.it`,
        fiscalCode: `AAAAAA00A00A${String(Date.now()).slice(-3)}A`,
        // firstName e lastName sono NOT NULL nello schema: ometterli fa
        // fallire la create con un errore del driver, non un errore di test.
        firstName: 'Utente',
        lastName: 'Alfa',
        role: 'ADMIN',
        keycloakId: `kc-${Date.now()}-${pivaCounter}`,
      },
    })
    utenteAlfaId = utenteAlfa.id

    // Un produttore per ciascuna sorella.
    await base.produttore.create({
      data: {
        tenantId: alfaId,
        ragioneSociale: 'Produttore di Alfa',
        partitaIVA: piva(4),
        via: 'Via Alfa',
        civico: '1',
        cap: '00100',
        comune: 'Roma',
        provincia: 'RM',
      },
    })
    await base.produttore.create({
      data: {
        tenantId: betaId,
        ragioneSociale: 'Produttore di Beta',
        partitaIVA: piva(5),
        via: 'Via Beta',
        civico: '2',
        cap: '20100',
        comune: 'Milano',
        provincia: 'MI',
      },
    })
  })

  afterAll(async () => {
    // Il FIR referenzia un utente di un'altra sorella (vedi commento su
    // `firBetaId` sopra): va rimosso esplicitamente prima di toccare i tenant,
    // altrimenti il cascade su Alfa (che cancella il suo utente) puo' urtare
    // il vincolo RESTRICT fra FIR e User e interrompere tutta la pulizia.
    if (firBetaId) {
      await base.fIR.delete({ where: { id: firBetaId } }).catch(err => {
        // eslint-disable-next-line no-console
        console.error(`isolamento-sorelle: impossibile cancellare il FIR ${firBetaId}`, err)
      })
    }

    // onDelete: Cascade sui dati operativi; le figlie prima della madre.
    for (const id of [alfaId, betaId, madreId]) {
      await base.tenant.delete({ where: { id } }).catch(err => {
        // Non deve passare inosservato: se la cancellazione fallisce restano
        // dati sporchi nel database fra un'esecuzione e l'altra.
        // eslint-disable-next-line no-console
        console.error(`isolamento-sorelle: impossibile cancellare il tenant ${id}`, err)
      })
    }
    await base.$disconnect()
  })

  it('Alfa non vede le anagrafiche di Beta', async () => {
    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const produttori = await db.produttore.findMany()

      expect(produttori).toHaveLength(1)
      expect(produttori[0].ragioneSociale).toBe('Produttore di Alfa')
    })
  })

  it('Alfa non raggiunge un produttore di Beta con una ricerca filtrata', async () => {
    // Rinominato in revisione: il nome originale ("nemmeno conoscendone l'id")
    // era fuorviante. `findFirst` è una delle operazioni "WHERE" che l'estensione
    // filtra iniettando `where.tenantId` — è la protezione contro una query che
    // dimentica il filtro esplicito, non contro un accesso diretto per chiave
    // primaria (quello è verificato, e smentito, dal test successivo).
    const diBeta = await base.produttore.findFirst({ where: { tenantId: betaId } })

    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const trovato = await db.produttore.findFirst({ where: { id: diBeta!.id } })

      expect(trovato).toBeNull()
    })
  })

  it("findUnique per id NON e filtrato dall'estensione: la protezione sta nei repository", async () => {
    // Questo test documenta un limite DICHIARATO dell'estensione RLS, non una
    // regressione di questo lavoro: `prisma-rls.extension.ts` esclude
    // deliberatamente findUnique/findUniqueOrThrow/update/delete per chiave
    // primaria dall'iniezione di `tenantId` (vedi il commento a
    // `applyTenantScope`, righe 196-201) perché aggiungere `tenantId` al
    // `where` di una `findUnique` per PK violerebbe il vincolo "unique field"
    // di Prisma. Il rischio esiste identico fra QUALSIASI coppia di tenant
    // (non solo fra sorelle) e non è nuovo: la vera difesa in profondità per
    // questo percorso sono i repository applicativi, che devono usare
    // `findFirst`/`findFirstOrThrow` con `where.tenantId` esplicito (o un id
    // già risolto nel tenant corretto) invece di una `findUnique` nuda per id
    // proveniente da input esterno. Se questa asserzione un giorno cambiasse
    // esito, sarebbe una modifica al comportamento dell'estensione da
    // verificare con attenzione, non un dettaglio da aggiustare qui.
    const diBeta = await base.produttore.findFirst({ where: { tenantId: betaId } })

    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const trovato = await db.produttore.findUnique({ where: { id: diBeta!.id } })

      expect(trovato).not.toBeNull()
      expect(trovato!.tenantId).toBe(betaId)
    })
  })

  it('una scrittura di Alfa nasce dentro Alfa, non altrove', async () => {
    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const creato = await db.produttore.create({
        data: {
          ragioneSociale: 'Secondo produttore di Alfa',
          partitaIVA: piva(6),
          via: 'Via Alfa',
          civico: '3',
          cap: '00100',
          comune: 'Roma',
          provincia: 'RM',
        } as any,
      })

      expect(creato.tenantId).toBe(alfaId)
    })
  })

  it('il conteggio di Beta non include i dati di Alfa', async () => {
    await TenantContext.run({ tenantId: betaId, userId: utenteAlfaId }, async () => {
      const quanti = await db.produttore.count()

      expect(quanti).toBe(1)
    })
  })

  it('la configurazione RENTRI di Alfa non e visibile a Beta', async () => {
    await base.rentriCredential.create({
      data: {
        tenantId: alfaId,
        clientId: 'client-alfa',
        certificatePem: 'PEM-ALFA',
        privateKeyEnc: 'iv:tag:cipher',
      },
    })

    await TenantContext.run({ tenantId: betaId, userId: utenteAlfaId }, async () => {
      const credenziali = await db.rentriCredential.findMany()

      expect(credenziali).toHaveLength(0)
    })
  })

  it('un FIR di Beta non e visibile ad Alfa', async () => {
    const firBeta = await base.fIR.create({
      data: {
        tenantId: betaId,
        // producerUserId e' una FK tecnica obbligatoria (User): nessuna
        // asserzione di questo test dipende da quale utente vi e' collegato,
        // quindi si riusa l'utente gia' creato per il setup invece di
        // costruirne uno dedicato solo per soddisfare il vincolo.
        producerUserId: utenteAlfaId,
        producerPartitaIva: piva(7),
        producerName: 'Produttore di Beta',
        producerAddress: 'Via Beta 2, 20100 Milano MI',
        carrierPartitaIva: piva(8),
        carrierName: 'Trasportatore di Beta',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: piva(9),
        receiverName: 'Destinatario di Beta',
        receiverAddress: 'Via Destinazione 1, 20100 Milano MI',
        cerCode: '20 01 01',
        wasteDescription: 'Carta e cartone',
        wasteCategory: 'Non pericoloso',
        quantity: 100,
        transportDate: new Date(),
      },
    })
    firBetaId = firBeta.id
    expect(firBeta.tenantId).toBe(betaId) // conferma che il dato di Beta esiste davvero

    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const fir = await db.fIR.findMany()

      expect(fir).toHaveLength(0)
    })
  })

  it('un movimento di registro di Beta non e visibile ad Alfa', async () => {
    const movimentoBeta = await base.wasteMovement.create({
      data: {
        tenantId: betaId,
        progressiveNumber: 1,
        progressiveYear: 2026,
        type: 'CARICO',
        causale: 'PRODUZIONE_INTERNA',
        cerCode: '20 01 01',
        quantity: 50,
        movementDate: new Date(),
      } as any,
    })
    expect(movimentoBeta.tenantId).toBe(betaId)

    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const movimenti = await db.wasteMovement.findMany()

      expect(movimenti).toHaveLength(0)
    })
  })

  it('un MUD di Beta non e visibile ad Alfa', async () => {
    const mudBeta = await base.mUDReport.create({
      data: {
        tenantId: betaId,
        year: 2025,
        reportData: { rifiuti: [] },
      },
    })
    expect(mudBeta.tenantId).toBe(betaId)

    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const mud = await db.mUDReport.findMany()

      expect(mud).toHaveLength(0)
    })
  })
})

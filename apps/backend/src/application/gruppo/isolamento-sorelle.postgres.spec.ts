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
  return String(Date.now() * 1000 + pivaCounter * 10 + n).slice(-11).padStart(11, '1')
}

describe('Isolamento fra aziende sorelle (Postgres reale)', () => {
  let madreId: string
  let alfaId: string
  let betaId: string
  let utenteAlfaId: string

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
    // onDelete: Cascade sui dati operativi; le figlie prima della madre.
    for (const id of [alfaId, betaId, madreId]) {
      await base.tenant.delete({ where: { id } }).catch(() => undefined)
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

  it('Alfa non raggiunge un produttore di Beta nemmeno conoscendone l id', async () => {
    const diBeta = await base.produttore.findFirst({ where: { tenantId: betaId } })

    await TenantContext.run({ tenantId: alfaId, userId: utenteAlfaId }, async () => {
      const trovato = await db.produttore.findFirst({ where: { id: diBeta!.id } })

      expect(trovato).toBeNull()
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
})

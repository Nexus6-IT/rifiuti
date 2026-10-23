import { PrismaClient } from '@prisma/client'
import { MudObbligoService } from './mud-obbligo.service'

/**
 * Flag "MUD non dovuto" (A-W-10) contro un Postgres reale: le colonne create dalla migration
 * (lette da `information_schema`, così il test fallisce se la migration manca o cambia) e il
 * giro completo imposta → log → azzera.
 */
describe('MudObbligoService — Postgres reale', () => {
  let prisma: PrismaClient
  let service: MudObbligoService
  let tenantId: string
  let userId: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    service = new MudObbligoService(prisma as any)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // Azienda e utente di prova solo per i test del servizio: il test della migration non deve
  // dipendere da un `tenant.create`, che senza le colonne fallirebbe prima dell'asserzione.
  async function preparaAzienda() {
    const suffisso = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9)
    const t = await prisma.tenant.create({
      data: { partitaIva: `MN${suffisso}`, ragioneSociale: 'Obbligo MUD SRL', country: 'IT' },
    })
    tenantId = t.id
    const u = await prisma.user.create({
      data: {
        tenantId,
        keycloakId: `keycloak-obbligo-mud-${Date.now()}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `obbligo-mud-${Date.now()}@example.com`,
        role: 'ADMIN',
      },
    })
    userId = u.id
  }

  async function pulisciAzienda() {
    // Solo le righe create qui: con un id `undefined` (creazione fallita) Prisma toglierebbe
    // il filtro e cancellerebbe l'intera tabella.
    if (tenantId) await prisma.activityLog.deleteMany({ where: { tenantId } })
    if (userId) await prisma.user.deleteMany({ where: { id: userId } })
    if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } })
  }

  describe('migration 20261022120000_tenant_mud_non_dovuto', () => {
    it('aggiunge a tenants le quattro colonne, con mud_non_dovuto NOT NULL DEFAULT false', async () => {
      const colonne = await prisma.$queryRaw<
        Array<{
          column_name: string
          is_nullable: string
          data_type: string
          column_default: string | null
          character_maximum_length: number | null
        }>
      >`
        SELECT column_name, is_nullable, data_type, column_default, character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenants'
          AND column_name LIKE 'mud_non_dovuto%'
        ORDER BY column_name
      `
      expect(
        colonne.map(c => [
          c.column_name,
          c.is_nullable,
          c.data_type,
          c.column_default,
          c.character_maximum_length,
        ])
      ).toEqual([
        ['mud_non_dovuto', 'NO', 'boolean', 'false', null],
        ['mud_non_dovuto_da', 'YES', 'uuid', null, null],
        ['mud_non_dovuto_il', 'YES', 'timestamp without time zone', null, null],
        ['mud_non_dovuto_motivo', 'YES', 'character varying', null, 500],
      ])
    })
  })

  describe('servizio', () => {
    beforeAll(preparaAzienda)
    afterAll(pulisciAzienda)

    it("un'azienda nuova è tenuta al MUD", async () => {
      expect(await service.leggi(tenantId)).toEqual({
        mudNonDovuto: false,
        motivo: null,
        impostatoIl: null,
        impostatoDa: null,
      })
    })

    it("imposta il flag con una riga nel log, poi lo azzera con un'altra", async () => {
      const attivo = await service.imposta(tenantId, userId, true, 'Meno di 10 dipendenti')

      expect(attivo.mudNonDovuto).toBe(true)
      expect(attivo.motivo).toBe('Meno di 10 dipendenti')
      expect(attivo.impostatoDa).toBe(userId)
      expect(attivo.impostatoIl).toBeInstanceOf(Date)
      expect(await service.leggi(tenantId)).toEqual(attivo)

      const spento = await service.imposta(tenantId, userId, false, null)

      expect(spento).toEqual({
        mudNonDovuto: false,
        motivo: null,
        impostatoIl: null,
        impostatoDa: null,
      })
      const log = await prisma.activityLog.findMany({
        where: { tenantId, action: 'MUD_OBBLIGO_MODIFICATO' },
        select: { userId: true, description: true, metadata: true },
      })
      // le due righe possono avere lo stesso created_at: conta che ci siano entrambe
      expect(log).toHaveLength(2)
      expect(log).toEqual(
        expect.arrayContaining([
          {
            userId,
            description: 'Azienda segnata come non tenuta al MUD: Meno di 10 dipendenti',
            metadata: {
              prima: { mudNonDovuto: false, motivo: null },
              dopo: { mudNonDovuto: true, motivo: 'Meno di 10 dipendenti' },
            },
          },
          {
            userId,
            description: 'Azienda di nuovo tenuta al MUD',
            metadata: {
              prima: { mudNonDovuto: true, motivo: 'Meno di 10 dipendenti' },
              dopo: { mudNonDovuto: false, motivo: null },
            },
          },
        ])
      )
    })
  })
})

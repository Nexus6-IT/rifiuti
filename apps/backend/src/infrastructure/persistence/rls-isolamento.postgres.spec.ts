/**
 * RLS pezzo 3, Task 4: isolamento provato COLLEGANDOSI DAVVERO come `wasteflow_app` e
 * `wasteflow_sistema` (password da `DB_APP_PASSWORD` / `DB_SISTEMA_PASSWORD`, altrimenti i
 * valori di sviluppo di `ops/db-ruoli.sh`). I ruoli devono esistere: li crea `ops/db-ruoli.sh`
 * dopo il migrate (vedi il job `test-postgres` della CI).
 *
 * I dati li crea il proprietario (`wasteflow`, che ignora la RLS) con id unici per esecuzione e
 * la pulizia toglie solo quelli: mai TRUNCATE.
 *
 * Prova di significativita': l'ultimo caso toglie la RLS da `firs` (DDL transazionale, annullato
 * dal rollback) e rifa' la stessa lettura: ora il ruolo app vede anche le righe dell'altra
 * azienda. Il DDL non e' visibile ad altre connessioni prima del commit (e bloccherebbe la
 * lettura), quindi la lettura gira sulla connessione del proprietario con `SET LOCAL ROLE`.
 *
 * Non lanciare gli spec Postgres in parallelo sullo stesso DB (il caso di significativita' prende
 * un lock esclusivo su `firs`). Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../database/client-come-ruolo'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlProprietario

const PWD_APP = process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev'
const PWD_SISTEMA = process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev'

const TABELLE = [
  'firs',
  'users',
  'waste_movements',
  'fir_signatures',
  'rentri_credentials',
  'consultant_tenant_associations',
] as const

describe('RLS: isolamento col ruolo applicativo e col ruolo di sistema (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo('wasteflow_app', PWD_APP, urlProprietario)
  const sistema = clientComeRuolo('wasteflow_sistema', PWD_SISTEMA, urlProprietario)

  const run = randomUUID().replace(/-/g, '')
  const sfx = Date.now().toString().slice(-8)
  let A = ''
  let B = ''
  const tenantIds: string[] = []
  let userA = ''
  let userB = ''
  const mov: Record<'A' | 'B', string> = { A: '', B: '' }
  let progressivo = 0
  /** Registro di ogni azienda: il movimento ne ha uno obbligatorio. */
  const registro: Record<string, string> = {}

  type Tx = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

  /** Una transazione sul client dato, col contesto azienda impostato come fa l'applicazione. */
  const conContesto = <T>(
    client: PrismaClient,
    tenant: string | null,
    fn: (tx: Tx) => Promise<T>
  ): Promise<T> =>
    client.$transaction(async tx => {
      if (tenant)
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenant}', true)`)
      return fn(tx)
    })

  const aziendeVisibili = async (tx: Tx, tabella: string) =>
    (
      await tx.$queryRawUnsafe<{ t: string }[]>(
        `SELECT DISTINCT tenant_id::text AS t FROM ${tabella} ORDER BY 1`
      )
    ).map(r => r.t)

  const inserisciMovimento = (tx: Tx, tenant: string) =>
    tx.$executeRawUnsafe(
      `INSERT INTO waste_movements (tenant_id, registro_id, updated_at, type, cer_code, quantity, movement_date,
         registration_date, progressive_number, progressive_year, causale)
       VALUES ('${tenant}', '${registro[tenant]}', now(), 'CARICO', '150101', 1, now(), now(), ${++progressivo}, 2031, 'ALTRO_CARICO')`
    )

  async function creaAzienda(tag: string) {
    const t = await owner.tenant.create({
      data: {
        partitaIva: `I${tag}${sfx}`.slice(0, 11),
        ragioneSociale: `Isolamento ${tag} ${run}`,
      },
    })
    tenantIds.push(t.id)
    registro[t.id] = (
      await owner.registroRifiuti.create({
        data: { tenantId: t.id, descrizione: 'Registro cronologico' },
      })
    ).id
    return t.id
  }

  async function creaUtente(tenantId: string, nome: string) {
    return (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-iso-${nome}-${run}`,
          fiscalCode: `ISOTNT00A00A${nome === 'a' ? '101' : '102'}Z`,
          firstName: 'Prova',
          lastName: nome,
          email: `iso-${nome}-${run}@example.it`,
          role: 'ADMIN',
        },
      })
    ).id
  }

  beforeAll(async () => {
    A = await creaAzienda('A')
    B = await creaAzienda('B')
    userA = await creaUtente(A, 'a')
    userB = await creaUtente(B, 'b')
    const repo = new FIRPrismaRepository(owner as never, owner as never)

    for (const [k, tenantId] of [
      ['A', A],
      ['B', B],
    ] as const) {
      const utente = k === 'A' ? userA : userB
      mov[k] = (
        await owner.wasteMovement.create({
          data: {
            tenantId,
            registroId: registro[tenantId],
            progressiveYear: 2031,
            progressiveNumber: ++progressivo,
            type: 'CARICO',
            movementDate: new Date('2031-03-01'),
            registrationDate: new Date('2031-03-01'),
            causale: 'ALTRO_CARICO',
            cerCode: '150101',
            quantity: 5,
            unit: 'KG',
          },
        })
      ).id
      const fir = FIR.create({
        produttoreId: '11111111-1111-4111-8111-111111111111',
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: '22222222-2222-4222-8222-222222222222',
        destinatarioId: '33333333-3333-4333-8333-333333333333',
        tenantId,
        creatoDaUserId: utente,
      } as never)
      await repo.save(fir)
      await owner.fIRSignature.create({
        data: {
          firId: fir.id,
          tenantId,
          userId: utente,
          role: 'PRODUTTORE',
          signedAt: new Date(),
          signatureValue: 'x',
          certificateHash: 'x',
          documentHash: 'x',
        },
      })
      await owner.rentriCredential.create({
        data: { tenantId, clientId: `iso-${k}-${run}`, certificatePem: 'x', privateKeyEnc: 'x' },
      })
      const ruolo = await owner.role.create({
        data: { tenantId, name: `ISO-${k}-${run}`, createdBy: utente },
      })
      await owner.consultantTenantAssociation.create({
        data: { consultantUserId: userA, tenantId, roleId: ruolo.id, addedBy: userA },
      })
    }
  })

  afterAll(async () => {
    // Solo le righe create da questo spec (cascade su figlie e dati dell'azienda).
    if (tenantIds.length) {
      await owner.consultantTenantAssociation.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.role.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.rentriCredential.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.fIR.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    }
    await Promise.all([owner.$disconnect(), app.$disconnect(), sistema.$disconnect()])
  })

  describe('lettura col ruolo app', () => {
    it.each(TABELLE)('%s: con app.tenant_id = A si vedono solo le righe di A', async tabella => {
      expect(await conContesto(app, A, tx => aziendeVisibili(tx, tabella))).toEqual([A])
      expect(await conContesto(app, B, tx => aziendeVisibili(tx, tabella))).toEqual([B])
    })

    it.each(TABELLE)('%s: senza app.tenant_id nessuna riga', async tabella => {
      expect(await conContesto(app, null, tx => aziendeVisibili(tx, tabella))).toEqual([])
    })

    it('con app.tenant_id vuoto (stringa) nessuna riga e nessun errore di cast', async () => {
      const r = await app.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '', true)`)
        return aziendeVisibili(tx, 'firs')
      })
      expect(r).toEqual([])
    })
  })

  describe('scrittura col ruolo app', () => {
    const RLS = /row-level security/

    it('INSERT con tenant_id di B in contesto A: rifiutato', async () => {
      await expect(conContesto(app, A, tx => inserisciMovimento(tx, B))).rejects.toThrow(RLS)
    })

    it('INSERT con tenant_id di A in contesto A: accettato (controprova)', async () => {
      const n = await conContesto(app, A, tx => inserisciMovimento(tx, A))
      expect(n).toBe(1)
      await owner.$executeRawUnsafe(
        `DELETE FROM waste_movements WHERE tenant_id = '${A}' AND progressive_number = ${progressivo}`
      )
    })

    it('INSERT senza contesto: rifiutato', async () => {
      await expect(conContesto(app, null, tx => inserisciMovimento(tx, A))).rejects.toThrow(RLS)
    })

    it('UPDATE che sposta tenant_id da A a B: rifiutato', async () => {
      await expect(
        conContesto(app, A, tx =>
          tx.$executeRawUnsafe(
            `UPDATE waste_movements SET tenant_id = '${B}' WHERE id = '${mov.A}'`
          )
        )
      ).rejects.toThrow(RLS)
    })

    it('UPDATE di una riga di B in contesto A: 0 righe toccate', async () => {
      const n = await conContesto(app, A, tx =>
        tx.$executeRawUnsafe(`UPDATE waste_movements SET quantity = 999 WHERE id = '${mov.B}'`)
      )
      expect(n).toBe(0)
      const [riga] = await owner.$queryRawUnsafe<{ quantity: string }[]>(
        `SELECT quantity::text FROM waste_movements WHERE id = '${mov.B}'`
      )
      expect(Number(riga.quantity)).toBe(5)
    })

    it('DELETE di una riga di B in contesto A: 0 righe toccate', async () => {
      const n = await conContesto(app, A, tx =>
        tx.$executeRawUnsafe(`DELETE FROM waste_movements WHERE id = '${mov.B}'`)
      )
      expect(n).toBe(0)
      expect(await owner.wasteMovement.count({ where: { id: mov.B } })).toBe(1)
    })
  })

  describe('ruolo di sistema', () => {
    it.each(TABELLE)('%s: vede le righe di A e di B senza contesto', async tabella => {
      const r = await sistema.$queryRawUnsafe<{ t: string }[]>(
        `SELECT DISTINCT tenant_id::text AS t FROM ${tabella}
         WHERE tenant_id IN ('${A}', '${B}') ORDER BY 1`
      )
      expect(r.map(x => x.t).sort()).toEqual([A, B].sort())
    })
  })

  describe('significativita', () => {
    it('senza RLS su firs la stessa lettura col ruolo app vede anche altre aziende', async () => {
      const rollback = new Error('rollback voluto')
      const letto: { con: string[]; senza: string[] } = { con: [], senza: [] }
      await expect(
        owner.$transaction(async tx => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE wasteflow_app')
          await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${A}', true)`)
          letto.con = await aziendeVisibili(tx, 'firs')
          await tx.$executeRawUnsafe('RESET ROLE')
          await tx.$executeRawUnsafe('ALTER TABLE firs DISABLE ROW LEVEL SECURITY')
          await tx.$executeRawUnsafe('SET LOCAL ROLE wasteflow_app')
          letto.senza = await aziendeVisibili(tx, 'firs')
          throw rollback
        })
      ).rejects.toBe(rollback)
      expect(letto.con).toEqual([A])
      expect(letto.senza).toEqual(expect.arrayContaining([A, B]))
      // Il rollback ha ripristinato la RLS: dal ruolo app, di nuovo solo A.
      expect(await conContesto(app, A, tx => aziendeVisibili(tx, 'firs'))).toEqual([A])
    })
  })
})

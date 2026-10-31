/**
 * Anagrafica automezzi e strumenti contro un Postgres reale, collegato COME `wasteflow_app`
 * (RLS ENABLE+FORCE) e dentro il `TenantContext` dell'azienda. Il proprietario prepara aziende,
 * trasportatori, accessi e pesate (tabelle in sola scrittura); la pulizia cancella SOLO le
 * aziende create qui, per id esatto (la cascata da `tenants` e' l'unica cancellazione ammessa).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55444/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo, partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { AutomezziService } from './automezzi.service'
import { AutomezzoDuplicatoError, TrasportatoreNonTrovatoError } from './errori-pese'
import { StrumentiPesaService } from './strumenti-pesa.service'

const HASH = 'a'.repeat(64)

describe('Automezzi e strumenti di pesa — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let automezzi: AutomezziService
  let strumenti: StrumentiPesaService
  const tenantCreati: string[] = []
  let n = 0
  const seme = 6_000_000 + (Date.now() % 3_000_000)

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda() {
    n++
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(seme + n * 17),
        ragioneSociale: 'Automezzi SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-auto-${seme}-${n}`,
        fiscalCode: `AUTO${seme}${n}`.slice(0, 16),
        firstName: 'Prova',
        lastName: 'Automezzi',
        email: `auto-${seme}-${n}@example.test`,
        role: 'ADMIN',
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro A' },
    })
    const trasportatore = await creaDittaConRuolo(owner, t.id, 'TRASPORTATORE')
    return {
      tenantId: t.id,
      utenteId: utente.id,
      registroId: registro.id,
      trasp: trasportatore.ruoloId,
    }
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    automezzi = new AutomezziService(app)
    strumenti = new StrumentiPesaService(app)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    if (tenantCreati.length) {
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await app.$disconnect()
    await owner.$disconnect()
  })

  it('due richieste concorrenti con la stessa targa: una 201 e una 409', async () => {
    const a = await azienda()

    const esiti = await Promise.allSettled(
      ['ab 123 cd', 'AB-123-CD'].map(targa =>
        nelTenant(a.tenantId, () => automezzi.crea(a.tenantId, a.utenteId, { targa }))
      )
    )

    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    const rifiutati = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
    expect(rifiutati).toHaveLength(1)
    expect(rifiutati[0].reason).toBeInstanceOf(AutomezzoDuplicatoError)
    const righe = await owner.automezzo.findMany({ where: { tenantId: a.tenantId } })
    expect(righe.map(r => r.targa)).toEqual(['AB123CD'])
  })

  it('stessa motrice con rimorchi diversi: due automezzi; stessa targa in un’altra azienda: ok', async () => {
    const a = await azienda()
    const b = await azienda()

    await nelTenant(a.tenantId, () =>
      automezzi.crea(a.tenantId, a.utenteId, { targa: 'ZZ111ZZ', targaRimorchio: 'R1' })
    )
    await nelTenant(a.tenantId, () =>
      automezzi.crea(a.tenantId, a.utenteId, { targa: 'ZZ111ZZ', targaRimorchio: 'R2' })
    )
    await nelTenant(b.tenantId, () => automezzi.crea(b.tenantId, b.utenteId, { targa: 'ZZ111ZZ' }))
    await expect(
      nelTenant(a.tenantId, () =>
        automezzi.crea(a.tenantId, a.utenteId, { targa: 'zz111zz', targaRimorchio: 'r1' })
      )
    ).rejects.toThrow(AutomezzoDuplicatoError)
    const elenco = await nelTenant(a.tenantId, () => automezzi.elenca(a.tenantId, 'zz11'))
    expect(elenco).toHaveLength(2)
  })

  it('trasportatore di un’altra azienda: rifiutato (la FK semplice lo accetterebbe); il proprio: ok', async () => {
    const a = await azienda()
    const b = await azienda()

    await expect(
      nelTenant(a.tenantId, () =>
        automezzi.crea(a.tenantId, a.utenteId, { targa: 'TR111TR', trasportatoreId: b.trasp })
      )
    ).rejects.toThrow(TrasportatoreNonTrovatoError)
    const mio = await nelTenant(a.tenantId, () =>
      automezzi.crea(a.tenantId, a.utenteId, { targa: 'TR111TR', trasportatoreId: a.trasp })
    )
    expect(mio.trasportatoreId).toBe(a.trasp)
    // anche in aggiornamento
    await expect(
      nelTenant(a.tenantId, () =>
        automezzi.aggiorna(a.tenantId, a.utenteId, mio.id, {
          targa: 'TR111TR',
          trasportatoreId: b.trasp,
        })
      )
    ).rejects.toThrow(TrasportatoreNonTrovatoError)
    expect(await owner.automezzo.count({ where: { tenantId: b.tenantId } })).toBe(0)
  })

  it('automezzo di un’altra azienda: invisibile (RLS) in lettura e in scrittura', async () => {
    const a = await azienda()
    const b = await azienda()
    const daB = await nelTenant(b.tenantId, () =>
      automezzi.crea(b.tenantId, b.utenteId, { targa: 'XX222XX' })
    )

    expect(await nelTenant(a.tenantId, () => automezzi.elenca(a.tenantId))).toEqual([])
    await expect(
      nelTenant(a.tenantId, () =>
        automezzi.impostaTara(a.tenantId, a.utenteId, daB.id, { taraKg: 7000 })
      )
    ).rejects.toThrow('Automezzo non trovato.')
  })

  it('tara da pesata copia il peso effettivo (dopo rettifica) e la data della pesata', async () => {
    const a = await azienda()
    const mezzo = await nelTenant(a.tenantId, () =>
      automezzi.crea(a.tenantId, a.utenteId, { targa: 'TA111RA' })
    )
    const strumento = await nelTenant(a.tenantId, () =>
      strumenti.crea(a.tenantId, a.utenteId, { descrizione: 'Pesa', portataMaxKg: 60000 })
    )
    const accesso = await owner.$queryRaw<{ id: string }[]>`
      INSERT INTO accessi_pesa (tenant_id, registro_id, anno, numero, verso, modo, aperto_da)
      VALUES (${a.tenantId}::uuid, ${a.registroId}::uuid, 2026, 1, 'CARICO', 'DOPPIA', ${a.utenteId}::uuid)
      RETURNING id::text AS id`
    const accessoId = accesso[0].id
    const ora = new Date('2026-10-20T08:30:00.000Z')
    const inserisciPesata = (ordine: number, peso: number) =>
      owner.$queryRaw<{ id: string }[]>`
        INSERT INTO pesate (tenant_id, accesso_id, ordine, fonte, strumento_id, peso_kg, stabile,
                            ora_ricezione, chiave_idempotenza, impronta)
        VALUES (${a.tenantId}::uuid, ${accessoId}::uuid, ${ordine}, 'STRUMENTO',
                ${strumento.id}::uuid, ${peso}, true, ${ora}, gen_random_uuid(), ${HASH})
        RETURNING id::text AS id`
    await inserisciPesata(1, 24000)
    const tara = (await inserisciPesata(2, 7000))[0].id
    await owner.$executeRaw`
      INSERT INTO rettifiche_peso (tenant_id, pesata_id, numero, peso_precedente_kg, peso_nuovo_kg,
                                   motivo, autore_id, impronta, created_at)
      VALUES (${a.tenantId}::uuid, ${tara}::uuid, 1, 7000, 7120.5, 'errore di lettura',
              ${a.utenteId}::uuid, ${HASH}, now())`

    const vista = await nelTenant(a.tenantId, () =>
      automezzi.impostaTara(a.tenantId, a.utenteId, mezzo.id, { pesataId: tara })
    )

    expect(vista).toMatchObject({
      taraKg: 7120.5,
      taraOrigine: 'PESATA',
      taraPesataId: tara,
      taraAggiornataIl: ora.toISOString(),
      ultimaPesataVuotoIl: ora.toISOString(),
    })
    // la dichiarata successiva azzera il legame con la pesata (vincolo automezzi_tara_check)
    const dichiarata = await nelTenant(a.tenantId, () =>
      automezzi.impostaTara(a.tenantId, a.utenteId, mezzo.id, { taraKg: 7300 })
    )
    expect(dichiarata).toMatchObject({
      taraKg: 7300,
      taraOrigine: 'DICHIARATA',
      taraPesataId: null,
      ultimaPesataVuotoIl: null,
    })
    const audit = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId, action: 'PESA_TARA_IMPOSTATA' },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit).toHaveLength(2)
    expect(audit[1].metadata).toMatchObject({ precedente: 7120.5, nuova: 7300 })
  })

  it('tara da una pesata inesistente: 404', async () => {
    const a = await azienda()
    const mezzo = await nelTenant(a.tenantId, () =>
      automezzi.crea(a.tenantId, a.utenteId, { targa: 'AL111TR' })
    )
    const inesistente = '99999999-0000-4000-8000-000000000009'

    await expect(
      nelTenant(a.tenantId, () =>
        automezzi.impostaTara(a.tenantId, a.utenteId, mezzo.id, { pesataId: inesistente })
      )
    ).rejects.toThrow('Pesata non trovata.')
  })

  it('strumenti: matricola unica per azienda, registro di un’altra azienda rifiutato', async () => {
    const a = await azienda()
    const b = await azienda()
    const dati = { descrizione: 'Pesa a ponte', matricola: 'MAT-1', portataMaxKg: 60000 }

    await nelTenant(a.tenantId, () => strumenti.crea(a.tenantId, a.utenteId, dati))
    await expect(
      nelTenant(a.tenantId, () => strumenti.crea(a.tenantId, a.utenteId, dati))
    ).rejects.toThrow('Esiste già uno strumento con questa matricola.')
    await nelTenant(b.tenantId, () => strumenti.crea(b.tenantId, b.utenteId, dati))
    await expect(
      nelTenant(a.tenantId, () =>
        strumenti.crea(a.tenantId, a.utenteId, { descrizione: 'X', registroId: b.registroId })
      )
    ).rejects.toThrow('Registro non trovato')
  })
})

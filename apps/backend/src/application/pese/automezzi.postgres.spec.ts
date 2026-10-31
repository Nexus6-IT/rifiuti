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

  /** Accesso con le sue pesate (strumento registrato), preparato dal proprietario. */
  async function accessoConPesate(
    a: Awaited<ReturnType<typeof azienda>>,
    strumentoId: string,
    o: {
      automezzoId?: string | null
      targa?: string | null
      modo?: 'DOPPIA' | 'SINGOLA'
      verso?: 'CARICO' | 'SCARICO'
      pesi?: number[]
      ora?: Date
      annulla?: boolean
    } = {}
  ) {
    const ora = o.ora ?? new Date('2026-10-20T08:30:00.000Z')
    const modo = o.modo ?? 'DOPPIA'
    const [acc] = await owner.$queryRaw<{ id: string }[]>`
      INSERT INTO accessi_pesa (tenant_id, registro_id, anno, numero, verso, modo, automezzo_id, targa, aperto_da)
      VALUES (${a.tenantId}::uuid, ${a.registroId}::uuid, 2026, ${++n}, ${o.verso ?? 'CARICO'}::"waste_movement_type",
              ${modo}::"modo_pesatura", ${o.automezzoId ?? null}::uuid, ${o.targa ?? null}, ${a.utenteId}::uuid)
      RETURNING id::text AS id`
    const pesi = o.pesi ?? (modo === 'SINGOLA' ? [7000] : [24000, 7000])
    const ids: string[] = []
    for (const [k, peso] of pesi.entries()) {
      const [p] = await owner.$queryRaw<{ id: string }[]>`
        INSERT INTO pesate (tenant_id, accesso_id, ordine, fonte, strumento_id, peso_kg, stabile,
                            ora_ricezione, chiave_idempotenza, impronta)
        VALUES (${a.tenantId}::uuid, ${acc.id}::uuid, ${k + 1}, 'STRUMENTO', ${strumentoId}::uuid,
                ${peso}, true, ${ora}, gen_random_uuid(), ${HASH})
        RETURNING id::text AS id`
      ids.push(p.id)
    }
    if (o.annulla) {
      await owner.$executeRaw`
        UPDATE accessi_pesa SET stato = 'ANNULLATO', annullato_da = ${a.utenteId}::uuid,
               annullato_il = now(), motivo_annullamento = 'x' WHERE id = ${acc.id}::uuid`
    }
    return { accessoId: acc.id, pesate: ids, ora }
  }

  async function mezzoEStrumento(a: Awaited<ReturnType<typeof azienda>>, targa: string) {
    const mezzo = await nelTenant(a.tenantId, () =>
      automezzi.crea(a.tenantId, a.utenteId, { targa })
    )
    const strumento = await nelTenant(a.tenantId, () =>
      strumenti.crea(a.tenantId, a.utenteId, { descrizione: 'Pesa', portataMaxKg: 60000 })
    )
    return { mezzo, strumento }
  }

  const tara = (a: Awaited<ReturnType<typeof azienda>>, id: string, pesataId: string) =>
    nelTenant(a.tenantId, () => automezzi.impostaTara(a.tenantId, a.utenteId, id, { pesataId }))

  it('tara da pesata copia il peso effettivo (dopo rettifica) e la data della pesata', async () => {
    const a = await azienda()
    const { mezzo, strumento } = await mezzoEStrumento(a, 'TA111RA')
    const { pesate, ora } = await accessoConPesate(a, strumento.id, { automezzoId: mezzo.id })
    await owner.$executeRaw`
      INSERT INTO rettifiche_peso (tenant_id, pesata_id, numero, peso_precedente_kg, peso_nuovo_kg,
                                   motivo, autore_id, impronta, created_at)
      VALUES (${a.tenantId}::uuid, ${pesate[1]}::uuid, 1, 7000, 7120.5, 'errore di lettura',
              ${a.utenteId}::uuid, ${HASH}, now())`

    const vista = await tara(a, mezzo.id, pesate[1])

    expect(vista).toMatchObject({
      taraKg: 7120.5,
      taraOrigine: 'PESATA',
      taraPesataId: pesate[1],
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

  describe('tara da pesata: coerenza con l’accesso (422)', () => {
    it('accesso assegnato a un altro automezzo', async () => {
      const a = await azienda()
      const { mezzo, strumento } = await mezzoEStrumento(a, 'AA111AA')
      const altro = await nelTenant(a.tenantId, () =>
        automezzi.crea(a.tenantId, a.utenteId, { targa: 'BB222BB' })
      )
      const { pesate } = await accessoConPesate(a, strumento.id, { automezzoId: altro.id })

      await expect(tara(a, mezzo.id, pesate[1])).rejects.toThrow('altro automezzo')
    })

    it('accesso senza automezzo: targa diversa rifiutata, targa uguale accettata', async () => {
      const a = await azienda()
      const { mezzo, strumento } = await mezzoEStrumento(a, 'CC333CC')
      const diversa = await accessoConPesate(a, strumento.id, { targa: 'ZZ999ZZ' })
      const uguale = await accessoConPesate(a, strumento.id, { targa: 'CC333CC' })

      await expect(tara(a, mezzo.id, diversa.pesate[1])).rejects.toThrow('non corrisponde')
      await expect(tara(a, mezzo.id, uguale.pesate[1])).resolves.toMatchObject({ taraKg: 7000 })
    })

    it('pesata singola', async () => {
      const a = await azienda()
      const { mezzo, strumento } = await mezzoEStrumento(a, 'DD444DD')
      const { pesate } = await accessoConPesate(a, strumento.id, {
        automezzoId: mezzo.id,
        modo: 'SINGOLA',
      })

      await expect(tara(a, mezzo.id, pesate[0])).rejects.toThrow('pesata singola')
    })

    it('lato lordo (carico: prima; scarico: seconda); lato tara accettato', async () => {
      const a = await azienda()
      const { mezzo, strumento } = await mezzoEStrumento(a, 'EE555EE')
      const carico = await accessoConPesate(a, strumento.id, { automezzoId: mezzo.id })
      const scarico = await accessoConPesate(a, strumento.id, {
        automezzoId: mezzo.id,
        verso: 'SCARICO',
        pesi: [6500, 24000],
      })

      await expect(tara(a, mezzo.id, carico.pesate[0])).rejects.toThrow('serve la pesata a vuoto')
      await expect(tara(a, mezzo.id, scarico.pesate[1])).rejects.toThrow('serve la pesata a vuoto')
      await expect(tara(a, mezzo.id, scarico.pesate[0])).resolves.toMatchObject({ taraKg: 6500 })
      await expect(tara(a, mezzo.id, carico.pesate[1])).resolves.toMatchObject({ taraKg: 7000 })
    })

    it('accesso annullato', async () => {
      const a = await azienda()
      const { mezzo, strumento } = await mezzoEStrumento(a, 'FF666FF')
      const { pesate } = await accessoConPesate(a, strumento.id, {
        automezzoId: mezzo.id,
        annulla: true,
      })

      await expect(tara(a, mezzo.id, pesate[1])).rejects.toThrow('annullato')
    })

    it('pesata di un’altra azienda: 404', async () => {
      const a = await azienda()
      const b = await azienda()
      const { mezzo } = await mezzoEStrumento(a, 'GG777GG')
      const { mezzo: mezzoB, strumento: strumentoB } = await mezzoEStrumento(b, 'GG777GG')
      const daB = await accessoConPesate(b, strumentoB.id, { automezzoId: mezzoB.id })

      await expect(tara(a, mezzo.id, daB.pesate[1])).rejects.toThrow('Pesata non trovata.')
    })
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

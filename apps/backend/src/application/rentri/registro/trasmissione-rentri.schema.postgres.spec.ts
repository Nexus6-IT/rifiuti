/**
 * Schema della trasmissione del registro a RENTRI (Fase 2 pezzo 9, Task 1) contro un Postgres reale,
 * COME `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext`. Il proprietario (`wasteflow`)
 * prepara aziende, registri e movimenti e legge cio' che e' stato scritto; la pulizia toglie solo le
 * aziende create qui, per id esatti.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'

describe('Trasmissione del registro a RENTRI, schema — Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 08'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let n = 0
  let progressivo = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  type Az = { tenantId: string; registroId: string }

  async function azienda(): Promise<Az> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Trasmissione RENTRI SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001TR${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: { tenantId: t.id, unitaLocaleId: sede.id, descrizione: 'Registro di prova' },
    })
    return { tenantId: t.id, registroId: registro.id }
  }

  function movimento(az: Az, type: 'CARICO' | 'SCARICO' = 'CARICO') {
    return owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        type,
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'ALTRO_SCARICO',
        cerCode: CER,
        quantity: 10,
        unit: 'KG',
      },
    })
  }

  /** Riga di trasmissione scritta dal proprietario (salta la RLS, non i trigger e i CHECK). */
  async function riga(
    az: Az,
    stato:
      | 'DA_TRASMETTERE'
      | 'TRASMESSA'
      | 'RIFIUTATA'
      | 'INCERTA'
      | 'GIA_SU_RENTRI' = 'DA_TRASMETTERE',
    extra: Record<string, unknown> = {}
  ) {
    const m = await movimento(az)
    const bloccata = stato === 'TRASMESSA' || stato === 'GIA_SU_RENTRI' || stato === 'INCERTA'
    return owner.movimentoTrasmissioneRentri.create({
      data: {
        tenantId: az.tenantId,
        movimentoId: m.id,
        registroId: az.registroId,
        tipo: m.type,
        stato,
        origine: 'MANUALE',
        bloccatoInvio: bloccata,
        motivoBlocco: bloccata ? 'motivo di prova' : null,
        ...extra,
      },
    })
  }

  /** L'errore porta il nome del vincolo (o il messaggio del trigger). */
  async function errore(p: Promise<unknown>): Promise<string> {
    try {
      await p
    } catch (e) {
      return String((e as Error).message)
    }
    throw new Error('attesa una violazione, non e arrivata')
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    // Pulizia per id esatti: la cascata dell'azienda toglie registri, movimenti e righe di trasmissione.
    if (tenantCreati.length > 0) {
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it("inserisce una riga DA_TRASMETTERE nel contesto dell'azienda", async () => {
    const az = await azienda()
    const m = await movimento(az)
    const creata = await nelTenant(az.tenantId, () =>
      app.db.movimentoTrasmissioneRentri.create({
        data: {
          tenantId: az.tenantId,
          movimentoId: m.id,
          registroId: az.registroId,
          tipo: m.type,
          origine: 'MANUALE',
        },
      })
    )
    expect(creata.stato).toBe('DA_TRASMETTERE')
    expect(creata.bloccatoInvio).toBe(false)
    expect(creata.tentativi).toBe(0)
    expect(creata.messaggi).toEqual([])
    const letta = await nelTenant(az.tenantId, () =>
      app.db.movimentoTrasmissioneRentri.findUnique({ where: { movimentoId: m.id } })
    )
    expect(letta?.id).toBe(creata.id)
  })

  it("seconda riga per lo stesso movimento: violazione dell'unico 1:1", async () => {
    const az = await azienda()
    const prima = await riga(az)
    const msg = await errore(
      owner.movimentoTrasmissioneRentri.create({
        data: {
          tenantId: az.tenantId,
          movimentoId: prima.movimentoId,
          registroId: az.registroId,
          tipo: prima.tipo,
          origine: 'AUTOMATICA',
        },
      })
    )
    expect(msg).toMatch(/Unique constraint|movimenti_trasmissione_rentri_movimento_id_key/)
  })

  it('registro o tipo diversi da quelli del movimento: violazione della FK composta', async () => {
    const az = await azienda()
    const altro = await azienda()
    const m = await movimento(az, 'CARICO')
    const tipoSbagliato = await errore(
      owner.movimentoTrasmissioneRentri.create({
        data: {
          tenantId: az.tenantId,
          movimentoId: m.id,
          registroId: az.registroId,
          tipo: 'SCARICO',
          origine: 'MANUALE',
        },
      })
    )
    expect(tipoSbagliato).toMatch(/movimenti_trasmissione_rentri_movimento_fkey|Foreign key/)
    const registroSbagliato = await errore(
      owner.movimentoTrasmissioneRentri.create({
        data: {
          tenantId: az.tenantId,
          movimentoId: m.id,
          registroId: altro.registroId,
          tipo: 'CARICO',
          origine: 'MANUALE',
        },
      })
    )
    expect(registroSbagliato).toMatch(/movimenti_trasmissione_rentri_movimento_fkey|Foreign key/)
  })

  describe('CHECK', () => {
    const casi: Array<
      [string, string, (az: Az, movimentoId: string, tipo: 'CARICO') => Record<string, unknown>]
    > = [
      [
        'bloccato_coerente',
        'TRASMESSA non bloccata',
        () => ({ stato: 'TRASMESSA', bloccatoInvio: false }),
      ],
      [
        'coda_sbloccata',
        'DA_TRASMETTERE bloccata',
        () => ({ stato: 'DA_TRASMETTERE', bloccatoInvio: true, motivoBlocco: 'x' }),
      ],
      [
        'motivo_blocco',
        'bloccata senza motivo',
        () => ({ stato: 'RIFIUTATA', bloccatoInvio: true, motivoBlocco: null }),
      ],
      [
        'attesa_transazione',
        'ATTESA_ESITO senza transazione',
        () => ({ stato: 'ATTESA_ESITO', transazioneId: null }),
      ],
      [
        'identificativo',
        'identificativo fuori formato',
        () => ({ stato: 'RIFIUTATA', identificativoRentri: 'm123' }),
      ],
    ]
    for (const [nome, descrizione, dati] of casi) {
      it(`${nome}: ${descrizione}`, async () => {
        const az = await azienda()
        const m = await movimento(az)
        const msg = await errore(
          owner.movimentoTrasmissioneRentri.create({
            data: {
              tenantId: az.tenantId,
              movimentoId: m.id,
              registroId: az.registroId,
              tipo: m.type,
              origine: 'MANUALE',
              ...dati(az, m.id, 'CARICO'),
            } as never,
          })
        )
        expect(msg).toContain(`movimenti_trasmissione_rentri_${nome}_check`)
      })
    }
  })

  it('una riga TRASMESSA non torna DA_TRASMETTERE né si sblocca', async () => {
    const az = await azienda()
    const r = await riga(az, 'TRASMESSA')
    const indietro = await errore(
      owner.movimentoTrasmissioneRentri.update({
        where: { id: r.id },
        data: { stato: 'DA_TRASMETTERE', bloccatoInvio: false, motivoBlocco: null },
      })
    )
    expect(indietro).toContain('non cambia stato')
    const sblocco = await errore(
      owner.movimentoTrasmissioneRentri.update({
        where: { id: r.id },
        data: { bloccatoInvio: false },
      })
    )
    expect(sblocco).toMatch(/non cambia stato|coerente|bloccato/)
    // Un campo non protetto (tentativi) si aggiorna.
    const ok = await owner.movimentoTrasmissioneRentri.update({
      where: { id: r.id },
      data: { tentativi: 3 },
    })
    expect(ok.tentativi).toBe(3)
    const gia = await riga(az, 'GIA_SU_RENTRI')
    expect(
      await errore(
        owner.movimentoTrasmissioneRentri.update({
          where: { id: gia.id },
          data: { stato: 'RIFIUTATA' },
        })
      )
    ).toContain('non cambia stato')
  })

  it("l'identificativo di una TRASMESSA passa solo da NULL a valore", async () => {
    const az = await azienda()
    const r = await riga(az, 'TRASMESSA')
    expect(r.identificativoRentri).toBeNull()
    const id1 = 'M' + 'A'.repeat(19)
    const aggiornata = await owner.movimentoTrasmissioneRentri.update({
      where: { id: r.id },
      data: { identificativoRentri: id1 },
    })
    expect(aggiornata.identificativoRentri).toBe(id1)
    const msg = await errore(
      owner.movimentoTrasmissioneRentri.update({
        where: { id: r.id },
        data: { identificativoRentri: 'M' + 'B'.repeat(19) },
      })
    )
    expect(msg).toContain('passa solo da NULL a un valore')
    // Movimento, registro, tipo e azienda non si spostano mai.
    const altro = await movimento(az)
    expect(
      await errore(
        owner.movimentoTrasmissioneRentri.update({
          where: { id: r.id },
          data: { movimentoId: altro.id },
        })
      )
    ).toMatch(/non si modificano/)
  })

  it('DELETE diretto di una TRASMESSA rifiutato, di una DA_TRASMETTERE consentito', async () => {
    const az = await azienda()
    const trasmessa = await riga(az, 'TRASMESSA')
    const daTrasmettere = await riga(az, 'DA_TRASMETTERE')
    const rifiutata = await riga(az, 'RIFIUTATA')
    expect(
      await errore(owner.movimentoTrasmissioneRentri.delete({ where: { id: trasmessa.id } }))
    ).toContain('non si cancella')
    expect(
      await errore(
        nelTenant(az.tenantId, () =>
          app.db.movimentoTrasmissioneRentri.delete({ where: { id: trasmessa.id } })
        )
      )
    ).toContain('non si cancella')
    await nelTenant(az.tenantId, () =>
      app.db.movimentoTrasmissioneRentri.delete({ where: { id: daTrasmettere.id } })
    )
    await owner.movimentoTrasmissioneRentri.delete({ where: { id: rifiutata.id } })
    expect(
      await owner.movimentoTrasmissioneRentri.count({
        where: { id: { in: [daTrasmettere.id, rifiutata.id] } },
      })
    ).toBe(0)
    expect(await owner.movimentoTrasmissioneRentri.count({ where: { id: trasmessa.id } })).toBe(1)
  })

  it("cancellare l'azienda (proprietario) cancella anche le righe TRASMESSA", async () => {
    const az = await azienda()
    const t = await riga(az, 'TRASMESSA')
    const g = await riga(az, 'GIA_SU_RENTRI')
    await owner.tenant.delete({ where: { id: az.tenantId } })
    expect(
      await owner.movimentoTrasmissioneRentri.count({ where: { id: { in: [t.id, g.id] } } })
    ).toBe(0)
    expect(await owner.wasteMovement.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('identificativo del registro fuori formato rifiutato; uguale in due aziende consentito; doppio nella stessa azienda rifiutato', async () => {
    const a = await azienda()
    const b = await azienda()
    expect(
      await errore(
        owner.registroRifiuti.update({
          where: { id: a.registroId },
          data: { identificativoRentri: 'r123' },
        })
      )
    ).toContain('registri_rifiuti_identificativo_rentri_check')
    const idr = 'RAB12345CD'.padEnd(11, '0')
    await owner.registroRifiuti.update({
      where: { id: a.registroId },
      data: { identificativoRentri: idr },
    })
    await owner.registroRifiuti.update({
      where: { id: b.registroId },
      data: { identificativoRentri: idr },
    })
    const sede2 = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: a.tenantId,
        numIscrSito: `OP0001TR${String(++n).padStart(6, '0')}-MI0002`,
        denominazione: 'Sede 2',
        principale: false,
      },
    })
    const secondo = await owner.registroRifiuti.create({
      data: { tenantId: a.tenantId, unitaLocaleId: sede2.id, descrizione: 'Secondo registro' },
    })
    expect(
      await errore(
        owner.registroRifiuti.update({
          where: { id: secondo.id },
          data: { identificativoRentri: idr },
        })
      )
    ).toMatch(/registri_rifiuti_tenant_identificativo_rentri_key|Unique constraint/)
  })

  it('con il contesto di B le righe di A non si vedono né si aggiornano', async () => {
    const a = await azienda()
    const b = await azienda()
    const r = await riga(a, 'DA_TRASMETTERE')
    expect(
      await nelTenant(b.tenantId, () =>
        app.db.movimentoTrasmissioneRentri.findMany({ where: { id: r.id } })
      )
    ).toHaveLength(0)
    const upd = await nelTenant(b.tenantId, () =>
      app.db.movimentoTrasmissioneRentri.updateMany({ where: { id: r.id }, data: { tentativi: 9 } })
    )
    expect(upd.count).toBe(0)
    const ancora = await owner.movimentoTrasmissioneRentri.findUnique({ where: { id: r.id } })
    expect(ancora?.tentativi).toBe(0)
    // Una riga scritta nel contesto di B per un movimento di A viene rifiutata dalla RLS.
    const m = await movimento(a)
    await expect(
      nelTenant(b.tenantId, () =>
        app.db.movimentoTrasmissioneRentri.create({
          data: {
            tenantId: a.tenantId,
            movimentoId: m.id,
            registroId: a.registroId,
            tipo: m.type,
            origine: 'MANUALE',
          },
        })
      )
    ).rejects.toThrow(/row-level security|violates/i)
  })
})

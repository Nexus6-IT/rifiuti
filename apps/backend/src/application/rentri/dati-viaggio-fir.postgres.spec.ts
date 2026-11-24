/**
 * FIR in viaggio P2, T0/T3 — colonne di quantita' e trasporto su `firs` e `fir_transporters` contro un
 * Postgres reale, collegato COME `wasteflow_app`: il repository dei dati di viaggio (lettura, salvataggio
 * alla creazione, aggiornamento dopo l'ente, isolamento fra aziende) e la lettura dell'aggregate.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { DatiViaggioFirRepository } from '../../infrastructure/persistence/dati-viaggio-fir.repository'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'

describe('FIR in viaggio P2 — dati di viaggio, Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let repo: DatiViaggioFirRepository
  let firRepo: FIRPrismaRepository
  const tenantCreati: string[] = []
  const REG = '11111111-1111-4111-8111-111111111111'

  interface Azienda {
    t: string
    fir: string
  }

  async function azienda(): Promise<Azienda> {
    const t = (
      await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Viaggio SRL', country: 'IT' },
      })
    ).id
    tenantCreati.push(t)
    const sigla = partitaIvaUnica()
    const utente = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-vi-${sigla}`,
          fiscalCode: `VIA${sigla}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Viaggio',
          email: `vi-${sigla}@example.test`,
          role: 'OPERATOR',
        },
      })
    ).id
    const fir = FIR.create({
      produttoreId: REG,
      rifiuto: { cerCode: '150101', quantita: 100, numeroColli: 4 },
      trasportatoreId: REG,
      destinatarioId: REG,
      tenantId: t,
      creatoDaUserId: utente,
    } as any)
    await new FIRPrismaRepository(owner as any, owner as any).save(fir)
    return { t, fir: fir.id }
  }

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    repo = new DatiViaggioFirRepository(app)
    firRepo = new FIRPrismaRepository(app as any, app as any)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    for (const t of tenantCreati) {
      try {
        await owner.fIR.deleteMany({ where: { tenantId: t } })
        await owner.user.deleteMany({ where: { tenantId: t } })
        await owner.tenant.delete({ where: { id: t } })
      } catch (e) {
        console.error(`pulizia dati viaggio: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('un FIR nuovo ha i dati di viaggio vuoti (colonne nullable, nessun default)', async () => {
    const a = await azienda()
    const d = await nelTenant(a.t, () => repo.leggi(a.t, a.fir))
    expect(d).toMatchObject({
      firId: a.fir,
      quantita: 100,
      numeroColli: 4,
      verificatoInPartenza: null,
      rinfusa: null,
      principale: {
        conducenteNome: null,
        conducenteCognome: null,
        targaRimorchio: null,
        percorso: null,
      },
      tratteAggiuntive: [],
    })
    expect(d?.dataTrasporto).toBeInstanceOf(Date)
  })

  it("salvaDatiPartenza: undefined non tocca, null svuota, e l'aggregate li legge in sola lettura", async () => {
    const a = await azienda()
    await nelTenant(a.t, () =>
      repo.salvaDatiPartenza(a.t, a.fir, {
        rinfusa: true,
        verificatoInPartenza: false,
        conducenteNome: 'Mario',
        conducenteCognome: 'Rossi',
        targaRimorchio: 'XY987ZW',
        percorso: 'A1',
      })
    )
    await nelTenant(a.t, () =>
      repo.salvaDatiPartenza(a.t, a.fir, { percorso: null, conducenteNome: undefined })
    )
    const d = await nelTenant(a.t, () => repo.leggi(a.t, a.fir))
    expect(d).toMatchObject({
      rinfusa: true,
      verificatoInPartenza: false,
      principale: {
        conducenteNome: 'Mario',
        conducenteCognome: 'Rossi',
        targaRimorchio: 'XY987ZW',
        percorso: null,
      },
    })
    const fir = await nelTenant(a.t, () => firRepo.findById(a.fir))
    expect(fir?.datiViaggio).toEqual({
      rinfusa: true,
      verificatoInPartenza: false,
      conducenteNome: 'Mario',
      conducenteCognome: 'Rossi',
      targaRimorchio: 'XY987ZW',
      percorso: null,
      dichiarato: null,
    })
  })

  it("il save dell'aggregate non riscrive i dati di viaggio", async () => {
    const a = await azienda()
    await nelTenant(a.t, () =>
      repo.salvaDatiPartenza(a.t, a.fir, { conducenteNome: 'Mario', rinfusa: true })
    )
    const fir = await nelTenant(a.t, () => firRepo.findById(a.fir))
    await nelTenant(a.t, () => firRepo.save(fir!))
    const d = await nelTenant(a.t, () => repo.leggi(a.t, a.fir))
    expect(d).toMatchObject({ rinfusa: true, principale: { conducenteNome: 'Mario' } })
  })

  /** Le colonne che entrano nel documento firmato all'emissione (`toSignableDocument`). */
  const firmate = async (firId: string) => {
    const r = (await owner.fIR.findUnique({ where: { id: firId } }))!
    return {
      quantity: Number(r.quantity),
      unit: r.unit,
      wastePackageCount: r.wastePackageCount,
      carrierVehiclePlate: r.carrierVehiclePlate,
      transportDate: r.transportDate,
      versione: r.versione,
    }
  }

  it('aggiornaQuantitaDopoEnte: scrive la copia dichiarata e NON tocca le colonne firmate (C1)', async () => {
    const a = await azienda()
    const prima = await firmate(a.fir)
    await nelTenant(a.t, () =>
      repo.aggiornaQuantitaDopoEnte(a.t, a.fir, {
        valore: 1.5,
        unitaMisura: 't',
        numeroColli: 7,
        rinfusa: false,
        verificatoInPartenza: true,
      })
    )
    expect(await firmate(a.fir)).toEqual(prima)
    expect(await nelTenant(a.t, () => repo.leggi(a.t, a.fir))).toMatchObject({
      quantita: 100,
      numeroColli: 4,
      rinfusa: false,
      verificatoInPartenza: true,
      dichiarato: { quantita: { valore: 1.5, unitaMisura: 't', numeroColli: 7 } },
    })
    // alla rinfusa i colli dichiarati sono null
    await nelTenant(a.t, () =>
      repo.aggiornaQuantitaDopoEnte(a.t, a.fir, {
        valore: 800,
        unitaMisura: 'litri',
        numeroColli: 7,
        rinfusa: true,
        verificatoInPartenza: null,
      })
    )
    expect((await nelTenant(a.t, () => repo.leggi(a.t, a.fir)))?.dichiarato?.quantita).toEqual({
      valore: 800,
      unitaMisura: 'litri',
      numeroColli: null,
    })
    expect(await firmate(a.fir)).toEqual(prima)
  })

  it('aggiornaTrasportoDopoEnte: copia dichiarata, quantita e trasporto si fondono, firmate intatte (C1)', async () => {
    const a = await azienda()
    const prima = await firmate(a.fir)
    await nelTenant(a.t, () =>
      repo.aggiornaQuantitaDopoEnte(a.t, a.fir, {
        valore: 5,
        unitaMisura: 'kg',
        numeroColli: 1,
        rinfusa: false,
        verificatoInPartenza: null,
      })
    )
    await nelTenant(a.t, () =>
      repo.aggiornaTrasportoDopoEnte(a.t, a.fir, {
        targaAutomezzo: 'AB123CD',
        conducenteNome: 'Mario',
        conducenteCognome: 'De Rossi',
        targaRimorchio: null,
        percorso: 'A1',
      })
    )
    const d = await nelTenant(a.t, () => repo.leggi(a.t, a.fir))
    expect(d).toMatchObject({
      targaAutomezzo: '',
      principale: { conducenteNome: 'Mario', conducenteCognome: 'De Rossi', percorso: 'A1' },
      dichiarato: {
        quantita: { valore: 5, unitaMisura: 'kg', numeroColli: 1 },
        trasporto: { targaAutomezzo: 'AB123CD' },
      },
    })
    expect(await firmate(a.fir)).toEqual(prima)
  })

  it("il save dell'aggregate non riscrive la copia dichiarata (I1)", async () => {
    const a = await azienda()
    const fir = await nelTenant(a.t, () => firRepo.findById(a.fir))
    await nelTenant(a.t, () =>
      repo.aggiornaQuantitaDopoEnte(a.t, a.fir, {
        valore: 9,
        unitaMisura: 'kg',
        numeroColli: 2,
        rinfusa: false,
        verificatoInPartenza: null,
      })
    )
    await nelTenant(a.t, () => firRepo.save(fir!)) // aggregate letto PRIMA: stato vecchio
    expect((await nelTenant(a.t, () => repo.leggi(a.t, a.fir)))?.dichiarato?.quantita?.valore).toBe(
      9
    )
  })

  it('le tratte aggiuntive portano i loro dati di trasporto', async () => {
    const a = await azienda()
    await owner.fIRTransporter.create({
      data: {
        firId: a.fir,
        tenantId: a.t,
        ordine: 1,
        tipoTratta: 'TERRESTRE',
        denominazione: 'Secondo Trasporti',
        conducenteNome: 'Luigi',
        conducenteCognome: 'Verdi',
        targaRimorchio: 'ZZ111ZZ',
        percorso: 'SS7',
        dataOraInizioTrasporto: new Date('2026-11-22T06:00:00Z'),
      },
    })
    const d = await nelTenant(a.t, () => repo.leggi(a.t, a.fir))
    expect(d?.tratteAggiuntive).toHaveLength(1)
    expect(d?.tratteAggiuntive[0]).toMatchObject({
      ordine: 1,
      denominazione: 'Secondo Trasporti',
      conducenteNome: 'Luigi',
      conducenteCognome: 'Verdi',
      targaRimorchio: 'ZZ111ZZ',
      percorso: 'SS7',
    })
    expect(d?.tratteAggiuntive[0].dataOraInizioTrasporto).toEqual(new Date('2026-11-22T06:00:00Z'))
  })

  it("ultimoTrasportoPerTarga: l'ultimo FIR dell'azienda con quella targa e un conducente completo", async () => {
    const a = await azienda()
    const b = await azienda()
    await nelTenant(a.t, () =>
      repo.aggiornaTrasportoDopoEnte(a.t, a.fir, {
        targaAutomezzo: 'ZZ123ZZ',
        conducenteNome: 'Mario',
        conducenteCognome: 'Rossi',
        targaRimorchio: 'XY987ZW',
        percorso: null,
      })
    )
    expect(await nelTenant(a.t, () => repo.ultimoTrasportoPerTarga(a.t, 'ZZ123ZZ'))).toEqual({
      conducenteNome: 'Mario',
      conducenteCognome: 'Rossi',
      targaRimorchio: 'XY987ZW',
    })
    expect(await nelTenant(a.t, () => repo.ultimoTrasportoPerTarga(a.t, 'AA000AA'))).toBeNull()
    // Un'altra azienda non vede il conducente di questa, nemmeno con la stessa targa.
    expect(await nelTenant(b.t, () => repo.ultimoTrasportoPerTarga(b.t, 'ZZ123ZZ'))).toBeNull()
    expect(await nelTenant(b.t, () => repo.ultimoTrasportoPerTarga(a.t, 'ZZ123ZZ'))).toBeNull()
  })

  it('i limiti del contratto sono anche limiti delle colonne (conducente 50, targa 10, percorso 250)', async () => {
    const a = await azienda()
    for (const dati of [
      { conducenteNome: 'x'.repeat(51) },
      { targaRimorchio: 'ABCDEFGHIJK' },
      { percorso: 'p'.repeat(251) },
    ]) {
      await expect(nelTenant(a.t, () => repo.salvaDatiPartenza(a.t, a.fir, dati))).rejects.toThrow()
    }
  })

  it("un altro tenant non legge ne scrive i dati di viaggio dell'azienda", async () => {
    const a = await azienda()
    const b = await azienda()
    expect(await nelTenant(b.t, () => repo.leggi(a.t, a.fir))).toBeNull()
    await nelTenant(b.t, () =>
      repo.aggiornaQuantitaDopoEnte(a.t, a.fir, {
        valore: 9999,
        unitaMisura: 'kg',
        numeroColli: 1,
        rinfusa: false,
        verificatoInPartenza: null,
      })
    )
    expect((await nelTenant(a.t, () => repo.leggi(a.t, a.fir)))?.quantita).toBe(100)
  })
})

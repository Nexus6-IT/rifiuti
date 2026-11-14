/**
 * Dati del tracciato per movimento (4.9c-f, A4) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext` dell'azienda. Il proprietario
 * prepara i dati; la pulizia toglie solo le righe create qui, per `tenantId`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
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
import {
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { DatiTracciatoService } from './dati-tracciato.service'
import { DatiTracciatoNonValidiError } from './dati-tracciato.port'
import { MarcaturaConsorziService } from './marcatura-consorzi.service'
import { MovimentoNonTrovatoError } from './marcatura-consorzi.port'

describe('Dati del tracciato per movimento — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: DatiTracciatoService
  let marcatura: MarcaturaConsorziService
  const tenantCreati: string[] = []

  const nel = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  async function nuovaAzienda(sigla: string) {
    const az = await creaAziendaMud(owner, sigla, { province: 'MI' })
    tenantCreati.push(az.tenantId)
    return az
  }

  const carico = (az: AziendaMud, cerCode: string, giorno: string) =>
    creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode,
      quantita: 100,
      unita: 'KG',
      giorno,
    })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    servizio = new DatiTracciatoService(app)
    marcatura = new MarcaturaConsorziService(app)
  })

  afterAll(async () => {
    // I dati puntano ai movimenti (NO ACTION): prima loro, poi il resto.
    const where = { tenantId: { in: tenantCreati } }
    await owner.datiTracciatoMovimento.deleteMany({ where })
    await owner.datiConsorzioMovimento.deleteMany({ where })
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('imposta, rilegge, sostituisce e cancella i dati; un tracciato non scrive sull’altro', async () => {
    const az = await nuovaAzienda('T1')
    const m = await carico(az, '13 02 05*', '2026-05-10')
    expect(await nel(az, () => servizio.leggi(az.tenantId, m.id, 'CONOU'))).toBeNull()

    const v = await nel(az, () =>
      servizio.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', {
        prodotto: 'A',
        percentualeOlio: 90.5,
      })
    )
    expect(v).toMatchObject({
      tracciato: 'CONOU',
      dati: { prodotto: 'A', percentualeOlio: 90.5 },
      versioneSchema: 1,
    })
    const riletto = await nel(az, () => servizio.leggi(az.tenantId, m.id, 'CONOU'))
    expect(riletto?.dati).toEqual({ prodotto: 'A', percentualeOlio: 90.5 })

    // Sostituzione completa, non merge.
    await nel(az, () => servizio.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { causale: 'M' }))
    expect((await nel(az, () => servizio.leggi(az.tenantId, m.id, 'CONOU')))?.dati).toEqual({
      causale: 'M',
    })
    expect(await nel(az, () => servizio.leggi(az.tenantId, m.id, 'COBAT'))).toBeNull()
    expect(await owner.datiTracciatoMovimento.count({ where: { tenantId: az.tenantId } })).toBe(1)

    await nel(az, () => servizio.cancella(az.tenantId, m.id, 'CONOU'))
    expect(await nel(az, () => servizio.leggi(az.tenantId, m.id, 'CONOU'))).toBeNull()
    // Idempotente.
    await nel(az, () => servizio.cancella(az.tenantId, m.id, 'CONOU'))
  })

  it('dati non validi o tracciato sconosciuto: errore con l’elenco, nessuna riga scritta', async () => {
    const az = await nuovaAzienda('T2')
    const m = await carico(az, '13 02 05*', '2026-05-10')
    const err = await nel(az, () =>
      servizio.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { prodotto: 'Z', extra: 1 })
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DatiTracciatoNonValidiError)
    expect((err as DatiTracciatoNonValidiError).errori).toEqual([
      'extra: campo sconosciuto',
      'prodotto: uno tra A, B, C, E, G',
    ])
    await expect(
      nel(az, () => servizio.imposta(az.tenantId, az.utenteId, m.id, 'ORSO' as never, {}))
    ).rejects.toBeInstanceOf(DatiTracciatoNonValidiError)
    expect(await owner.datiTracciatoMovimento.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('la marcatura per consorzio resta identica: scrivere e togliere i dati non crea né toglie correzioni manuali', async () => {
    const az = await nuovaAzienda('T3')
    // CER 13: marcato CONOU dalla regola di sistema, non da una correzione.
    const m = await carico(az, '13 02 05*', '2026-05-10')
    const prima = await nel(az, () => marcatura.consorziDeiMovimenti(az.tenantId, [m.id]))
    expect(prima[m.id].marcature).toEqual([{ consorzio: 'CONOU', origine: 'REGOLA' }])

    await nel(az, () =>
      servizio.imposta(az.tenantId, az.utenteId, m.id, 'CONOU', { prodotto: 'A' })
    )
    const durante = await nel(az, () => marcatura.consorziDeiMovimenti(az.tenantId, [m.id]))
    expect(durante).toEqual(prima)
    expect(await owner.datiConsorzioMovimento.count({ where: { tenantId: az.tenantId } })).toBe(0)

    await nel(az, () => servizio.cancella(az.tenantId, m.id, 'CONOU'))
    const dopo = await nel(az, () => marcatura.consorziDeiMovimenti(az.tenantId, [m.id]))
    expect(dopo).toEqual(prima)
    expect(await owner.datiConsorzioMovimento.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('i dati seguono la radice: impostati su una rettifica finiscono sulla radice e si leggono da entrambe', async () => {
    const az = await nuovaAzienda('T4')
    const radice = await carico(az, '13 02 05*', '2026-05-10')
    const rettifica = await creaMovimento(owner, az, {
      tipo: 'RETTIFICA',
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 80,
      giorno: '2026-05-10',
      rettificatoId: radice.id,
      originaleId: radice.id,
    })
    await nel(az, () =>
      servizio.imposta(az.tenantId, az.utenteId, rettifica.id, 'COBAT', { tipoMovimento: 3 })
    )
    const righe = await owner.datiTracciatoMovimento.findMany({ where: { tenantId: az.tenantId } })
    expect(righe).toHaveLength(1)
    expect(righe[0].movimentoOriginaleId).toBe(radice.id)
    for (const id of [radice.id, rettifica.id]) {
      expect((await nel(az, () => servizio.leggi(az.tenantId, id, 'COBAT')))?.dati).toEqual({
        tipoMovimento: 3,
      })
    }
    // Annullamento della catena: i dati restano sulla radice, nessun errore.
    await creaMovimento(owner, az, {
      tipo: 'ANNULLAMENTO',
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 80,
      giorno: '2026-05-10',
      rettificatoId: rettifica.id,
      originaleId: radice.id,
    })
    expect(await nel(az, () => servizio.leggi(az.tenantId, radice.id, 'COBAT'))).not.toBeNull()
  })

  it('un movimento di un’altra azienda: MovimentoNonTrovatoError e nessuna riga scritta', async () => {
    const a = await nuovaAzienda('T5a')
    const b = await nuovaAzienda('T5b')
    const mb = await carico(b, '13 02 05*', '2026-05-10')
    await expect(
      nel(a, () => servizio.imposta(a.tenantId, a.utenteId, mb.id, 'CONOU', { prodotto: 'A' }))
    ).rejects.toBeInstanceOf(MovimentoNonTrovatoError)
    await expect(nel(a, () => servizio.leggi(a.tenantId, mb.id, 'CONOU'))).rejects.toBeInstanceOf(
      MovimentoNonTrovatoError
    )
    await expect(
      nel(a, () => servizio.cancella(a.tenantId, mb.id, 'CONOU'))
    ).rejects.toBeInstanceOf(MovimentoNonTrovatoError)
    expect(
      await owner.datiTracciatoMovimento.count({
        where: { tenantId: { in: [a.tenantId, b.tenantId] } },
      })
    ).toBe(0)
  })

  it('le righe di un’azienda non si vedono da un’altra (RLS)', async () => {
    const a = await nuovaAzienda('T6a')
    const b = await nuovaAzienda('T6b')
    const ma = await carico(a, '13 02 05*', '2026-05-10')
    await nel(a, () => servizio.imposta(a.tenantId, a.utenteId, ma.id, 'ORR', { attivita: 'FRA' }))
    const viste = await nel(b, () => app.datiTracciatoMovimento.count())
    expect(viste).toBe(0)
  })
})

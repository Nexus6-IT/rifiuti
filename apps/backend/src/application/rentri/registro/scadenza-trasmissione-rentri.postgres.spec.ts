/**
 * E0: `ImpostazioniRentriRegistroService.leggi` aggiunge il termine della trasmissione mensile,
 * per registro, COME `wasteflow_app` (RLS). Il proprietario prepara i dati. Nessuna chiamata a
 * RENTRI: il client e' un oggetto vuoto che farebbe fallire qualunque uso.
 */
import { PrismaClient, type StatoTrasmissioneRentri } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { randomUUID } from 'crypto'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import {
  creaMovimentoImportato,
  lottoDiProva,
} from '../../../test-support/migrazione/movimento-importato'
import { ImpostazioniRentriRegistroService } from './impostazioni-rentri-registro.service'

import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
describe('E0: termine della trasmissione mensile nelle impostazioni del registro — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const logger: any = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  const tenantCreati: string[] = []
  let n = 0
  let progressivo = 0
  let servizio: ImpostazioniRentriRegistroService

  interface Az {
    tenantId: string
    registroId: string
    unitaLocaleId: string
  }

  async function azienda(
    identificativo: string | null = 'RABCDE12345',
    invioAutomaticoDal: Date | null = new Date('2020-01-01T00:00:00Z')
  ): Promise<Az> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Termini RENTRI SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001TE${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede.id,
        descrizione: 'Registro termini',
        identificativoRentri: identificativo,
        invioRentriAutomaticoDal: invioAutomaticoDal,
      },
    })
    return { tenantId: t.id, registroId: registro.id, unitaLocaleId: sede.id }
  }

  async function movimento(
    az: Az,
    data: string,
    stato?: StatoTrasmissioneRentri,
    extra: Record<string, unknown> = {}
  ) {
    const m = await owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        cerCode: '15 01 01',
        unit: 'KG',
        wastePhysicalState: 'Solido',
        type: 'CARICO',
        movementDate: new Date(data),
        registrationDate: new Date(data),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 100,
        ...extra,
      } as never,
    })
    if (stato) {
      const bloccata = ['TRASMESSA', 'GIA_SU_RENTRI', 'INCERTA'].includes(stato)
      await owner.movimentoTrasmissioneRentri.create({
        data: {
          tenantId: az.tenantId,
          movimentoId: m.id,
          registroId: az.registroId,
          tipo: 'CARICO',
          origine: 'MANUALE',
          stato,
          bloccatoInvio: bloccata,
          motivoBlocco: bloccata ? 'prova' : null,
          // il CHECK della migration vuole l'id della transazione per le righe gia' partite
          ...(stato === 'ATTESA_ESITO' ? { transazioneId: randomUUID() } : {}),
        } as never,
      })
    }
    return m
  }

  const termine = async (az: Az, registroId = az.registroId) =>
    (await servizio.leggi(az.tenantId)).find(r => r.registroId === registroId)?.scadenzaTrasmissione

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new ImpostazioniRentriRegistroService(app, {} as never, logger)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await cancellaAziendeDiProva(owner, tenantCreati)
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('registro senza annotazioni: nessun termine', async () => {
    const az = await azienda()
    expect(await termine(az)).toBeNull()
  })

  it('annotazione senza riga di trasmissione: termine = fine del mese successivo', async () => {
    const az = await azienda()
    await movimento(az, '2026-01-31T10:00:00Z')
    expect(await termine(az)).toMatchObject({ mese: '2026-01', entro: '2026-02-28' })
  })

  it.each(['DA_TRASMETTERE', 'RIFIUTATA', 'NON_TRASMISSIBILE', 'INCERTA'] as const)(
    'una riga %s tiene aperto il termine',
    async stato => {
      const az = await azienda()
      await movimento(az, '2026-02-10T10:00:00Z', stato)
      expect(await termine(az)).toMatchObject({ mese: '2026-02', entro: '2026-03-31' })
    }
  )

  it.each(['TRASMESSA', 'GIA_SU_RENTRI', 'IN_INVIO', 'ATTESA_ESITO'] as const)(
    'una riga %s non pesa sul termine',
    async stato => {
      const az = await azienda()
      await movimento(az, '2026-02-10T10:00:00Z', stato)
      expect(await termine(az)).toBeNull()
    }
  )

  it('conta la più vecchia fra le annotazioni non confermate, ignorando le confermate', async () => {
    const az = await azienda()
    await movimento(az, '2026-01-05T10:00:00Z', 'TRASMESSA')
    await movimento(az, '2026-03-05T10:00:00Z', 'DA_TRASMETTERE')
    await movimento(az, '2026-04-05T10:00:00Z')
    expect(await termine(az)).toMatchObject({ mese: '2026-03', entro: '2026-04-30' })
  })

  it('i movimenti importati da riconciliare non contano', async () => {
    const az = await azienda()
    const lottoId = await lottoDiProva(owner, az.tenantId)
    await creaMovimentoImportato(
      owner,
      { ...az, lottoId },
      {
        registrationDate: new Date('2025-01-10T10:00:00Z'),
      }
    )
    expect(await termine(az)).toBeNull()
  })

  it('I1: le annotazioni senza riga nate prima di invio_rentri_automatico_dal non contano (D3, nessun invio retroattivo)', async () => {
    const az = await azienda('RABCDE12345', new Date(Date.now() + 3600_000))
    await movimento(az, '2026-01-10T10:00:00Z')
    expect(await termine(az)).toBeNull()
  })

  it('I1: registro senza invio automatico: le annotazioni senza riga non contano, quelle in coda sì', async () => {
    const az = await azienda('RABCDE12345', null)
    await movimento(az, '2026-01-10T10:00:00Z')
    expect(await termine(az)).toBeNull()
    await movimento(az, '2026-02-10T10:00:00Z', 'DA_TRASMETTERE')
    expect((await termine(az))?.mese).toBe('2026-02')
  })

  it('I1: una riga accodata a mano prima della data conta comunque', async () => {
    const az = await azienda('RABCDE12345', new Date(Date.now() + 3600_000))
    await movimento(az, '2026-01-10T10:00:00Z', 'DA_TRASMETTERE')
    expect((await termine(az))?.mese).toBe('2026-01')
  })

  it('I2: la correzione di un importato da riconciliare (senza riga) non conta', async () => {
    const az = await azienda()
    const lottoId = await lottoDiProva(owner, az.tenantId)
    const imp = await creaMovimentoImportato(owner, { ...az, lottoId })
    await movimento(az, '2026-01-10T10:00:00Z', undefined, {
      tipoAnnotazione: 'RETTIFICA',
      movimentoRettificatoId: imp.movimentoId,
      movimentoOriginaleId: imp.movimentoId,
      motivoAnnotazione: 'Rettifica di prova',
    })
    expect(await termine(az)).toBeNull()
  })

  it('I2: la correzione di un movimento ordinario senza riga conta', async () => {
    const az = await azienda()
    const base = await movimento(az, '2026-01-05T10:00:00Z', 'TRASMESSA')
    await movimento(az, '2026-01-10T10:00:00Z', undefined, {
      tipoAnnotazione: 'RETTIFICA',
      movimentoRettificatoId: base.id,
      movimentoOriginaleId: base.id,
      motivoAnnotazione: 'Rettifica di prova',
    })
    expect((await termine(az))?.mese).toBe('2026-01')
  })

  it('registro senza identificativo RENTRI: nessun termine (non e il registro di RENTRI)', async () => {
    const az = await azienda(null)
    await movimento(az, '2026-01-10T10:00:00Z')
    expect(await termine(az)).toBeNull()
  })

  it('i registri dell’azienda hanno ciascuno il proprio termine', async () => {
    const az = await azienda()
    const altro = await owner.registroRifiuti.create({
      data: {
        tenantId: az.tenantId,
        unitaLocaleId: az.unitaLocaleId,
        codice: 'ALTRO',
        descrizione: 'Altro registro',
        identificativoRentri: 'RZZZZZ99999',
        invioRentriAutomaticoDal: new Date('2020-01-01T00:00:00Z'),
      },
    })
    await movimento(az, '2026-01-10T10:00:00Z')
    await owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: altro.id,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        cerCode: '15 01 01',
        unit: 'KG',
        wastePhysicalState: 'Solido',
        type: 'CARICO',
        movementDate: new Date('2026-05-10T10:00:00Z'),
        registrationDate: new Date('2026-05-10T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 1,
      } as never,
    })
    expect((await termine(az))?.mese).toBe('2026-01')
    expect((await termine(az, altro.id))?.mese).toBe('2026-05')
  })

  it('isolamento: le annotazioni di un’altra azienda non spostano il termine', async () => {
    const a = await azienda()
    const b = await azienda()
    await movimento(b, '2025-06-10T10:00:00Z')
    expect(await termine(a)).toBeNull()
    expect((await termine(b))?.mese).toBe('2025-06')
  })
})

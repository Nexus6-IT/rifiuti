/** Dettaglio di trasmissione contro Postgres reale (ruolo wasteflow_app): fasi, 404 e isolamento fra aziende. */
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

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { DettaglioTrasmissioneRentriService } from './dettaglio-trasmissione-rentri.service'
import { MovimentoNonTrovatoError } from './errori-azioni-rentri-registro'

import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
describe('DettaglioTrasmissioneRentriService — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: DettaglioTrasmissioneRentriService
  const tenantCreati: string[] = []
  let n = 0
  let prog = 0

  async function scenario(
    stato: 'DA_TRASMETTERE' | 'ATTESA_ESITO' | 'INCERTA' | 'TRASMESSA' | null
  ) {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Dettaglio SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001DT${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede.id,
        descrizione: 'R',
        identificativoRentri: 'RABCDE12345',
      },
    })
    const m = await owner.wasteMovement.create({
      data: {
        tenantId: t.id,
        registroId: registro.id,
        progressiveYear: 2026,
        progressiveNumber: ++prog,
        cerCode: '15 01 01',
        unit: 'KG',
        wastePhysicalState: 'Solido',
        type: 'CARICO',
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 100,
      },
    })
    if (stato) {
      const bloccata = stato === 'INCERTA' || stato === 'TRASMESSA'
      await owner.movimentoTrasmissioneRentri.create({
        data: {
          tenantId: t.id,
          movimentoId: m.id,
          registroId: registro.id,
          tipo: 'CARICO',
          origine: 'MANUALE',
          stato,
          bloccatoInvio: bloccata,
          motivoBlocco: bloccata ? 'Motivo di prova' : null,
          transazioneId: stato === 'ATTESA_ESITO' ? '5d5d5d5d-0000-4000-8000-000000000001' : null,
          identificativoRentri: stato === 'TRASMESSA' ? 'M0000000000000000001' : null,
          trasmessoIl: stato === 'TRASMESSA' ? new Date() : null,
        },
      })
    }
    return { tenantId: t.id, movimentoId: m.id }
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    service = new DettaglioTrasmissioneRentriService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      // Le righe DA_TRASMETTERE si cancellano; le altre vanno con l'azienda (cascata).
      await owner.movimentoTrasmissioneRentri.deleteMany({
        where: { tenantId: { in: tenantCreati }, stato: 'DA_TRASMETTERE' },
      })
      await owner.wasteMovement.deleteMany({
        where: { tenantId: { in: tenantCreati }, trasmissioneRentri: null },
      })
      await cancellaAziendeDiProva(owner, tenantCreati)
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it.each([
    ['DA_TRASMETTERE', 'IN_CODA', false],
    ['ATTESA_ESITO', 'INVIATA_IN_ATTESA_DI_CONFERMA', false],
    ['INCERTA', 'ESITO_INCERTO', false],
    ['TRASMESSA', 'CONFERMATA', true],
  ] as const)('%s -> fase %s (confermata=%s)', async (stato, fase, confermata) => {
    const s = await scenario(stato)
    const d = await service.dettaglio(s.tenantId, s.movimentoId)
    expect(d).toMatchObject({ stato, fase, confermata, origine: 'MANUALE' })
    expect(d.identificativo).toBe(stato === 'TRASMESSA' ? 'M0000000000000000001' : null)
  })

  it('movimento importato: stato DA_RICONCILIARE -> fase DA_RICONCILIARE, mai confermata, con il motivo del blocco', async () => {
    const s = await scenario(null)
    const m = await owner.wasteMovement.findUniqueOrThrow({ where: { id: s.movimentoId } })
    const lotto = await owner.lottoImport.create({
      data: {
        tenantId: s.tenantId,
        importSource: 'WINWASTE',
        archivio: 'WW00012026',
        ambito: 'REGISTRO',
        formatoStaging: 'winwaste-staging/1',
        hashStaging: 'd'.repeat(64),
      },
    })
    // Un movimento diventa «importato» solo alla nascita: ne creo uno e la sua riga di blocco insieme.
    const importato = await owner.$transaction(async tx => {
      const nuovo = await tx.wasteMovement.create({
        data: {
          tenantId: s.tenantId,
          registroId: m.registroId,
          progressiveYear: 2026,
          progressiveNumber: ++prog,
          cerCode: '15 01 01',
          unit: 'KG',
          type: 'CARICO',
          movementDate: new Date('2026-03-01T10:00:00Z'),
          registrationDate: new Date('2026-03-01T10:00:00Z'),
          causale: 'PRODUZIONE_INTERNA',
          quantity: 10,
          importSource: 'WINWASTE',
          legacyKey: '0001|2026|MOVIMENTI|1',
          lottoImportId: lotto.id,
        },
      })
      await tx.movimentoTrasmissioneRentri.create({
        data: {
          tenantId: s.tenantId,
          movimentoId: nuovo.id,
          registroId: m.registroId,
          tipo: 'CARICO',
          origine: 'IMPORTAZIONE',
          stato: 'DA_RICONCILIARE',
          bloccatoInvio: true,
          motivoBlocco: 'Importato: in attesa di riconciliazione',
        },
      })
      return nuovo
    })
    const d = await service.dettaglio(s.tenantId, importato.id)
    expect(d).toMatchObject({
      stato: 'DA_RICONCILIARE',
      fase: 'DA_RICONCILIARE',
      confermata: false,
      origine: 'IMPORTAZIONE',
      motivoBlocco: 'Importato: in attesa di riconciliazione',
    })
  })

  it("senza riga o di un'altra azienda: MovimentoNonTrovatoError", async () => {
    const senza = await scenario(null)
    await expect(service.dettaglio(senza.tenantId, senza.movimentoId)).rejects.toBeInstanceOf(
      MovimentoNonTrovatoError
    )
    const a = await scenario('DA_TRASMETTERE')
    const b = await scenario('DA_TRASMETTERE')
    await expect(service.dettaglio(b.tenantId, a.movimentoId)).rejects.toBeInstanceOf(
      MovimentoNonTrovatoError
    )
  })
})

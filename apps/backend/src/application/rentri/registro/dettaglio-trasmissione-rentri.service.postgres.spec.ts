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
import { partitaIvaValida } from '../../../test-support/anagrafiche-di-test'
import { DettaglioTrasmissioneRentriService } from './dettaglio-trasmissione-rentri.service'
import { MovimentoNonTrovatoError } from './errori-azioni-rentri-registro'

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
        partitaIva: partitaIvaValida(Date.now() + ++n),
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
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
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

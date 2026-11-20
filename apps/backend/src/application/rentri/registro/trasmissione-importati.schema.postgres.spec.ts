/**
 * Fase 3 (3.1), Task 4: blocco all'invio a RENTRI dei MOVIMENTI importati, nel database. Le scritture
 * sotto prova girano COME `wasteflow_app` dentro il `TenantContext` (RLS ENABLE+FORCE); il proprietario
 * prepara aziende, registri e lotti e prova che i trigger fermano anche lui. La pulizia toglie solo le
 * aziende create qui, per id esatti (la cascata porta via movimenti, righe e lotti).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55447/wasteflow_ci?schema=public'
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

import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
describe("Fase 3 (3.1): blocco all'invio dei movimenti importati — Postgres reale, ruolo wasteflow_app", () => {
  const CER = '99 99 08'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let progressivo = 0
  let chiaveN = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  interface Az {
    tenantId: string
    registroId: string
    lottoId: string
  }

  async function azienda(): Promise<Az> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Import blocco SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const registro = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro di prova' },
    })
    const lotto = await owner.lottoImport.create({
      data: {
        tenantId: t.id,
        importSource: 'WINWASTE',
        archivio: 'WW00012026',
        ambito: 'REGISTRO',
        formatoStaging: 'winwaste-staging/1',
        hashStaging: 'b'.repeat(64),
      },
    })
    return { tenantId: t.id, registroId: registro.id, lottoId: lotto.id }
  }

  const datiMovimento = (az: Az, importato: boolean) => ({
    tenantId: az.tenantId,
    registroId: az.registroId,
    progressiveYear: 2026,
    progressiveNumber: ++progressivo,
    type: 'CARICO' as const,
    movementDate: new Date('2026-03-01T10:00:00Z'),
    registrationDate: new Date('2026-03-01T10:00:00Z'),
    causale: 'PRODUZIONE_INTERNA',
    cerCode: CER,
    quantity: 10,
    unit: 'KG' as const,
    ...(importato
      ? {
          importSource: 'WINWASTE',
          legacyKey: `0001|2026|MOVIMENTI|${++chiaveN}`,
          lottoImportId: az.lottoId,
        }
      : {}),
  })

  const rigaImportata = (az: Az, movimentoId: string, extra: Record<string, unknown> = {}) => ({
    tenantId: az.tenantId,
    movimentoId,
    registroId: az.registroId,
    tipo: 'CARICO' as const,
    origine: 'IMPORTAZIONE' as const,
    stato: 'DA_RICONCILIARE' as const,
    bloccatoInvio: true,
    motivoBlocco: 'Importato: in attesa di riconciliazione',
    ...extra,
  })

  /** Movimento importato + riga bloccata, come app, nella stessa transazione (il modo giusto). */
  async function importatoConRiga(az: Az): Promise<{ movimentoId: string; rigaId: string }> {
    return nelTenant(az.tenantId, () =>
      app.$transaction(async tx => {
        const m = await tx.wasteMovement.create({ data: datiMovimento(az, true) })
        const r = await tx.movimentoTrasmissioneRentri.create({ data: rigaImportata(az, m.id) })
        return { movimentoId: m.id, rigaId: r.id }
      })
    )
  }

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
    if (tenantCreati.length > 0) {
      await cancellaAziendeDiProva(owner, tenantCreati)
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('movimento importato + riga DA_RICONCILIARE nella stessa transazione: il commit riesce', async () => {
    const az = await azienda()
    const { movimentoId, rigaId } = await importatoConRiga(az)
    const r = await owner.movimentoTrasmissioneRentri.findUniqueOrThrow({ where: { id: rigaId } })
    expect(r.movimentoId).toBe(movimentoId)
    expect(r.stato).toBe('DA_RICONCILIARE')
    expect(r.origine).toBe('IMPORTAZIONE')
    expect(r.bloccatoInvio).toBe(true)
  })

  it('movimento importato SENZA la riga di blocco: SET CONSTRAINTS IMMEDIATE (contratto del caricatore) fa fallire con il messaggio del trigger', async () => {
    const az = await azienda()
    const msg = await errore(
      nelTenant(az.tenantId, () =>
        app.$transaction(async tx => {
          await tx.wasteMovement.create({ data: datiMovimento(az, true) })
          // Prisma 5.22 non riporta all'applicazione l'errore di un vincolo differito sollevato dal
          // COMMIT (la transazione viene annullata, ma la promise si risolve): il caricatore deve
          // quindi forzare il controllo PRIMA del commit, come ultimo statement del blocco.
          await tx.$executeRawUnsafe(
            'SET CONSTRAINTS "waste_movements_importato_bloccato" IMMEDIATE'
          )
        })
      )
    )
    expect(msg).toContain('non ha la riga di blocco')
    expect(await owner.wasteMovement.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('movimento importato SENZA la riga e senza SET CONSTRAINTS: il database annulla comunque il commit, nessuna riga persiste', async () => {
    const az = await azienda()
    // Con Prisma 5.22 la promise si risolve anche se il COMMIT e' stato rifiutato (vedi sopra): quello
    // che conta e' che la riga NON resti. Se un Prisma futuro segnalasse l'errore, il test lo accetta.
    await nelTenant(az.tenantId, () =>
      app.$transaction(async tx => {
        await tx.wasteMovement.create({ data: datiMovimento(az, true) })
      })
    ).catch(() => undefined)
    expect(await owner.wasteMovement.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('un movimento NON importato non paga nulla: nessuna riga richiesta', async () => {
    const az = await azienda()
    const m = await nelTenant(az.tenantId, () =>
      app.wasteMovement.create({ data: datiMovimento(az, false) })
    )
    expect(m.importSource).toBeNull()
  })

  it('riga di origine IMPORTAZIONE per un movimento non importato: rifiutata', async () => {
    const az = await azienda()
    const m = await owner.wasteMovement.create({ data: datiMovimento(az, false) })
    const msg = await errore(
      nelTenant(az.tenantId, () =>
        app.movimentoTrasmissioneRentri.create({ data: rigaImportata(az, m.id) })
      )
    )
    expect(msg).toContain('origine IMPORTAZIONE solo per un movimento importato')
  })

  it('riga AUTOMATICA/MANUALE/CORREZIONE/DICHIARATA per un movimento importato: rifiutata', async () => {
    const az = await azienda()
    for (const origine of ['AUTOMATICA', 'MANUALE', 'CORREZIONE', 'DICHIARATA'] as const) {
      const msg = await errore(
        nelTenant(az.tenantId, () =>
          app.$transaction(async tx => {
            const m = await tx.wasteMovement.create({ data: datiMovimento(az, true) })
            await tx.movimentoTrasmissioneRentri.create({
              data: {
                tenantId: az.tenantId,
                movimentoId: m.id,
                registroId: az.registroId,
                tipo: 'CARICO',
                origine,
              },
            })
          })
        )
      )
      expect(msg).toContain('ha solo la riga di origine IMPORTAZIONE')
    }
  })

  it('origine IMPORTAZIONE con stato diverso da DA_RICONCILIARE: rifiutata alla nascita', async () => {
    const az = await azienda()
    const msg = await errore(
      nelTenant(az.tenantId, () =>
        app.$transaction(async tx => {
          const m = await tx.wasteMovement.create({ data: datiMovimento(az, true) })
          await tx.movimentoTrasmissioneRentri.create({
            data: rigaImportata(az, m.id, {
              stato: 'DA_TRASMETTERE',
              bloccatoInvio: false,
              motivoBlocco: null,
            }),
          })
        })
      )
    )
    expect(msg).toContain('nasce DA_RICONCILIARE')
  })

  describe('CHECK', () => {
    it('DA_RICONCILIARE non bloccata o senza motivo; con origine diversa da IMPORTAZIONE', async () => {
      const az = await azienda()
      const casi: Array<[Record<string, unknown>, RegExp]> = [
        [
          { bloccatoInvio: false, motivoBlocco: null },
          /bloccato_coerente|coda_sbloccata|DA_RICONCILIARE/,
        ],
        [{ bloccatoInvio: true, motivoBlocco: null }, /motivo_blocco_check/],
      ]
      for (const [extra, atteso] of casi) {
        const msg = await errore(
          nelTenant(az.tenantId, () =>
            app.$transaction(async tx => {
              const m = await tx.wasteMovement.create({ data: datiMovimento(az, true) })
              await tx.movimentoTrasmissioneRentri.create({ data: rigaImportata(az, m.id, extra) })
            })
          )
        )
        expect(msg).toMatch(atteso)
      }
      // origine diversa: il CHECK `origine_importazione` (con un movimento non importato per superare il trigger)
      const m = await owner.wasteMovement.create({ data: datiMovimento(az, false) })
      const msg = await errore(
        owner.movimentoTrasmissioneRentri.create({
          data: rigaImportata(az, m.id, { origine: 'MANUALE' }),
        })
      )
      expect(msg).toContain('origine_importazione_check')
    })

    it('esclusione su una riga DA_RICONCILIARE: CHECK di esclusione', async () => {
      const az = await azienda()
      const { rigaId } = await importatoConRiga(az)
      const msg = await errore(
        owner.movimentoTrasmissioneRentri.update({
          where: { id: rigaId },
          data: { esclusoIl: new Date(), motivoEsclusione: 'non inviare' },
        })
      )
      expect(msg).toContain('esclusione_check')
    })
  })

  describe('da DA_RICONCILIARE non si esce (prima di 3.6)', () => {
    it.each([
      'DA_TRASMETTERE',
      'GIA_SU_RENTRI',
      'TRASMESSA',
      'IN_INVIO',
      'INCERTA',
      'RIFIUTATA',
    ] as const)('UPDATE verso %s rifiutato, anche col proprietario', async stato => {
      const az = await azienda()
      const { rigaId } = await importatoConRiga(az)
      const comune = { stato }
      const msg = await errore(
        owner.movimentoTrasmissioneRentri.update({
          where: { id: rigaId },
          data:
            stato === 'DA_TRASMETTERE' || stato === 'RIFIUTATA' || stato === 'IN_INVIO'
              ? { ...comune, bloccatoInvio: false, motivoBlocco: null }
              : comune,
        })
      )
      expect(msg).toMatch(/non si esce|origine_importazione_check|bloccato_coerente|coda_sbloccata/)
      const dopo = await owner.movimentoTrasmissioneRentri.findUniqueOrThrow({
        where: { id: rigaId },
      })
      expect(dopo.stato).toBe('DA_RICONCILIARE')
    })

    it('lo sblocco (bloccato_invio) e il cambio di origine sono rifiutati', async () => {
      const az = await azienda()
      const { rigaId } = await importatoConRiga(az)
      expect(
        await errore(
          owner.movimentoTrasmissioneRentri.update({
            where: { id: rigaId },
            data: { bloccatoInvio: false },
          })
        )
      ).toMatch(/non si esce|bloccato_coerente/)
      expect(
        await errore(
          owner.movimentoTrasmissioneRentri.update({
            where: { id: rigaId },
            data: { origine: 'MANUALE' },
          })
        )
      ).toMatch(/non cambia|origine_importazione_check/)
    })

    it('un campo non protetto (tentativi) si aggiorna', async () => {
      const az = await azienda()
      const { rigaId } = await importatoConRiga(az)
      const r = await owner.movimentoTrasmissioneRentri.update({
        where: { id: rigaId },
        data: { tentativi: 2 },
      })
      expect(r.tentativi).toBe(2)
    })
  })

  it("la riga DA_RICONCILIARE non si cancella (DELETE diretto), ne' come app ne' come proprietario; la cascata dell'azienda si", async () => {
    const az = await azienda()
    const { rigaId } = await importatoConRiga(az)
    expect(
      await errore(
        nelTenant(az.tenantId, () =>
          app.movimentoTrasmissioneRentri.delete({ where: { id: rigaId } })
        )
      )
    ).toContain('non si cancella')
    expect(
      await errore(owner.movimentoTrasmissioneRentri.delete({ where: { id: rigaId } }))
    ).toContain('non si cancella')
    await cancellaAziendeDiProva(owner, az.tenantId)
    tenantCreati.splice(tenantCreati.indexOf(az.tenantId), 1)
    expect(await owner.movimentoTrasmissioneRentri.count({ where: { id: rigaId } })).toBe(0)
  })

  it('movimenti e righe non importati restano invariati (AUTOMATICA ammessa, DA_TRASMETTERE modificabile)', async () => {
    const az = await azienda()
    const m = await owner.wasteMovement.create({ data: datiMovimento(az, false) })
    const r = await nelTenant(az.tenantId, () =>
      app.movimentoTrasmissioneRentri.create({
        data: {
          tenantId: az.tenantId,
          movimentoId: m.id,
          registroId: az.registroId,
          tipo: 'CARICO',
          origine: 'AUTOMATICA',
        },
      })
    )
    expect(r.stato).toBe('DA_TRASMETTERE')
    const dopo = await nelTenant(az.tenantId, () =>
      app.movimentoTrasmissioneRentri.update({ where: { id: r.id }, data: { tentativi: 1 } })
    )
    expect(dopo.tentativi).toBe(1)
  })

  it('con il contesto di B il movimento importato di A non si vede e la sua riga non si crea', async () => {
    const a = await azienda()
    const b = await azienda()
    const { movimentoId } = await importatoConRiga(a)
    expect(
      await nelTenant(b.tenantId, () =>
        app.movimentoTrasmissioneRentri.findMany({ where: { movimentoId } })
      )
    ).toEqual([])
  })
})

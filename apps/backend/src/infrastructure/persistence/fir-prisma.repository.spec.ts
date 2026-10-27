/**
 * FIRPrismaRepository — persistenza delle firme del ciclo di vita
 *
 * Prima di questa modifica `_firme` veniva ricostruito sempre vuoto in
 * `toDomain` ("Would come from signatures relation"): le firme esistevano solo
 * in memoria nell'aggregate e sparivano al primo reload. Questi test
 * verificano il ciclo completo salva -> rileggi -> ritrova sulla tabella
 * `fir_signatures`, con un doppio di Prisma (nessun DB reale: la prova contro
 * Postgres vero è nel test di integrazione dedicato).
 */
import { FIRPrismaRepository } from './fir-prisma.repository'
import { FIR, FirmaDigitale } from '../../domain/fir/aggregates/fir.aggregate'
import {
  FirAnnullatoNelFrattempoError,
  FirModificatoNelFrattempoError,
  FirmaSenzaUtenteError,
  FirNonPiuInBozzaError,
} from '../../core/domain/errors'

function buildFirRecord(overrides: Partial<any> = {}) {
  return {
    id: 'fir-1',
    versione: 1,
    status: 'AWAITING_CARRIER',
    firNumber: 'FIR-2026-000001',
    tenantId: 'tenant-1',
    producerUserId: 'user-produttore',
    producerId: 'reg-produttore',
    producerPartitaIva: '12345678901',
    producerName: 'Produttore SRL',
    producerAddress: 'Via Test 1',
    producerContact: null,
    carrierId: null,
    carrierUserId: null,
    carrierPartitaIva: null,
    carrierName: null,
    carrierVehiclePlate: null,
    carrierContact: null,
    receiverId: null,
    receiverUserId: null,
    receiverPartitaIva: null,
    receiverName: null,
    receiverAddress: null,
    receiverContact: null,
    cerCode: '150101',
    quantity: 100,
    unit: 'KG',
    wastePhysicalState: null,
    wasteHazardClasses: null,
    wastePackageCount: null,
    wasteDescription: null,
    wasteCategory: null,
    wasteOperationType: null,
    wasteOperationCode: null,
    wasteNotes: null,
    transportDate: null,
    actualArrivalDate: null,
    effectiveWeight: null,
    fourthCopyReturnedAt: null,
    fourthCopyNotes: null,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    transportersAggiuntivi: [],
    signatures: [],
    // Legame RENTRI: default "mai sincronizzato", coerente col default Prisma.
    rentriSyncStatus: 'PENDING',
    rentriSyncedAt: null,
    rentriSyncAttempts: 0,
    rentriLastSyncError: null,
    rentriNextRetryAt: null,
    rentriNumeroFir: null,
    rentriTransazioneId: null,
    rentriOrigineLegame: null,
    ...overrides,
  }
}

describe('FIRPrismaRepository — persistenza firme lifecycle (fir_signatures)', () => {
  let prisma: any
  let sistema: any
  let repo: FIRPrismaRepository

  beforeEach(() => {
    prisma = {
      db: {
        fIR: {
          findFirst: jest.fn(),
        },
      },
      fIR: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
      fIRSignature: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    }
    sistema = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }]) },
    }
    repo = new FIRPrismaRepository(prisma, sistema)
  })

  describe('trasmissioni RENTRI sospese (job su tutte le aziende)', () => {
    it('elencaTrasmissioniRentriSospese: elenco delle aziende dal client di sistema', async () => {
      sistema.$queryRaw.mockResolvedValue([{ fir_id: 'f1', tenant_id: 't1' }])

      const elenco = await repo.elencaTrasmissioniRentriSospese(new Date(), 100, new Date())

      expect(elenco).toEqual([{ firId: 'f1', tenantId: 't1' }])
      expect(sistema.$queryRaw).toHaveBeenCalledTimes(1)
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })
  })

  describe('lettura (findById) — deve includere le firme persistite', () => {
    it('include la relazione signatures nella query', async () => {
      prisma.db.fIR.findFirst.mockResolvedValue(buildFirRecord())

      await repo.findById('fir-1')

      expect(prisma.db.fIR.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            signatures: expect.anything(),
          }),
        })
      )
    })

    it('ricostruisce la firma del produttore da una riga fir_signatures persistita', async () => {
      const signedAt = new Date('2026-07-01T12:00:00Z')
      prisma.db.fIR.findFirst.mockResolvedValue(
        buildFirRecord({
          signatures: [
            {
              id: 'sig-1',
              firId: 'fir-1',
              userId: 'user-produttore',
              role: 'PRODUTTORE',
              signedAt,
              signatureMethod: 'APPLICATIVA-NON-QUALIFICATA',
              signatureValue: 'certificato-produttore',
              certificateHash: 'a'.repeat(64),
              documentHash: 'b'.repeat(64),
              timestampToken: null,
              signerFiscalCode: null,
              signerName: 'Mario Rossi',
              publicKey: null,
            },
          ],
        })
      )

      const fir = await repo.findById('fir-1')

      expect(fir).not.toBeNull()
      expect(fir!.firme.produttore).toBeDefined()
      expect(fir!.firme.produttore).toMatchObject({
        firmatario: 'Mario Rossi',
        certificato: 'certificato-produttore',
        userId: 'user-produttore',
      })
      expect(fir!.firme.produttore!.timestamp).toEqual(signedAt)
      // Nessun'altra firma presente in questo FIR.
      expect(fir!.firme.trasportatore).toBeUndefined()
      expect(fir!.firme.destinatario).toBeUndefined()
    })

    it('ignora righe di firme crittografiche (ruoli PRODUCER/CARRIER/RECEIVER del sottosistema QES)', async () => {
      prisma.db.fIR.findFirst.mockResolvedValue(
        buildFirRecord({
          signatures: [
            {
              id: 'sig-qes-1',
              firId: 'fir-1',
              userId: 'user-produttore',
              role: 'PRODUCER',
              signedAt: new Date(),
              signatureMethod: 'ECDSA-SHA256',
              signatureValue: 'firma-crittografica-reale',
              certificateHash: 'c'.repeat(64),
              documentHash: 'd'.repeat(64),
              timestampToken: null,
              signerFiscalCode: 'RSSMRA80A01H501U',
              signerName: 'Mario Rossi',
              publicKey: '-----BEGIN PUBLIC KEY-----',
            },
          ],
        })
      )

      const fir = await repo.findById('fir-1')

      expect(fir!.firme.produttore).toBeUndefined()
    })
  })

  describe('legame RENTRI — salva, rileggi, ritrova (stesso tranello delle firme)', () => {
    it('ricostruisce tutti i campi rentri* da un FIR già agganciato', async () => {
      prisma.db.fIR.findFirst.mockResolvedValue(
        buildFirRecord({
          rentriSyncStatus: 'SYNCED',
          rentriSyncedAt: new Date('2026-07-26T09:00:00Z'),
          rentriSyncAttempts: 1,
          rentriLastSyncError: null,
          rentriNextRetryAt: null,
          rentriNumeroFir: 'RENTRI-000123',
          rentriTransazioneId: 'tx-abc-999',
          rentriOrigineLegame: 'TRASMESSO_DA_NOI',
        })
      )

      const fir = await repo.findById('fir-1')

      expect(fir).not.toBeNull()
      expect(fir!.rentriNumeroFir).toBe('RENTRI-000123')
      expect(fir!.rentriTransazioneId).toBe('tx-abc-999')
      expect(fir!.rentriOrigineLegame).toBe('TRASMESSO_DA_NOI')
      expect(fir!.rentriSyncStatus.getStatus()).toBe('SYNCED')
      expect(fir!.rentriSyncStatus.getAttempts()).toBe(1)
    })

    it('ricostruisce un fallimento con tentativi ed errore', async () => {
      prisma.db.fIR.findFirst.mockResolvedValue(
        buildFirRecord({
          rentriSyncStatus: 'FAILED',
          rentriSyncAttempts: 2,
          rentriLastSyncError: 'RENTRI ha risposto 500',
        })
      )

      const fir = await repo.findById('fir-1')

      expect(fir!.rentriSyncStatus.getStatus()).toBe('FAILED')
      expect(fir!.rentriSyncStatus.getAttempts()).toBe(2)
      expect(fir!.rentriSyncStatus.getLastError()).toBe('RENTRI ha risposto 500')
      expect(fir!.rentriNumeroFir).toBeNull()
    })

    it('save scrive tutti i campi rentri* sulla riga firs (scrittura, non solo lettura)', async () => {
      const fir = FIR.create({
        produttoreId: 'reg-produttore',
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: 'reg-trasportatore',
        destinatarioId: 'reg-destinatario',
        tenantId: 'tenant-1',
        creatoDaUserId: 'user-produttore',
      })
      const firma: FirmaDigitale = {
        firmatario: 'Mario Rossi',
        timestamp: new Date('2026-07-01T12:00:00Z'),
        certificato: 'certificato-produttore',
        userId: 'user-produttore',
      }
      fir.emetti('FIR-2026-000001', firma)
      fir.markRENTRISynced('RENTRI-000123', 'tx-abc-999')

      await repo.save(fir)

      const [{ update }] = prisma.fIR.upsert.mock.calls[0]
      expect(update).toMatchObject({
        rentriNumeroFir: 'RENTRI-000123',
        rentriTransazioneId: 'tx-abc-999',
        rentriOrigineLegame: 'TRASMESSO_DA_NOI',
        rentriSyncAttempts: 0,
      })
      expect(update.rentriSyncStatus).toBe('SYNCED')
      expect(update.rentriSyncedAt).toBeInstanceOf(Date)
    })

    /**
     * Difetto R1: `rentriNextRetryAt` veniva calcolato da `fir.needsRENTRIRetry()`
     * senza guardare il codice errore — un 403 (RENTRI_FORBIDDEN) con tentativi
     * ancora disponibili veniva comunque pianificato per un nuovo giro,
     * pronto a essere ripreso da un futuro scheduler/job che scansiona
     * `rentriNextRetryAt <= now`. Deve restare `null`: nessun nuovo tentativo
     * pianificato per un errore non ritentabile.
     */
    it('save NON pianifica un nuovo tentativo (rentriNextRetryAt null) dopo un fallimento non ritentabile (403)', async () => {
      const fir = FIR.create({
        produttoreId: 'reg-produttore',
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: 'reg-trasportatore',
        destinatarioId: 'reg-destinatario',
        tenantId: 'tenant-1',
        creatoDaUserId: 'user-produttore',
      })
      const firma: FirmaDigitale = {
        firmatario: 'Mario Rossi',
        timestamp: new Date('2026-07-01T12:00:00Z'),
        certificato: 'certificato-produttore',
        userId: 'user-produttore',
      }
      fir.emetti('FIR-2026-000001', firma)
      fir.avviaTentativoRentri(new Date())
      fir.markRENTRISyncFailed('Certificato non valido', 'RENTRI_FORBIDDEN')

      await repo.save(fir)

      const [{ update }] = prisma.fIR.upsert.mock.calls[0]
      expect(update.rentriSyncStatus).toBe('PERMANENTLY_FAILED')
      expect(update.rentriSyncAttempts).toBe(1)
      expect(update.rentriNextRetryAt).toBeNull()
    })
  })

  describe('scrittura (save) — deve persistere le firme nuove nella tabella fir_signatures', () => {
    function buildFirWithFirmaProduttore(): FIR {
      const fir = FIR.create({
        produttoreId: 'reg-produttore',
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: 'reg-trasportatore',
        destinatarioId: 'reg-destinatario',
        tenantId: 'tenant-1',
        creatoDaUserId: 'user-produttore',
      })

      const firma: FirmaDigitale = {
        firmatario: 'Mario Rossi',
        timestamp: new Date('2026-07-01T12:00:00Z'),
        certificato: 'certificato-produttore',
        userId: 'user-produttore',
      }
      fir.emetti('FIR-2026-000001', firma)
      return fir
    }

    it('crea una riga fir_signatures per la firma del produttore con tutti i campi obbligatori', async () => {
      const fir = buildFirWithFirmaProduttore()

      await repo.save(fir)

      expect(prisma.fIRSignature.create).toHaveBeenCalledTimes(1)
      const [{ data }] = prisma.fIRSignature.create.mock.calls[0]
      expect(data).toMatchObject({
        firId: fir.id,
        tenantId: fir.tenantId,
        userId: 'user-produttore',
        role: 'PRODUTTORE',
        signedAt: new Date('2026-07-01T12:00:00Z'),
        signatureValue: 'certificato-produttore',
        signerName: 'Mario Rossi',
      })
      // Campi obbligatori non-null dello schema Prisma devono essere valorizzati.
      expect(data.signatureMethod).toEqual(expect.any(String))
      expect(data.certificateHash).toMatch(/^[a-f0-9]{64}$/)
      expect(data.documentHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('è idempotente: non ricrea la firma se già persistita per quel firId+ruolo', async () => {
      prisma.fIRSignature.findFirst.mockResolvedValue({ id: 'existing-sig' })
      const fir = buildFirWithFirmaProduttore()

      await repo.save(fir)

      expect(prisma.fIRSignature.create).not.toHaveBeenCalled()
    })

    it('rifiuta il salvataggio di una firma priva di userId, senza scrivere nulla', async () => {
      const fir = buildFirWithFirmaProduttore()
      // Simula un aggregate costruito senza userId (es. da un test di dominio).
      ;(fir.firme.produttore as any).userId = undefined

      await expect(repo.save(fir)).rejects.toThrow(FirmaSenzaUtenteError)

      expect(prisma.fIR.upsert).not.toHaveBeenCalled()
      expect(prisma.fIRSignature.create).not.toHaveBeenCalled()
    })

    it('save esegue upsert e firme nella stessa transaction', async () => {
      await repo.save(buildFirWithFirmaProduttore())

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })
  })

  describe('emettiConNumerazione — controllo della bozza sullo stato grezzo', () => {
    function bozza(): FIR {
      return FIR.create({
        produttoreId: 'reg-produttore',
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: 'reg-trasportatore',
        destinatarioId: 'reg-destinatario',
        tenantId: 'tenant-1',
        creatoDaUserId: 'user-produttore',
      })
    }

    beforeEach(() => {
      prisma.$executeRaw = jest.fn().mockResolvedValue(1)
      prisma.$transaction = jest.fn(async (fn: any) => fn(prisma))
    })

    it('uno stato sconosciuto non vale come bozza: emissione rifiutata', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ status: 'STATO_INATTESO' }])
      const applica = jest.fn()

      await expect(repo.emettiConNumerazione(bozza(), 2026, applica)).rejects.toThrow(
        FirNonPiuInBozzaError
      )
      expect(applica).not.toHaveBeenCalled()
      expect(prisma.fIR.upsert).not.toHaveBeenCalled()
    })

    it.each(['DRAFT', 'AWAITING_PRODUCER'])('lo stato %s è una bozza emettibile', async status => {
      prisma.$queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ status }])
        .mockResolvedValueOnce([{ max_num: 4 }])
        .mockResolvedValue([])
      const fir = bozza()

      const numero = await repo.emettiConNumerazione(fir, 2026, n =>
        fir.emetti(n, {
          firmatario: 'Mario Rossi',
          timestamp: new Date(),
          certificato: 'x',
          userId: 'user-produttore',
        })
      )

      expect(numero).toBe('FIR-2026-000005')
    })
  })

  describe('FIR annullato in locale mentre era in corso un salvataggio', () => {
    it("il controllo su CANCELLED vale anche quando l'aggregate porta già 'Annullato' dell'ente", async () => {
      // Copia vecchia: l'ente risulta già 'Annullato', ma lo stato interno è
      // ancora EMESSO. La riga nel frattempo è stata annullata in locale.
      prisma.db.fIR.findFirst.mockResolvedValue(
        buildFirRecord({
          status: 'AWAITING_CARRIER',
          rentriNumeroFir: 'RENTRI-ANN-1',
          rentriStatoFormulario: 'Annullato',
        })
      )
      const copiaVecchia = (await repo.findById('fir-1'))!
      prisma.$queryRaw = jest
        .fn()
        .mockResolvedValue([{ stato: 'Annullato', status: 'CANCELLED', versione: 1 }])

      await expect(repo.save(copiaVecchia)).rejects.toBeInstanceOf(FirAnnullatoNelFrattempoError)
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
      expect(prisma.fIR.upsert).not.toHaveBeenCalled()
    })

    it('il blocco della riga resta nel tenant del FIR e non serializza le scritture del registro', async () => {
      prisma.db.fIR.findFirst.mockResolvedValue(buildFirRecord({ status: 'AWAITING_CARRIER' }))
      const fir = (await repo.findById('fir-1'))!
      prisma.$queryRaw = jest
        .fn()
        .mockResolvedValue([{ stato: null, status: 'AWAITING_CARRIER', versione: 1 }])

      await repo.save(fir)

      const [frammenti, ...valori] = prisma.$queryRaw.mock.calls[0]
      const sql = (frammenti as string[]).join('?').replace(/\s+/g, ' ')
      // FOR NO KEY UPDATE: protegge la riga come FOR UPDATE ma non entra in conflitto con il
      // FOR KEY SHARE che l'insert di un movimento prende sul FIR collegato (fir_id).
      expect(sql).toContain('FOR NO KEY UPDATE')
      expect(sql).toContain('tenant_id = ?::uuid')
      expect(valori).toContain('tenant-1')
      expect(sql).toContain('versione AS versione')
    })
  })

  describe('versione (lock ottimistico)', () => {
    async function firLetto() {
      prisma.db.fIR.findFirst.mockResolvedValue(
        buildFirRecord({ status: 'AWAITING_CARRIER', versione: 4 })
      )
      return (await repo.findById('fir-1'))!
    }

    it('toDomain riporta la versione della riga', async () => {
      expect((await firLetto()).versione).toBe(4)
    })

    it('con verificaVersione e versione uguale scrive versione + 1 e allinea la versione', async () => {
      const fir = await firLetto()
      prisma.$queryRaw = jest
        .fn()
        .mockResolvedValue([{ stato: null, status: 'AWAITING_CARRIER', versione: 4 }])

      await repo.save(fir, { verificaVersione: true })

      const arg = prisma.fIR.upsert.mock.calls[0][0]
      expect(arg.update.versione).toBe(5)
      expect(arg.create.versione).toBe(5)
      expect(fir.versione).toBe(5)
    })

    it('con verificaVersione e versione diversa rifiuta prima di scrivere', async () => {
      const fir = await firLetto()
      prisma.$queryRaw = jest
        .fn()
        .mockResolvedValue([{ stato: null, status: 'AWAITING_CARRIER', versione: 5 }])

      await expect(repo.save(fir, { verificaVersione: true })).rejects.toBeInstanceOf(
        FirModificatoNelFrattempoError
      )
      expect(prisma.fIR.upsert).not.toHaveBeenCalled()
      expect(fir.versione).toBe(4)
    })

    it('senza verificaVersione scrive comunque, sopra la versione del database', async () => {
      const fir = await firLetto()
      prisma.$queryRaw = jest
        .fn()
        .mockResolvedValue([{ stato: null, status: 'AWAITING_CARRIER', versione: 7 }])

      await repo.save(fir)

      expect(prisma.fIR.upsert.mock.calls[0][0].update.versione).toBe(8)
      expect(fir.versione).toBe(8)
    })

    it('riga assente (primo salvataggio): versione 1', async () => {
      const fir = FIR.create({
        produttoreId: 'reg-produttore',
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: 'reg-trasportatore',
        destinatarioId: 'reg-destinatario',
        tenantId: 'tenant-1',
        creatoDaUserId: 'user-produttore',
      })
      prisma.$queryRaw = jest.fn().mockResolvedValue([])

      await repo.save(fir)

      expect(prisma.fIR.upsert.mock.calls[0][0].create.versione).toBe(1)
      expect(fir.versione).toBe(1)
    })
  })
})

describe('FIRPrismaRepository.findByIdPublic', () => {
  it('verifica pubblica FIR: lettura dal client di sistema', async () => {
    const prisma: any = {
      fIR: {
        findUnique: jest.fn(() => {
          throw new Error('client applicativo: lettura pubblica non ammessa')
        }),
      },
    }
    const sistema: any = { fIR: { findUnique: jest.fn().mockResolvedValue(null) } }
    const repo = new FIRPrismaRepository(prisma, sistema)

    expect(await repo.findByIdPublic('fir-1')).toBeNull()
    expect(sistema.fIR.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fir-1' } })
    )
    expect(prisma.fIR.findUnique).not.toHaveBeenCalled()
  })
})

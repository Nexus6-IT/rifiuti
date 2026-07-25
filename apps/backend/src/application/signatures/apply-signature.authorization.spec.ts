/**
 * Autorizzazione di ruolo-parte sulla firma FIR.
 *
 * Regola: ogni ruolo (PRODUCER/CARRIER/RECEIVER) può essere firmato SOLO dalla
 * parte designata su quel FIR. Senza il controllo, qualsiasi operatore del
 * tenant poteva apporre tutte e tre le firme, annullando la separazione dei
 * ruoli che è la ragione d'essere del formulario (DM 59/2023 art. 6-7).
 */

import { ApplySignatureUseCase } from './apply-signature.use-case'
import { DomainException } from '../../domain/shared/domain-exception'
import { FIRPartyResolver } from '../../infrastructure/signatures/fir-party.resolver'

const TENANT = 'tenant-1'
const FIR_ID = '11111111-1111-4111-8111-111111111111'
const PRODUTTORE = 'user-produttore'
const TRASPORTATORE = 'user-trasportatore'

/** FIR aggregate minimale: al test interessa solo arrivare al controllo di ruolo. */
function fakeFir() {
  return {
    getTenantId: () => TENANT,
    getId: () => FIR_ID,
    getStatus: () => 'DRAFT',
    getFirNumber: () => 'FIR-2026-0001',
    toSignableDocument: () => ({ id: FIR_ID }),
    applySignature: jest.fn(),
    getDomainEvents: () => [],
    clearDomainEvents: jest.fn(),
    isImmutable: () => false,
  }
}

function buildUseCase(parties: any) {
  const firRepository = {
    findById: jest.fn().mockResolvedValue(fakeFir()),
    save: jest.fn().mockImplementation(async (f: any) => f),
  }
  const signatureService = {
    createSignature: jest.fn().mockResolvedValue({
      signatureValue: 'c2ln',
      signatureMethod: 'ECDSA-SHA256',
      certificateHash: 'a'.repeat(64),
      documentHash: 'b'.repeat(64),
      publicKey: '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----',
      timestampToken: undefined,
      isQualified: false,
      providerType: 'sandbox',
    }),
  }
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  const eventEmitter = { emit: jest.fn() }
  const partyResolver = { findParties: jest.fn().mockResolvedValue(parties) }

  const useCase = new ApplySignatureUseCase(
    firRepository as any,
    signatureService as any,
    logger as any,
    eventEmitter as any,
    partyResolver as any
  )
  return { useCase, signatureService, firRepository }
}

const baseParams = {
  firId: FIR_ID,
  tenantId: TENANT,
  role: 'PRODUCER' as const,
  signerFiscalCode: 'MNZGZN78A01F839X',
  signerName: 'Graziano Manzo',
  spidLevel: 2,
  authenticatedAt: new Date(),
}

describe('ApplySignatureUseCase — autorizzazione di ruolo-parte', () => {
  const parties = {
    tenantId: TENANT,
    producerUserId: PRODUTTORE,
    carrierUserId: TRASPORTATORE,
    receiverUserId: null,
  }

  it('rifiuta la firma di un utente non designato per quel ruolo', async () => {
    const { useCase, signatureService } = buildUseCase(parties)

    await expect(
      useCase.execute({ ...baseParams, userId: TRASPORTATORE, role: 'PRODUCER' })
    ).rejects.toThrow(DomainException)

    // Nessuna firma deve essere generata: il rifiuto precede la crittografia.
    expect(signatureService.createSignature).not.toHaveBeenCalled()
  })

  it('impedisce a un singolo utente di firmare tutti i ruoli', async () => {
    const { useCase } = buildUseCase(parties)

    // Il produttore firma legittimamente il proprio ruolo...
    await expect(
      useCase.execute({ ...baseParams, userId: PRODUTTORE, role: 'PRODUCER' })
    ).resolves.toMatchObject({ success: true })

    // ...ma non può firmare come trasportatore.
    await expect(
      useCase.execute({ ...baseParams, userId: PRODUTTORE, role: 'CARRIER' })
    ).rejects.toThrow(/SIGNER_NOT_AUTHORIZED_FOR_ROLE/)
  })

  it('rifiuta la firma di un ruolo non ancora assegnato', async () => {
    const { useCase } = buildUseCase(parties)

    // receiverUserId è null: non c'è una parte designata da autorizzare.
    await expect(
      useCase.execute({ ...baseParams, userId: PRODUTTORE, role: 'RECEIVER' })
    ).rejects.toThrow(/ROLE_NOT_ASSIGNED/)
  })

  it('consente la firma alla parte designata', async () => {
    const { useCase, signatureService } = buildUseCase(parties)

    const result = await useCase.execute({
      ...baseParams,
      userId: TRASPORTATORE,
      role: 'CARRIER',
    })

    expect(result.success).toBe(true)
    expect(signatureService.createSignature).toHaveBeenCalled()
  })

  it('risponde NOT_FOUND se il FIR non ha parti risolvibili', async () => {
    const { useCase } = buildUseCase(null)

    await expect(useCase.execute({ ...baseParams, userId: PRODUTTORE })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('FIRPartyResolver.expectedUserIdFor', () => {
  const parties = {
    tenantId: TENANT,
    producerUserId: PRODUTTORE,
    carrierUserId: TRASPORTATORE,
    receiverUserId: null,
  }

  it('mappa ogni ruolo alla propria parte', () => {
    expect(FIRPartyResolver.expectedUserIdFor(parties, 'PRODUCER')).toBe(PRODUTTORE)
    expect(FIRPartyResolver.expectedUserIdFor(parties, 'CARRIER')).toBe(TRASPORTATORE)
    expect(FIRPartyResolver.expectedUserIdFor(parties, 'RECEIVER')).toBeNull()
  })
})

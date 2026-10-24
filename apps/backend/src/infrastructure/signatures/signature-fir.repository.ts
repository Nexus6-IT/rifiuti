/**
 * SignatureFIRRepository
 *
 * Repository FIR dedicato alle operazioni firma (WS-E).
 * Implementa l'interfaccia FIRRepository (old aggregate) fornendo accesso
 * ai dati FIR e alle firme crittografiche persistite in fir_signatures.
 *
 * Separato da FIRPrismaRepository (che usa il nuovo aggregate per il lifecycle)
 * perché il workflow firma usa un aggregate FIR semplificato con metodi
 * applySignature/getSignatures — non presente nel nuovo aggregate del lifecycle.
 *
 * SICUREZZA: usa `prisma.db` (RLS-aware) per findById (tenant-scoped);
 * il client di sistema per findByIdPublic (verifica pubblica QR code, tenant ignoto).
 */

import { Injectable } from '@nestjs/common'
import { FIR } from '../../domain/fir/fir.aggregate'
import { FIRRepository } from '../../domain/fir/fir.repository'
import {
  DigitalSignature,
  SignatureRole,
  SignatureMethod,
} from '../../domain/fir/digital-signature.vo'
import { PrismaService } from '../persistence/prisma.service'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'

// Include per le query firma: signatures + user (per fiscal code legacy)
const SIGNATURE_INCLUDE = {
  signatures: {
    include: { user: true },
    orderBy: { signedAt: 'asc' } as const,
  },
} as const

@Injectable()
export class SignatureFIRRepository implements FIRRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sistema: PrismaSistemaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(SignatureFIRRepository.name)
  }

  /**
   * Carica FIR con firme crittografiche (RLS-aware, scoped per tenant).
   */
  async findById(id: string): Promise<FIR | null> {
    const record = await this.prisma.db.fIR.findFirst({
      where: { id },
      include: SIGNATURE_INCLUDE,
    })
    if (!record) return null
    return this.toDomain(record as any)
  }

  /**
   * Carica FIR con firme senza filtro tenant (verifica pubblica firma via QR code).
   * Sistema: rotta pubblica senza contesto, l'azienda del FIR si conosce solo dopo la lettura
   * (l'id del FIR e' la capability: si restituisce solo cio' che l'endpoint gia' espone).
   */
  async findByIdPublic(id: string): Promise<FIR | null> {
    const record = await this.sistema.fIR.findUnique({
      where: { id },
      include: SIGNATURE_INCLUDE,
    })
    if (!record) return null
    return this.toDomain(record as any)
  }

  /**
   * Persiste la nuova firma crittografica sul FIR.
   *
   * Salva SOLO l'ultima firma aggiunta (il chiamante ha già applicato la firma
   * all'aggregate tramite applySignature; qui si scrive solo il delta persistito).
   * Se la firma per quel ruolo esiste già, è un no-op (idempotente).
   *
   * SICUREZZA: la chiave privata non transita per questo metodo (è già stata
   * usata e scartata dal provider prima di chiamare save).
   */
  async save(fir: FIR): Promise<FIR> {
    const signatures = fir.getSignatures()
    if (signatures.length === 0) return fir

    const lastSignature = signatures[signatures.length - 1]
    const firId = fir.getId()
    const tenantId = fir.getTenantId()
    const role = lastSignature.getRole()

    // Idempotenza: evita duplicati se save() viene chiamata più volte
    const existing = await this.prisma.fIRSignature.findFirst({ where: { firId, role } })
    if (existing) {
      this.logger.debug(`Firma ${role} per FIR ${firId} già persistita — skip`)
      return fir
    }

    // Recupera userId dal codice fiscale del firmatario nel tenant corrente
    const signerFiscalCode = lastSignature.getSignerFiscalCode()
    const user = await this.prisma.user.findFirst({
      where: { fiscalCode: signerFiscalCode.toUpperCase(), tenantId },
    })

    if (!user) {
      // NON si può proseguire silenziosamente: il chiamante risponderebbe
      // `success: true` all'utente mentre in `fir_signatures` non resta nulla,
      // cioè una firma creduta apposta e in realtà inesistente. Meglio un
      // errore esplicito che una prova documentale fantasma.
      this.logger.error(
        `Utente CF=${signerFiscalCode} non trovato nel tenant ${tenantId}: ` +
          `firma ${role} per FIR ${firId} NON persistibile in fir_signatures. ` +
          "Assicurarsi che l'utente sia sincronizzato localmente (provisioning Keycloak)."
      )
      throw DomainException.businessRuleViolation(
        'SIGNER_NOT_PROVISIONED',
        `Firmatario con codice fiscale ${signerFiscalCode} non presente nel tenant: ` +
          'la firma non può essere registrata. Sincronizzare l’utente e riprovare.'
      )
    }

    const sigData = lastSignature.toPlainObject()

    await this.prisma.fIRSignature.create({
      data: {
        firId,
        userId: user.id,
        role,
        signedAt: sigData.signedAt,
        signatureMethod: sigData.signatureMethod,
        signatureValue: sigData.signatureValue,
        certificateHash: sigData.certificateHash,
        documentHash: sigData.documentHash,
        timestampToken: sigData.timestampToken ?? null,
        // Campi aggiuntivi (migrazione 20260629200000): firma auto-descrittiva
        signerFiscalCode: sigData.signerFiscalCode,
        signerName: sigData.signerName,
        publicKey: sigData.publicKey,
      },
    })

    this.logger.info(
      `Firma ${role} (${sigData.signatureMethod}) persistita per FIR ${firId} — ` +
        `firmatario=${signerFiscalCode}`
    )

    return fir
  }

  // ===== Metodi richiesti dall'interfaccia ma non usati nel contesto firma =====

  async findByNumeroProgressivo(_numero: string, _tenantId: string): Promise<FIR | null> {
    return null
  }

  async update(fir: FIR): Promise<FIR> {
    return this.save(fir)
  }

  async delete(_id: string): Promise<void> {
    // no-op per il contesto firma
  }

  async getCurrentWorkloadByDriver(_driverId: string, _tenantId: string): Promise<number> {
    return 0
  }

  // ===== Ricostruzione domain aggregate =====

  private toDomain(record: any): FIR {
    const domainSignatures: DigitalSignature[] = []

    for (const sig of record.signatures ?? []) {
      try {
        domainSignatures.push(
          DigitalSignature.reconstitute({
            signerFiscalCode: sig.signerFiscalCode ?? sig.user?.fiscalCode ?? 'ZZZZZZZ00A00A000A',
            signerName:
              sig.signerName ??
              (sig.user ? `${sig.user.firstName} ${sig.user.lastName}` : 'Sconosciuto'),
            role: sig.role as SignatureRole,
            signatureValue: sig.signatureValue,
            signatureMethod: (sig.signatureMethod ?? 'ECDSA-SHA256') as SignatureMethod,
            certificateHash: sig.certificateHash,
            documentHash: sig.documentHash,
            publicKey: sig.publicKey ?? '',
            timestampToken: sig.timestampToken ?? undefined,
            signedAt: sig.signedAt,
          })
        )
      } catch (err: any) {
        this.logger.warn(`Firma ${sig.id} non ricostruibile (dati legacy?): ${err.message}`)
      }
    }

    return FIR.reconstitute(
      {
        id: record.id,
        firNumber: record.firNumber ?? '',
        tenantId: record.tenantId,

        producerPartitaIva: record.producerPartitaIva,
        producerName: record.producerName ?? null,
        producerAddress: record.producerAddress ?? null,
        producerContact: record.producerContact ?? null,

        carrierPartitaIva: record.carrierPartitaIva ?? null,
        carrierName: record.carrierName ?? null,
        carrierVehiclePlate: record.carrierVehiclePlate ?? null,
        carrierContact: record.carrierContact ?? null,

        receiverPartitaIva: record.receiverPartitaIva ?? null,
        receiverName: record.receiverName ?? null,
        receiverAddress: record.receiverAddress ?? null,
        receiverContact: record.receiverContact ?? null,

        cerCode: record.cerCode,
        wasteDescription: record.wasteDescription ?? null,
        wasteCategory: record.wasteCategory ?? null,
        quantity:
          typeof record.quantity === 'object' ? record.quantity.toNumber() : record.quantity,
        unit: record.unit ?? 'KG',
        wasteOperationType: record.wasteOperationType ?? null,
        wastePhysicalState: record.wastePhysicalState ?? null,
        wasteHazardClasses: record.wasteHazardClasses ?? null,
        wastePackageCount: record.wastePackageCount ?? null,
        wasteOperationCode: record.wasteOperationCode ?? null,
        wasteNotes: record.wasteNotes ?? null,

        transportDate: record.transportDate ?? null,
        estimatedArrivalDate: record.estimatedArrivalDate ?? null,
        transportNotes: record.transportNotes ?? null,

        // Non persistito (nessuna colonna dedicata finché esiste una sola
        // versione dello schema): tutti i FIR ricostituiti da DB usano la
        // versione corrente. Se in futuro il documento canonico cambia forma,
        // occorrerà una colonna `document_schema_version` per far sì che i
        // FIR creati sotto lo schema precedente continuino a rigenerare quella
        // stessa forma (vedi commento su FIR.toSignableDocument).
        schemaVersion: FIR.CURRENT_SCHEMA_VERSION,
      },
      domainSignatures
    )
  }
}

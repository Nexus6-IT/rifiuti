/**
 * FIR Prisma Repository - Infrastructure Layer
 * Implementazione concreta del repository FIR con Prisma ORM
 */

import { Injectable } from '@nestjs/common'
import { FIRStatus as PrismaFIRStatus } from '@prisma/client'
import { FIR, FIRStato } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository, FIRSearchFilters } from '../../domain/fir/repositories/fir-repository.interface'
import { Quantita, UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { PrismaService } from './prisma.service'

@Injectable()
export class FIRPrismaRepository implements IFIRRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Carica sempre i trasportatori aggiuntivi (tratte intermodali) ordinati, così
  // che lo snapshot del FIR sia completo ovunque venga ricostruito l'aggregate.
  // Cast ad any: la relazione è disponibile dopo `prisma generate` sullo schema
  // aggiornato (modello FIRTransporter).
  private static readonly FIR_INCLUDE: any = {
    transportersAggiuntivi: { orderBy: { ordine: 'asc' } },
  }

  async findById(id: string): Promise<FIR | null> {
    // Usa il client RLS-aware: con TenantContext attivo l'estensione inietta il
    // `tenantId` reale (findFirst), evitando di restituire FIR di altri tenant
    // tramite un id noto. Senza contesto (job di sistema) è un no-op = by-id.
    const record = await this.prisma.db.fIR.findFirst({
      where: { id },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    if (!record) return null

    return this.toDomain(record)
  }

  async findByIdPublic(id: string): Promise<FIR | null> {
    // Public access without tenant filter - used for signature verification
    const record = await this.prisma.fIR.findUnique({
      where: { id },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    if (!record) return null

    return this.toDomain(record)
  }

  async findByNumeroProgressivo(numeroProgressivo: string): Promise<FIR | null> {
    // firNumber è unico solo con tenantId: la ricerca per solo numero resta
    // best-effort finché l'aggregate FIR non porta un tenantId reale (vedi nota
    // in fondo al file).
    const record = await this.prisma.fIR.findFirst({
      where: { firNumber: numeroProgressivo },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    if (!record) return null

    return this.toDomain(record)
  }

  async findByTenant(tenantId: string, filters?: FIRSearchFilters): Promise<FIR[]> {
    const where: any = {
      tenantId: tenantId,
    }

    if (filters?.stato) {
      where.status = filters.stato
    }

    if (filters?.cerCode) {
      where.cerCode = filters.cerCode
    }

    if (filters?.dataFrom || filters?.dataTo) {
      where.createdAt = {}
      if (filters.dataFrom) where.createdAt.gte = filters.dataFrom
      if (filters.dataTo) where.createdAt.lte = filters.dataTo
    }

    const records = await this.prisma.fIR.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    return records.map((r: any) => this.toDomain(r))
  }

  async findByStato(stato: FIRStato, tenantId?: string): Promise<FIR[]> {
    const where: any = {
      status: stato as any
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    const records = await this.prisma.fIR.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    return records.map((r: any) => this.toDomain(r))
  }

  async save(fir: FIR): Promise<void> {
    const data = this.toPersistence(fir)
    // I trasportatori aggiuntivi (tratte intermodali) sono uno snapshot fissato
    // alla creazione del FIR: si scrivono solo nel ramo `create` dell'upsert, mai
    // negli update (transizioni di stato) per non duplicarli.
    const transportersCreate = this.transportersToCreate(fir)
    const createData: any = { ...data }
    if (transportersCreate.length > 0) {
      createData.transportersAggiuntivi = { create: transportersCreate }
    }

    await this.prisma.fIR.upsert({
      where: { id: fir.id },
      create: createData,
      update: data,
    })
  }

  /** Mappa i trasportatori aggiuntivi dell'aggregate in righe `FIRTransporter`. */
  private transportersToCreate(fir: FIR): any[] {
    return (fir.trasportatoriAggiuntivi ?? []).map(t => ({
      ordine: t.ordine,
      tipoTratta: t.tipoTratta as any,
      trasportatoreId: t.trasportatoreId || undefined,
      denominazione: t.denominazione,
      partitaIva: t.partitaIva || undefined,
      codiceFiscale: t.codiceFiscale || undefined,
      numeroIscrizioneAlbo: t.numeroIscrizioneAlbo || undefined,
      mezzo: t.mezzo || undefined,
      dataPresaInCarico: t.dataPresaInCarico || undefined,
    }))
  }

  async delete(id: string): Promise<void> {
    // Soft delete by updating status to CANCELLED
    await this.prisma.fIR.update({
      where: { id },
      data: {
        status: PrismaFIRStatus.CANCELLED,
        cancelledAt: new Date()
      },
    })
  }

  async existsNumeroProgressivo(numeroProgressivo: string): Promise<boolean> {
    const count = await this.prisma.fIR.count({
      where: { firNumber: numeroProgressivo },
    })
    return count > 0
  }

  async generateNumeroProgressivo(tenantId: string, anno: number): Promise<string> {
    // Conta i FIR del tenant nell'anno (lo schema non ha un campo 'anno':
    // si filtra per intervallo di date su createdAt).
    const count = await this.prisma.fIR.count({
      where: {
        tenantId: tenantId,
        createdAt: {
          gte: new Date(anno, 0, 1),
          lte: new Date(anno, 11, 31, 23, 59, 59)
        }
      },
    })

    const progressive = String(count + 1).padStart(6, '0')
    return `FIR-${anno}-${progressive}`
  }

  async count(filters?: FIRSearchFilters): Promise<number> {
    const where: any = {}

    if (filters?.stato) {
      where.status = filters.stato
    }

    if (filters?.produttoreId) {
      // BUGFIX: prima filtrava la colonna `tenantId` con l'id del produttore
      // (filtro errato). Il produttore è ora referenziato da `producerId`
      // (riferimento al registro, vedi snapshot anagrafico FIR).
      where.producerId = filters.produttoreId
    }

    return this.prisma.fIR.count({ where })
  }

  private toDomain(record: any): FIR {
    // Reconstitute the FIR aggregate from the persisted columns, including the
    // frozen anagrafica snapshots. produttoreId/trasportatoreId/destinatarioId
    // are the registry references (fallback to legacy columns for old rows).
    const fir = FIR.create({
      produttoreId: record.producerId || record.producerUserId || record.tenantId,
      tenantId: record.tenantId,
      rifiuto: {
        cerCode: record.cerCode,
        quantita: Number(record.quantity),
        unitaMisura: record.unit as UnitaMisura,
        statoFisico: undefined, // Not persisted yet
        caratteristichePericolo: undefined, // Not persisted yet
        descrizione: record.wasteDescription || undefined,
        categoria: record.wasteCategory || undefined,
        tipoOperazione: record.wasteOperationType || undefined,
      },
      trasportatoreId: record.carrierId || record.carrierUserId || '',
      destinatarioId: record.receiverId || record.receiverUserId || '',
      creatoDaUserId: record.producerUserId || undefined,
      produttore: this.partyFromRecord(
        record.producerId,
        record.producerName,
        record.producerPartitaIva,
        record.producerAddress,
        record.producerContact,
      ),
      trasportatore: this.partyFromRecord(
        record.carrierId,
        record.carrierName,
        record.carrierPartitaIva,
        undefined,
        record.carrierContact,
        record.carrierVehiclePlate,
      ),
      destinatario: this.partyFromRecord(
        record.receiverId,
        record.receiverName,
        record.receiverPartitaIva,
        record.receiverAddress,
        record.receiverContact,
      ),
      trasportatoriAggiuntivi: (record.transportersAggiuntivi ?? []).map((t: any) => ({
        ordine: t.ordine,
        tipoTratta: t.tipoTratta,
        trasportatoreId: t.trasportatoreId || undefined,
        denominazione: t.denominazione,
        partitaIva: t.partitaIva || undefined,
        codiceFiscale: t.codiceFiscale || undefined,
        numeroIscrizioneAlbo: t.numeroIscrizioneAlbo || undefined,
        mezzo: t.mezzo || undefined,
        dataPresaInCarico: t.dataPresaInCarico || undefined,
      })),
    })

    // Restore state (using reflection - in production use proper reconstitution)
    Object.assign(fir, {
      _id: record.id,
      _stato: record.status as any, // Map FIRStatus to FIRStato
      _numeroProgressivo: record.firNumber,
      _dataPresaCarico: record.transportDate,
      _dataConsegna: record.actualArrivalDate,
      _pesoEffettivo: undefined, // Not in schema
      _firme: {}, // Would come from signatures relation
      _createdAt: record.createdAt,
    })

    return fir
  }

  /** Ricostruisce uno snapshot di parte FIR dai campi persistiti, o null se vuoto. */
  private partyFromRecord(
    registroId?: string | null,
    ragioneSociale?: string | null,
    partitaIva?: string | null,
    indirizzo?: string | null,
    contatto?: string | null,
    targaVeicolo?: string | null,
  ) {
    if (!ragioneSociale && !partitaIva && !registroId) return undefined
    return {
      registroId: registroId || undefined,
      ragioneSociale: ragioneSociale || '',
      partitaIva: partitaIva || '',
      indirizzo: indirizzo || undefined,
      contatto: contatto || undefined,
      targaVeicolo: targaVeicolo || undefined,
    }
  }

  private toPersistence(fir: FIR): any {
    // Mappa l'aggregate FIR sui campi Prisma. I dati anagrafici vengono presi
    // dagli snapshot congelati (parte del documento legale), non più stringhe
    // vuote. producerUserId = utente creatore (FK a User); producer/carrier/
    // receiverId = riferimento al registro di provenienza dello snapshot.
    const produttore = fir.produttore
    const trasportatore = fir.trasportatore
    const destinatario = fir.destinatario

    return {
      id: fir.id,
      status: fir.stato as any, // Map FIRStato to FIRStatus
      firNumber: fir.numeroProgressivo,
      // tenantId reale del FIR; fallback a produttoreId per i FIR legacy creati
      // prima dell'introduzione del tenantId sull'aggregate.
      tenantId: fir.tenantId || fir.produttoreId,
      producerUserId: fir.creatoDaUserId || fir.produttoreId,
      producerId: produttore?.registroId || fir.produttoreId || undefined,
      producerPartitaIva: produttore?.partitaIva || '',
      producerName: produttore?.ragioneSociale || '',
      producerAddress: produttore?.indirizzo || '',
      producerContact: produttore?.contatto || undefined,
      carrierId: trasportatore?.registroId || fir.trasportatoreId || undefined,
      carrierUserId: undefined, // il trasportatore è un'anagrafica, non uno User
      carrierPartitaIva: trasportatore?.partitaIva || '',
      carrierName: trasportatore?.ragioneSociale || '',
      carrierVehiclePlate: trasportatore?.targaVeicolo || '', // dato di trasporto, compilato alla presa in carico
      carrierContact: trasportatore?.contatto || undefined,
      receiverId: destinatario?.registroId || fir.destinatarioId || undefined,
      receiverUserId: undefined, // il destinatario è un'anagrafica, non uno User
      receiverPartitaIva: destinatario?.partitaIva || '',
      receiverName: destinatario?.ragioneSociale || '',
      receiverAddress: destinatario?.indirizzo || '',
      receiverContact: destinatario?.contatto || undefined,
      cerCode: fir.rifiuto.cerCode,
      wasteDescription: fir.rifiuto.descrizione || '',
      wasteCategory: fir.rifiuto.categoria || '',
      wasteOperationType: fir.rifiuto.tipoOperazione || undefined,
      quantity: fir.rifiuto.quantita.valore,
      unit: fir.rifiuto.quantita.unitaMisura,
      transportDate: fir.dataPresaCarico || new Date(),
      actualArrivalDate: fir.dataConsegna,
    }
  }
}

/*
 * ISOLAMENTO TENANT DEL FIR (#7):
 *
 * L'aggregate `FIR` porta ora un `tenantId` reale (valorizzato dal tenant
 * dell'utente creatore in CreateFIRUseCase) persistito in `firs.tenant_id`.
 * `findById` usa il client RLS-aware (`this.prisma.db.fIR`): con TenantContext
 * attivo l'estensione inietta il tenant reale, impedendo l'accesso cross-tenant
 * per id noto; senza contesto (job di sistema) resta un lookup by-id.
 *
 * `findByIdPublic` resta volutamente NON filtrato (verifica firma pubblica).
 * I FIR legacy senza tenantId reale ricadono su `produttoreId` (vedi
 * toPersistence) per retro-compatibilità.
 */

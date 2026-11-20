import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  DatiPartenzaDaSalvare,
  DatiViaggioFir,
  DichiaratoRentri,
  IDatiViaggioFirRepository,
  QuantitaInviata,
  TrasportoInviato,
  UltimoTrasportoAutomezzo,
} from '../../application/rentri/dati-viaggio-fir.port'
import { PrismaService } from './prisma.service'

/**
 * Persistenza Prisma dei dati di viaggio (colonne dedicate di `firs` e `fir_transporters`). Ogni query
 * filtra anche per tenant (oltre alla RLS). Le scritture DOPO l'esito dell'ente non toccano le colonne firmate
 * all'emissione (quantita', unita', colli, targa): vanno nella copia separata `rentri_dichiarato`, che
 * l'aggregate non scrive mai (nessun lost update); nessuna delle due avanza `versione`.
 */
@Injectable()
export class DatiViaggioFirRepository extends IDatiViaggioFirRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async ultimoTrasportoPerTarga(
    tenantId: string,
    targa: string
  ): Promise<UltimoTrasportoAutomezzo | null> {
    // La targa e' quella del FIR (creazione) o quella dichiarata all'ente (le targhe inviate sono ripulite e
    // in maiuscolo); il confronto sul FIR ignora le maiuscole.
    const t = targa.trim()
    const r = await this.prisma.fIR.findFirst({
      where: {
        tenantId,
        conducenteNome: { not: null },
        conducenteCognome: { not: null },
        OR: [
          { carrierVehiclePlate: { equals: t, mode: 'insensitive' } },
          { rentriDichiarato: { path: ['trasporto', 'targaAutomezzo'], equals: t.toUpperCase() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { conducenteNome: true, conducenteCognome: true, targaRimorchio: true },
    })
    if (!r?.conducenteNome || !r.conducenteCognome) return null
    return {
      conducenteNome: r.conducenteNome,
      conducenteCognome: r.conducenteCognome,
      targaRimorchio: r.targaRimorchio,
    }
  }

  async leggi(tenantId: string, firId: string): Promise<DatiViaggioFir | null> {
    const r = await this.prisma.fIR.findFirst({
      where: { id: firId, tenantId },
      select: {
        id: true,
        quantity: true,
        unit: true,
        wastePackageCount: true,
        verificatoInPartenza: true,
        rinfusa: true,
        transportDate: true,
        carrierVehiclePlate: true,
        conducenteNome: true,
        conducenteCognome: true,
        targaRimorchio: true,
        percorso: true,
        rentriDichiarato: true,
        transportersAggiuntivi: { orderBy: { ordine: 'asc' } },
      },
    })
    if (!r) return null
    return {
      firId: r.id,
      dichiarato: (r.rentriDichiarato as DichiaratoRentri | null) ?? null,
      quantita: Number(r.quantity),
      unitaMisura: r.unit,
      numeroColli: r.wastePackageCount ?? null,
      verificatoInPartenza: r.verificatoInPartenza,
      rinfusa: r.rinfusa,
      dataTrasporto: r.transportDate,
      targaAutomezzo: r.carrierVehiclePlate ?? '',
      principale: {
        conducenteNome: r.conducenteNome,
        conducenteCognome: r.conducenteCognome,
        targaRimorchio: r.targaRimorchio,
        percorso: r.percorso,
      },
      tratteAggiuntive: r.transportersAggiuntivi.map(t => ({
        ordine: t.ordine,
        tipoTratta: t.tipoTratta,
        denominazione: t.denominazione,
        partitaIva: t.partitaIva,
        codiceFiscale: t.codiceFiscale,
        numeroIscrizioneAlbo: t.numeroIscrizioneAlbo,
        mezzo: t.mezzo,
        conducenteNome: t.conducenteNome,
        conducenteCognome: t.conducenteCognome,
        targaRimorchio: t.targaRimorchio,
        percorso: t.percorso,
        dataOraInizioTrasporto: t.dataOraInizioTrasporto,
      })),
    }
  }

  async salvaDatiPartenza(
    tenantId: string,
    firId: string,
    dati: DatiPartenzaDaSalvare
  ): Promise<void> {
    // `undefined` = non toccare (Prisma lo ignora); `null` = svuota.
    await this.prisma.fIR.updateMany({
      where: { id: firId, tenantId },
      data: {
        verificatoInPartenza: dati.verificatoInPartenza,
        rinfusa: dati.rinfusa,
        conducenteNome: dati.conducenteNome,
        conducenteCognome: dati.conducenteCognome,
        targaRimorchio: dati.targaRimorchio,
        percorso: dati.percorso,
        // Niente `versione`: sono colonne fuori dall'aggregate, che il suo `save` non riscrive mai, e
        // chi ha appena modificato la bozza deve poter rimandare la versione che ha in mano.
      },
    })
  }

  /** Fonde `parte` nella copia dichiarata (chiavi diverse per quantita' e trasporto). */
  private async fondiDichiarato(
    tenantId: string,
    firId: string,
    parte: Prisma.InputJsonObject
  ): Promise<Prisma.InputJsonObject> {
    const r = await this.prisma.fIR.findFirst({
      where: { id: firId, tenantId },
      select: { rentriDichiarato: true },
    })
    const attuale = (r?.rentriDichiarato ?? {}) as Prisma.InputJsonObject
    return { ...attuale, ...parte }
  }

  async aggiornaQuantitaDopoEnte(
    tenantId: string,
    firId: string,
    q: QuantitaInviata
  ): Promise<void> {
    const dichiarato = await this.fondiDichiarato(tenantId, firId, {
      quantita: {
        valore: q.valore,
        unitaMisura: q.unitaMisura,
        // Alla rinfusa i colli non esistono.
        numeroColli: q.rinfusa ? null : q.numeroColli,
      },
    })
    // `quantity`, `unit` e `waste_package_count` NON si toccano: entrano nel documento firmato
    // all'emissione. Il `versione` non avanza: nessun campo dell'aggregate cambia.
    await this.prisma.fIR.updateMany({
      where: { id: firId, tenantId },
      data: {
        rinfusa: q.rinfusa,
        verificatoInPartenza: q.verificatoInPartenza,
        rentriDichiarato: dichiarato,
      },
    })
  }

  async aggiornaTrasportoDopoEnte(
    tenantId: string,
    firId: string,
    t: TrasportoInviato
  ): Promise<void> {
    const dichiarato = await this.fondiDichiarato(tenantId, firId, {
      trasporto: { targaAutomezzo: t.targaAutomezzo },
    })
    // `carrier_vehicle_plate` NON si tocca (documento firmato): la targa dichiarata sta nella copia.
    await this.prisma.fIR.updateMany({
      where: { id: firId, tenantId },
      data: {
        conducenteNome: t.conducenteNome,
        conducenteCognome: t.conducenteCognome,
        targaRimorchio: t.targaRimorchio,
        percorso: t.percorso,
        rentriDichiarato: dichiarato,
      },
    })
  }
}

import { Injectable } from '@nestjs/common'
import {
  DatiPartenzaDaSalvare,
  DatiViaggioFir,
  IDatiViaggioFirRepository,
  QuantitaInviata,
  TrasportoInviato,
} from '../../application/rentri/dati-viaggio-fir.port'
import { PrismaService } from './prisma.service'

/**
 * Persistenza Prisma dei dati di viaggio (colonne dedicate di `firs` e `fir_transporters`). Ogni query
 * filtra anche per tenant (oltre alla RLS). Le scritture incrementano `versione`: il lock ottimistico
 * degli altri salvataggi del FIR deve accorgersi che la riga e' cambiata.
 */
@Injectable()
export class DatiViaggioFirRepository extends IDatiViaggioFirRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
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
        transportersAggiuntivi: { orderBy: { ordine: 'asc' } },
      },
    })
    if (!r) return null
    return {
      firId: r.id,
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
        versione: { increment: 1 },
      },
    })
  }

  async aggiornaQuantitaDopoEnte(
    tenantId: string,
    firId: string,
    q: QuantitaInviata
  ): Promise<void> {
    await this.prisma.fIR.updateMany({
      where: { id: firId, tenantId },
      data: {
        quantity: q.valore,
        unit: q.unitaMisura,
        // Alla rinfusa i colli non esistono: la copia locale non ne tiene di vecchi.
        wastePackageCount: q.rinfusa ? null : q.numeroColli,
        rinfusa: q.rinfusa,
        verificatoInPartenza: q.verificatoInPartenza,
        versione: { increment: 1 },
      },
    })
  }

  async aggiornaTrasportoDopoEnte(
    tenantId: string,
    firId: string,
    t: TrasportoInviato
  ): Promise<void> {
    await this.prisma.fIR.updateMany({
      where: { id: firId, tenantId },
      data: {
        carrierVehiclePlate: t.targaAutomezzo ?? '',
        conducenteNome: t.conducenteNome,
        conducenteCognome: t.conducenteCognome,
        targaRimorchio: t.targaRimorchio,
        percorso: t.percorso,
        versione: { increment: 1 },
      },
    })
  }
}

import { Injectable } from '@nestjs/common'
import {
  DatiPartenzaDaSalvare,
  EsitoAggiuntaTratta,
  NuovaTrattaTrasbordoTotale,
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

  async aggiornaQuantitaDopoEnte(
    tenantId: string,
    firId: string,
    q: QuantitaInviata
  ): Promise<void> {
    const parte = JSON.stringify({
      quantita: {
        valore: q.valore,
        unitaMisura: q.unitaMisura,
        // Alla rinfusa i colli non esistono.
        numeroColli: q.rinfusa ? null : q.numeroColli,
      },
    })
    // UN SOLO UPDATE: la fusione del JSON (`||`) e' atomica, quindi `/quantita` e `/trasporto` concorrenti
    // non si perdono a vicenda. `quantity`, `unit` e `waste_package_count` NON si toccano: entrano nel
    // documento firmato all'emissione. Il `versione` non avanza: nessun campo dell'aggregate cambia.
    // Dentro `$transaction` perche' l'estensione imposta il tenant (RLS) per la transazione.
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`
        UPDATE firs SET
          rinfusa = ${q.rinfusa},
          verificato_in_partenza = ${q.verificatoInPartenza}::boolean,
          rentri_dichiarato = COALESCE(rentri_dichiarato, '{}'::jsonb) || ${parte}::jsonb
        WHERE id = ${firId}::uuid AND tenant_id = ${tenantId}::uuid`
    })
  }

  async aggiornaTrasportoDopoEnte(
    tenantId: string,
    firId: string,
    t: TrasportoInviato
  ): Promise<void> {
    const parte = JSON.stringify({ trasporto: { targaAutomezzo: t.targaAutomezzo } })
    // `carrier_vehicle_plate` NON si tocca (documento firmato): la targa dichiarata sta nella copia.
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`
        UPDATE firs SET
          conducente_nome = ${t.conducenteNome},
          conducente_cognome = ${t.conducenteCognome},
          targa_rimorchio = ${t.targaRimorchio}::varchar,
          percorso = ${t.percorso}::varchar,
          rentri_dichiarato = COALESCE(rentri_dichiarato, '{}'::jsonb) || ${parte}::jsonb
        WHERE id = ${firId}::uuid AND tenant_id = ${tenantId}::uuid`
    })
  }

  async aggiungiTrattaTrasbordoTotale(
    tenantId: string,
    firId: string,
    t: NuovaTrattaTrasbordoTotale
  ): Promise<EsitoAggiuntaTratta> {
    // Una transazione: lettura delle tratte (anche per l'idempotenza) e inserimento si vedono insieme, e
    // l'estensione imposta il tenant (RLS) per tutta la transazione. Nessun UPDATE su `firs`: `versione` e
    // colonne firmate restano quelle dell'emissione.
    return this.prisma.$transaction(async tx => {
      // `fir_transporters` non ha vincoli unique: lettura e inserimento in READ COMMITTED non bastano contro due
      // riconciliazioni concorrenti (invio + firma, o due firme). Il lock sulla riga del FIR le serializza, come
      // in `fir-prisma.repository.ts` (`FOR NO KEY UPDATE`: non blocca i movimenti del registro che puntano al FIR).
      await tx.$queryRaw`
        SELECT 1 FROM firs WHERE id = ${firId}::uuid AND tenant_id = ${tenantId}::uuid
        FOR NO KEY UPDATE`
      const esistenti = await tx.fIRTransporter.findMany({
        where: { firId, tenantId },
        select: {
          ordine: true,
          partitaIva: true,
          codiceFiscale: true,
          dataOraInizioTrasporto: true,
        },
      })
      const stessa = esistenti.find(
        x =>
          x.partitaIva === t.partitaIva &&
          x.codiceFiscale === t.codiceFiscale &&
          x.dataOraInizioTrasporto?.getTime() === t.dataOraInizioTrasporto.getTime()
      )
      if (stessa) return { creata: false, ordine: stessa.ordine }

      const ordine = Math.max(1, ...esistenti.map(x => x.ordine)) + 1
      await tx.fIRTransporter.create({
        data: {
          firId,
          tenantId,
          ordine,
          tipoTratta: 'TERRESTRE',
          trasportatoreId: t.trasportatoreId,
          denominazione: t.denominazione,
          partitaIva: t.partitaIva,
          codiceFiscale: t.codiceFiscale,
          numeroIscrizioneAlbo: t.numeroIscrizioneAlbo,
          mezzo: t.mezzo,
          dataPresaInCarico: t.dataOraInizioTrasporto,
          conducenteNome: t.conducenteNome,
          conducenteCognome: t.conducenteCognome,
          targaRimorchio: t.targaRimorchio,
          percorso: t.percorso,
          dataOraInizioTrasporto: t.dataOraInizioTrasporto,
        },
      })
      return { creata: true, ordine }
    })
  }
}

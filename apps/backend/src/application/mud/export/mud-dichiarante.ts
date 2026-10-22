import type { Tenant } from '@prisma/client'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { MudAggregato } from '../aggregazione/mud-aggregazione.service'
import type {
  MudAutorizzazione,
  MudAzienda,
  MudClassificazioneDiscarica,
  MudEnteAutorizzante,
  MudTipoAutorizzazione,
} from './mud-export.types'

// Unico caricamento dei dati del dichiarante che entrano nel file MUD (record AA e AU): lo usano
// l'export, per scrivere il file, e la segnatura della presentazione, per capire se il
// dichiarante è cambiato dopo (`hashDichiarante`). Due caricamenti separati divergerebbero.

/** Campi dell'azienda che entrano nell'anagrafica del dichiarante del file MUD. */
export type TenantDichiarante = Pick<
  Tenant,
  | 'ragioneSociale'
  | 'partitaIva'
  | 'codiceFiscale'
  | 'address'
  | 'civico'
  | 'city'
  | 'province'
  | 'postalCode'
  | 'pec'
  | 'telefono'
  | 'reaNumber'
  | 'numeroAddetti'
  | 'legaleRappresentanteNome'
  | 'legaleRappresentanteCognome'
>

/** Dati del dichiarante come entrano nel file: anagrafica (AA) e autorizzazioni (AU). */
export interface DichiaranteMud {
  azienda: MudAzienda
  autorizzazioni: MudAutorizzazione[]
}

/**
 * Anagrafica del dichiarante come entra nel record AA: dati dell'azienda più ATECO e comune
 * ISTAT già risolti dall'aggregazione.
 */
export function aziendaDichiarante(
  tenant: TenantDichiarante,
  dichiarante: MudAggregato['dichiarante']
): MudAzienda {
  return {
    ragioneSociale: tenant.ragioneSociale,
    partitaIva: tenant.partitaIva,
    codiceFiscale: tenant.codiceFiscale ?? undefined,
    via: tenant.address ?? undefined,
    civico: tenant.civico ?? undefined,
    comune: tenant.city ?? undefined,
    comuneCode: dichiarante.comuneCode ?? undefined,
    provincia: tenant.province ?? undefined,
    cap: tenant.postalCode ?? undefined,
    pec: tenant.pec ?? undefined,
    telefono: tenant.telefono ?? undefined,
    atecoCode: dichiarante.atecoNormalizzato ?? undefined,
    reaNumber: tenant.reaNumber ?? undefined,
    numeroAddetti: tenant.numeroAddetti ?? undefined,
    legaleRappresentanteNome: tenant.legaleRappresentanteNome ?? undefined,
    legaleRappresentanteCognome: tenant.legaleRappresentanteCognome ?? undefined,
  }
}

/**
 * Schede SA-AUT (record AU) del dichiarante.
 *
 * Il tracciato prevede una scheda per ogni autorizzazione o certificazione posseduta
 * dall'impianto che effettua la gestione dei rifiuti; in assenza, nessun record AU va
 * trasmesso e `AB` riporta `00` schede AUT. L'ordine è fisso (anche per le discariche), così
 * il file e l'hash non dipendono dall'ordine di lettura del database.
 */
async function caricaAutorizzazioni(
  prisma: PrismaService,
  tenantId: string
): Promise<MudAutorizzazione[]> {
  const righe = await prisma.autorizzazioneImpianto.findMany({
    where: { tenantId },
    include: { discariche: { orderBy: { id: 'asc' } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  return righe.map(a => ({
    estremi: a.estremi,
    dataRilascio: a.dataRilascio ?? undefined,
    dataScadenza: a.dataScadenza ?? undefined,
    enteAutorizzante: a.enteAutorizzante as MudEnteAutorizzante,
    tipoAutorizzazione: a.tipoAutorizzazione as MudTipoAutorizzazione,
    rinnovoAutocertificazione: a.rinnovoAutocertificazione,
    operazioniRecupero: a.operazioniRecupero,
    operazioniSmaltimento: a.operazioniSmaltimento,
    gestisceVFU: a.gestisceVfu,
    gestisceRAEE: a.gestisceRaee,
    autorizzazioneEoW: a.autorizzazioneEow,
    impiantoIncenerimento: a.impiantoIncenerimento,
    capacitaComplessivaTa: a.capacitaComplessivaTa,
    capacitaPericolosiTa: a.capacitaPericolosiTa,
    capacitaNonPericolosiTa: a.capacitaNonPericolosiTa,
    impiantoCoincenerimento: a.impiantoCoincenerimento,
    capacitaCoincComplessivaTa: a.capacitaCoincComplessivaTa,
    capacitaCoincPericolosiTa: a.capacitaCoincPericolosiTa,
    capacitaCoincNonPericolosiTa: a.capacitaCoincNonPericolosiTa,
    discariche: a.discariche.map(d => ({
      classificazione: d.classificazione as MudClassificazioneDiscarica,
      capacitaResiduaMc: d.capacitaResiduaMc,
    })),
    emasPrimaRegistrazione: a.emasPrimaRegistrazione ?? undefined,
    emasNumeroRegistrazione: a.emasNumeroRegistrazione ?? undefined,
    iso14001Emissione: a.iso14001Emissione ?? undefined,
  }))
}

/** Dati del dichiarante di un'azienda già letta (l'export la legge prima, per il 404). */
export async function caricaDichiarante(
  prisma: PrismaService,
  tenantId: string,
  tenant: TenantDichiarante,
  dichiarante: MudAggregato['dichiarante']
): Promise<DichiaranteMud> {
  return {
    azienda: aziendaDichiarante(tenant, dichiarante),
    autorizzazioni: await caricaAutorizzazioni(prisma, tenantId),
  }
}

/** Come `caricaDichiarante`, leggendo l'azienda; `null` se non esiste. */
export async function caricaDichiaranteDellAzienda(
  prisma: PrismaService,
  tenantId: string,
  dichiarante: MudAggregato['dichiarante']
): Promise<DichiaranteMud | null> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  return tenant ? caricaDichiarante(prisma, tenantId, tenant, dichiarante) : null
}

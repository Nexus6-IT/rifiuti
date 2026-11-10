import { UnitaMisura } from '../fir/value-objects/quantita'
import {
  ProvenienzaRifiuto,
  TipoTratta,
  type TipoOperazioneRifiuto,
} from '../fir/aggregates/fir.aggregate'

/** Dati del ritiro che servono a produrre la bozza del FIR (sottoinsieme di `RitiroVista`). */
export interface RitiroPerFir {
  id: string
  produttoreId: string
  produttoreSedeId: string
  trasportatoreId: string
  destinatarioId: string
  destinatarioSedeId: string
  cerCode: string
  descrizione: string | null
  statoFisico: string | null
  caratteristichePericolo: string | null
  numeroColli: number | null
  /** Decimale come stringa, es. '12.50'. */
  quantitaPresunta: string
  unita: string
  tipoOperazione: TipoOperazioneRifiuto | null
  codiceOperazione: string | null
  provenienza: ProvenienzaRifiuto
  tipoTratta: TipoTratta
  /** Va sul campo 17 del FIR. */
  annotazioni: string | null
  /** Solo per l'operatore: NON si copia sul FIR. */
  noteInterne?: string | null
}

/**
 * Stessa forma di `CreateFIRCommand` più `ritiroId`: il servizio la passa al costruttore
 * (T9 aggiunge `ritiroId` al comando). Tenuta qui, nel dominio, per non dipendere
 * dall'application layer.
 */
export interface ComandoFirDaRitiro {
  produttoreId: string
  rifiuto: {
    cerCode: string
    quantita: number
    unitaMisura: UnitaMisura
    statoFisico?: string
    caratteristichePericolo?: string
    numeroColli?: number
    descrizione?: string
    tipoOperazione?: TipoOperazioneRifiuto
    codiceOperazione?: string
  }
  trasportatoreId: string
  destinatarioId: string
  userId: string
  tenantId: string
  provenienza: ProvenienzaRifiuto
  tipoTrattaPrincipale: TipoTratta
  trasportatoriAggiuntivi: []
  annotazioni?: string
  produttoreSedeId: string
  destinatarioSedeId: string
  ritiroId: string
}

const UNITA: Record<string, UnitaMisura> = {
  kg: UnitaMisura.KG,
  litri: UnitaMisura.LITRI,
  t: UnitaMisura.TONNELLATE,
}

/** Converte l'unità salvata sul ritiro (case-insensitive: 'KG', 'Kg', 'kg'). */
export function unitaDaRitiro(unita: string): UnitaMisura {
  const trovata = UNITA[unita.trim().toLowerCase()]
  if (!trovata) throw new Error(`Unità di misura non supportata: ${unita}`)
  return trovata
}

function seNonVuoto(v: string | null | undefined): string | undefined {
  return v == null || v.trim() === '' ? undefined : v
}

/** Funzione pura: dal ritiro al comando di creazione della bozza FIR (P7 §3.2). */
export function comandoFirDaRitiro(
  ritiro: RitiroPerFir,
  contesto: { userId: string; tenantId: string }
): ComandoFirDaRitiro {
  const quantita = Number(ritiro.quantitaPresunta)
  if (!Number.isFinite(quantita) || quantita <= 0) {
    throw new Error(`Quantità presunta non valida: ${ritiro.quantitaPresunta}`)
  }
  return {
    produttoreId: ritiro.produttoreId,
    rifiuto: {
      cerCode: ritiro.cerCode,
      quantita,
      unitaMisura: unitaDaRitiro(ritiro.unita),
      statoFisico: seNonVuoto(ritiro.statoFisico),
      caratteristichePericolo: seNonVuoto(ritiro.caratteristichePericolo),
      numeroColli: ritiro.numeroColli ?? undefined,
      descrizione: seNonVuoto(ritiro.descrizione),
      tipoOperazione: ritiro.tipoOperazione ?? undefined,
      codiceOperazione: seNonVuoto(ritiro.codiceOperazione),
    },
    trasportatoreId: ritiro.trasportatoreId,
    destinatarioId: ritiro.destinatarioId,
    userId: contesto.userId,
    tenantId: contesto.tenantId,
    provenienza: ritiro.provenienza,
    tipoTrattaPrincipale: ritiro.tipoTratta,
    trasportatoriAggiuntivi: [],
    annotazioni: seNonVuoto(ritiro.annotazioni),
    produttoreSedeId: ritiro.produttoreSedeId,
    destinatarioSedeId: ritiro.destinatarioSedeId,
    ritiroId: ritiro.id,
  }
}

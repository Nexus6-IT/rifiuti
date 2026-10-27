import { FIR, MotivoNonModificabile } from '../../shared/models/fir.model'
import { CreateFIRDto } from './fir.service'

/**
 * Ricompone il form del dialog FIR a partire da un FIR letto dal backend, campo per campo.
 *
 * NON si copia mai l'oggetto `rifiuto` della risposta: contiene anche `descrizione`,
 * `categoria` e `tipoOperazione`, che il backend rifiuta con 400 (`forbidNonWhitelisted`).
 * Per lo stesso motivo non si porta nulla di ciò che è solo di lettura (stato, numero,
 * snapshot delle parti, versione): la versione la gestisce chi invia il PUT.
 *
 * L'unità di misura è quella del FIR (obbligatoria nella modifica), non il predefinito della creazione.
 */
export function formDaFir(fir: FIR): CreateFIRDto {
  const r = fir.rifiuto
  const dto: CreateFIRDto = {
    produttoreId: fir.produttoreId,
    trasportatoreId: fir.trasportatoreId,
    destinatarioId: fir.destinatarioId,
    provenienza: fir.provenienza ?? undefined,
    tipoTrattaPrincipale: fir.tipoTrattaPrincipale ?? undefined,
    rifiuto: {
      cerCode: r.cerCode,
      quantita: r.quantita,
      unitaMisura: r.unitaMisura,
      statoFisico: r.statoFisico ?? undefined,
      caratteristichePericolo: r.caratteristichePericolo ?? undefined,
      numeroColli: r.numeroColli ?? undefined,
      codiceOperazione: r.codiceOperazione ?? undefined,
    },
    annotazioni: fir.annotazioni ?? undefined,
  }
  // Una tratta senza trasportatoreId (non nel registro) non si può rinviare: si omette.
  const tratte = (fir.trasportatoriAggiuntivi ?? [])
    .filter(t => !!t.trasportatoreId)
    .map(t => ({
      trasportatoreId: t.trasportatoreId as string,
      tipoTratta: t.tipoTratta,
      ordine: t.ordine,
    }))
  if (tratte.length > 0) dto.trasportatoriAggiuntivi = tratte
  return dto
}

/** Perché una bozza non si può modificare, in parole per l'utente (stessi motivi e ordine del backend). */
export function testoMotivoNonModificabile(
  motivo: MotivoNonModificabile | null | undefined
): string {
  switch (motivo) {
    case 'LEGATO_RENTRI':
      return 'Il FIR è legato a un formulario RENTRI: la modifica va fatta su RENTRI, non in locale.'
    case 'NON_BOZZA':
      return 'Un FIR emesso non si modifica: annullalo e creane uno nuovo.'
    case 'FIRMATO':
      return 'Il FIR porta già una firma: modificarlo la renderebbe non più verificabile. Annulla il FIR e creane uno nuovo.'
    case 'IN_ATTESA_FIRMA_PRODUTTORE':
      return 'Il FIR è in attesa della firma del produttore e non si può modificare.'
    default:
      return ''
  }
}

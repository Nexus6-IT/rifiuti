/**
 * Parametri di percorso delle rotte per elaborazione (4.4b1, §11): `:id` e `:documentoId` devono
 * essere UUID (altrimenti 400, prima del servizio). `escludi` e `riammetti` non hanno corpo.
 */
import { IsUUID } from 'class-validator'

export class ElaborazioneParamDto {
  @IsUUID()
  id: string
}

export class DocumentoElaborazioneParamDto {
  @IsUUID()
  id: string

  @IsUUID()
  documentoId: string
}

import { IsUUID } from 'class-validator'

/** Parametri di `GET /documenti-fattura/:id/sdi/notifiche/:notificaId/file`. */
export class RicevutaParamDto {
  @IsUUID()
  id: string

  @IsUUID()
  notificaId: string
}

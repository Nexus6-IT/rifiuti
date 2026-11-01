// Multipart degli allegati del contratto cliente (4.1b, Task 19): un solo file `allegato` e il
// solo campo `posizione`. Limiti come `api/pese/allegato-upload.ts`, errori in italiano senza
// dettagli interni. Il controllo del tipo (solo PDF, magic bytes) e' del servizio.
import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Observable } from 'rxjs'
import { DIMENSIONE_MASSIMA_ALLEGATO } from '../../domain/pese/allegato-pesa'
import { MESSAGGIO_DIMENSIONE_ALLEGATO_CONTRATTO } from '../../application/contratti-cliente/allegati-contratto-cliente.service'

export { nomeUtf8 } from '../pese/allegato-upload'
export type { FileMulter } from '../pese/allegato-upload'

/**
 * Il limite di multer e' 1 byte oltre i 4 MiB (a limite esatto multer segnala gia' il
 * troncamento): il controllo preciso lo fa il servizio.
 */
const interno = FileInterceptor('allegato', {
  limits: {
    fileSize: DIMENSIONE_MASSIMA_ALLEGATO + 1,
    files: 1,
    fields: 1,
    fieldSize: 1024,
  },
})

@Injectable()
export class AllegatoContrattoInterceptor implements NestInterceptor {
  private readonly multer = new (interno as new () => NestInterceptor)()

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.multer.intercept(ctx, next)
    } catch (err) {
      if (err instanceof PayloadTooLargeException) {
        throw new PayloadTooLargeException(MESSAGGIO_DIMENSIONE_ALLEGATO_CONTRATTO)
      }
      if (err instanceof HttpException && err.getStatus() === 400) {
        throw new BadRequestException(
          'Richiesta non valida: servono il file "allegato" e il campo "posizione".'
        )
      }
      throw err
    }
  }
}

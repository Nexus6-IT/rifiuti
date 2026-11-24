// Multipart delle foto dal campo (P5): un solo file `foto` e i soli campi `id` e `sha256`. Il tetto
// per foto lo applica il servizio (413 in italiano); qui multer legge al piu' 1 byte oltre, quindi
// un file enorme non viene mai caricato per intero in memoria.
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
import {
  MAX_BYTE_FOTO_CAMPO,
  MESSAGGIO_FOTO_TROPPO_GRANDE,
} from '../../application/campo/allegati-campo.input'

const interno = FileInterceptor('foto', {
  limits: { fileSize: MAX_BYTE_FOTO_CAMPO + 1, files: 1, fields: 2, fieldSize: 256 },
})

@Injectable()
export class FotoCampoInterceptor implements NestInterceptor {
  private readonly multer = new (interno as new () => NestInterceptor)()

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.multer.intercept(ctx, next)
    } catch (err) {
      if (err instanceof PayloadTooLargeException) {
        throw new PayloadTooLargeException({
          message: MESSAGGIO_FOTO_TROPPO_GRANDE,
          error: 'FOTO_TROPPO_GRANDE',
        })
      }
      if (err instanceof HttpException && err.getStatus() === 400) {
        throw new BadRequestException(
          'Richiesta non valida: servono il file "foto" e i campi "id" e "sha256".'
        )
      }
      throw err
    }
  }
}

/** File caricato da multer in memoria. */
export interface FotoMulter {
  size: number
  buffer: Buffer
}

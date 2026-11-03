import {
  BadRequestException,
  CanActivate,
  ForbiddenException,
  Type,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Observable } from 'rxjs'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { contentDisposition } from '../common/content-disposition'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { DIMENSIONE_MASSIMA_ALLEGATO, riconosciTipoFile } from '../../domain/pese/allegato-pesa'
import type { FileCaricato } from '../../application/pese/accessi-pesa.tipi'
import {
  MESSAGGIO_DIMENSIONE_ALLEGATO,
  MESSAGGIO_TIPO_ALLEGATO,
} from '../../application/pese/allegati-pesa.service'

/** File caricato da multer in memoria (il pacchetto dei tipi non e' installato). */
export interface FileMulter {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

const TIPI_DICHIARATI_AMMESSI = ['image/jpeg', 'image/png', 'application/pdf']

/**
 * Limiti del multipart: un solo file `allegato` e il solo campo `dati`. Il limite di multer e'
 * 1 byte oltre i 4 MiB (a limite esatto multer segnala gia' il troncamento): il controllo
 * preciso (> 4 MiB → 413) lo fa `allegatoDaRichiesta`.
 */
const interno = FileInterceptor('allegato', {
  limits: {
    fileSize: DIMENSIONE_MASSIMA_ALLEGATO + 1,
    files: 1,
    fields: 1,
    fieldSize: 64 * 1024,
  },
})

/**
 * Multipart con allegato facoltativo. Gli errori di multer diventano messaggi italiani senza
 * dettagli interni; gli errori del handler (validazione dei dati, servizi) passano intatti,
 * perche' si traduce solo l'eccezione lanciata PRIMA di `next.handle()`.
 */
@Injectable()
export class AllegatoInterceptor implements NestInterceptor {
  private readonly multer = new (interno as new () => NestInterceptor)()

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.multer.intercept(ctx, next)
    } catch (err) {
      if (err instanceof PayloadTooLargeException) {
        throw new PayloadTooLargeException(MESSAGGIO_DIMENSIONE_ALLEGATO)
      }
      if (err instanceof HttpException && err.getStatus() === 400) {
        throw new BadRequestException(
          'Richiesta non valida: serve il campo "dati" e al massimo un file "allegato".'
        )
      }
      throw err
    }
  }
}

/**
 * multer/busboy decodificano il nome come latin1: "città.jpg" arriva "cittÃ .jpg". Si
 * ricodifica in UTF-8 solo se il risultato e' UTF-8 valido (nessun U+FFFD), altrimenti resta.
 */
export function nomeUtf8(nome: string): string {
  const ricodificato = Buffer.from(nome ?? '', 'latin1').toString('utf8')
  return ricodificato.includes('\uFFFD') ? nome : ricodificato
}

/**
 * Controlla l'allegato PRIMA del servizio: tipo dichiarato ammesso e magic bytes coerenti
 * (un eseguibile rinominato .jpg non passa). 415 o 413 in italiano.
 */
export function allegatoDaRichiesta(file?: FileMulter): FileCaricato | undefined {
  if (!file) return undefined
  if (file.size > DIMENSIONE_MASSIMA_ALLEGATO) {
    throw new PayloadTooLargeException(MESSAGGIO_DIMENSIONE_ALLEGATO)
  }
  const reale = riconosciTipoFile(file.buffer)
  if (!TIPI_DICHIARATI_AMMESSI.includes(file.mimetype) || !reale || reale !== file.mimetype) {
    throw new UnsupportedMediaTypeException(MESSAGGIO_TIPO_ALLEGATO)
  }
  return {
    nomeFile: nomeUtf8(file.originalname),
    mimeDichiarato: file.mimetype,
    contenuto: file.buffer,
  }
}

/** Intestazione Content-Disposition sicura (helper comune, RFC 5987). */
export function contentDispositionInline(nome: string): string {
  return contentDisposition('inline', nome)
}

/** Guard dei ruoli: 403 prima che l'interceptor legga il multipart. */
export function RuoloPesaGuard(
  ammessi: readonly RuoloApplicativo[],
  chi: 'OPERATORI' | 'AMMINISTRATORI'
): Type<CanActivate> {
  @Injectable()
  class RuoloPesaGuardImpl implements CanActivate {
    constructor(private readonly membership: RuoloEffettivoService) {}
    async canActivate(ctx: ExecutionContext): Promise<boolean> {
      const req = ctx.switchToHttp().getRequest()
      const tenantId = requireRequestTenantId(req)
      const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
      if (ammessi.includes(ruolo)) return true
      throw new ForbiddenException({
        message:
          chi === 'AMMINISTRATORI'
            ? "Solo un amministratore dell'azienda può eseguire questa operazione sulle pese."
            : "Il tuo ruolo nell'azienda selezionata non consente di operare sulle pese.",
        error: `PESE_RISERVATE_${chi}`,
      })
    }
  }
  return RuoloPesaGuardImpl
}

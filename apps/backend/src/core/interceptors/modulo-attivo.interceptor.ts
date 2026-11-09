import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, from, switchMap, throwError } from 'rxjs'
import { Request } from 'express'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { RICHIEDE_MODULO, SENZA_MODULO } from '../decorators/richiede-modulo.decorator'
import { resolveRequestTenantId } from '../context/resolve-request-tenant'
import { VERIFICA_AZIENDA_NON_DISPONIBILE } from '../context/azienda-selezionata-errori'
import { rispostaModuloNonAttivo } from '../context/modulo-non-attivo-errore'

/** `blocca` (default) respinge; `registra` scrive un avviso e lascia passare (rilascio graduale). */
export type ModalitaModuli = 'blocca' | 'registra'

/** Legge `MODULI_BACKEND_MODALITA`: qualunque valore diverso da `registra` e' `blocca`. */
export function modalitaModuli(): ModalitaModuli {
  return process.env.MODULI_BACKEND_MODALITA?.trim().toLowerCase() === 'registra'
    ? 'registra'
    : 'blocca'
}

/**
 * ModuloAttivoInterceptor — i moduli commerciali sono chiusi anche nel backend.
 *
 * Globale (`APP_INTERCEPTOR`), registrato DOPO `TenantSwitchInterceptor`: deve vedere l'azienda
 * selezionata gia' validata (`req.tenantId`). Un guard girerebbe prima del JWT e sull'azienda
 * candidata non validata, rivelando i moduli di aziende non accessibili.
 *
 * Algoritmo:
 *  1. non http, o nessun `@RichiedeModulo`/`@SenzaModulo`, o `@SenzaModulo` -> passa;
 *  2. senza `req.user` -> 401 (una rotta di modulo non e' mai pubblica);
 *  3. azienda = `resolveRequestTenantId(req)`: quella su cui l'handler opera davvero (la
 *     selezionata validata; su una rotta di recupero con selezione respinta, la primaria);
 *  4. SUPER_ADMIN senza azienda -> passa; altri senza azienda -> 403;
 *  5. moduli attivi dell'azienda (`ModuliAttiviService`); basta UNA delle chiavi richieste,
 *     altrimenti 403 `MODULO_NON_ATTIVO` (in `registra`: avviso e passa);
 *  6. errore del database -> 503 `VERIFICA_AZIENDA_NON_DISPONIBILE`, in ogni modalita':
 *     la richiesta non passa mai se i moduli non si sono potuti verificare.
 *
 * Su ogni livello (metodo, poi classe) `@RichiedeModulo` e `@SenzaModulo` si leggono
 * separatamente: il metodo prevale sulla classe.
 */
@Injectable()
export class ModuloAttivoInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ModuloAttivoInterceptor.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly moduli: ModuliAttiviService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle()

    const richiesti = this.chiaviRichieste(context)
    if (!richiesti) return next.handle()

    const req = context.switchToHttp().getRequest<Request>()
    const user = (req as any).user
    // Una rotta di modulo non e' mai pubblica: senza utente 401, mai passare (fail-closed).
    if (!user) return throwError(() => new UnauthorizedException())

    // Azienda su cui l'handler opera davvero: la selezionata gia' validata da
    // TenantSwitchInterceptor, o la primaria se la selezione non e' valida su una rotta di recupero.
    const tenantId = resolveRequestTenantId(req)

    if (!tenantId) {
      // D2b: il SUPER_ADMIN senza azienda opera a livello di piattaforma.
      if (user.role === 'SUPER_ADMIN') return next.handle()
      if (modalitaModuli() === 'registra') {
        this.logger.warn(
          `Nessuna azienda (solo registrato): ${req.method} ${req.path}, utente=${user.id}, ` +
            `richiesti=${richiesti.join('|')}`
        )
        return next.handle()
      }
      return throwError(() => this.rifiuta(richiesti))
    }

    return from(
      this.moduli.moduliAttivi(tenantId).then(
        attivi => ({ attivi }),
        (err: Error) => ({ errore: err })
      )
    ).pipe(
      switchMap(esito => {
        if ('errore' in esito) {
          this.logger.warn(`Verifica moduli fallita (azienda=${tenantId}): ${esito.errore.message}`)
          throw new ServiceUnavailableException({ ...VERIFICA_AZIENDA_NON_DISPONIBILE })
        }
        if (richiesti.some(k => (esito.attivi as readonly string[]).includes(k)))
          return next.handle()
        if (modalitaModuli() === 'registra') {
          this.logger.warn(
            `Modulo non attivo (solo registrato): ${req.method} ${req.path}, ` +
              `azienda=${tenantId}, utente=${user.id}, richiesti=${richiesti.join('|')}`
          )
          return next.handle()
        }
        throw this.rifiuta(richiesti)
      })
    )
  }

  private rifiuta(richiesti: readonly string[]): ForbiddenException {
    return new ForbiddenException(rispostaModuloNonAttivo(richiesti))
  }

  /**
   * Chiavi richieste dalla rotta, o null se non ne richiede. Il metodo prevale sulla classe;
   * a pari livello `@RichiedeModulo` prevale su `@SenzaModulo` (i due non vanno mai insieme).
   */
  private chiaviRichieste(context: ExecutionContext): readonly string[] | null {
    for (const bersaglio of [context.getHandler(), context.getClass()]) {
      const chiavi = this.reflector.get<string[] | undefined>(RICHIEDE_MODULO, bersaglio)
      if (chiavi && chiavi.length > 0) return chiavi
      if (this.reflector.get<string | undefined>(SENZA_MODULO, bersaglio) !== undefined) {
        return null
      }
    }
    return null
  }
}

import { ThrottlerException } from '@nestjs/throttler'
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import {
  RisoluzioneAgenteService,
  type AgenteRisolto,
} from '../../application/pese/agenti/risoluzione-agente.service'
import { hashSegreto, tokenBenFormato } from '../../domain/pese/agenti/credenziali-agente'
import { modalitaModuli } from '../../core/interceptors/modulo-attivo.interceptor'
import { rispostaModuloNonAttivo } from '../../core/context/modulo-non-attivo-errore'
import { VERIFICA_AZIENDA_NON_DISPONIBILE } from '../../core/context/azienda-selezionata-errori'
import type { RichiestaConAgente } from './agente-richiesta'
import { agenteRevocato, tokenNonValido } from './errori-agente'
import { FallimentiAutenticazione } from './fallimenti-autenticazione'

const MODULO_PESE = 'pese'

/**
 * AgentePesaGuard: autentica le rotte dell'agente (SENZA utente) col token `Authorization: Bearer
 * wfpa_...` (D9). Risolve l'azienda dall'hash del token (client di sistema, un solo lookup), verifica
 * che il modulo `pese` sia attivo e mette `req.agentePesa = { id, tenantId }`.
 *
 * Non tocca `req.user` ne' `req.tenantId`, e ignora `X-Tenant-ID`: l'azienda viene SOLO dal token.
 * Il token non finisce mai nei log. Il modulo e' verificato qui perche' `ModuloAttivoInterceptor`
 * lascia passare le rotte senza utente.
 */
@Injectable()
export class AgentePesaGuard implements CanActivate {
  private readonly logger = new Logger(AgentePesaGuard.name)

  constructor(
    private readonly risoluzione: RisoluzioneAgenteService,
    private readonly moduli: ModuliAttiviService,
    @Optional()
    private readonly fallimenti: FallimentiAutenticazione = new FallimentiAutenticazione()
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RichiestaConAgente>()
    const ip = req.ip ?? 'ignoto'
    // Tetto d'ingresso (I1): solo i token rifiutati contano, per IP; l'IP che ha esaurito il tetto
    // non arriva nemmeno al database.
    const attesa = this.fallimenti.bloccatoPer(ip)
    if (attesa !== null) {
      context.switchToHttp().getResponse?.()?.header?.('Retry-After', attesa)
      throw new ThrottlerException()
    }
    const token = this.estraiToken(req.headers?.authorization)
    // Senza prefisso o lunghezza giusti non si interroga nemmeno il database.
    if (!token || !tokenBenFormato(token)) {
      this.fallimenti.registra(ip)
      throw tokenNonValido()
    }

    let agente: AgenteRisolto | null
    try {
      agente = await this.risoluzione.daToken(hashSegreto(token))
    } catch (err) {
      // Solo il tipo dell'errore: il messaggio del driver puo' riportare i parametri della query.
      this.logger.warn(`Risoluzione dell'agente fallita: ${(err as Error).name}`)
      throw new ServiceUnavailableException({ ...VERIFICA_AZIENDA_NON_DISPONIBILE })
    }
    if (!agente || agente.stato === 'IN_ATTESA') {
      this.fallimenti.registra(ip)
      throw tokenNonValido()
    }
    if (agente.stato === 'REVOCATO') throw agenteRevocato()

    await this.verificaModulo(agente)
    req.agentePesa = { id: agente.id, tenantId: agente.tenantId }
    return true
  }

  private async verificaModulo(agente: AgenteRisolto): Promise<void> {
    let attivi: readonly string[]
    try {
      attivi = await this.moduli.moduliAttivi(agente.tenantId)
    } catch (err) {
      this.logger.warn(
        `Verifica moduli fallita (azienda=${agente.tenantId}, agente=${agente.id}): ${(err as Error).name}`
      )
      throw new ServiceUnavailableException({ ...VERIFICA_AZIENDA_NON_DISPONIBILE })
    }
    if (attivi.includes(MODULO_PESE)) return
    if (modalitaModuli() === 'registra') {
      this.logger.warn(
        `Modulo non attivo (solo registrato): agente=${agente.id}, azienda=${agente.tenantId}, richiesti=${MODULO_PESE}`
      )
      return
    }
    throw new ForbiddenException(rispostaModuloNonAttivo([MODULO_PESE]))
  }

  private estraiToken(intestazione: string | undefined): string | null {
    if (typeof intestazione !== 'string') return null
    const m = /^Bearer[ \t]+(\S+)$/i.exec(intestazione.trim())
    return m ? m[1] : null
  }
}

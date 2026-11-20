/**
 * Collega un registro locale a un registro gia' aperto su RENTRI (eREGI E2, T1).
 *
 * Prima di salvare l'identificativo lo VERIFICA su RENTRI: esiste, appartiene alla sede del
 * registro locale, non e' chiuso. Poi passa da `ImpostazioniRentriRegistroService.imposta`, che
 * conserva le regole di F2-9 (nessun cambio con annotazioni gia' partite, unicita' per azienda,
 * audit). Solo ADMIN. L'inserimento a mano dell'identificativo (`PUT registri/:id`) resta.
 */
import { Injectable } from '@nestjs/common'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriAnagraficheClient } from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import { leggiContestoRegistroRentri, registroRentriChiuso } from './contesto-registro-rentri'
import { attivitaDaRentri } from './attivita-registro-rentri'
import {
  IdentificativoRegistroNonValidoError,
  RegistroRentriNonCollegabileError,
  RegistroRentriNonTrovatoError,
  richiediAmministratore,
} from './errori-azioni-rentri-registro'
import {
  ImpostazioniRentriRegistroService,
  type ImpostazioniRegistro,
} from './impostazioni-rentri-registro.service'

const FORMATO_IDENTIFICATIVO_REGISTRO = /^R[0-9A-Z]{10}$/

@Injectable()
export class CollegaRegistroRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RentriAnagraficheClient,
    private readonly impostazioni: ImpostazioniRentriRegistroService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('CollegaRegistroRentriUseCase')
  }

  /**
   * @throws RuoloNonAutorizzatoRentriError 403 se non ADMIN
   * @throws IdentificativoRegistroNonValidoError 400 formato errato
   * @throws RegistroRentriNonTrovatoError 400 l'identificativo non esiste su RENTRI
   * @throws RegistroRentriNonCollegabileError 409 altra sede, chiuso
   * @throws RegistroSenzaSedeRentriError / OperatoreRentriNonConfiguratoError 409
   * @throws TrasmissioneNonModificabileError / IdentificativoGiaUsatoError 409 (regole F2-9)
   */
  async esegui(
    tenantId: string,
    utenteId: string,
    ruolo: string,
    registroId: string,
    identificativoGrezzo: string
  ): Promise<ImpostazioniRegistro> {
    richiediAmministratore(ruolo)
    const identificativo = (identificativoGrezzo ?? '').trim().toUpperCase()
    if (!FORMATO_IDENTIFICATIVO_REGISTRO.test(identificativo)) {
      throw new IdentificativoRegistroNonValidoError(
        "L'identificativo del registro RENTRI è la lettera R seguita da 10 lettere maiuscole o cifre."
      )
    }

    const contesto = await TenantContext.run(
      { tenantId },
      async () =>
        await this.prisma.$transaction(tx => leggiContestoRegistroRentri(tx, tenantId, registroId))
    )

    let dettaglio
    try {
      dettaglio = await this.client.dettaglioRegistro(identificativo, tenantId)
    } catch (errore) {
      if (errore instanceof RentriApiError && errore.status === 404) {
        throw new RegistroRentriNonTrovatoError()
      }
      throw errore
    }

    if (dettaglio.num_iscr_sito !== contesto.numIscrSito) {
      throw new RegistroRentriNonCollegabileError(
        "Questo registro RENTRI appartiene a un'altra unità locale: non si può collegare a questo registro."
      )
    }
    if (registroRentriChiuso(dettaglio)) {
      throw new RegistroRentriNonCollegabileError(
        'Questo registro RENTRI è chiuso: non si può collegare.'
      )
    }

    const esito = await this.impostazioni.imposta(tenantId, utenteId, ruolo, registroId, {
      identificativoRentri: identificativo,
      collegamento: {
        ...attivitaDaRentri(dettaglio.attivita, dettaglio.attivita_rec_smalt),
        sincronizzatoIl: new Date(),
        origine: 'COLLEGAMENTO',
      },
    })
    this.logger.info('Registro collegato a un registro RENTRI', { tenantId, registroId })
    return esito
  }
}

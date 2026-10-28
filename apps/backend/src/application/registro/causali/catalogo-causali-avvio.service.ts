import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { PrismaSistemaService } from '../../../infrastructure/persistence/prisma-sistema.service'

/** Messaggio unico: lo usano il log all'avvio e la voce dello stato del sistema. */
export const MESSAGGIO_CATALOGO_CAUSALI_VUOTO =
  "La tabella causali_registro e' vuota (database creato senza migration?). " +
  'Il MUD escluderebbe tutti i movimenti e ogni registrazione darebbe 400. ' +
  'Eseguire "prisma migrate deploy" e poi ops/db-ruoli.sh.'

/**
 * Controllo all'avvio del catalogo di sistema delle causali.
 *
 * Il catalogo e' GLOBALE (niente tenant_id, niente RLS), quindi si legge con il client di sistema
 * e il messaggio non contiene identificativi di azienda. Solo log: un catalogo vuoto non deve
 * impedire l'avvio (le altre funzioni dell'app restano utilizzabili), ma non deve nemmeno passare
 * inosservato.
 */
@Injectable()
export class CatalogoCausaliAvvioService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogoCausaliAvvioService.name)

  constructor(private readonly sistema: PrismaSistemaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.verifica()
  }

  /** Ritorna true se il catalogo ha almeno una riga. Non solleva mai. */
  async verifica(): Promise<boolean> {
    try {
      const righe = await this.sistema.causaleRegistro.count()
      if (righe === 0) {
        this.logger.error(MESSAGGIO_CATALOGO_CAUSALI_VUOTO)
        return false
      }
      return true
    } catch (errore) {
      this.logger.error(
        `Impossibile leggere causali_registro all'avvio: ${(errore as Error).message}`
      )
      return false
    }
  }
}

/**
 * Foto dal campo (P5). L'autista scatta, il telefono comprime e calcola lo SHA-256; il server
 * ricalcola l'impronta sui byte ricevuti e rifiuta se non coincide, poi salva in `allegati_campo`
 * (append-only). La foto si aggancia a un evento GIA' registrato dallo stesso autista: il fatto
 * viene prima, le foto lo documentano.
 *
 * Concorrenza: un lock advisory sull'evento serializza gli invii della stessa foto (reinvii) e il
 * conteggio per il tetto di foto per evento. Niente di cio' che e' qui (byte, impronta) va nei log.
 */
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  impronta,
  MAX_FOTO_PER_EVENTO,
  validaFotoCampo,
  type FotoCampoInput,
} from './allegati-campo.input'
import {
  EventoCampoDiAltroUtenteError,
  EventoCampoNonTrovatoError,
  FotoCampoGiaUsataError,
  FotoCampoHashNonCorrispondenteError,
  FotoCampoLimiteEventoError,
  FotoCampoNonTrovataError,
} from './errori-campo'

/** Risposta al telefono: identica a ogni reinvio della stessa foto. */
export interface RispostaFotoCampo {
  id: string
  eventoId: string
  mimeType: string
  dimensioneByte: number
  sha256: string
  ricevutoIl: string
}

const eViolazioneUnicita = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

@Injectable()
export class AllegatiCampoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra la foto dell'autista collegato a `utenteId` per l'evento `eventoUuid` (l'uuid che il
   * telefono ha dato all'evento). 400/413/415/422 sui controlli del file e dell'impronta, 404 se
   * l'evento non e' dell'azienda, 409 se e' di un altro utente o se l'id foto e' gia' usato per
   * altro, 422 oltre il tetto di foto per evento.
   */
  async registra(
    tenantId: string,
    utenteId: string,
    eventoUuid: string,
    grezzo: Partial<FotoCampoInput>
  ): Promise<RispostaFotoCampo> {
    const foto = validaFotoCampo(grezzo)
    if (impronta(foto.contenuto) !== foto.sha256) throw new FotoCampoHashNonCorrispondenteError()
    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`allegati_campo:${tenantId}:${eventoUuid}`}, 0))`
          const evento = await tx.eventoCampo.findUnique({
            where: { tenantId_eventoUuid: { tenantId, eventoUuid } },
            select: { id: true, utenteId: true },
          })
          if (!evento) throw new EventoCampoNonTrovatoError()
          if (evento.utenteId !== utenteId) throw new EventoCampoDiAltroUtenteError()

          const esistente = await tx.allegatoCampo.findUnique({
            where: { tenantId_fotoUuid: { tenantId, fotoUuid: foto.id } },
            select: {
              fotoUuid: true,
              eventoId: true,
              utenteId: true,
              mimeType: true,
              dimensioneByte: true,
              sha256: true,
              ricevutoIl: true,
            },
          })
          if (esistente) {
            if (
              esistente.eventoId !== evento.id ||
              esistente.utenteId !== utenteId ||
              esistente.sha256 !== foto.sha256
            ) {
              throw new FotoCampoGiaUsataError()
            }
            return this.risposta(esistente, eventoUuid)
          }

          const presenti = await tx.allegatoCampo.count({
            where: { tenantId, eventoId: evento.id },
          })
          if (presenti >= MAX_FOTO_PER_EVENTO) {
            throw new FotoCampoLimiteEventoError(MAX_FOTO_PER_EVENTO)
          }
          const riga = await tx.allegatoCampo.create({
            data: {
              tenantId,
              fotoUuid: foto.id,
              eventoId: evento.id,
              utenteId,
              mimeType: foto.mimeType,
              dimensioneByte: foto.contenuto.length,
              sha256: foto.sha256,
              contenuto: foto.contenuto,
            },
            select: {
              fotoUuid: true,
              mimeType: true,
              dimensioneByte: true,
              sha256: true,
              ricevutoIl: true,
            },
          })
          return this.risposta(riga, eventoUuid)
        })
      } catch (err) {
        // Con il lock non dovrebbe succedere; se capita l'altra transazione ha gia' scritto.
        if (eViolazioneUnicita(err)) throw new FotoCampoGiaUsataError()
        throw err
      }
    })
  }

  /** Foto di un'azienda per l'ufficio: 404 se non c'e' o e' di un'altra azienda. */
  async leggi(tenantId: string, fotoUuid: string) {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.allegatoCampo.findUnique({
        where: { tenantId_fotoUuid: { tenantId, fotoUuid: fotoUuid.toLowerCase() } },
        select: { mimeType: true, sha256: true, contenuto: true },
      })
      if (!riga) throw new FotoCampoNonTrovataError()
      return {
        mimeType: riga.mimeType,
        sha256: riga.sha256,
        contenuto: Buffer.from(riga.contenuto),
      }
    })
  }

  private risposta(
    riga: {
      fotoUuid: string
      mimeType: string
      dimensioneByte: number
      sha256: string
      ricevutoIl: Date
    },
    eventoUuid: string
  ): RispostaFotoCampo {
    return {
      id: riga.fotoUuid,
      eventoId: eventoUuid,
      mimeType: riga.mimeType,
      dimensioneByte: riga.dimensioneByte,
      sha256: riga.sha256,
      ricevutoIl: riga.ricevutoIl.toISOString(),
    }
  }
}

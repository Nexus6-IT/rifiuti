// Allegati delle pesate (foto dello scontrino, PDF): nel database (Q3), con impronta SHA-256.
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { DIMENSIONE_MASSIMA_ALLEGATO, riconosciTipoFile } from '../../domain/pese/allegato-pesa'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { AllegatoNonTrovatoError, AllegatoNonValidoError } from './errori-pese'
import type { FileCaricato } from './accessi-pesa.tipi'
import { nelContestoTenant } from './nel-contesto-tenant'

export interface AllegatoSalvato {
  id: string
  nomeFile: string
  mimeType: string
  dimensioneByte: number
  sha256: string
}

export const MESSAGGIO_TIPO_ALLEGATO = 'Sono ammessi solo foto JPEG o PNG e documenti PDF.'
export const MESSAGGIO_DIMENSIONE_ALLEGATO = "L'allegato supera i 4 MB."

/** Nome per la visualizzazione: senza percorso né caratteri di controllo, al massimo 255. */
function nomePulito(nome: string): string {
  const base = (nome ?? '').split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const senzaControlli = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (senzaControlli || 'allegato').slice(0, 255)
}

@Injectable()
export class AllegatiPesaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Salva l'allegato dentro la transazione del chiamante. Il tipo lo decidono i magic bytes,
   * non quello dichiarato dal client.
   */
  async salva(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    file: FileCaricato
  ): Promise<AllegatoSalvato> {
    const contenuto = file.contenuto
    if (!contenuto || contenuto.length === 0) {
      throw new AllegatoNonValidoError("L'allegato è vuoto.")
    }
    if (contenuto.length > DIMENSIONE_MASSIMA_ALLEGATO) {
      throw new AllegatoNonValidoError(MESSAGGIO_DIMENSIONE_ALLEGATO)
    }
    const mimeType = riconosciTipoFile(contenuto)
    if (!mimeType) throw new AllegatoNonValidoError(MESSAGGIO_TIPO_ALLEGATO)
    const sha256 = createHash('sha256').update(contenuto).digest('hex')
    const riga = await tx.allegatoPesa.create({
      data: {
        tenantId,
        nomeFile: nomePulito(file.nomeFile),
        mimeType,
        dimensioneByte: contenuto.length,
        sha256,
        contenuto,
        caricatoDa: utenteId,
      },
    })
    return {
      id: riga.id,
      nomeFile: riga.nomeFile,
      mimeType: riga.mimeType,
      dimensioneByte: riga.dimensioneByte,
      sha256: riga.sha256,
    }
  }

  /** Legge un allegato dell'azienda (404 se non c'è o è di un'altra azienda). */
  async leggi(tenantId: string, id: string) {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.allegatoPesa.findFirst({ where: { id, tenantId } })
      if (!riga) throw new AllegatoNonTrovatoError()
      return {
        nomeFile: riga.nomeFile,
        mimeType: riga.mimeType,
        sha256: riga.sha256,
        contenuto: Buffer.from(riga.contenuto),
      }
    })
  }
}

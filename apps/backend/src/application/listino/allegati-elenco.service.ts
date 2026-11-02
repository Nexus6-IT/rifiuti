// Allegati PDF dell'elenco degli addebiti (4.2b, Task 25, E4, R47): al massimo due per elenco
// (posizione 1 e 2), conservati nel database come quelli del contratto (4.1b, D29) e con le stesse
// regole: il tipo lo decidono i magic bytes (solo PDF), 4 MiB al massimo, nome ripulito, audit
// senza il nome del file. Si importano senza modificarli `nomePulito`, i messaggi della posizione
// e della dimensione e il tipo della vista della 4.1b.
//
// ECCEZIONE DICHIARATA A D16 (R47): come per il contratto (4.1 D29) gli allegati si caricano e si
// tolgono anche quando il contratto e' ANNULLATO; qui il contratto non e' mai bloccato per stato.
// Un contratto o un elenco di un'altra azienda, o di un contratto eliminato, risponde 404.
//
// Lock (R40): contratto FOR SHARE -> elenco FOR SHARE. Serializzano la scrittura con
// l'eliminazione dell'elenco o del contratto (che prendono FOR UPDATE sull'elenco) senza bloccare
// altri allegati; due caricamenti nella stessa posizione li ferma la chiave unica (409). Il lock
// consultivo per contratto non serve: non si assegnano codici e il predefinito non cambia. La
// `versione` dell'elenco NON sale: gli allegati non sono un campo dell'elenco e il FE li ricarica
// a parte (la `versione` protegge solo la modifica dei dati dell'elenco).
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { DIMENSIONE_MASSIMA_ALLEGATO, riconosciTipoFile } from '../../domain/pese/allegato-pesa'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  MESSAGGIO_DIMENSIONE_ALLEGATO_CONTRATTO,
  MESSAGGIO_POSIZIONE_ALLEGATO,
  nomePulito,
  type AllegatoContrattoVista,
  type FileAllegatoContratto,
} from '../contratti-cliente/allegati-contratto-cliente.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'

export type AllegatoElencoVista = AllegatoContrattoVista
export type FileAllegatoElenco = FileAllegatoContratto

export const MESSAGGIO_TIPO_ALLEGATO_ELENCO = "L'allegato dell'elenco deve essere un PDF."

const NON_TROVATO = 'Elenco o allegato non trovato.'

function comeVista(r: {
  id: string
  posizione: number
  nomeFile: string
  dimensioneByte: number
  createdAt: Date
}): AllegatoElencoVista {
  return {
    id: r.id,
    posizione: r.posizione as 1 | 2,
    nomeFile: r.nomeFile,
    dimensioneByte: r.dimensioneByte,
    caricatoIl: r.createdAt.toISOString(),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const elencoNonTrovato = () =>
  new NotFoundException({ message: NON_TROVATO, error: 'ELENCO_ADDEBITI_NON_TROVATO' })

@Injectable()
export class AllegatiElencoService {
  constructor(private readonly prisma: PrismaService) {}

  /** L'elenco esiste nell'azienda e il suo contratto non e' eliminato (anche se annullato), o 404. */
  private async elencoEsistente(
    tx: Prisma.TransactionClient,
    tenantId: string,
    elencoId: string
  ): Promise<void> {
    const e = await tx.elencoAddebiti.findFirst({
      where: { id: elencoId, tenantId, contratto: { eliminatoIl: null } },
      select: { id: true },
    })
    if (!e) throw elencoNonTrovato()
  }

  /** Come `elencoEsistente`, con contratto ed elenco bloccati FOR SHARE (nell'ordine di R40). */
  private async bloccaElenco(
    tx: Prisma.TransactionClient,
    tenantId: string,
    elencoId: string
  ): Promise<void> {
    const noto = await tx.elencoAddebiti.findFirst({
      where: { id: elencoId, tenantId, contratto: { eliminatoIl: null } },
      select: { contrattoId: true },
    })
    if (!noto) throw elencoNonTrovato()
    const contratti = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "contratti_cliente"
      WHERE tenant_id = ${tenantId}::uuid AND id = ${noto.contrattoId}::uuid
        AND eliminato_il IS NULL
      FOR SHARE`
    if (contratti.length === 0) throw elencoNonTrovato()
    const elenchi = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "elenchi_addebiti"
      WHERE tenant_id = ${tenantId}::uuid AND id = ${elencoId}::uuid
      FOR SHARE`
    if (elenchi.length === 0) throw elencoNonTrovato()
  }

  async elenco(tenantId: string, elencoId: string): Promise<AllegatoElencoVista[]> {
    if (!UUID.test(elencoId)) throw elencoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        await this.elencoEsistente(tx, tenantId, elencoId)
        const righe = await tx.allegatoElencoAddebiti.findMany({
          where: { elencoId, tenantId },
          select: {
            id: true,
            posizione: true,
            nomeFile: true,
            dimensioneByte: true,
            createdAt: true,
          },
          orderBy: { posizione: 'asc' },
        })
        return righe.map(comeVista)
      })
    )
  }

  async carica(
    tenantId: string,
    utenteId: string,
    elencoId: string,
    posizione: 1 | 2,
    file: FileAllegatoElenco
  ): Promise<AllegatoElencoVista> {
    // Validazione pura prima di ogni lettura del database.
    if (posizione !== 1 && posizione !== 2) {
      throw new BadRequestException(MESSAGGIO_POSIZIONE_ALLEGATO)
    }
    const contenuto = file.buffer
    if (contenuto.length > DIMENSIONE_MASSIMA_ALLEGATO) {
      throw new PayloadTooLargeException(MESSAGGIO_DIMENSIONE_ALLEGATO_CONTRATTO)
    }
    if (riconosciTipoFile(contenuto) !== 'application/pdf') {
      throw new UnsupportedMediaTypeException(MESSAGGIO_TIPO_ALLEGATO_ELENCO)
    }
    if (!UUID.test(elencoId)) throw elencoNonTrovato()
    const sha256 = createHash('sha256').update(contenuto).digest('hex')

    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await this.bloccaElenco(tx, tenantId, elencoId)
          const riga = await tx.allegatoElencoAddebiti.create({
            data: {
              tenantId,
              elencoId,
              posizione,
              nomeFile: nomePulito(file.originalname),
              mimeType: 'application/pdf',
              dimensioneByte: contenuto.length,
              sha256,
              contenuto,
              caricatoDa: utenteId,
            },
          })
          // Niente nome del file: puo' contenere dati del cliente (D16).
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'ALLEGATO_ELENCO_ADDEBITI_CARICATO',
              description: "Allegato dell'elenco degli addebiti caricato",
              metadata: {
                elencoId,
                posizione,
                dimensioneByte: contenuto.length,
              } as Prisma.InputJsonValue,
            },
          })
          return comeVista(riga)
        })
        .catch(err => {
          // L'unico vincolo univoco "di business" della tabella e' (elenco, posizione).
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new ConflictException({
              error: 'ALLEGATO_POSIZIONE_OCCUPATA',
              message: 'La posizione è già occupata: rimuovi prima l’allegato esistente.',
            })
          }
          throw err
        })
    )
  }

  async contenuto(
    tenantId: string,
    elencoId: string,
    allegatoId: string
  ): Promise<{ nomeFile: string; contenuto: Buffer }> {
    if (!UUID.test(elencoId) || !UUID.test(allegatoId)) throw elencoNonTrovato()
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        await this.elencoEsistente(tx, tenantId, elencoId)
        const riga = await tx.allegatoElencoAddebiti.findFirst({
          where: { id: allegatoId, elencoId, tenantId },
          select: { nomeFile: true, contenuto: true },
        })
        if (!riga) throw elencoNonTrovato()
        return { nomeFile: riga.nomeFile, contenuto: Buffer.from(riga.contenuto) }
      })
    )
  }

  async rimuovi(
    tenantId: string,
    utenteId: string,
    elencoId: string,
    allegatoId: string
  ): Promise<void> {
    if (!UUID.test(elencoId) || !UUID.test(allegatoId)) throw elencoNonTrovato()
    await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        await this.bloccaElenco(tx, tenantId, elencoId)
        const riga = await tx.allegatoElencoAddebiti.findFirst({
          where: { id: allegatoId, elencoId, tenantId },
          select: { posizione: true },
        })
        if (!riga) throw elencoNonTrovato()
        const { count } = await tx.allegatoElencoAddebiti.deleteMany({
          where: { id: allegatoId, elencoId, tenantId },
        })
        if (count === 0) throw elencoNonTrovato()
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: utenteId,
            action: 'ALLEGATO_ELENCO_ADDEBITI_RIMOSSO',
            description: "Allegato dell'elenco degli addebiti rimosso",
            metadata: { elencoId, posizione: riga.posizione } as Prisma.InputJsonValue,
          },
        })
      })
    )
  }
}

// Allegati PDF del contratto cliente (4.1b, Task 19, D29): al massimo due per contratto
// (posizione 1 e 2, i due file di WinWaste), conservati nel database come gli allegati delle pese.
// Il tipo lo decidono i magic bytes (mai il nome o il tipo dichiarato dal client) e qui e' ammesso
// solo il PDF. Il contratto lo legge il servizio da se' (R28): deve essere dell'azienda e non
// eliminato; un contratto annullato accetta allegati. L'audit non porta mai il nome del file.
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
import { nelContestoTenant } from '../pese/nel-contesto-tenant'

export interface AllegatoContrattoVista {
  id: string
  posizione: 1 | 2
  nomeFile: string
  dimensioneByte: number
  caricatoIl: string
}

export interface FileAllegatoContratto {
  originalname: string
  size: number
  buffer: Buffer
}

export const MESSAGGIO_POSIZIONE_ALLEGATO = "La posizione dell'allegato è 1 o 2."
export const MESSAGGIO_TIPO_ALLEGATO_CONTRATTO = "L'allegato del contratto deve essere un PDF."
export const MESSAGGIO_DIMENSIONE_ALLEGATO_CONTRATTO = "L'allegato supera i 4 MB."

const NON_TROVATO = 'Contratto o allegato non trovato.'

/** Nome per la visualizzazione: senza percorso né caratteri di controllo, al massimo 255. */
export function nomePulito(nome: string): string {
  const base = (nome ?? '').split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const senzaControlli = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return Array.from(senzaControlli || 'allegato')
    .slice(0, 255)
    .join('')
}

function comeVista(r: {
  id: string
  posizione: number
  nomeFile: string
  dimensioneByte: number
  createdAt: Date
}): AllegatoContrattoVista {
  return {
    id: r.id,
    posizione: r.posizione as 1 | 2,
    nomeFile: r.nomeFile,
    dimensioneByte: r.dimensioneByte,
    caricatoIl: r.createdAt.toISOString(),
  }
}

@Injectable()
export class AllegatiContrattoClienteService {
  constructor(private readonly prisma: PrismaService) {}

  /** Contratto dell'azienda non eliminato (anche annullato), o 404. */
  private async contrattoEsistente(
    tx: Prisma.TransactionClient,
    tenantId: string,
    contrattoId: string
  ): Promise<void> {
    const c = await tx.contrattoCliente.findFirst({
      where: { id: contrattoId, tenantId, eliminatoIl: null },
      select: { id: true },
    })
    if (!c) throw new NotFoundException(NON_TROVATO)
  }

  async elenco(tenantId: string, contrattoId: string): Promise<AllegatoContrattoVista[]> {
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        await this.contrattoEsistente(tx, tenantId, contrattoId)
        const righe = await tx.allegatoContrattoCliente.findMany({
          where: { contrattoId, tenantId },
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
    contrattoId: string,
    posizione: 1 | 2,
    file: FileAllegatoContratto
  ): Promise<AllegatoContrattoVista> {
    // Validazione pura prima di ogni lettura del database.
    if (posizione !== 1 && posizione !== 2) {
      throw new BadRequestException(MESSAGGIO_POSIZIONE_ALLEGATO)
    }
    const contenuto = file.buffer
    if (contenuto.length > DIMENSIONE_MASSIMA_ALLEGATO) {
      throw new PayloadTooLargeException(MESSAGGIO_DIMENSIONE_ALLEGATO_CONTRATTO)
    }
    if (riconosciTipoFile(contenuto) !== 'application/pdf') {
      throw new UnsupportedMediaTypeException(MESSAGGIO_TIPO_ALLEGATO_CONTRATTO)
    }
    const sha256 = createHash('sha256').update(contenuto).digest('hex')

    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await this.contrattoEsistente(tx, tenantId, contrattoId)
          const riga = await tx.allegatoContrattoCliente.create({
            data: {
              tenantId,
              contrattoId,
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
              action: 'ALLEGATO_CONTRATTO_CLIENTE_CARICATO',
              description: 'Allegato del contratto cliente caricato',
              metadata: {
                contrattoId,
                posizione,
                dimensioneByte: contenuto.length,
              } as Prisma.InputJsonValue,
            },
          })
          return comeVista(riga)
        })
        .catch(err => {
          // L'unico vincolo univoco "di business" della tabella e' (contratto, posizione).
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
    contrattoId: string,
    allegatoId: string
  ): Promise<{ nomeFile: string; contenuto: Buffer }> {
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        await this.contrattoEsistente(tx, tenantId, contrattoId)
        const riga = await tx.allegatoContrattoCliente.findFirst({
          where: { id: allegatoId, contrattoId, tenantId },
          select: { nomeFile: true, contenuto: true },
        })
        if (!riga) throw new NotFoundException(NON_TROVATO)
        return { nomeFile: riga.nomeFile, contenuto: Buffer.from(riga.contenuto) }
      })
    )
  }

  async rimuovi(
    tenantId: string,
    utenteId: string,
    contrattoId: string,
    allegatoId: string
  ): Promise<void> {
    await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        await this.contrattoEsistente(tx, tenantId, contrattoId)
        const riga = await tx.allegatoContrattoCliente.findFirst({
          where: { id: allegatoId, contrattoId, tenantId },
          select: { posizione: true },
        })
        if (!riga) throw new NotFoundException(NON_TROVATO)
        const { count } = await tx.allegatoContrattoCliente.deleteMany({
          where: { id: allegatoId, contrattoId, tenantId },
        })
        if (count === 0) throw new NotFoundException(NON_TROVATO)
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: utenteId,
            action: 'ALLEGATO_CONTRATTO_CLIENTE_RIMOSSO',
            description: 'Allegato del contratto cliente rimosso',
            metadata: { contrattoId, posizione: riga.posizione } as Prisma.InputJsonValue,
          },
        })
      })
    )
  }
}

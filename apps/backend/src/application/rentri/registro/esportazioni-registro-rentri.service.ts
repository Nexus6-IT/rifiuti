/**
 * Lettura delle esportazioni XML del registro (eREGI E6): elenco per il pannello e download del file.
 * Solo database, nessuna chiamata a RENTRI. L'elenco NON porta l'XML (puo' pesare qualche MB).
 */
import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { gunzipSync } from 'zlib'
import { TenantContext } from '../../../core/context/tenant-context'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RegistroNonTrovatoError } from '../../registro/registri.service'
import { EsportazioneNonTrovataError } from './errori-esportazioni-registro-rentri'
import { ordinaCatena } from './ordina-catena-esportazioni'
import {
  nomeFileEsportazione,
  type MessaggioSalvato,
} from './valida-esportazione-registro-rentri.use-case'

type Tx = Prisma.TransactionClient

export interface VoceElencoEsportazione {
  id: string
  anno: number
  progressivoDa: number
  progressivoA: number
  numeroRegistrazioni: number
  dataCreazione: string
  stato: string
  firmato: boolean
  /** Primi 12 caratteri del digest della firma, per riconoscere l'anello senza mostrare tutto. */
  digestAbbreviato: string | null
  precedenteId: string | null
  messaggi: MessaggioSalvato[]
  creataDa: string | null
}

export interface FileEsportazione {
  nomeFile: string
  xml: Buffer
}

@Injectable()
export class EsportazioniRegistroRentriService {
  constructor(private readonly prisma: PrismaService) {}

  private nelTenant<R>(tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn))
  }

  /** Catena viva dalla piu' recente alla piu' vecchia (come nel pannello), poi le sostituite. */
  async elenca(tenantId: string, registroId: string): Promise<VoceElencoEsportazione[]> {
    return this.nelTenant(tenantId, async tx => {
      const registro = await tx.registroRifiuti.findFirst({
        where: { id: registroId, tenantId },
        select: { id: true },
      })
      if (!registro) throw new RegistroNonTrovatoError()
      const righe = await tx.esportazioneRegistroRentri.findMany({
        where: { tenantId, registroId },
        select: {
          id: true,
          anno: true,
          progressivoDa: true,
          progressivoA: true,
          numeroRegistrazioni: true,
          dataCreazione: true,
          stato: true,
          firmato: true,
          digestValue: true,
          precedenteId: true,
          messaggi: true,
          creataDa: true,
          createdAt: true,
        },
      })
      // Catena viva dalla piu' recente; in coda le sostituite (audit), dalla piu' recente.
      const vive = righe.filter(r => r.stato !== 'SOSTITUITA')
      const sostituite = righe
        .filter(r => r.stato === 'SOSTITUITA')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return [...ordinaCatena(vive).reverse(), ...sostituite].map(r => ({
        id: r.id,
        anno: r.anno,
        progressivoDa: r.progressivoDa,
        progressivoA: r.progressivoA,
        numeroRegistrazioni: r.numeroRegistrazioni,
        dataCreazione: r.dataCreazione.toISOString(),
        stato: r.stato,
        firmato: r.firmato,
        digestAbbreviato: r.digestValue ? r.digestValue.slice(0, 12) : null,
        precedenteId: r.precedenteId,
        messaggi: Array.isArray(r.messaggi) ? (r.messaggi as unknown as MessaggioSalvato[]) : [],
        creataDa: r.creataDa,
      }))
    })
  }

  /** Il file firmato, decompresso, con il nome che usa WinWaste (`.SignedR.xml`). */
  async scarica(tenantId: string, esportazioneId: string): Promise<FileEsportazione> {
    const riga = await this.nelTenant(tenantId, tx =>
      tx.esportazioneRegistroRentri.findFirst({
        where: { id: esportazioneId, tenantId },
        select: {
          xml: true,
          progressivoDa: true,
          progressivoA: true,
          dataCreazione: true,
          registro: { select: { identificativoRentri: true } },
        },
      })
    )
    if (!riga) throw new EsportazioneNonTrovataError()
    return {
      nomeFile: nomeFileEsportazione(
        riga.registro.identificativoRentri ?? 'REGISTRO',
        riga.progressivoDa,
        riga.progressivoA,
        riga.dataCreazione
      ),
      xml: gunzipSync(Buffer.from(riga.xml)),
    }
  }
}

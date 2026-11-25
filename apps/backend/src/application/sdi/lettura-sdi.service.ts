// Lettura delle trasmissioni SDI di un documento con la cronologia delle notifiche (4.5c, piano §4.7-§4.8).
// Solo letture, nel contesto dell'azienda (RLS). Due query per qualsiasi numero di trasmissioni. I file delle
// ricevute NON stanno nella risposta (solo `haFile`): si scaricano a parte.
import { Injectable, NotFoundException } from '@nestjs/common'
import { avvisiScarto } from '../../domain/fatturazione/sdi/avvisi'
import { descrizioneErroreSdi } from '../../domain/fatturazione/sdi/codici-errore'
import {
  type AvvisoTrasmissioneSdi,
  type EsitoCommittente,
  type EsitoFiscale,
  type FonteNotificaSdi,
  type StatoTrasmissioneSdi,
  type TipoNotificaSdi,
} from '../../domain/fatturazione/sdi/codici'
import { esitoFiscale, statoDaNotifiche } from '../../domain/fatturazione/sdi/stato'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'

export interface NotificaSdiVista {
  id: string
  tipo: TipoNotificaSdi
  esitoCommittente: EsitoCommittente | null
  codiciErrore: { codice: string; descrizione: string }[]
  dataRicezioneSdi: string | null
  ricevutaIl: string
  fonte: FonteNotificaSdi
  haFile: boolean
}

export interface TrasmissioneSdiVista {
  id: string
  stato: StatoTrasmissioneSdi
  esitoFiscale: EsitoFiscale
  provider: string
  ambiente: string
  nomeFile: string
  creataIl: string
  inviataIl: string | null
  chiusaIl: string | null
  tentativi: number
  ultimoErroreCodice: string | null
  ultimoErroreMessaggio: string | null
  avvisi: AvvisoTrasmissioneSdi[]
  notifiche: NotificaSdiVista[]
}

export interface RicevutaSdiScaricabile {
  nomeFile: string
  contenuto: Buffer
}

interface RigaTrasmissione {
  id: string
  stato: StatoTrasmissioneSdi
  provider: string
  ambiente: string
  nome_file: string
  created_at: Date
  inviata_il: Date | null
  chiusa_il: Date | null
  tentativi: number
  ultimo_errore_codice: string | null
  ultimo_errore_messaggio: string | null
}

interface RigaNotifica {
  id: string
  trasmissione_id: string
  tipo: TipoNotificaSdi
  esito_committente: EsitoCommittente | null
  codici_errore: string[]
  data_ricezione_sdi: Date | null
  ricevuta_il: Date
  fonte: FonteNotificaSdi
  ha_file: boolean
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

@Injectable()
export class LetturaSdiService {
  constructor(private readonly prisma: PrismaService) {}

  /** Trasmissioni del documento, la piu' recente per prima, ciascuna con le notifiche in ordine di arrivo. */
  async delDocumento(
    tenantId: string,
    documentoId: string
  ): Promise<{ trasmissioni: TrasmissioneSdiVista[] }> {
    return nelContestoTenant(tenantId, async () => {
      const documento = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM "documenti_fattura"
        WHERE id = ${documentoId}::uuid AND tenant_id = ${tenantId}::uuid`
      if (documento.length === 0) {
        throw new NotFoundException({
          error: 'DOCUMENTO_NON_TROVATO',
          message: 'Documento non trovato.',
        })
      }
      const trasmissioni = await this.prisma.$queryRaw<RigaTrasmissione[]>`
        SELECT id::text AS id, stato::text AS stato, provider, ambiente, nome_file, created_at,
               inviata_il, chiusa_il, tentativi::int AS tentativi, ultimo_errore_codice,
               ultimo_errore_messaggio
        FROM "trasmissioni_sdi"
        WHERE documento_id = ${documentoId}::uuid AND tenant_id = ${tenantId}::uuid
        ORDER BY created_at DESC, id DESC`
      if (trasmissioni.length === 0) return { trasmissioni: [] }
      const notifiche = await this.prisma.$queryRaw<RigaNotifica[]>`
        SELECT n.id::text AS id, n.trasmissione_id::text AS trasmissione_id, n.tipo, n.esito_committente,
               n.codici_errore, n.data_ricezione_sdi, n.ricevuta_il, n.fonte, (n.file IS NOT NULL) AS ha_file
        FROM "notifiche_sdi" n
        JOIN "trasmissioni_sdi" t ON t.id = n.trasmissione_id AND t.tenant_id = n.tenant_id
        WHERE t.documento_id = ${documentoId}::uuid AND n.tenant_id = ${tenantId}::uuid
        ORDER BY n.data_ricezione_sdi NULLS LAST, n.ricevuta_il, n.id`
      return {
        trasmissioni: trasmissioni.map(t =>
          vista(
            t,
            notifiche.filter(n => n.trasmissione_id === t.id)
          )
        ),
      }
    })
  }

  /** XML di una ricevuta, solo se la notifica appartiene a una trasmissione del documento. */
  async fileRicevuta(
    tenantId: string,
    documentoId: string,
    notificaId: string
  ): Promise<RicevutaSdiScaricabile> {
    const righe = await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$queryRaw<{ file: Uint8Array | null; nome_file: string; tipo: string }[]>`
        SELECT n.file, t.nome_file, n.tipo
        FROM "notifiche_sdi" n
        JOIN "trasmissioni_sdi" t ON t.id = n.trasmissione_id AND t.tenant_id = n.tenant_id
        WHERE n.id = ${notificaId}::uuid AND t.documento_id = ${documentoId}::uuid
          AND n.tenant_id = ${tenantId}::uuid`
    )
    const r = righe[0]
    if (!r || !r.file) {
      throw new NotFoundException({
        error: 'RICEVUTA_NON_TROVATA',
        message: 'Ricevuta non trovata o senza file.',
      })
    }
    return {
      nomeFile: `${r.nome_file.replace(/\.[^.]+$/, '')}_${r.tipo}.xml`,
      contenuto: Buffer.from(r.file),
    }
  }
}

function vista(t: RigaTrasmissione, notifiche: RigaNotifica[]): TrasmissioneSdiVista {
  const calcolato = statoDaNotifiche(
    t.stato,
    notifiche.map(n => ({ tipo: n.tipo, esitoCommittente: n.esito_committente }))
  )
  const avvisi = [...calcolato.avvisi]
  // Lo stato SALVATO non regredisce (un NS dopo una consegna non marca lo scarto): l'avviso si vede lo stesso.
  for (const n of notifiche.filter(x => x.tipo === 'NS')) {
    for (const a of avvisiScarto(n.codici_errore)) if (!avvisi.includes(a)) avvisi.push(a)
  }
  return {
    id: t.id,
    stato: t.stato,
    esitoFiscale: esitoFiscale(t.stato),
    provider: t.provider,
    ambiente: t.ambiente,
    nomeFile: t.nome_file,
    creataIl: t.created_at.toISOString(),
    inviataIl: iso(t.inviata_il),
    chiusaIl: iso(t.chiusa_il),
    tentativi: t.tentativi,
    ultimoErroreCodice: t.ultimo_errore_codice,
    ultimoErroreMessaggio: t.ultimo_errore_messaggio,
    avvisi,
    notifiche: notifiche.map(n => ({
      id: n.id,
      tipo: n.tipo,
      esitoCommittente: n.esito_committente,
      codiciErrore: n.codici_errore.map(codice => ({
        codice,
        descrizione: descrizioneErroreSdi(codice),
      })),
      dataRicezioneSdi: iso(n.data_ricezione_sdi),
      ricevutaIl: n.ricevuta_il.toISOString(),
      fonte: n.fonte,
      haFile: n.ha_file,
    })),
  }
}

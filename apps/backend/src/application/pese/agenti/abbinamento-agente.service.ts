import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  chiavePubblicaDaBase64,
  generaToken,
  hashSegreto,
  improntaChiave,
  normalizzaCodice,
} from '../../../domain/pese/agenti/credenziali-agente'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import {
  AgentePesaNonTrovatoError,
  CodiceAbbinamentoNonValidoError,
  DatiPesaNonValidiError,
} from '../errori-pese'
import { nelContestoTenant } from '../nel-contesto-tenant'
import { RisoluzioneAgenteService } from './risoluzione-agente.service'

export interface DatiAbbinamento {
  codice: string
  /** base64 standard dei 32 byte Ed25519 */
  chiavePubblica: string
  nomeHost: string
  versione: string
}

export interface StrumentoAssegnato {
  id: string
  descrizione: string
  matricola: string | null
}

export interface RispostaAbbinamento {
  agenteId: string
  /** mostrato UNA volta: nel database resta solo lo SHA-256 */
  token: string
  azienda: { ragioneSociale: string }
  strumenti: StrumentoAssegnato[]
  simulazioneAmmessa: boolean
}

export interface RispostaConfigurazione {
  agenteId: string
  azienda: { ragioneSociale: string }
  strumenti: StrumentoAssegnato[]
  simulazioneAmmessa: boolean
  intervalloBattitoS: number
  lottoMassimo: number
  /** ISO 8601 UTC */
  oraServer: string
}

export const INTERVALLO_BATTITO_S = 60
export const LOTTO_MASSIMO = 50

const nonEmpty = (s: string | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

/**
 * Abbinamento di un agente di pesa (D5, D8, D9): scambia il codice monouso con il token.
 *
 * L'azienda e' ignota fino al codice: `RisoluzioneAgenteService.daCodice` (ruolo di sistema) trova
 * l'agente, poi lo scambio avviene nel contesto dell'azienda con un `updateMany` condizionato
 * (`id`, `stato = IN_ATTESA`, hash del codice, scadenza futura): conteggio 1 = abbinato, 0 = codice
 * non valido. Due abbinamenti paralleli con lo stesso codice: ne vince uno solo.
 * Codice ignoto, scaduto, gia' usato o di un agente revocato: SEMPRE `CodiceAbbinamentoNonValidoError`.
 */
@Injectable()
export class AbbinamentoAgenteService {
  /** Orologio sostituibile nelle prove (scadenza del codice). */
  orologio: () => Date = () => new Date()

  constructor(
    private readonly prisma: PrismaService,
    private readonly risoluzione: RisoluzioneAgenteService
  ) {}

  async abbina(dati: DatiAbbinamento): Promise<RispostaAbbinamento> {
    // La forma della chiave si controlla PRIMA di consumare il codice: un 400 non brucia il codice.
    if (!chiavePubblicaDaBase64(dati.chiavePubblica)) {
      throw new DatiPesaNonValidiError(['La chiave pubblica non è valida (32 byte in base64).'])
    }
    const codice = normalizzaCodice(dati.codice)
    if (!codice) throw new CodiceAbbinamentoNonValidoError()
    const codiceSha256 = hashSegreto(codice)
    const trovato = await this.risoluzione.daCodice(codiceSha256)
    if (!trovato || trovato.stato !== 'IN_ATTESA') throw new CodiceAbbinamentoNonValidoError()

    const token = generaToken()
    const adesso = this.orologio()
    const nomeHost = nonEmpty(dati.nomeHost)?.slice(0, 100) ?? null
    const versione = nonEmpty(dati.versione)?.slice(0, 30) ?? null
    const impronta = improntaChiave(dati.chiavePubblica)

    return nelContestoTenant(trovato.tenantId, () =>
      this.prisma.$transaction(async tx => {
        const scambio = await tx.agentePesa.updateMany({
          where: {
            id: trovato.id,
            tenantId: trovato.tenantId,
            stato: 'IN_ATTESA',
            codiceSha256,
            codiceScadeIl: { gt: adesso },
          },
          data: {
            stato: 'ATTIVO',
            tokenSha256: hashSegreto(token),
            chiavePubblica: dati.chiavePubblica,
            improntaChiave: impronta,
            abbinatoIl: adesso,
            nomeHost,
            versioneAgente: versione,
            codiceSha256: null,
            codiceScadeIl: null,
          },
        })
        if (scambio.count !== 1) throw new CodiceAbbinamentoNonValidoError()
        await tx.activityLog.create({
          data: {
            tenantId: trovato.tenantId,
            userId: null,
            action: 'PESA_AGENTE_ABBINATO',
            description: 'Agente di pesa abbinato',
            metadata: {
              agenteId: trovato.id,
              nomeHost,
              improntaChiave: impronta,
              versione,
            } as Prisma.InputJsonValue,
          },
        })
        const base = await this.leggiBase(tx, trovato.tenantId, trovato.id)
        return { agenteId: trovato.id, token, ...base }
      })
    )
  }

  /** Configurazione per l'agente gia' autenticato dal token (solo strumenti assegnati e attivi). */
  async configurazione(agente: { id: string; tenantId: string }): Promise<RispostaConfigurazione> {
    return nelContestoTenant(agente.tenantId, () =>
      this.prisma.$transaction(async tx => {
        const base = await this.leggiBase(tx, agente.tenantId, agente.id)
        return {
          agenteId: agente.id,
          ...base,
          intervalloBattitoS: INTERVALLO_BATTITO_S,
          lottoMassimo: LOTTO_MASSIMO,
          oraServer: this.orologio().toISOString(),
        }
      })
    )
  }

  private async leggiBase(
    tx: Prisma.TransactionClient,
    tenantId: string,
    agenteId: string
  ): Promise<Pick<RispostaAbbinamento, 'azienda' | 'strumenti' | 'simulazioneAmmessa'>> {
    const [azienda, strumenti] = await Promise.all([
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { ragioneSociale: true, peseSimulazioneAmmessa: true },
      }),
      tx.strumentoPesa.findMany({
        where: { tenantId, agenteId, attivo: true },
        orderBy: { descrizione: 'asc' },
        select: { id: true, descrizione: true, matricola: true },
      }),
    ])
    if (!azienda) throw new AgentePesaNonTrovatoError()
    return {
      azienda: { ragioneSociale: azienda.ragioneSociale },
      strumenti,
      simulazioneAmmessa: azienda.peseSimulazioneAmmessa,
    }
  }
}

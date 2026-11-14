import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  MINUTI_VALIDITA_CODICE,
  formattaCodice,
  generaCodice,
  hashSegreto,
} from '../../../domain/pese/agenti/credenziali-agente'
import { agenteInLinea } from '../../../domain/pese/agenti/stato-agente'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RegistroNonTrovatoError } from '../../registro/registri.service'
import {
  AgentePesaNonTrovatoError,
  DatiPesaNonValidiError,
  RegolaPesataError,
  StatoAccessoNonValidoError,
  StrumentoNonTrovatoError,
} from '../errori-pese'
import { nelContestoTenant } from '../nel-contesto-tenant'
import { scriviAuditPese } from '../audit-pese'
import { BattitoAgenteService, type StatoStrumentoAgente } from './battito-agente.service'

export interface AgenteVista {
  id: string
  descrizione: string
  registro: { id: string; descrizione: string } | null
  stato: 'IN_ATTESA' | 'ATTIVO' | 'REVOCATO'
  abbinatoIl: string | null
  /** dato tecnico dell'azienda: solo per chi gestisce (N4) */
  nomeHost: string | null
  versioneAgente: string | null
  ultimoContattoIl: string | null
  inLinea: boolean
  scartoOrologioS: number | null
  codaInAttesa: number | null
  lettureScartate: number | null
  /** SHA-256 della chiave pubblica a gruppi di 4, per il riscontro a vista con l'agente */
  improntaChiave: string | null
  strumenti: {
    id: string
    descrizione: string
    stato: StatoStrumentoAgente | null
    ultimoErrore: string | null
  }[]
  codiceScadeIl: string | null
  revocatoIl: string | null
  motivoRevoca: string | null
  /** solo per chi gestisce (N4) */
  ultimoIp: string | null
}

export interface AgenteCreato {
  agente: AgenteVista
  /** `XXXX-XXXX-XXXX`, mostrato UNA volta: nel database resta solo l'hash */
  codice: string
  scadeIl: string
}

const gruppiDi4 = (hex: string) => (hex.toUpperCase().match(/.{1,4}/g) ?? []).join(' ')

type Riga = Prisma.AgentePesaGetPayload<{
  include: { registro: { select: { id: true; descrizione: true } }; strumenti: true }
}>

/**
 * Gestione degli agenti di pesa dell'azienda (D15): creazione col codice monouso, nuovo codice,
 * revoca, assegnazione degli strumenti. Il ruolo lo verifica il controller; l'azienda e' quella del
 * contesto. Nessun token, codice o chiave finisce in audit o nei log (D16).
 */
@Injectable()
export class AgentiPesaService {
  /** Sostituibile nei test. */
  protected adesso: () => Date = () => new Date()

  constructor(
    private readonly prisma: PrismaService,
    private readonly battito: BattitoAgenteService
  ) {}

  async elenca(tenantId: string, opzioni: { vediDatiTecnici: boolean }): Promise<AgenteVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.agentePesa.findMany({
        where: { tenantId },
        include: {
          registro: { select: { id: true, descrizione: true } },
          strumenti: { orderBy: { descrizione: 'asc' } },
        },
        orderBy: [{ createdAt: 'desc' }],
      })
      return righe.map(r => this.vista(r, opzioni.vediDatiTecnici))
    })
  }

  async crea(
    tenantId: string,
    utenteId: string,
    dati: { descrizione: string; registroId?: string | null }
  ): Promise<AgenteCreato> {
    const descrizione = dati.descrizione?.trim() ?? ''
    if (!descrizione) throw new DatiPesaNonValidiError(['La descrizione è obbligatoria.'])
    if (descrizione.length > 255) {
      throw new DatiPesaNonValidiError(['La descrizione può avere al massimo 255 caratteri.'])
    }
    const codice = generaCodice()
    const scadeIl = new Date(this.adesso().getTime() + MINUTI_VALIDITA_CODICE * 60_000)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        if (dati.registroId) {
          const registro = await tx.registroRifiuti.findFirst({
            where: { id: dati.registroId, tenantId },
            select: { id: true },
          })
          if (!registro) throw new RegistroNonTrovatoError()
        }
        const riga = await tx.agentePesa.create({
          data: {
            tenantId,
            registroId: dati.registroId ?? null,
            descrizione,
            codiceSha256: hashSegreto(codice),
            codiceScadeIl: scadeIl,
            creatoDa: utenteId,
          },
          include: {
            registro: { select: { id: true, descrizione: true } },
            strumenti: true,
          },
        })
        await scriviAuditPese(
          tx,
          tenantId,
          utenteId,
          'PESA_AGENTE_CREATO',
          'Agente di pesa creato',
          { agenteId: riga.id }
        )
        return {
          agente: this.vista(riga, true),
          codice: formattaCodice(codice),
          scadeIl: scadeIl.toISOString(),
        }
      })
    )
  }

  /** Nuovo codice: solo per un agente ancora IN_ATTESA (il precedente smette di valere). */
  async nuovoCodice(
    tenantId: string,
    utenteId: string,
    agenteId: string
  ): Promise<{ codice: string; scadeIl: string }> {
    const codice = generaCodice()
    const scadeIl = new Date(this.adesso().getTime() + MINUTI_VALIDITA_CODICE * 60_000)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const esiste = await tx.agentePesa.findFirst({
          where: { id: agenteId, tenantId },
          select: { id: true },
        })
        if (!esiste) throw new AgentePesaNonTrovatoError()
        const r = await tx.agentePesa.updateMany({
          where: { id: agenteId, tenantId, stato: 'IN_ATTESA' },
          data: { codiceSha256: hashSegreto(codice), codiceScadeIl: scadeIl },
        })
        if (r.count !== 1) {
          throw new StatoAccessoNonValidoError(
            'Il codice si genera solo per un agente in attesa di abbinamento.'
          )
        }
        await scriviAuditPese(
          tx,
          tenantId,
          utenteId,
          'PESA_AGENTE_CODICE_GENERATO',
          'Nuovo codice di abbinamento generato',
          { agenteId }
        )
        return { codice: formattaCodice(codice), scadeIl: scadeIl.toISOString() }
      })
    )
  }

  /** Revoca (IN_ATTESA o ATTIVO): da subito il token e' respinto con 403 e il codice non vale piu'. */
  async revoca(
    tenantId: string,
    utenteId: string,
    agenteId: string,
    motivo: string
  ): Promise<AgenteVista> {
    const testo = motivo?.trim() ?? ''
    if (!testo) throw new DatiPesaNonValidiError(['Il motivo della revoca è obbligatorio.'])
    if (testo.length > 500) {
      throw new DatiPesaNonValidiError(['Il motivo può avere al massimo 500 caratteri.'])
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const prima = await tx.agentePesa.findFirst({
          where: { id: agenteId, tenantId },
          select: { id: true, stato: true },
        })
        if (!prima) throw new AgentePesaNonTrovatoError()
        const r = await tx.agentePesa.updateMany({
          where: { id: agenteId, tenantId, stato: { in: ['IN_ATTESA', 'ATTIVO'] } },
          data: {
            stato: 'REVOCATO',
            revocatoDa: utenteId,
            revocatoIl: this.adesso(),
            motivoRevoca: testo,
            codiceSha256: null,
            codiceScadeIl: null,
          },
        })
        if (r.count !== 1) throw new StatoAccessoNonValidoError("L'agente è già stato revocato.")
        await scriviAuditPese(
          tx,
          tenantId,
          utenteId,
          'PESA_AGENTE_REVOCATO',
          'Agente di pesa revocato',
          {
            agenteId,
            statoPrecedente: prima.stato,
            motivoLunghezza: testo.length,
          }
        )
        const riga = await tx.agentePesa.findFirstOrThrow({
          where: { id: agenteId, tenantId },
          include: {
            registro: { select: { id: true, descrizione: true } },
            strumenti: { orderBy: { descrizione: 'asc' } },
          },
        })
        return this.vista(riga, true)
      })
    )
  }

  /** Assegna uno strumento a un agente (o lo libera con `null`); l'agente non deve essere revocato. */
  async assegnaStrumento(
    tenantId: string,
    utenteId: string,
    strumentoId: string,
    agenteId: string | null
  ): Promise<{ strumentoId: string; agenteId: string | null }> {
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const strumento = await tx.strumentoPesa.findFirst({
          where: { id: strumentoId, tenantId },
          select: { id: true, agenteId: true },
        })
        if (!strumento) throw new StrumentoNonTrovatoError()
        if (agenteId) {
          const agente = await tx.agentePesa.findFirst({
            where: { id: agenteId, tenantId },
            select: { stato: true },
          })
          if (!agente) throw new RegolaPesataError(['Agente non trovato in questa azienda.'])
          if (agente.stato === 'REVOCATO') {
            throw new RegolaPesataError(['Un agente revocato non può leggere strumenti.'])
          }
        }
        await tx.strumentoPesa.update({ where: { id: strumentoId }, data: { agenteId } })
        await scriviAuditPese(
          tx,
          tenantId,
          utenteId,
          'PESA_STRUMENTO_AGENTE_ASSEGNATO',
          agenteId
            ? 'Strumento di pesa assegnato a un agente'
            : 'Strumento di pesa liberato da un agente',
          { strumentoId, agenteId, agentePrecedenteId: strumento.agenteId }
        )
        return { strumentoId, agenteId }
      })
    )
  }

  private vista(r: Riga, vediDatiTecnici: boolean): AgenteVista {
    const adesso = this.adesso()
    const vivo = this.battito.statoStrumenti(r.id)
    return {
      id: r.id,
      descrizione: r.descrizione,
      registro: r.registro,
      stato: r.stato,
      abbinatoIl: r.abbinatoIl?.toISOString() ?? null,
      nomeHost: vediDatiTecnici ? r.nomeHost : null,
      versioneAgente: r.versioneAgente,
      ultimoContattoIl: r.ultimoContattoIl?.toISOString() ?? null,
      inLinea: r.stato === 'ATTIVO' && agenteInLinea(r.ultimoContattoIl, adesso),
      scartoOrologioS: r.scartoOrologioMs === null ? null : Math.round(r.scartoOrologioMs / 1000),
      codaInAttesa: r.codaInAttesa,
      lettureScartate: r.lettureScartate,
      improntaChiave: r.improntaChiave ? gruppiDi4(r.improntaChiave) : null,
      strumenti: r.strumenti.map(s => ({
        id: s.id,
        descrizione: s.descrizione,
        stato: vivo.get(s.id)?.stato ?? null,
        ultimoErrore: vivo.get(s.id)?.ultimoErrore ?? null,
      })),
      codiceScadeIl: r.stato === 'IN_ATTESA' ? (r.codiceScadeIl?.toISOString() ?? null) : null,
      revocatoIl: r.revocatoIl?.toISOString() ?? null,
      motivoRevoca: r.motivoRevoca,
      ultimoIp: vediDatiTecnici ? r.ultimoIp : null,
    }
  }
}

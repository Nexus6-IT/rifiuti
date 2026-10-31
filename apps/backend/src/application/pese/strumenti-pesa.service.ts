// Anagrafica degli strumenti di pesa (bilance) dell'azienda. Mutabile e mai cancellata.
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PESO_MASSIMO_KG } from '../../domain/pese/regole-pesata'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RegistroNonTrovatoError } from '../registro/registri.service'
import {
  DatiPesaNonValidiError,
  StrumentoDuplicatoError,
  StrumentoNonTrovatoError,
} from './errori-pese'
import { nelContestoTenant } from './nel-contesto-tenant'

export interface DatiStrumento {
  descrizione: string
  costruttore?: string | null
  modello?: string | null
  matricola?: string | null
  registroId?: string | null
  portataMaxKg?: number | null
  divisioneKg?: number | null
  /** YYYY-MM-DD */
  dataUltimaVerificazione?: string | null
  attivo?: boolean
}

export interface StrumentoVista {
  id: string
  registroId: string | null
  descrizione: string
  costruttore: string | null
  modello: string | null
  matricola: string | null
  portataMaxKg: number | null
  divisioneKg: number | null
  dataUltimaVerificazione: string | null
  attivo: boolean
}

type RigaStrumento = {
  id: string
  registroId: string | null
  descrizione: string
  costruttore: string | null
  modello: string | null
  matricola: string | null
  portataMaxKg: Prisma.Decimal | number | null
  divisioneKg: Prisma.Decimal | number | null
  dataUltimaVerificazione: Date | null
  attivo: boolean
}

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/

function dataValida(s: string): Date | null {
  const m = FORMATO_DATA.exec(s)
  if (!m) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  // 2026-02-31 viene riportato al mese dopo: non e' una data
  return d.toISOString().slice(0, 10) === s ? d : null
}

const decimaliAl = (x: number, fattore: number) =>
  Math.abs(x * fattore - Math.round(x * fattore)) < 1e-6

export function comeStrumentoVista(r: RigaStrumento): StrumentoVista {
  return {
    id: r.id,
    registroId: r.registroId,
    descrizione: r.descrizione,
    costruttore: r.costruttore,
    modello: r.modello,
    matricola: r.matricola,
    portataMaxKg: r.portataMaxKg === null ? null : Number(r.portataMaxKg),
    divisioneKg: r.divisioneKg === null ? null : Number(r.divisioneKg),
    dataUltimaVerificazione: r.dataUltimaVerificazione
      ? r.dataUltimaVerificazione.toISOString().slice(0, 10)
      : null,
    attivo: r.attivo,
  }
}

const pulito = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

/** Valida i dati e restituisce i valori pronti per il database; 400 con tutti i messaggi. */
function validaDati(dati: DatiStrumento) {
  const messaggi: string[] = []
  const descrizione = dati.descrizione?.trim() ?? ''
  if (!descrizione) messaggi.push('La descrizione è obbligatoria.')
  else if (descrizione.length > 255)
    messaggi.push('La descrizione può avere al massimo 255 caratteri.')
  for (const [nome, v] of [
    ['Il costruttore', dati.costruttore],
    ['Il modello', dati.modello],
    ['La matricola', dati.matricola],
  ] as const) {
    if ((v?.trim().length ?? 0) > 100) messaggi.push(`${nome} può avere al massimo 100 caratteri.`)
  }
  const portata = dati.portataMaxKg ?? null
  if (portata !== null) {
    if (!Number.isFinite(portata) || portata <= 0) {
      messaggi.push('La portata massima deve essere maggiore di zero.')
    } else if (portata > PESO_MASSIMO_KG || !decimaliAl(portata, 100)) {
      messaggi.push('La portata massima non è valida.')
    }
  }
  const divisione = dati.divisioneKg ?? null
  if (divisione !== null) {
    if (!Number.isFinite(divisione) || divisione <= 0) {
      messaggi.push('La divisione deve essere maggiore di zero.')
    } else if (divisione > 99_999.999 || !decimaliAl(divisione, 1000)) {
      messaggi.push('La divisione non è valida.')
    }
  }
  let verificazione: Date | null = null
  if (dati.dataUltimaVerificazione) {
    verificazione = dataValida(dati.dataUltimaVerificazione)
    if (!verificazione) messaggi.push('La data dell’ultima verificazione non è valida.')
  }
  if (messaggi.length > 0) throw new DatiPesaNonValidiError(messaggi)
  return {
    descrizione,
    costruttore: pulito(dati.costruttore),
    modello: pulito(dati.modello),
    matricola: pulito(dati.matricola),
    registroId: dati.registroId ?? null,
    portataMaxKg: portata,
    divisioneKg: divisione,
    dataUltimaVerificazione: verificazione,
  }
}

const eDuplicato = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

@Injectable()
export class StrumentiPesaService {
  constructor(private readonly prisma: PrismaService) {}

  async elenca(tenantId: string): Promise<StrumentoVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.strumentoPesa.findMany({
        where: { tenantId },
        orderBy: [{ attivo: 'desc' }, { descrizione: 'asc' }],
      })
      return righe.map(comeStrumentoVista)
    })
  }

  async crea(tenantId: string, utenteId: string, dati: DatiStrumento): Promise<StrumentoVista> {
    const valori = validaDati(dati)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          if (valori.registroId) await this.verificaRegistro(tx, tenantId, valori.registroId)
          const riga = await tx.strumentoPesa.create({
            data: { tenantId, creatoDa: utenteId, ...valori, attivo: dati.attivo ?? true },
          })
          await this.audit(tx, tenantId, utenteId, 'creato', null, riga)
          return comeStrumentoVista(riga)
        })
        .catch(err => {
          throw eDuplicato(err) ? new StrumentoDuplicatoError() : err
        })
    )
  }

  async aggiorna(
    tenantId: string,
    utenteId: string,
    id: string,
    dati: DatiStrumento
  ): Promise<StrumentoVista> {
    const valori = validaDati(dati)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.strumentoPesa.findFirst({ where: { id, tenantId } })
          if (!prima) throw new StrumentoNonTrovatoError()
          if (valori.registroId) await this.verificaRegistro(tx, tenantId, valori.registroId)
          const riga = await tx.strumentoPesa.update({
            where: { id },
            data: { ...valori, attivo: dati.attivo ?? prima.attivo },
          })
          await this.audit(tx, tenantId, utenteId, 'aggiornato', prima, riga)
          return comeStrumentoVista(riga)
        })
        .catch(err => {
          throw eDuplicato(err) ? new StrumentoDuplicatoError() : err
        })
    )
  }

  /** Per le pesate: legge lo strumento dell'azienda dentro la transazione del chiamante. */
  async leggiPerPesata(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<StrumentoVista> {
    const riga = await tx.strumentoPesa.findFirst({ where: { id, tenantId } })
    if (!riga) throw new StrumentoNonTrovatoError()
    return comeStrumentoVista(riga)
  }

  private async verificaRegistro(
    tx: Prisma.TransactionClient,
    tenantId: string,
    registroId: string
  ): Promise<void> {
    const registro = await tx.registroRifiuti.findFirst({
      where: { id: registroId, tenantId },
      select: { id: true },
    })
    if (!registro) throw new RegistroNonTrovatoError()
  }

  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    esito: 'creato' | 'aggiornato',
    prima: RigaStrumento | null,
    dopo: RigaStrumento
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action: 'PESA_STRUMENTO_SALVATO',
        description: `Strumento di pesa ${esito}`,
        metadata: {
          strumentoId: dopo.id,
          prima: prima ? comeStrumentoVista(prima) : null,
          dopo: comeStrumentoVista(dopo),
        } as unknown as Prisma.InputJsonValue,
      },
    })
  }
}

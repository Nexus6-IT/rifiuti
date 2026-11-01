// Conti correnti del gestore (4.1a, D21): anagrafica per azienda con lock ottimistico (D14),
// disattivazione al posto della cancellazione quando il conto e' in uso (D13) e audit (D16).
// Le regole sui dati stanno in `domain/clienti/conto-corrente`.
//
// L'IBAN e' un dato finanziario: l'elenco lo mostra mascherato, il dettaglio intero; non compare
// mai in audit, log o messaggi di errore (l'audit porta solo id, codice e nomi dei campi).
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  normalizzaContoCorrente,
  validaContoCorrente,
  type DatiContoCorrente,
} from '../../domain/clienti/conto-corrente'
import { mascheraIban } from '../../domain/clienti/iban'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from './anagrafica-versionata'

const ENTITA: DescrizioneEntita = {
  prefisso: 'CONTO_CORRENTE',
  soggetto: 'Il conto corrente',
  femminile: false,
}

const VINCOLO_CODICE = 'conti_correnti_tenant_id_codice_key'
const VINCOLO_IBAN = 'conti_correnti_tenant_id_iban_key'

/** Tutte le chiavi uniche di business della tabella: codice e IBAN. */
const VINCOLI: VincoliNoti = {
  [VINCOLO_CODICE]: {
    codice: 'CONTO_CORRENTE_CODICE_DUPLICATO',
    messaggio: 'Esiste già un conto corrente con questo codice.',
  },
  [VINCOLO_IBAN]: {
    codice: 'CONTO_CORRENTE_IBAN_DUPLICATO',
    messaggio: 'Esiste già un conto corrente con questo IBAN.',
  },
}

export interface ContoCorrenteVista extends DatiContoCorrente {
  id: string
  attivo: boolean
  versione: number
  /** `IT60 **** **** 3456`. */
  ibanMascherato: string
  /** Nessun cliente o contratto lo cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

/** Riga dell'elenco: l'IBAN intero c'e' solo nel dettaglio. */
export type ContoCorrenteInElenco = Omit<ContoCorrenteVista, 'iban'>

/** Il BIC e' facoltativo: assente o null = nessun BIC. */
export type NuovoContoCorrente = Omit<DatiContoCorrente, 'bic'> & { bic?: string | null }

export type ModificaContoCorrente = Partial<DatiContoCorrente> & {
  attivo?: boolean
  versione: number
}

type RigaConto = {
  id: string
  codice: string
  descrizione: string
  banca: string
  iban: string
  bic: string | null
  attivo: boolean
  versione: number
}

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = ['codice', 'descrizione', 'banca', 'iban', 'bic', 'attivo'] as const
type Campo = (typeof CAMPI)[number]

/**
 * Quante righe (clienti e contratti) citano il conto.
 * In 4.1a le tabelle referenti non esistono ancora: nessuno lo cita, quindi 0. Il conteggio reale
 * arriva con la 4.1b, quando esistono `clienti` e `contratti_cliente`.
 */
async function contaUsi(_tenantId: string, _id: string): Promise<number> {
  return 0
}

const datiDi = (r: RigaConto): DatiContoCorrente & { attivo: boolean } => ({
  codice: r.codice,
  descrizione: r.descrizione,
  banca: r.banca,
  iban: r.iban,
  bic: r.bic,
  attivo: r.attivo,
})

async function comeVista(r: RigaConto, tenantId: string): Promise<ContoCorrenteVista> {
  return {
    id: r.id,
    codice: r.codice,
    descrizione: r.descrizione,
    banca: r.banca,
    iban: r.iban,
    bic: r.bic,
    attivo: r.attivo,
    versione: r.versione,
    ibanMascherato: mascheraIban(r.iban),
    eliminabile: (await contaUsi(tenantId, r.id)) === 0,
  }
}

function validaOLancia(dati: DatiContoCorrente): void {
  // I messaggi del dominio non contengono mai l'IBAN ricevuto.
  const errori = validaContoCorrente(dati)
  if (errori.length > 0) {
    throw new BadRequestException({ message: errori, error: 'CONTO_CORRENTE_NON_VALIDO' })
  }
}

const nonTrovato = () =>
  new NotFoundException({
    message: 'Conto corrente non trovato.',
    error: 'CONTO_CORRENTE_NON_TROVATO',
  })

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class ContiCorrentiService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, incluseDisattivate: boolean): Promise<ContoCorrenteInElenco[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.contoCorrente.findMany({
        where: incluseDisattivate ? { tenantId } : { tenantId, attivo: true },
        orderBy: [{ attivo: 'desc' }, { codice: 'asc' }],
      })
      return Promise.all(
        righe.map(async r => {
          const { iban: _iban, ...senzaIban } = await comeVista(r, tenantId)
          return senzaIban
        })
      )
    })
  }

  async getById(tenantId: string, id: string): Promise<ContoCorrenteVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.contoCorrente.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovato()
      return comeVista(riga, tenantId)
    })
  }

  async crea(
    tenantId: string,
    utenteId: string,
    dati: NuovoContoCorrente
  ): Promise<ContoCorrenteVista> {
    const valori = normalizzaContoCorrente(dati)
    validaOLancia(valori)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.contoCorrente.create({ data: { tenantId, ...valori } })
          await this.audit(tx, tenantId, utenteId, 'CONTO_CORRENTE_CREATO', 'creato', {
            contoId: riga.id,
            codice: riga.codice,
          })
          return comeVista(riga, tenantId)
        })
        .catch(err =>
          traduciErrorePrisma(err, ENTITA, VINCOLI, () =>
            this.rileggiVincolo(tenantId, valori.iban)
          )
        )
    )
  }

  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaContoCorrente
  ): Promise<ContoCorrenteVista> {
    // IBAN che la transazione stava per scrivere: serve a `rileggiVincolo` se la scrittura salta.
    let ibanInScrittura: string | null = null
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.contoCorrente.findFirst({ where: { id, tenantId } })
          if (!prima) throw nonTrovato()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = datiDi(prima)
          const unione = normalizzaContoCorrente({
            ...attuali,
            ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)),
          })
          validaOLancia(unione)
          const nuovi: Record<Campo, unknown> = { ...unione, attivo: m.attivo ?? attuali.attivo }

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return comeVista(prima, tenantId)

          ibanInScrittura = unione.iban
          await scriviCondizionato(
            () =>
              tx.contoCorrente.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c]])),
                  versione: { increment: 1 },
                } as Prisma.ContoCorrenteUpdateManyMutationInput,
              }),
            ENTITA
          )
          const dopo = await tx.contoCorrente.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovato()
          // Solo i nomi dei campi: mai l'IBAN, ne' il vecchio ne' il nuovo.
          await this.audit(tx, tenantId, utenteId, 'CONTO_CORRENTE_MODIFICATO', 'modificato', {
            contoId: id,
            codice: dopo.codice,
            campi,
          })
          return comeVista(dopo, tenantId)
        })
        .catch(err =>
          traduciErrorePrisma(err, ENTITA, VINCOLI, () =>
            this.rileggiVincolo(tenantId, ibanInScrittura, id)
          )
        )
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.contoCorrente.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovato()
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.contoCorrente.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'CONTO_CORRENTE_ELIMINATO', 'eliminato', {
            contoId: id,
            codice: riga.codice,
          })
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /**
   * Dopo una P2002 senza `meta.target` (RLS), FUORI dalla transazione abortita: l'IBAN e' gia'
   * di un altro conto? Se si', e' il vincolo dell'IBAN; altrimenti l'unica altra chiave unica e'
   * il codice. `escludiId` esclude il conto che si sta modificando.
   */
  private async rileggiVincolo(
    tenantId: string,
    iban: string | null,
    escludiId?: string
  ): Promise<string | null> {
    if (iban === null) return null
    const altro = await this.prisma.contoCorrente.findFirst({
      where: { tenantId, iban, ...(escludiId ? { id: { not: escludiId } } : {}) },
      select: { id: true },
    })
    return altro ? VINCOLO_IBAN : VINCOLO_CODICE
  }

  /** Audit nella stessa transazione: solo id, codice e nomi dei campi, mai IBAN o testo libero. */
  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    action: string,
    esito: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action,
        description: `Conto corrente ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}

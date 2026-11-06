// Codici IVA delle vendite (4.2a, D3): anagrafica per azienda con lock ottimistico (D14),
// disattivazione al posto della cancellazione quando il codice e' citato da un addebito o da una
// riga di un listino (D13, R44) e audit (D16). Le regole sui dati stanno in `domain/listino/codice-iva`; per il resto il servizio
// segue i registri IVA della 4.1.
import { MESSAGGIO_IN_USO_DA_DOCUMENTI } from '../../domain/fatturazione/codici'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  normalizzaCodiceIva,
  validaCodiceIva,
  type DatiCodiceIva,
} from '../../domain/listino/codice-iva'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from '../clienti/anagrafica-versionata'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { COLONNE_SPESE_DI_CODICE_IVA, contaUsi } from '../clienti/uso-tabelle-fatturazione'
import { COLONNE_CODICE_IVA, contaUsiListino, type ListinoUsi } from './uso-listino'

/**
 * Citazioni di ciascun codice IVA: addebiti, righe, legami e documenti (listino) piu' le spese
 * accessorie (4.4a). Una query per sorgente, mai una per codice.
 */
async function contaUsiCodiceIva(
  client: ListinoUsi,
  tenantId: string,
  ids: readonly string[]
): Promise<Map<string, number>> {
  const usi = await contaUsiListino(client, tenantId, ids, COLONNE_CODICE_IVA)
  const spese = await contaUsi(client, tenantId, ids, COLONNE_SPESE_DI_CODICE_IVA)
  for (const [id, n] of spese) usi.set(id, (usi.get(id) ?? 0) + n)
  return usi
}

const ENTITA: DescrizioneEntita = {
  prefisso: 'CODICE_IVA',
  soggetto: 'Il codice IVA',
  femminile: false,
  // R9: il testo di ripiego direbbe "clienti o contratti", che qui non c'entrano.
  inUso: {
    codice: 'CODICE_IVA_IN_USO',
    messaggio:
      'Il codice IVA è usato da addebiti, righe dei listini, movimenti, documenti o spese accessorie: disattivalo invece di eliminarlo.',
  },
  inUsoPerVincolo: {
    righe_documento_fattura_codice_iva_fkey: {
      codice: 'CODICE_IVA_IN_USO',
      messaggio: MESSAGGIO_IN_USO_DA_DOCUMENTI,
    },
  },
}

/** Unica chiave unica di business della tabella: il codice. */
const VINCOLI: VincoliNoti = {
  codici_iva_tenant_id_codice_key: {
    codice: 'CODICE_IVA_CODICE_DUPLICATO',
    messaggio: 'Esiste già un codice IVA con questo codice.',
  },
}

export interface CodiceIvaVista extends DatiCodiceIva {
  id: string
  versione: number
  /** Nessun addebito lo cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

/** Alla creazione `attivo` omesso vale true (R24). */
export type NuovoCodiceIva = Omit<DatiCodiceIva, 'attivo' | 'natura'> & {
  natura?: string | null
  attivo?: boolean
}

export type ModificaCodiceIva = Partial<DatiCodiceIva> & { versione: number }

type RigaCodiceIva = {
  id: string
  codice: string
  descrizione: string
  aliquota: Prisma.Decimal | string
  natura: string | null
  attivo: boolean
  versione: number
}

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = ['codice', 'descrizione', 'aliquota', 'natura', 'attivo'] as const
type Campo = (typeof CAMPI)[number]

/** Aliquota sempre a due decimali (R12/R24), anche se Prisma la restituisce come Decimal. */
const aliquotaTesto = (a: Prisma.Decimal | string): string => new Prisma.Decimal(a).toFixed(2)

const datiDi = (r: RigaCodiceIva): DatiCodiceIva => ({
  codice: r.codice,
  descrizione: r.descrizione,
  aliquota: aliquotaTesto(r.aliquota),
  natura: r.natura,
  attivo: r.attivo,
})

/** Vista con gli usi gia' noti (la lista li conta in blocco, una volta per tutti i codici). */
function vistaConUsi(r: RigaCodiceIva, usi: number): CodiceIvaVista {
  return { id: r.id, ...datiDi(r), versione: r.versione, eliminabile: usi === 0 }
}

async function comeVista(
  r: RigaCodiceIva,
  tenantId: string,
  client: ListinoUsi
): Promise<CodiceIvaVista> {
  const usi = (await contaUsiCodiceIva(client, tenantId, [r.id])).get(r.id) ?? 0
  return vistaConUsi(r, usi)
}

function validaOLancia(dati: DatiCodiceIva): void {
  const errori = validaCodiceIva(dati)
  if (errori.length > 0) {
    throw new BadRequestException({ message: errori, error: 'CODICE_IVA_NON_VALIDO' })
  }
}

const nonTrovato = () =>
  new NotFoundException({ message: 'Codice IVA non trovato.', error: 'CODICE_IVA_NON_TROVATO' })

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class CodiciIvaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, incluseDisattivate: boolean): Promise<CodiceIvaVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.codiceIva.findMany({
        where: incluseDisattivate ? { tenantId } : { tenantId, attivo: true },
        orderBy: [{ attivo: 'desc' }, { codice: 'asc' }],
      })
      const usi = await contaUsiCodiceIva(
        this.prisma,
        tenantId,
        righe.map(r => r.id)
      )
      return righe.map(r => vistaConUsi(r, usi.get(r.id) ?? 0))
    })
  }

  async getById(tenantId: string, id: string): Promise<CodiceIvaVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.codiceIva.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovato()
      return comeVista(riga, tenantId, this.prisma)
    })
  }

  async crea(tenantId: string, utenteId: string, dati: NuovoCodiceIva): Promise<CodiceIvaVista> {
    const valori = normalizzaCodiceIva(dati)
    validaOLancia(valori)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.codiceIva.create({ data: { tenantId, ...valori } })
          await this.audit(tx, tenantId, utenteId, 'CODICE_IVA_CREATO', 'creato', {
            codiceIvaId: riga.id,
            codice: riga.codice,
          })
          return comeVista(riga, tenantId, tx)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaCodiceIva
  ): Promise<CodiceIvaVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.codiceIva.findFirst({ where: { id, tenantId } })
          if (!prima) throw nonTrovato()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = datiDi(prima)
          // `undefined` = campo non inviato; `null` (solo per la natura) lo azzera.
          const inviati = Object.fromEntries(
            Object.entries(m).filter(([c, v]) => c !== 'versione' && v !== undefined)
          )
          const nuovi = normalizzaCodiceIva({ ...attuali, ...inviati })
          validaOLancia(nuovi)

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return comeVista(prima, tenantId, tx)

          await scriviCondizionato(
            () =>
              tx.codiceIva.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c as Campo]])),
                  versione: { increment: 1 },
                } as Prisma.CodiceIvaUpdateManyMutationInput,
              }),
            ENTITA
          )
          const dopo = await tx.codiceIva.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovato()
          await this.audit(tx, tenantId, utenteId, 'CODICE_IVA_MODIFICATO', 'modificato', {
            codiceIvaId: id,
            codice: dopo.codice,
            campi,
          })
          return comeVista(dopo, tenantId, tx)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.codiceIva.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovato()
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.codiceIva.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'CODICE_IVA_ELIMINATO', 'eliminato', {
            codiceIvaId: id,
            codice: riga.codice,
          })
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /** Audit nella stessa transazione: solo id, codice e nomi dei campi, mai testo libero (D16). */
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
        description: `Codice IVA ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}

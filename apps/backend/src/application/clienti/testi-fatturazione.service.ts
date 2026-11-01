// Testi di fatturazione (4.1a, D25): anagrafica per azienda con lock ottimistico (D14),
// disattivazione al posto della cancellazione quando il testo e' in uso (D13) e audit (D16).
// Le regole sui dati stanno in `domain/clienti/testo-fatturazione`. Le righe del testo sono testo
// libero: non compaiono mai nell'audit.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  normalizzaTesto,
  validaTesto,
  type DatiTestoFatturazione,
} from '../../domain/clienti/testo-fatturazione'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from './anagrafica-versionata'
import { COLONNE_TESTO, contaUsi, type ClientUsi } from './uso-tabelle-fatturazione'

const ENTITA: DescrizioneEntita = {
  prefisso: 'TESTO_FATTURAZIONE',
  soggetto: 'Il testo di fatturazione',
  femminile: false,
}

/** Unica chiave unica di business della tabella: il codice. */
const VINCOLI: VincoliNoti = {
  testi_fatturazione_tenant_id_codice_key: {
    codice: 'TESTO_FATTURAZIONE_CODICE_DUPLICATO',
    messaggio: 'Esiste già un testo di fatturazione con questo codice.',
  },
}

export interface TestoVista extends DatiTestoFatturazione {
  id: string
  attivo: boolean
  versione: number
  /** Nessun cliente o contratto lo cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

export type ModificaTesto = Partial<DatiTestoFatturazione> & {
  attivo?: boolean
  versione: number
}

type RigaTesto = {
  id: string
  codice: string
  titolo: string
  righe: string[]
  attivo: boolean
  versione: number
}

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = ['codice', 'titolo', 'righe', 'attivo'] as const
type Campo = (typeof CAMPI)[number]

const datiDi = (r: RigaTesto): DatiTestoFatturazione & { attivo: boolean } => ({
  codice: r.codice,
  titolo: r.titolo,
  righe: [...r.righe],
  attivo: r.attivo,
})

async function comeVista(
  r: RigaTesto,
  tenantId: string,
  client: ClientUsi,
  usiNoti?: number
): Promise<TestoVista> {
  const usi = usiNoti ?? (await contaUsi(client, tenantId, [r.id], COLONNE_TESTO)).get(r.id) ?? 0
  return {
    id: r.id,
    codice: r.codice,
    titolo: r.titolo,
    righe: [...r.righe],
    attivo: r.attivo,
    versione: r.versione,
    eliminabile: usi === 0,
  }
}

function validaOLancia(dati: DatiTestoFatturazione): void {
  const errori = validaTesto(dati)
  if (errori.length > 0) {
    throw new BadRequestException({ message: errori, error: 'TESTO_FATTURAZIONE_NON_VALIDO' })
  }
}

const nonTrovato = () =>
  new NotFoundException({
    message: 'Testo di fatturazione non trovato.',
    error: 'TESTO_FATTURAZIONE_NON_TROVATO',
  })

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class TestiFatturazioneService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, incluseDisattivate: boolean): Promise<TestoVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.testoFatturazione.findMany({
        where: incluseDisattivate ? { tenantId } : { tenantId, attivo: true },
        orderBy: [{ attivo: 'desc' }, { codice: 'asc' }],
      })
      const usi = await contaUsi(
        this.prisma,
        tenantId,
        righe.map(r => r.id),
        COLONNE_TESTO
      )
      return Promise.all(righe.map(r => comeVista(r, tenantId, this.prisma, usi.get(r.id) ?? 0)))
    })
  }

  async getById(tenantId: string, id: string): Promise<TestoVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.testoFatturazione.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovato()
      return comeVista(riga, tenantId, this.prisma)
    })
  }

  async crea(tenantId: string, utenteId: string, dati: DatiTestoFatturazione): Promise<TestoVista> {
    const valori = normalizzaTesto(dati)
    validaOLancia(valori)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.testoFatturazione.create({ data: { tenantId, ...valori } })
          await this.audit(tx, tenantId, utenteId, 'TESTO_FATTURAZIONE_CREATO', 'creato', {
            testoId: riga.id,
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
    m: ModificaTesto
  ): Promise<TestoVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.testoFatturazione.findFirst({ where: { id, tenantId } })
          if (!prima) throw nonTrovato()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = datiDi(prima)
          const unione = normalizzaTesto({
            ...attuali,
            ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)),
          })
          validaOLancia(unione)
          const nuovi: Record<Campo, unknown> = { ...unione, attivo: m.attivo ?? attuali.attivo }

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return comeVista(prima, tenantId, tx)

          await scriviCondizionato(
            () =>
              tx.testoFatturazione.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c]])),
                  versione: { increment: 1 },
                } as Prisma.TestoFatturazioneUpdateManyMutationInput,
              }),
            ENTITA
          )
          const dopo = await tx.testoFatturazione.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovato()
          await this.audit(tx, tenantId, utenteId, 'TESTO_FATTURAZIONE_MODIFICATO', 'modificato', {
            testoId: id,
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
          const riga = await tx.testoFatturazione.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovato()
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.testoFatturazione.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'TESTO_FATTURAZIONE_ELIMINATO', 'eliminato', {
            testoId: id,
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
        description: `Testo di fatturazione ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}

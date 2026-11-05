// Registri IVA sezionali delle vendite (4.1a, D24): anagrafica per azienda con lock ottimistico
// (D14), disattivazione al posto della cancellazione quando il registro e' in uso (D13) e audit
// (D16). Le regole sui dati stanno in `domain/clienti/registro-iva`.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  normalizzaRegistro,
  validaRegistro,
  type DatiRegistroIva,
} from '../../domain/clienti/registro-iva'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from './anagrafica-versionata'
import {
  MSG_SUFFISSO_NON_VALIDO,
  annoCorrente,
  controllaSuffissoModificabile,
  registriConDefinitivoNellAnno,
  suffissoValido,
} from '../fatturazione/suffisso-registro'
import { COLONNE_REGISTRO, contaUsi, type ClientUsi } from './uso-tabelle-fatturazione'

const ENTITA: DescrizioneEntita = {
  prefisso: 'REGISTRO_IVA',
  soggetto: 'Il registro IVA',
  femminile: false,
  inUso: {
    codice: 'REGISTRO_IVA_IN_USO',
    messaggio:
      'Il registro IVA è usato da clienti, contratti o documenti: disattivalo invece di eliminarlo.',
  },
}

/** Unica chiave unica di business della tabella: il codice. */
const VINCOLI: VincoliNoti = {
  registri_iva_tenant_id_codice_key: {
    codice: 'REGISTRO_IVA_CODICE_DUPLICATO',
    messaggio: 'Esiste già un registro IVA con questo codice.',
  },
}

/** Dati del registro con il suffisso facoltativo del numero (4.4a, S9). */
export type DatiRegistroIvaConSuffisso = DatiRegistroIva & { suffissoNumero?: string | null }

export interface RegistroIvaVista extends DatiRegistroIva {
  id: string
  attivo: boolean
  versione: number
  /** Suffisso del numero di fattura (per esempio `/A`), o null. */
  suffissoNumero: string | null
  /** false se il registro ha un definitivo nell'anno della data italiana corrente (§4.10). */
  suffissoModificabile: boolean
  /** Nessun cliente o contratto lo cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

export type ModificaRegistroIva = Partial<DatiRegistroIvaConSuffisso> & {
  attivo?: boolean
  versione: number
}

type RigaRegistro = {
  id: string
  codice: string
  descrizione: string
  ricevuteSplit: boolean
  attivo: boolean
  suffissoNumero: string | null
  versione: number
}

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = ['codice', 'descrizione', 'ricevuteSplit', 'suffissoNumero', 'attivo'] as const
type Campo = (typeof CAMPI)[number]

const datiDi = (
  r: RigaRegistro
): DatiRegistroIva & { attivo: boolean; suffissoNumero: string | null } => ({
  codice: r.codice,
  descrizione: r.descrizione,
  ricevuteSplit: r.ricevuteSplit,
  suffissoNumero: r.suffissoNumero,
  attivo: r.attivo,
})

async function comeVista(
  r: RigaRegistro,
  tenantId: string,
  client: ClientUsi,
  usiNoti?: number,
  conDefinitivo?: ReadonlySet<string>
): Promise<RegistroIvaVista> {
  const usi = usiNoti ?? (await contaUsi(client, tenantId, [r.id], COLONNE_REGISTRO)).get(r.id) ?? 0
  const bloccati =
    conDefinitivo ?? (await registriConDefinitivoNellAnno(client, tenantId, [r.id], annoCorrente()))
  return {
    id: r.id,
    codice: r.codice,
    descrizione: r.descrizione,
    ricevuteSplit: r.ricevuteSplit,
    attivo: r.attivo,
    suffissoNumero: r.suffissoNumero,
    suffissoModificabile: !bloccati.has(r.id),
    versione: r.versione,
    eliminabile: usi === 0,
  }
}

function validaOLancia(dati: DatiRegistroIva, suffisso: string | null = null): void {
  const errori = validaRegistro(dati)
  if (!suffissoValido(suffisso)) errori.push(MSG_SUFFISSO_NON_VALIDO)
  if (errori.length > 0) {
    throw new BadRequestException({ message: errori, error: 'REGISTRO_IVA_NON_VALIDO' })
  }
}

export const nonTrovato = () =>
  new NotFoundException({
    message: 'Registro IVA non trovato.',
    error: 'REGISTRO_IVA_NON_TROVATO',
  })

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class RegistriIvaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, incluseDisattivate: boolean): Promise<RegistroIvaVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.registroIva.findMany({
        where: incluseDisattivate ? { tenantId } : { tenantId, attivo: true },
        orderBy: [{ attivo: 'desc' }, { codice: 'asc' }],
      })
      const usi = await contaUsi(
        this.prisma,
        tenantId,
        righe.map(r => r.id),
        COLONNE_REGISTRO
      )
      const conDefinitivo = await registriConDefinitivoNellAnno(
        this.prisma,
        tenantId,
        righe.map(r => r.id),
        annoCorrente()
      )
      return Promise.all(
        righe.map(r => comeVista(r, tenantId, this.prisma, usi.get(r.id) ?? 0, conDefinitivo))
      )
    })
  }

  async getById(tenantId: string, id: string): Promise<RegistroIvaVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.registroIva.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovato()
      return comeVista(riga, tenantId, this.prisma)
    })
  }

  async crea(
    tenantId: string,
    utenteId: string,
    dati: DatiRegistroIvaConSuffisso
  ): Promise<RegistroIvaVista> {
    const valori = normalizzaRegistro(dati)
    const suffissoNumero = dati.suffissoNumero ?? null
    validaOLancia(valori, suffissoNumero)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.registroIva.create({
            data: { tenantId, ...valori, suffissoNumero },
          })
          await this.audit(tx, tenantId, utenteId, 'REGISTRO_IVA_CREATO', 'creato', {
            registroId: riga.id,
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
    m: ModificaRegistroIva
  ): Promise<RegistroIvaVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          // Suffisso (§4.10): il lock della numerazione dell'anno si prende PRIMA di quello del
          // registro (ordine della spec §8) e solo se il suffisso sta davvero cambiando. Un
          // cambio concorrente della versione e' preso comunque dal confronto di `versione`.
          const suffissoRichiesto = m.suffissoNumero
          if (suffissoRichiesto !== undefined) {
            if (!suffissoValido(suffissoRichiesto)) {
              throw new BadRequestException({
                message: [MSG_SUFFISSO_NON_VALIDO],
                error: 'REGISTRO_IVA_NON_VALIDO',
              })
            }
            const [corrente] = await tx.$queryRaw<{ suffisso: string | null }[]>`
              SELECT suffisso_numero AS suffisso FROM "registri_iva"
              WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`
            if (corrente && corrente.suffisso !== suffissoRichiesto) {
              await controllaSuffissoModificabile(tx, tenantId, id)
            }
          }
          // R24: vedi la spesa accessoria. Il blocco serve solo se il registro puo' diventare
          // quello delle ricevute split.
          if (m.ricevuteSplit === true) {
            await tx.$queryRaw`SELECT id FROM "registri_iva"
              WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`
          }
          const prima = await tx.registroIva.findFirst({ where: { id, tenantId } })
          if (!prima) throw nonTrovato()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = datiDi(prima)
          const senzaSuffisso: Record<string, unknown> = { ...m }
          delete senzaSuffisso.suffissoNumero
          const unione = normalizzaRegistro({
            ...attuali,
            ...Object.fromEntries(Object.entries(senzaSuffisso).filter(([, v]) => v !== undefined)),
          })
          validaOLancia(unione)
          const nuovi: Record<Campo, unknown> = {
            ...unione,
            suffissoNumero:
              suffissoRichiesto === undefined ? attuali.suffissoNumero : suffissoRichiesto,
            attivo: m.attivo ?? attuali.attivo,
          }

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return comeVista(prima, tenantId, tx)
          if (campi.includes('ricevuteSplit') && nuovi.ricevuteSplit === true) {
            const usi = (await contaUsi(tx, tenantId, [id], COLONNE_REGISTRO)).get(id) ?? 0
            if (usi > 0) {
              throw new ConflictException({
                error: 'REGISTRO_IVA_IN_USO',
                message:
                  'Il registro IVA è usato da clienti, contratti o documenti: non può diventare il registro delle ricevute split payment.',
              })
            }
          }

          await scriviCondizionato(
            () =>
              tx.registroIva.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c]])),
                  versione: { increment: 1 },
                } as Prisma.RegistroIvaUpdateManyMutationInput,
              }),
            ENTITA
          )
          const dopo = await tx.registroIva.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovato()
          await this.audit(tx, tenantId, utenteId, 'REGISTRO_IVA_MODIFICATO', 'modificato', {
            registroId: id,
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
          const riga = await tx.registroIva.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovato()
          confrontaVersione(riga.versione, versione, ENTITA)
          // Le righe vuote della numerazione nascono solo per il lock del suffisso: non sono un
          // uso. Si bloccano (ordine numerazioni -> registro, come il cambio di suffisso) e si
          // cancellano; quelle scritte restano e la FK rifiuta l'eliminazione (409 in uso).
          await tx.$queryRaw`SELECT 1 FROM "numerazioni_fattura"
            WHERE tenant_id = ${tenantId}::uuid AND registro_iva_id = ${id}::uuid
            ORDER BY anno FOR UPDATE`
          await tx.$executeRaw`DELETE FROM "numerazioni_fattura"
            WHERE tenant_id = ${tenantId}::uuid AND registro_iva_id = ${id}::uuid
              AND ultimo_numero = 0 AND numero_partenza = 0 AND data_partenza IS NULL`
          await scriviCondizionato(
            () => tx.registroIva.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'REGISTRO_IVA_ELIMINATO', 'eliminato', {
            registroId: id,
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
        description: `Registro IVA ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}

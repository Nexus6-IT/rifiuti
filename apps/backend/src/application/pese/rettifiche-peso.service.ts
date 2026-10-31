// Rettifiche tracciate del peso di una pesata (D2, D5, D9, D10, D11): la pesata non si tocca mai,
// ogni correzione e' una nuova riga di `rettifiche_peso` con numero consecutivo, peso precedente,
// motivo, autore, allegato facoltativo e impronta.
//
// CONCORRENZA. Ordine dei lock (vedi `blocchi-accesso.ts`): 1) advisory `accesso-pesa|<id>` +
// `FOR UPDATE` sulla riga dell'accesso (`bloccaAccesso`), 2) advisory `rettifica-peso|<pesataId>`,
// 3) insert. Il trigger `rettifiche_peso_controlli` non legge l'accesso con `FOR SHARE`: e' il
// lock del punto 1 a serializzare la rettifica con l'annullo (che prende lo stesso lock), cosi'
// non nasce una rettifica su un accesso annullato. `numero` e `peso_precedente_kg` li calcola il
// servizio sotto lock (il trigger li controlla, non li imposta).
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { calcolaNetto } from '../../domain/pese/netto-accesso'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { improntaRettifica } from '../../domain/pese/impronta-pesata'
import { validaPesataManuale } from '../../domain/pese/regole-pesata'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RUOLI_RESPONSABILE_PESA } from '../../api/pese/ruoli-pesa'
import type { FileCaricato, UtentePesa } from './accessi-pesa.tipi'
import { traduciErroreDatabase } from './accessi-pesa.service'
import { AllegatiPesaService } from './allegati-pesa.service'
import { scriviAuditPese } from './audit-pese'
import { bloccaAccesso } from './blocchi-accesso'
import {
  DatiPesaNonValidiError,
  PesataNonTrovataError,
  RegolaPesataError,
  RuoloPesaInsufficienteError,
  StatoAccessoNonValidoError,
} from './errori-pese'
import { nelContestoTenant } from './nel-contesto-tenant'
import { leggiVistaAccesso, type AccessoVista } from './viste-accesso'

export const AVVISO_DOCUMENTI_COLLEGATI =
  'I documenti collegati non cambiano: FIR e registro restano con il peso già scritto; se serve, rettificare il registro.'
export const MSG_PESO_UGUALE = 'Il nuovo peso è uguale a quello attuale.'

export interface RettificaDati {
  pesoNuovoKg: number
  motivo: string
}

export const avvisoTaraNonAggiornata = (targa: string): string =>
  `La tara dell'automezzo ${targa} non è stata aggiornata: usa ancora il peso originale.`

const centesimi = (kg: number | Prisma.Decimal): number => Math.round(Number(kg) * 100)

@Injectable()
export class RettifichePesoService {
  /** Sostituibile nei test. */
  protected adesso: () => Date = () => new Date()

  constructor(
    private readonly prisma: PrismaService,
    private readonly allegati: AllegatiPesaService
  ) {}

  async rettifica(
    tenantId: string,
    utente: UtentePesa,
    pesataId: string,
    dati: RettificaDati,
    allegato?: FileCaricato
  ): Promise<AccessoVista> {
    if (!RUOLI_RESPONSABILE_PESA.includes(utente.ruolo)) {
      throw new RuoloPesaInsufficienteError(
        "Solo un amministratore dell'azienda può rettificare un peso."
      )
    }
    const motivo = dati.motivo?.trim() ?? ''
    if (!motivo) throw new DatiPesaNonValidiError(['Il motivo della rettifica è obbligatorio.'])
    if (motivo.length > 500) {
      throw new DatiPesaNonValidiError(['Il motivo può avere al massimo 500 caratteri.'])
    }
    const adesso = this.adesso()
    const { errori } = validaPesataManuale({
      pesoKg: dati.pesoNuovoKg,
      oraStrumento: null,
      adesso,
      strumento: null,
    })
    if (errori.length > 0) throw new RegolaPesataError(errori)

    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(
          async tx => {
            const pesata = await tx.pesata.findFirst({
              where: { id: pesataId, tenantId },
              select: { id: true, accessoId: true, fonte: true, pesoKg: true },
            })
            if (!pesata) throw new PesataNonTrovataError()
            // 1) accesso: advisory + FOR UPDATE, poi stato riletto sotto lock.
            const accesso = await bloccaAccesso(tx, tenantId, pesata.accessoId)
            if (accesso.stato === 'ANNULLATO') {
              throw new StatoAccessoNonValidoError(
                "L'accesso è annullato: il peso non si rettifica."
              )
            }
            if (pesata.fonte === 'TARA_ANAGRAFICA') {
              throw new StatoAccessoNonValidoError('La tara dichiarata non si rettifica.')
            }
            // 2) la pesata.
            const chiave = `rettifica-peso|${pesataId}`
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`

            const ultima = await tx.rettificaPeso.findFirst({
              where: { pesataId, tenantId },
              orderBy: { numero: 'desc' },
              select: { numero: true, pesoNuovoKg: true },
            })
            const numero = (ultima?.numero ?? 0) + 1
            const precedente = ultima ? ultima.pesoNuovoKg : pesata.pesoKg
            if (centesimi(dati.pesoNuovoKg) === centesimi(precedente)) {
              throw new RegolaPesataError([MSG_PESO_UGUALE])
            }
            const nuovoKg = centesimi(dati.pesoNuovoKg) / 100
            if (accesso.stato === 'CHIUSO') {
              await this.verificaNettoDopoRettifica(
                tx,
                tenantId,
                accesso,
                pesataId,
                numero,
                nuovoKg
              )
            }
            const precedenteTesto = new Prisma.Decimal(precedente).toFixed(2)
            const nuovoTesto = new Prisma.Decimal(centesimi(dati.pesoNuovoKg)).div(100).toFixed(2)

            const salvato = allegato
              ? await this.allegati.salva(tx, tenantId, utente.id, allegato)
              : null
            await tx.rettificaPeso.create({
              data: {
                tenantId,
                pesataId,
                numero,
                pesoPrecedenteKg: precedenteTesto,
                pesoNuovoKg: nuovoTesto,
                motivo,
                autoreId: utente.id,
                allegatoId: salvato?.id ?? null,
                createdAt: adesso,
                impronta: improntaRettifica({
                  tenantId,
                  pesataId,
                  numero,
                  pesoPrecedenteKg: precedenteTesto,
                  pesoNuovoKg: nuovoTesto,
                  motivo,
                  autoreId: utente.id,
                  allegatoSha256: salvato?.sha256 ?? null,
                  createdAt: adesso,
                }),
              },
            })
            await scriviAuditPese(
              tx,
              tenantId,
              utente.id,
              'PESA_PESATA_RETTIFICATA',
              'Peso di una pesata rettificato',
              {
                pesataId,
                numero,
                precedente: Number(precedenteTesto),
                nuovo: Number(nuovoTesto),
                motivoLunghezza: motivo.length,
                conAllegato: salvato !== null,
              }
            )
            const mezzi = await tx.automezzo.findMany({
              where: { tenantId, taraPesataId: pesataId },
              select: { targa: true },
            })
            const vista = await leggiVistaAccesso(tx, tenantId, pesata.accessoId, adesso)
            const collegati = await tx.collegamentoAccesso.count({
              where: { tenantId, accessoId: pesata.accessoId, revocatoIl: null },
            })
            if (collegati > 0) vista.avvisi = [...vista.avvisi, AVVISO_DOCUMENTI_COLLEGATI]
            for (const m of mezzi) {
              vista.avvisi = [...vista.avvisi, avvisoTaraNonAggiornata(m.targa)]
            }
            return vista
          },
          { timeout: 15_000, maxWait: 5_000 }
        )
      } catch (err) {
        throw await traduciErroreDatabase(err)
      }
    })
  }

  /**
   * Un accesso CHIUSO resta con netto CALCOLATO: si rifa il calcolo col peso nuovo (le pesate
   * dell'accesso piu' la rettifica simulata, al giorno della chiusura) e, se non torna, 422 con
   * il messaggio di D6. Va chiamato sotto lock, prima dell'insert.
   */
  private async verificaNettoDopoRettifica(
    tx: Prisma.TransactionClient,
    tenantId: string,
    accesso: {
      id: string
      verso: 'CARICO' | 'SCARICO'
      modo: 'DOPPIA' | 'TARA_ANAGRAFICA' | 'SINGOLA'
      chiusoIl: Date | null
    },
    pesataId: string,
    numero: number,
    nuovoKg: number
  ): Promise<void> {
    const pesate = await tx.pesata.findMany({
      where: { tenantId, accessoId: accesso.id },
      include: { rettifiche: true },
    })
    const netto = calcolaNetto(
      accesso.verso,
      accesso.modo,
      pesate.map(p => ({
        ordine: p.ordine === 1 ? (1 as const) : (2 as const),
        fonte: p.fonte,
        pesoKg: Number(p.pesoKg),
        rettifiche: [
          ...p.rettifiche.map(r => ({ numero: r.numero, pesoNuovoKg: Number(r.pesoNuovoKg) })),
          ...(p.id === pesataId ? [{ numero, pesoNuovoKg: nuovoKg }] : []),
        ],
        stabile: p.stabile,
        taraAggiornataIl: p.taraAggiornataIl ? p.taraAggiornataIl.toISOString() : null,
      })),
      giornoItaliano(accesso.chiusoIl ?? this.adesso())
    )
    if (netto.stato !== 'CALCOLATO') {
      throw new RegolaPesataError([netto.errore ?? 'Il netto non si può calcolare.'])
    }
  }
}

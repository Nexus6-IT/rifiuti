// Dati del cedente (4.4a, spec §4.9, S7): una riga per azienda in `cedente_fatturazione` con lock
// ottimistico, come «fatturazione da» della 4.3. Partita IVA, codice fiscale, ragione sociale e
// indirizzo si leggono da `tenants` e si mostrano in sola lettura. L'audit contiene solo nomi di
// campo, codici e importi: mai i testi liberi (`reaUfficio`, `idTrasmittenteCodice`).
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nonTrovato } from '../clienti/registri-iva.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../clienti/anagrafica-versionata'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'

export type SocioUnico = 'SU' | 'SM'
export type StatoLiquidazione = 'LN' | 'LS'

export interface CedenteVista {
  regimeFiscale: string | null
  reaUfficio: string | null
  /** Stringa decimale col punto, per esempio `1000.50`. */
  capitaleSociale: string | null
  socioUnico: SocioUnico | null
  statoLiquidazione: StatoLiquidazione
  registroIvaPredefinitoId: string | null
  idTrasmittenteCodice: string | null
  versione: number
  daTenant: {
    ragioneSociale: string
    partitaIva: string | null
    codiceFiscale: string | null
    indirizzo: string | null
    cap: string | null
    comune: string | null
    provincia: string | null
    numeroRea: string | null
  }
  /**
   * Nota per il costruttore dell'XML: `indirizzo` unisce via e civico (l'XSD li vuole separati,
   * `Indirizzo` max 60 caratteri): la sede dell'XML va letta da `tenants`. `Provincia` e'
   * facoltativa nell'XSD: si emette quando c'e'.
   */
  completo: boolean
  mancanti: string[]
}

export interface DatiCedente {
  regimeFiscale: string
  reaUfficio?: string | null
  capitaleSociale?: string | null
  socioUnico?: SocioUnico | null
  statoLiquidazione?: StatoLiquidazione
  registroIvaPredefinitoId?: string | null
  idTrasmittenteCodice?: string | null
  versione: number
}

const ENTITA: DescrizioneEntita = {
  prefisso: 'CEDENTE_FATTURAZIONE',
  soggetto: 'I dati del cedente',
  femminile: false,
}

const MSG_VERSIONE_SUPERATA =
  'I dati del cedente sono stati modificati nel frattempo: ricarica per vedere i dati aggiornati.'
const versioneSuperata = () =>
  new ConflictException({ error: 'VERSIONE_SUPERATA', message: MSG_VERSIONE_SUPERATA })

const vuoto = (s: string | null | undefined) => s === null || s === undefined || s.trim() === ''

interface RigaCedente {
  id: string
  regimeFiscale: string
  reaUfficio: string | null
  capitaleSociale: Prisma.Decimal | null
  socioUnico: string | null
  statoLiquidazione: string
  registroIvaPredefinitoId: string | null
  idTrasmittenteCodice: string | null
  versione: number
}

/** Valore normalizzato dei campi scrivibili, per il confronto e per l'audit. */
interface Campi {
  regimeFiscale: string
  reaUfficio: string | null
  capitaleSociale: string | null
  socioUnico: SocioUnico | null
  statoLiquidazione: StatoLiquidazione
  registroIvaPredefinitoId: string | null
  idTrasmittenteCodice: string | null
}

@Injectable()
export class CedenteService {
  constructor(private readonly prisma: PrismaService) {}

  leggi(tenantId: string): Promise<CedenteVista> {
    return nelContestoTenant(tenantId, () => this.leggiDa(this.prisma, tenantId))
  }

  /** Lettura dentro una transazione gia' aperta nel contesto del tenant (nessun lock). */
  leggiInTx(tx: Prisma.TransactionClient, tenantId: string): Promise<CedenteVista> {
    return this.leggiDa(tx, tenantId)
  }

  async imposta(tenantId: string, utenteId: string, dati: DatiCedente): Promise<CedenteVista> {
    const nuovi = normalizza(dati)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          // FOR UPDATE: due PUT con la stessa versione si accodano e il secondo la trova cambiata.
          const attuale = (
            await tx.$queryRaw<RigaCedente[]>`
              SELECT id, regime_fiscale AS "regimeFiscale", rea_ufficio AS "reaUfficio",
                     capitale_sociale AS "capitaleSociale", socio_unico AS "socioUnico",
                     stato_liquidazione AS "statoLiquidazione",
                     registro_iva_predefinito_id::text AS "registroIvaPredefinitoId",
                     id_trasmittente_codice AS "idTrasmittenteCodice", versione
              FROM "cedente_fatturazione"
              WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
          )[0]
          if ((attuale?.versione ?? 0) !== dati.versione) throw versioneSuperata()

          if (nuovi.registroIvaPredefinitoId) {
            // Con la RLS un registro di un'altra azienda non si vede: 404 come se non esistesse.
            const registro = await tx.registroIva.findFirst({
              where: { id: nuovi.registroIvaPredefinitoId, tenantId },
              select: { id: true, attivo: true },
            })
            if (!registro) throw nonTrovato()
            // Un registro disattivato non si sceglie di nuovo; quello gia' salvato resta ammesso.
            if (!registro.attivo && attuale?.registroIvaPredefinitoId !== registro.id) {
              throw new BadRequestException({
                error: 'REGISTRO_IVA_NON_ATTIVO',
                message: 'Il registro IVA scelto non è attivo.',
              })
            }
          }

          const prima = attuale ? campiDa(attuale) : null
          const cambiati = prima ? nomiCambiati(prima, nuovi) : (Object.keys(nuovi) as string[])
          // Nessun cambio: niente scrittura, niente audit, niente incremento di versione.
          if (prima && cambiati.length === 0) return this.leggiDa(tx, tenantId)

          const scrivibili = {
            regimeFiscale: nuovi.regimeFiscale,
            reaUfficio: nuovi.reaUfficio,
            capitaleSociale:
              nuovi.capitaleSociale === null ? null : new Prisma.Decimal(nuovi.capitaleSociale),
            socioUnico: nuovi.socioUnico,
            statoLiquidazione: nuovi.statoLiquidazione,
            registroIvaPredefinitoId: nuovi.registroIvaPredefinitoId,
            idTrasmittenteCodice: nuovi.idTrasmittenteCodice,
          }
          if (attuale) {
            await tx.cedenteFatturazione.update({
              where: { id: attuale.id },
              data: { ...scrivibili, versione: { increment: 1 }, modificatoDa: utenteId },
            })
          } else {
            await tx.cedenteFatturazione.create({
              data: { tenantId, ...scrivibili, modificatoDa: utenteId },
            })
          }
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'CEDENTE_FATTURAZIONE_MODIFICATO',
              description: 'Dati del cedente per la fatturazione modificati',
              metadata: {
                campiCambiati: cambiati,
                regimeFiscale: { prima: prima?.regimeFiscale ?? null, dopo: nuovi.regimeFiscale },
                socioUnico: { prima: prima?.socioUnico ?? null, dopo: nuovi.socioUnico },
                statoLiquidazione: {
                  prima: prima?.statoLiquidazione ?? null,
                  dopo: nuovi.statoLiquidazione,
                },
                capitaleSociale: {
                  prima: prima?.capitaleSociale ?? null,
                  dopo:
                    nuovi.capitaleSociale === null
                      ? null
                      : new Prisma.Decimal(nuovi.capitaleSociale).toFixed(2),
                },
              } as Prisma.InputJsonValue,
            },
          })
          return this.leggiDa(tx, tenantId)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => {
          // Due prime impostazioni insieme (versione 0): l'unico del tenant fa perdere la seconda.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw versioneSuperata()
          }
          return traduciErrorePrisma(err, ENTITA, {})
        })
    )
  }

  private async leggiDa(
    db: PrismaService | Prisma.TransactionClient,
    tenantId: string
  ): Promise<CedenteVista> {
    const [riga, tenant] = await Promise.all([
      db.cedenteFatturazione.findFirst({ where: { tenantId } }),
      db.tenant.findUnique({
        where: { id: tenantId },
        select: {
          ragioneSociale: true,
          partitaIva: true,
          codiceFiscale: true,
          address: true,
          civico: true,
          postalCode: true,
          city: true,
          province: true,
          reaNumber: true,
          country: true,
        },
      }),
    ])
    if (!tenant) throw new NotFoundException('Azienda non trovata.')
    const via = vuoto(tenant.address)
      ? ''
      : [tenant.address!.trim(), tenant.civico?.trim()].filter(Boolean).join(' ')
    const daTenant = {
      ragioneSociale: tenant.ragioneSociale,
      partitaIva: tenant.partitaIva,
      codiceFiscale: tenant.codiceFiscale,
      indirizzo: via || null,
      cap: tenant.postalCode,
      comune: tenant.city,
      provincia: tenant.province,
      numeroRea: tenant.reaNumber,
    }
    const mancanti: string[] = []
    if (!riga?.regimeFiscale) mancanti.push('Regime fiscale')
    if (vuoto(daTenant.partitaIva)) mancanti.push('Partita IVA')
    if (vuoto(daTenant.ragioneSociale)) mancanti.push('Ragione sociale')
    const capNonValido = tenant.country === 'IT' && !/^\d{5}$/.test(daTenant.cap ?? '')
    if (vuoto(daTenant.indirizzo) || vuoto(daTenant.comune) || capNonValido) {
      mancanti.push('Indirizzo della sede')
    }
    // `IscrizioneREA` dell'XML vuole insieme ufficio e numero (e stato di liquidazione).
    if (riga?.reaUfficio && vuoto(daTenant.numeroRea)) mancanti.push('Numero REA')
    if (!riga?.reaUfficio && !vuoto(daTenant.numeroRea) && riga) mancanti.push('Ufficio REA')
    return {
      regimeFiscale: riga?.regimeFiscale ?? null,
      reaUfficio: riga?.reaUfficio ?? null,
      capitaleSociale: riga?.capitaleSociale ? riga.capitaleSociale.toFixed(2) : null,
      socioUnico: (riga?.socioUnico as SocioUnico | null | undefined) ?? null,
      statoLiquidazione: (riga?.statoLiquidazione as StatoLiquidazione | undefined) ?? 'LN',
      registroIvaPredefinitoId: riga?.registroIvaPredefinitoId ?? null,
      idTrasmittenteCodice: riga?.idTrasmittenteCodice ?? null,
      versione: riga?.versione ?? 0,
      daTenant,
      completo: mancanti.length === 0,
      mancanti,
    }
  }
}

function normalizza(d: DatiCedente): Campi {
  const testo = (s: string | null | undefined) => (vuoto(s) ? null : s!.trim())
  return {
    regimeFiscale: d.regimeFiscale,
    reaUfficio: testo(d.reaUfficio),
    capitaleSociale: testo(d.capitaleSociale),
    socioUnico: d.socioUnico ?? null,
    statoLiquidazione: d.statoLiquidazione ?? 'LN',
    registroIvaPredefinitoId: d.registroIvaPredefinitoId ?? null,
    idTrasmittenteCodice: testo(d.idTrasmittenteCodice),
  }
}

function campiDa(r: RigaCedente): Campi {
  return {
    regimeFiscale: r.regimeFiscale,
    reaUfficio: r.reaUfficio,
    capitaleSociale:
      r.capitaleSociale === null ? null : new Prisma.Decimal(r.capitaleSociale).toFixed(2),
    socioUnico: r.socioUnico as SocioUnico | null,
    statoLiquidazione: r.statoLiquidazione as StatoLiquidazione,
    registroIvaPredefinitoId: r.registroIvaPredefinitoId,
    idTrasmittenteCodice: r.idTrasmittenteCodice,
  }
}

function nomiCambiati(prima: Campi, dopo: Campi): string[] {
  const norm = (c: Campi) => ({
    ...c,
    capitaleSociale:
      c.capitaleSociale === null ? null : new Prisma.Decimal(c.capitaleSociale).toFixed(2),
  })
  const a = norm(prima)
  const b = norm(dopo)
  return (Object.keys(a) as (keyof Campi)[]).filter(k => a[k] !== b[k])
}

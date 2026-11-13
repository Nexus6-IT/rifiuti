// Accessi alla pesa: apertura con la prima pesata manuale, seconda pesata, annullo, elenco e
// dettaglio (D2, D5-D9, D11, D14).
//
// CONCORRENZA. Ordine dei lock, uguale per ogni scrittura su un accesso (vedi
// `blocchi-accesso.ts`): 1) advisory `accesso-pesa|<id>`, 2) `SELECT ... FOR UPDATE` sulla riga
// dell'accesso. Lo prendono, PRIMA di toccare pesate o stato, la seconda pesata (che inserisce e
// chiude) e l'annullo; l'apertura crea l'accesso nella propria transazione (nessun altro lo vede
// prima del commit). I trigger del database leggono l'accesso con `FOR SHARE`: con l'advisory
// sempre per primo nessuna transazione puo' aspettare la riga mentre ne tiene un'altra.
// Altri lock: `accessi-pesa|<registro>|<anno>` per la numerazione, `pesata-chiave|<tenant>|<chiave>`
// per l'idempotenza, e l'automezzo `FOR UPDATE` per la tara dichiarata. Mai FOR UPDATE su pesate,
// rettifiche e allegati (privilegi D4).
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { annoSolareItaliano, giornoItaliano } from '../../core/time/anno-italiano'
import { cerCanonico } from '../../domain/waste-movement/cer-registro'
import { calcolaNetto, type PesataPerNetto } from '../../domain/pese/netto-accesso'
import { normalizzaTarga } from '../../domain/pese/targa'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RUOLI_OPERATORE_PESA, RUOLI_RESPONSABILE_PESA } from '../../api/pese/ruoli-pesa'
import { cerNelCatalogo, normalizzaCerCode } from '../registro/cer-catalogo'
import { RegistriService, RegistroNonTrovatoError } from '../registro/registri.service'
import type {
  AperturaAccessoDati,
  FileCaricato,
  FiltriAccessi,
  PesataDaLetturaDati,
  PesataManualeDati,
  SecondaPesataDati,
  UtentePesa,
} from './accessi-pesa.tipi'
import { eDaLettura } from './accessi-pesa.tipi'
import { AllegatiPesaService } from './allegati-pesa.service'
import { AutomezziService } from './automezzi.service'
import { bloccaAccesso, bloccaAutomezzo, bloccaChiaveIdempotenza } from './blocchi-accesso'
import {
  AccessoNonTrovatoError,
  AlibiGiaUsatoError,
  DatiPesaNonValidiError,
  PesataNonTrovataError,
  RegolaPesataError,
  RuoloPesaInsufficienteError,
  StatoAccessoNonValidoError,
} from './errori-pese'
import { MSG_TRIGGER, MSG_TRIGGER_INCOERENZA } from './messaggi-trigger-pese'
import { nelContestoTenant } from './nel-contesto-tenant'
import {
  MSG_LETTURA_GIA_USATA,
  inserisciPesataDaLettura,
  inserisciPesataManuale,
  inserisciPesataTaraAnagrafica,
  type PesataScritta,
} from './pesate-scrittura'
import { StrumentiPesaService, type StrumentoVista } from './strumenti-pesa.service'
import {
  leggiRiepiloghi,
  leggiVistaAccesso,
  type AccessoRiepilogo,
  type AccessoVista,
} from './viste-accesso'

export const ACCESSI_PER_PAGINA = 20

const MSG_NON_SECONDA = 'Solo un accesso a doppia pesata ancora aperto accetta la seconda pesata.'

/** Colonne dell'indice violato: `meta.target` di Prisma 5 (nomi di colonna, o del vincolo). */
function targetDi(err: Prisma.PrismaClientKnownRequestError): string[] {
  const t = err.meta?.target
  if (Array.isArray(t)) return t.map(String)
  return typeof t === 'string' ? [t] : []
}

const haColonna = (target: string[], parte: string) => target.some(c => c.includes(parte))

/**
 * Violazioni del database che il servizio non ha anticipato (corse residue): mai un errore
 * Postgres grezzo all'utente, sempre un errore di dominio in italiano.
 * - P2002: si riconosce dalle COLONNE di `meta.target` (come `correggi-movimento.use-case`);
 *   senza target si chiama `rileggi`, che rilegge il database per capire quale unicita' e' stata
 *   violata (il chiamante la esegue FUORI dalla transazione abortita).
 * - Trigger: uguaglianza col testo esatto dei messaggi (`messaggi-trigger-pese.ts`), mai regex
 *   generiche: un "riga immutabile" resta un guasto e non diventa "pesata non coerente".
 */
export async function traduciErroreDatabase(
  err: unknown,
  rileggi?: () => Promise<unknown | null>
): Promise<unknown> {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = targetDi(err)
    if (haColonna(target, 'lettura_id')) {
      return new StatoAccessoNonValidoError(MSG_LETTURA_GIA_USATA)
    }
    if (haColonna(target, 'chiave_idempotenza')) {
      return new StatoAccessoNonValidoError('Questa pesata è già stata registrata.')
    }
    if (haColonna(target, 'alibi_id')) return new AlibiGiaUsatoError()
    if (haColonna(target, 'pesata_id')) {
      return new StatoAccessoNonValidoError(
        'Un’altra rettifica era in corso su questa pesata: riprovare.'
      )
    }
    if (haColonna(target, 'anno') || haColonna(target, 'numero')) {
      return new StatoAccessoNonValidoError('Numero di accesso già assegnato: riprovare.')
    }
    if (haColonna(target, 'ordine')) {
      return new StatoAccessoNonValidoError('La pesata di questo passaggio è già stata registrata.')
    }
    if (target.length === 0 && rileggi) {
      const trovato = await rileggi()
      if (trovato) return trovato
    }
    return new StatoAccessoNonValidoError(
      'Un’altra operazione sullo stesso dato era in corso: riprovare.'
    )
  }
  const testo = String((err as { message?: unknown })?.message ?? '')
  const ha = (m: string) => testo.includes(m)
  if (ha(MSG_TRIGGER.accessoNonAperto)) {
    return new StatoAccessoNonValidoError("L'accesso non è più aperto.")
  }
  if (ha(MSG_TRIGGER.accessoNonTrovato)) return new AccessoNonTrovatoError()
  if (ha(MSG_TRIGGER.mancaPrima) || ha(MSG_TRIGGER.pesateInsufficienti)) {
    return new StatoAccessoNonValidoError("L'accesso non ha ancora tutte le pesate necessarie.")
  }
  if (ha(MSG_TRIGGER.collegamentoAttivo)) {
    return new StatoAccessoNonValidoError('Prima revocare i collegamenti.')
  }
  if (ha(MSG_TRIGGER.accessoAnnullatoNonModificabile)) {
    return new StatoAccessoNonValidoError("L'accesso è già annullato.")
  }
  if (ha(MSG_TRIGGER.transizioneNonAmmessa)) {
    return new StatoAccessoNonValidoError(
      'Questa operazione non è ammessa nello stato attuale dell’accesso.'
    )
  }
  if (ha(MSG_TRIGGER.rettificaPesataNonTrovata)) return new PesataNonTrovataError()
  if (ha(MSG_TRIGGER.rettificaTara)) {
    return new StatoAccessoNonValidoError('La tara dichiarata non si rettifica.')
  }
  if (ha(MSG_TRIGGER.rettificaAccessoAnnullato)) {
    return new StatoAccessoNonValidoError("L'accesso è annullato: il peso non si rettifica.")
  }
  if (ha(MSG_TRIGGER.rettificaNumero) || ha(MSG_TRIGGER.rettificaPesoPrecedente)) {
    return new StatoAccessoNonValidoError(
      'Un’altra rettifica era in corso su questa pesata: riprovare.'
    )
  }
  if (ha(MSG_TRIGGER.collegamentoAccessoNonChiuso)) {
    return new StatoAccessoNonValidoError('Si può collegare solo un accesso chiuso.')
  }
  if (ha(MSG_TRIGGER.collegamentoGiaRevocato)) {
    return new StatoAccessoNonValidoError('Il collegamento è già stato revocato.')
  }
  if (MSG_TRIGGER_INCOERENZA.some(ha)) {
    return new RegolaPesataError(['La pesata non è coerente con il modo dell’accesso.'])
  }
  return err
}

/** Istante delle 00:00 italiane del giorno 'AAAA-MM-GG' (ora legale o solare). */
function mezzanotteRoma(giorno: string): Date {
  for (const offset of ['+02:00', '+01:00']) {
    const d = new Date(`${giorno}T00:00:00${offset}`)
    if (
      !Number.isNaN(d.getTime()) &&
      giornoItaliano(d) === giorno &&
      giornoItaliano(new Date(d.getTime() - 60 * 60 * 1000)) !== giorno
    ) {
      return d
    }
  }
  return new Date(`${giorno}T00:00:00Z`)
}

const testoOpzionale = (s: string | null | undefined, max: number, nome: string, e: string[]) => {
  const t = s?.trim()
  if (!t) return null
  if (t.length > max) e.push(`${nome} può avere al massimo ${max} caratteri.`)
  return t
}

@Injectable()
export class AccessiPesaService {
  /** Sostituibile nei test. */
  protected adesso: () => Date = () => new Date()

  constructor(
    private readonly prisma: PrismaService,
    private readonly registri: RegistriService,
    private readonly strumenti: StrumentiPesaService,
    private readonly automezzi: AutomezziService,
    private readonly allegati: AllegatiPesaService
  ) {}

  async apri(
    tenantId: string,
    utente: UtentePesa,
    dati: AperturaAccessoDati,
    allegato?: FileCaricato
  ): Promise<AccessoVista> {
    this.richiediOperatore(utente)
    return nelContestoTenant(tenantId, async () => {
      const registro = await this.registri.risolviInLettura(tenantId, dati.registroId ?? undefined)
      if (!registro.attivo) throw new RegistroNonTrovatoError()
      try {
        return await this.prisma.$transaction(
          async tx => {
            await bloccaChiaveIdempotenza(tx, tenantId, dati.chiaveIdempotenza)
            const gia = await this.accessoDellaChiave(tx, tenantId, dati.chiaveIdempotenza)
            if (gia)
              return {
                ...(await leggiVistaAccesso(tx, tenantId, gia, this.adesso())),
                giaRegistrata: true as const,
              }

            const adesso = this.adesso()
            const errori: string[] = []
            const campi = this.campiDescrittivi(dati, errori)
            if (errori.length > 0) throw new DatiPesaNonValidiError(errori)

            // Automezzo: le targhe dell'anagrafica vincono su quelle digitate
            let targa: string | null = null
            let targaRimorchio: string | null = null
            let automezzoId: string | null = null
            if (dati.automezzoId) {
              const mezzo = await this.automezzi.leggiPerAccesso(tx, tenantId, dati.automezzoId)
              if (!mezzo.attivo) throw new RegolaPesataError(["L'automezzo non è attivo."])
              automezzoId = mezzo.id
              targa = mezzo.targa
              targaRimorchio = mezzo.targaRimorchio
            } else {
              if (dati.targa?.trim()) {
                targa = normalizzaTarga(dati.targa)
                if (!targa) errori.push('Targa non valida.')
              }
              if (dati.targaRimorchio?.trim()) {
                targaRimorchio = normalizzaTarga(dati.targaRimorchio)
                if (!targaRimorchio) errori.push('Targa del rimorchio non valida.')
              }
              if (errori.length > 0) throw new DatiPesaNonValidiError(errori)
            }
            if (dati.modo === 'TARA_ANAGRAFICA' && !automezzoId) {
              throw new RegolaPesataError([
                'La tara dichiarata richiede un automezzo dell’anagrafica.',
              ])
            }

            let cerCode: string | null = null
            if (dati.cerCode?.trim()) {
              cerCode = await cerNelCatalogo(tx, normalizzaCerCode(dati.cerCode))
              if (!cerCode) {
                throw new DatiPesaNonValidiError(['Il codice CER non è nel catalogo.'])
              }
              cerCode = cerCanonico(cerCode)
            }

            const daLettura = eDaLettura(dati.pesata)
            if (daLettura && allegato) {
              throw new RegolaPesataError(['Una pesata da strumento non ha un allegato.'])
            }
            const strumento = eDaLettura(dati.pesata)
              ? null
              : await this.leggiStrumento(tx, tenantId, dati.pesata)
            if (!daLettura) this.verificaSedeStrumento(strumento, registro.id)
            // Tara dichiarata: l'automezzo si blocca PRIMA di creare l'accesso (vedi ordine dei lock)
            if (dati.modo === 'TARA_ANAGRAFICA') {
              await bloccaAutomezzo(tx, tenantId, automezzoId as string)
            }
            const anno = annoSolareItaliano(adesso)
            const numero = await this.prossimoNumero(tx, tenantId, registro.id, anno)
            const accesso = await tx.accessoPesa.create({
              data: {
                tenantId,
                registroId: registro.id,
                anno,
                numero,
                verso: dati.verso,
                modo: dati.modo,
                automezzoId,
                targa,
                targaRimorchio,
                cerCode,
                descrizione: campi.descrizione,
                note: campi.note,
                apertoDa: utente.id,
              },
            })
            const contesto = {
              tenantId,
              utenteId: utente.id,
              accessoId: accesso.id,
              modo: dati.modo,
              chiaveIdempotenza: dati.chiaveIdempotenza,
              adesso,
            }
            const prima = eDaLettura(dati.pesata)
              ? await inserisciPesataDaLettura(
                  tx,
                  { ...contesto, registroId: registro.id, ordine: 1 },
                  dati.pesata.letturaId
                )
              : await inserisciPesataManuale(
                  tx,
                  { ...contesto, ordine: 1, strumento, allegati: this.allegati },
                  dati.pesata,
                  allegato
                )
            await this.audit(
              tx,
              tenantId,
              utente.id,
              'PESA_ACCESSO_APERTO',
              'Accesso alla pesa aperto',
              {
                accessoId: accesso.id,
                modo: dati.modo,
                verso: dati.verso,
                ...(eDaLettura(dati.pesata) ? { letturaId: dati.pesata.letturaId } : {}),
              }
            )
            const scritte: PesataScritta[] = [prima]
            if (dati.modo === 'TARA_ANAGRAFICA') {
              scritte.push(await inserisciPesataTaraAnagrafica(tx, contesto, automezzoId as string))
            }
            if (dati.modo !== 'DOPPIA') {
              await this.chiudi(tx, tenantId, utente.id, accesso, scritte, adesso)
            }
            return leggiVistaAccesso(tx, tenantId, accesso.id, adesso)
          },
          { timeout: 15_000, maxWait: 5_000 }
        )
      } catch (err) {
        throw await traduciErroreDatabase(err, () => this.rileggiConflitto(tenantId, dati))
      }
    })
  }

  async secondaPesata(
    tenantId: string,
    utente: UtentePesa,
    accessoId: string,
    dati: SecondaPesataDati,
    allegato?: FileCaricato
  ): Promise<AccessoVista> {
    this.richiediOperatore(utente)
    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(
          async tx => {
            await bloccaChiaveIdempotenza(tx, tenantId, dati.chiaveIdempotenza)
            const gia = await this.accessoDellaChiave(tx, tenantId, dati.chiaveIdempotenza)
            if (gia) {
              if (gia !== accessoId) {
                throw new StatoAccessoNonValidoError('Questa pesata è già stata registrata.')
              }
              return {
                ...(await leggiVistaAccesso(tx, tenantId, gia, this.adesso())),
                giaRegistrata: true as const,
              }
            }
            // advisory + FOR UPDATE prima di leggere stato e pesate
            const accesso = await bloccaAccesso(tx, tenantId, accessoId)
            if (accesso.stato !== 'APERTO' || accesso.modo !== 'DOPPIA') {
              throw new StatoAccessoNonValidoError(MSG_NON_SECONDA)
            }
            const prima = await tx.pesata.findFirst({
              where: { accessoId, tenantId, ordine: 1 },
            })
            if (!prima) throw new StatoAccessoNonValidoError(MSG_NON_SECONDA)
            const adesso = this.adesso()
            if (eDaLettura(dati.pesata) && allegato) {
              throw new RegolaPesataError(['Una pesata da strumento non ha un allegato.'])
            }
            let seconda: PesataScritta
            if (eDaLettura(dati.pesata)) {
              seconda = await inserisciPesataDaLettura(
                tx,
                {
                  tenantId,
                  utenteId: utente.id,
                  accessoId,
                  registroId: accesso.registroId,
                  ordine: 2,
                  modo: 'DOPPIA',
                  chiaveIdempotenza: dati.chiaveIdempotenza,
                  adesso,
                  prima: { letturaId: prima.letturaId, oraStrumento: prima.oraStrumento },
                },
                dati.pesata.letturaId
              )
            } else {
              const strumento = await this.leggiStrumento(tx, tenantId, dati.pesata)
              this.verificaSedeStrumento(strumento, accesso.registroId)
              seconda = await inserisciPesataManuale(
                tx,
                {
                  tenantId,
                  utenteId: utente.id,
                  accessoId,
                  ordine: 2,
                  modo: 'DOPPIA',
                  chiaveIdempotenza: dati.chiaveIdempotenza,
                  adesso,
                  strumento,
                  oraPrimaPesata: prima.oraStrumento,
                  allegati: this.allegati,
                },
                dati.pesata,
                allegato
              )
            }
            const primaScritta: PesataScritta = {
              id: prima.id,
              ordine: 1,
              fonte: prima.fonte,
              pesoKg: Number(prima.pesoKg),
              stabile: prima.stabile,
              oraStrumento: prima.oraStrumento,
              oraRicezione: prima.oraRicezione,
              taraAggiornataIl: prima.taraAggiornataIl,
              automezzoId: prima.automezzoId,
              avvisi: [],
            }
            await this.chiudi(tx, tenantId, utente.id, accesso, [primaScritta, seconda], adesso)
            return leggiVistaAccesso(tx, tenantId, accessoId, adesso)
          },
          { timeout: 15_000, maxWait: 5_000 }
        )
      } catch (err) {
        throw await traduciErroreDatabase(err, () => this.rileggiConflitto(tenantId, dati))
      }
    })
  }

  async annulla(
    tenantId: string,
    utente: UtentePesa,
    accessoId: string,
    motivo: string
  ): Promise<AccessoVista> {
    this.richiediOperatore(utente)
    const testo = motivo?.trim() ?? ''
    if (!testo) throw new DatiPesaNonValidiError(['Il motivo dell’annullamento è obbligatorio.'])
    if (testo.length > 500) {
      throw new DatiPesaNonValidiError(['Il motivo può avere al massimo 500 caratteri.'])
    }
    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(
          async tx => {
            const accesso = await bloccaAccesso(tx, tenantId, accessoId)
            if (accesso.stato === 'ANNULLATO') {
              throw new StatoAccessoNonValidoError("L'accesso è già annullato.")
            }
            if (accesso.stato === 'CHIUSO' && !RUOLI_RESPONSABILE_PESA.includes(utente.ruolo)) {
              throw new RuoloPesaInsufficienteError(
                "Solo un amministratore dell'azienda può annullare un accesso chiuso."
              )
            }
            const attivi = await tx.collegamentoAccesso.count({
              where: { tenantId, accessoId, revocatoIl: null },
            })
            if (attivi > 0) throw new StatoAccessoNonValidoError('Prima revocare i collegamenti.')
            const adesso = this.adesso()
            await tx.accessoPesa.update({
              where: { id: accessoId },
              data: {
                stato: 'ANNULLATO',
                annullatoDa: utente.id,
                annullatoIl: adesso,
                motivoAnnullamento: testo,
              },
            })
            await this.audit(
              tx,
              tenantId,
              utente.id,
              'PESA_ACCESSO_ANNULLATO',
              'Accesso alla pesa annullato',
              {
                accessoId,
                statoPrecedente: accesso.stato,
                motivoLunghezza: testo.length,
              }
            )
            return leggiVistaAccesso(tx, tenantId, accessoId, adesso)
          },
          { timeout: 15_000, maxWait: 5_000 }
        )
      } catch (err) {
        throw await traduciErroreDatabase(err)
      }
    })
  }

  async elenca(
    tenantId: string,
    filtri: FiltriAccessi = {}
  ): Promise<{ righe: AccessoRiepilogo[]; totale: number; pagina: number }> {
    const pagina = Math.max(1, Math.trunc(filtri.pagina ?? 1) || 1)
    const targa = filtri.targa?.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const where: Prisma.AccessoPesaWhereInput = {
      tenantId,
      ...(filtri.registroId ? { registroId: filtri.registroId } : {}),
      ...(filtri.stato ? { stato: filtri.stato } : {}),
      ...(targa ? { targa: { contains: targa } } : {}),
      ...this.intervalloGiorni(filtri.dal, filtri.al),
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const [totale, accessi] = await Promise.all([
          tx.accessoPesa.count({ where }),
          tx.accessoPesa.findMany({
            where,
            orderBy: [{ apertoIl: 'desc' }, { numero: 'desc' }],
            skip: (pagina - 1) * ACCESSI_PER_PAGINA,
            take: ACCESSI_PER_PAGINA,
          }),
        ])
        return {
          righe: await leggiRiepiloghi(tx, tenantId, accessi, this.adesso()),
          totale,
          pagina,
        }
      })
    )
  }

  async dettaglio(tenantId: string, accessoId: string): Promise<AccessoVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx => leggiVistaAccesso(tx, tenantId, accessoId, this.adesso()))
    )
  }

  // ---------------------------------------------------------------------------------------

  private richiediOperatore(utente: UtentePesa): void {
    if (!RUOLI_OPERATORE_PESA.includes(utente.ruolo)) {
      throw new RuoloPesaInsufficienteError(
        "Il tuo ruolo nell'azienda selezionata non consente di operare sulle pese."
      )
    }
  }

  private campiDescrittivi(dati: AperturaAccessoDati, errori: string[]) {
    return {
      descrizione: testoOpzionale(dati.descrizione, 255, 'La descrizione', errori),
      note: testoOpzionale(dati.note, 1000, 'Le note', errori),
    }
  }

  private async leggiStrumento(
    tx: Prisma.TransactionClient,
    tenantId: string,
    pesata: PesataManualeDati
  ): Promise<StrumentoVista | null> {
    return pesata.strumentoId
      ? this.strumenti.leggiPerPesata(tx, tenantId, pesata.strumentoId)
      : null
  }

  /** Uno strumento legato a una sede si usa solo nel registro di quella sede; senza sede e' di tutti. */
  private verificaSedeStrumento(strumento: StrumentoVista | null, registroId: string): void {
    if (strumento?.registroId && strumento.registroId !== registroId) {
      throw new RegolaPesataError(['Lo strumento appartiene a un’altra sede.'])
    }
  }

  /**
   * Dopo una P2002 senza `meta.target` (transazione abortita, quindi FUORI da essa) rilegge il
   * database per capire quale unicita' e' stata violata.
   */
  private async rileggiConflitto(
    tenantId: string,
    dati: { chiaveIdempotenza: string; pesata: PesataManualeDati | PesataDaLetturaDati }
  ): Promise<unknown | null> {
    const stessa = await this.prisma.pesata.findFirst({
      where: { tenantId, chiaveIdempotenza: dati.chiaveIdempotenza },
      select: { id: true },
    })
    if (stessa) return new StatoAccessoNonValidoError('Questa pesata è già stata registrata.')
    if (eDaLettura(dati.pesata)) {
      const lettura = await this.prisma.pesata.findFirst({
        where: { tenantId, letturaId: dati.pesata.letturaId },
        select: { id: true },
      })
      return lettura ? new StatoAccessoNonValidoError(MSG_LETTURA_GIA_USATA) : null
    }
    if (dati.pesata.strumentoId && dati.pesata.alibiId?.trim()) {
      const alibi = await this.prisma.pesata.findFirst({
        where: {
          tenantId,
          strumentoId: dati.pesata.strumentoId,
          alibiId: dati.pesata.alibiId.trim(),
        },
        select: { id: true },
      })
      if (alibi) return new AlibiGiaUsatoError()
    }
    return null
  }

  private async accessoDellaChiave(
    tx: Prisma.TransactionClient,
    tenantId: string,
    chiave: string
  ): Promise<string | null> {
    const p = await tx.pesata.findFirst({
      where: { tenantId, chiaveIdempotenza: chiave },
      select: { accessoId: true },
    })
    return p?.accessoId ?? null
  }

  /** `MAX(numero)+1` per registro e anno, con lock D9; l'unico del database e' la rete. */
  private async prossimoNumero(
    tx: Prisma.TransactionClient,
    tenantId: string,
    registroId: string,
    anno: number
  ): Promise<number> {
    const chiave = `accessi-pesa|${registroId}|${anno}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
    const r = await tx.accessoPesa.aggregate({
      where: { tenantId, registroId, anno },
      _max: { numero: true },
    })
    return (r._max.numero ?? 0) + 1
  }

  /**
   * Chiude l'accesso: il netto si calcola dalle pesate appena scritte; `NON_VALIDO` (lordo <=
   * tara, pesata instabile) e' 422 col messaggio di D6 e fa annullare tutta la transazione:
   * nessuna pesata, e per l'apertura nemmeno l'accesso. Un accesso INCOMPLETO non si chiude.
   */
  private async chiudi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    accesso: {
      id: string
      verso: 'CARICO' | 'SCARICO'
      modo: 'DOPPIA' | 'TARA_ANAGRAFICA' | 'SINGOLA'
    },
    pesate: PesataScritta[],
    adesso: Date
  ): Promise<void> {
    // Una pesata gia' rettificata mentre l'accesso era APERTO conta col peso in vigore.
    const rettifiche = pesate.length
      ? await tx.rettificaPeso.findMany({
          where: { tenantId, pesataId: { in: pesate.map(p => p.id) } },
          select: { pesataId: true, numero: true, pesoNuovoKg: true },
        })
      : []
    const perNetto: PesataPerNetto[] = pesate.map(p => ({
      ordine: p.ordine,
      fonte: p.fonte,
      pesoKg: p.pesoKg,
      rettifiche: rettifiche
        .filter(r => r.pesataId === p.id)
        .map(r => ({ numero: r.numero, pesoNuovoKg: Number(r.pesoNuovoKg) })),
      stabile: p.stabile,
      taraAggiornataIl: p.taraAggiornataIl ? p.taraAggiornataIl.toISOString() : null,
    }))
    const netto = calcolaNetto(accesso.verso, accesso.modo, perNetto, giornoItaliano(adesso))
    if (netto.stato !== 'CALCOLATO') {
      throw new RegolaPesataError([netto.errore ?? 'Il netto non si può calcolare.'])
    }
    await tx.accessoPesa.update({
      where: { id: accesso.id },
      data: { stato: 'CHIUSO', chiusoDa: utenteId, chiusoIl: adesso },
    })
    await this.audit(tx, tenantId, utenteId, 'PESA_ACCESSO_CHIUSO', 'Accesso alla pesa chiuso', {
      accessoId: accesso.id,
      nettoKg: netto.nettoKg,
      qualita: netto.qualita,
    })
  }

  private intervalloGiorni(dal?: string, al?: string): Prisma.AccessoPesaWhereInput {
    const giorno = /^\d{4}-\d{2}-\d{2}$/
    const range: { gte?: Date; lt?: Date } = {}
    if (dal && giorno.test(dal)) range.gte = mezzanotteRoma(dal)
    if (al && giorno.test(al)) {
      const successivo = new Date(`${al}T12:00:00Z`)
      successivo.setUTCDate(successivo.getUTCDate() + 1)
      range.lt = mezzanotteRoma(successivo.toISOString().slice(0, 10))
    }
    return range.gte || range.lt ? { apertoIl: range } : {}
  }

  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    action: string,
    description: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await tx.activityLog.create({
      data: { tenantId, userId, action, description, metadata: metadata as Prisma.InputJsonValue },
    })
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { DomainError } from '../../core/domain/errors'
import { annoSolareItaliano, giornoItaliano } from '../../core/time/anno-italiano'
import { cerSoloCifre } from '../../domain/waste-movement/cer-registro'
import { normalizzaUnitaRegistro } from '../../domain/waste-movement/unita-misura-registro'
import { formattaQuantita } from '../../core/format/formatta-quantita'
import { cerNelCatalogo, normalizzaCerCode } from './cer-catalogo'
import { chiaveLockGiacenza } from './chiave-lock-giacenza'
import { sqlVigente } from '../../domain/waste-movement/vigenza'
import { RegistriService, RegistroNonTrovatoError } from './registri.service'

/** Relazione iniziale RENTRI: carico (anno, protocollo) che compone la giacenza (F2-9). */
export interface OrigineGiacenza {
  anno: number
  protocollo: number
  quantita?: number
}

export interface DatiGiacenzaIniziale {
  cerCode: string
  statoFisico?: string | null
  quantita: number
  unita: string
  /** Giorno italiano 'AAAA-MM-GG' dal quale la quantità è in deposito. */
  dataRiferimento: string
  origini?: OrigineGiacenza[]
  note?: string | null
}

/** Tutti i campi tranne CER e registro, che non si modificano (si cancella e si ricrea). */
export type DatiModificaGiacenzaIniziale = Omit<DatiGiacenzaIniziale, 'cerCode'>

export interface GiacenzaInizialeVista {
  id: string
  registroId: string
  cerCode: string
  statoFisico: string | null
  quantita: number
  unita: string
  /** 'AAAA-MM-GG', mai un ISO a mezzanotte UTC. */
  dataRiferimento: string
  origini: OrigineGiacenza[]
  provenienza: 'MANUALE' | 'IMPORTAZIONE'
  note: string | null
  impostatoDa: string
  createdAt: Date
  updatedAt: Date
}

export interface GiacenzaInizialeInElenco extends GiacenzaInizialeVista {
  /** Falso se uno scarico dello stesso CER è stato registrato dopo l'apertura (G4). */
  modificabile: boolean
}

export interface ElencoGiacenzeIniziali {
  /** null se il registro non si determina: elenco vuoto, nulla da mostrare. */
  registroId: string | null
  voci: GiacenzaInizialeInElenco[]
}

export interface EsitoCreazioneGiacenzaIniziale {
  giacenza: GiacenzaInizialeVista
  avvisi: string[]
}

const QUANTITA_MASSIMA = 99_999_999.99
const ANNO_ORIGINE_MINIMO = 1990
const ORIGINI_MASSIME = 200
const AVVISO_ALTRO_CARICO_ESEMPI = 5

const MSG_USATA =
  'Esiste uno scarico dello stesso CER registrato dopo questa giacenza iniziale: non si può ' +
  'più modificare né cancellare. Per correggerla serve una rettifica del registro ' +
  "(non ancora disponibile): contatta l'assistenza."

const MSG_DUPLICATA =
  'Esiste già una giacenza iniziale per questo CER, stato fisico e unità di misura nel ' +
  'registro (kg e tonnellate sono la stessa unità): modificala o cancellala.'

type Client = Prisma.TransactionClient

type RigaGiacenza = Prisma.GiacenzaInizialeGetPayload<Record<string, never>>

/** Famiglia di unità: kg e t sono la stessa (si sommano), le altre restano a parte. */
function famigliaUnita(unita: string): string {
  return normalizzaUnitaRegistro(unita).massa ? 'MASSA' : unita
}

function giornoComeData(giorno: string): Date {
  return new Date(`${giorno}T00:00:00.000Z`)
}

function dataComeGiorno(data: Date): string {
  return data.toISOString().slice(0, 10)
}

function centesimi(n: number): number {
  return Math.round(n * 100)
}

/** Vero se `n` ha al più 2 decimali (tolleranza per la rappresentazione binaria). */
function haAlPiuDueDecimali(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
}

function eViolazioneUnico(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

function comeVista(r: RigaGiacenza): GiacenzaInizialeVista {
  return {
    id: r.id,
    registroId: r.registroId,
    cerCode: r.cerCode,
    statoFisico: r.statoFisico,
    quantita: Number(r.quantita),
    unita: r.unita,
    dataRiferimento: dataComeGiorno(r.dataRiferimento),
    origini: (Array.isArray(r.origini) ? r.origini : []) as unknown as OrigineGiacenza[],
    provenienza: r.provenienza,
    note: r.note,
    impostatoDa: r.impostatoDa,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

interface DatiNormalizzati {
  statoFisico: string | null
  quantita: number
  unita: string
  dataRiferimento: string
  origini: OrigineGiacenza[]
  note: string | null
}

/**
 * Giacenze iniziali (aperture) del registro (Fase 2 pezzo 2).
 *
 * Una apertura è la quantità già in deposito di un CER quando si comincia a usare il registro:
 * entra nei saldi come un carico del giorno `dataRiferimento` ma non è un movimento (nessun
 * progressivo, nessuna riga del MUD). Il tenant lo imposta SOLO l'estensione del `PrismaService`,
 * dal contesto; i `tenantId` espliciti nei `where` sono una cintura in più oltre alla RLS.
 *
 * Concorrenza (G5): creazione, modifica e cancellazione prendono lo stesso advisory lock dello
 * scarico (`chiaveLockGiacenza`), così uno scarico concorrente o vede l'apertura o la aspetta.
 * Gli scarichi in unità non di massa non prendono il lock (non si controllano): corsa innocua.
 */
@Injectable()
export class GiacenzeInizialiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registri: RegistriService
  ) {}

  async elenca(tenantId: string, registroId?: string): Promise<ElencoGiacenzeIniziali> {
    // Lettura pura (è dietro una GET): niente preparaRegistri, che può fare INSERT. Senza registro
    // determinabile l'elenco è vuoto; un registroId esplicito inesistente è un 404.
    return this.prisma.$transaction(async tx => {
      let registro
      try {
        registro = await this.registri.risolvi(tx, tenantId, registroId)
      } catch (err) {
        if (!(err instanceof DomainError)) throw err
        if (registroId && err instanceof RegistroNonTrovatoError) {
          throw new NotFoundException(err.message)
        }
        return { registroId: null, voci: [] }
      }

      const righe = await tx.giacenzaIniziale.findMany({
        where: { tenantId, registroId: registro.id },
        orderBy: [{ cerCode: 'asc' }, { statoFisico: 'asc' }, { unita: 'asc' }],
      })
      if (righe.length === 0) return { registroId: registro.id, voci: [] }

      // Una sola query per il registro: l'ultimo scarico per CER (sole cifre).
      const scarichi = await tx.$queryRaw<Array<{ cifre: string; ultimo: Date }>>`
        SELECT regexp_replace(cer_code, '[^0-9]', '', 'g') AS cifre, MAX(created_at) AS ultimo
        FROM waste_movements
        WHERE tenant_id = ${tenantId}::uuid
          AND registro_id = ${registro.id}::uuid
          AND type = 'SCARICO'
        GROUP BY 1`
      const ultimoScarico = new Map(scarichi.map(s => [s.cifre, new Date(s.ultimo).getTime()]))

      return {
        registroId: registro.id,
        voci: righe.map(r => {
          const ultimo = ultimoScarico.get(cerSoloCifre(r.cerCode))
          return {
            ...comeVista(r),
            modificabile: ultimo === undefined || ultimo < r.createdAt.getTime(),
          }
        }),
      }
    })
  }

  async crea(
    tenantId: string,
    userId: string,
    dati: DatiGiacenzaIniziale,
    registroId?: string
  ): Promise<EsitoCreazioneGiacenzaIniziale> {
    const cerRichiesto = normalizzaCerCode(dati.cerCode ?? '')
    if (cerSoloCifre(cerRichiesto).length === 0) {
      throw new BadRequestException('Indica il codice CER.')
    }
    const cerCode = await cerNelCatalogo(this.prisma, cerRichiesto)
    if (!cerCode) throw new BadRequestException(`Codice CER non valido: ${dati.cerCode}`)
    const valori = this.normalizza(dati)

    // Registri pronti prima della transazione (il lock di creazione non si annida con quello di giacenza).
    try {
      await this.registri.preparaRegistri(tenantId, registroId)
    } catch (err) {
      throw this.comeErroreHttp(err, registroId)
    }

    return this.prisma.$transaction(async tx => {
      let registro
      try {
        registro = await this.registri.risolvi(tx, tenantId, registroId)
      } catch (err) {
        throw this.comeErroreHttp(err, registroId)
      }

      await this.prendiLock(tx, registro.id, cerCode)

      await this.controllaUnicita(tx, tenantId, registro.id, cerCode, valori)

      let creata: RigaGiacenza
      try {
        creata = await tx.giacenzaIniziale.create({
          data: {
            tenantId,
            registroId: registro.id,
            cerCode,
            statoFisico: valori.statoFisico,
            quantita: valori.quantita,
            unita: valori.unita,
            dataRiferimento: giornoComeData(valori.dataRiferimento),
            origini: valori.origini as unknown as Prisma.InputJsonValue,
            provenienza: 'MANUALE',
            note: valori.note,
            impostatoDa: userId,
          },
        })
      } catch (err) {
        // Rete di sicurezza dell'indice unico: sotto il lock non dovrebbe scattare.
        if (eViolazioneUnico(err)) throw new ConflictException(MSG_DUPLICATA)
        throw err
      }

      const avvisi = await this.avvisoAltroCarico(tx, tenantId, registro.id, cerCode)

      await this.audit(tx, tenantId, userId, 'REGISTRO_GIACENZA_INIZIALE_CREATA', creata, 'creata')
      return { giacenza: comeVista(creata), avvisi }
    })
  }

  async modifica(
    tenantId: string,
    userId: string,
    id: string,
    dati: DatiModificaGiacenzaIniziale
  ): Promise<{ giacenza: GiacenzaInizialeVista }> {
    const valori = this.normalizza(dati)

    // (1) la riga esiste ed è dell'azienda: ci dice registro e CER per il lock.
    const iniziale = await this.prisma.giacenzaIniziale.findFirst({
      where: { id, tenantId },
      select: { registroId: true, cerCode: true },
    })
    if (!iniziale) throw new NotFoundException('Giacenza iniziale non trovata.')

    return this.prisma.$transaction(async tx => {
      // (2) lock, (3) rilettura: nel frattempo la riga può essere sparita.
      await this.prendiLock(tx, iniziale.registroId, iniziale.cerCode)
      const attuale = await tx.giacenzaIniziale.findFirst({ where: { id, tenantId } })
      if (!attuale) throw new NotFoundException('Giacenza iniziale non trovata.')

      // (4) G4
      await this.controllaNonUsata(tx, tenantId, attuale)
      // (5) di nuovo G3 sui valori nuovi (unità e stato fisico possono cambiare famiglia o collidere).
      await this.controllaUnicita(tx, tenantId, attuale.registroId, attuale.cerCode, valori, id)

      // (6) scrittura e audit
      let aggiornata: RigaGiacenza
      try {
        aggiornata = await tx.giacenzaIniziale.update({
          where: { id_tenantId: { id, tenantId } },
          data: {
            statoFisico: valori.statoFisico,
            quantita: valori.quantita,
            unita: valori.unita,
            dataRiferimento: giornoComeData(valori.dataRiferimento),
            origini: valori.origini as unknown as Prisma.InputJsonValue,
            note: valori.note,
          },
        })
      } catch (err) {
        if (eViolazioneUnico(err)) throw new ConflictException(MSG_DUPLICATA)
        throw err
      }
      await this.audit(
        tx,
        tenantId,
        userId,
        'REGISTRO_GIACENZA_INIZIALE_MODIFICATA',
        aggiornata,
        'modificata'
      )
      return { giacenza: comeVista(aggiornata) }
    })
  }

  async elimina(tenantId: string, userId: string, id: string): Promise<void> {
    const iniziale = await this.prisma.giacenzaIniziale.findFirst({
      where: { id, tenantId },
      select: { registroId: true, cerCode: true },
    })
    if (!iniziale) throw new NotFoundException('Giacenza iniziale non trovata.')

    await this.prisma.$transaction(async tx => {
      await this.prendiLock(tx, iniziale.registroId, iniziale.cerCode)
      const attuale = await tx.giacenzaIniziale.findFirst({ where: { id, tenantId } })
      if (!attuale) throw new NotFoundException('Giacenza iniziale non trovata.')

      await this.controllaNonUsata(tx, tenantId, attuale)

      await tx.giacenzaIniziale.delete({ where: { id_tenantId: { id, tenantId } } })
      await this.audit(
        tx,
        tenantId,
        userId,
        'REGISTRO_GIACENZA_INIZIALE_ELIMINATA',
        attuale,
        'eliminata'
      )
    })
  }

  // ---------------------------------------------------------------------------------------------

  /** G5: lo stesso lock dello scarico (`verificaGiacenza`). */
  private async prendiLock(tx: Client, registroId: string, cerCode: string): Promise<void> {
    const chiave = chiaveLockGiacenza(registroId, cerCode)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
  }

  /** G1, G2, G6: validazione e normalizzazione dei campi (senza accesso al database). */
  private normalizza(dati: DatiModificaGiacenzaIniziale): DatiNormalizzati {
    const quantita = dati.quantita
    if (
      typeof quantita !== 'number' ||
      !Number.isFinite(quantita) ||
      quantita <= 0 ||
      quantita > QUANTITA_MASSIMA
    ) {
      throw new BadRequestException(
        'La quantità deve essere maggiore di zero e al massimo 99.999.999,99.'
      )
    }
    if (!haAlPiuDueDecimali(quantita)) {
      throw new BadRequestException('La quantità può avere al massimo 2 decimali.')
    }

    const testoUnita = (dati.unita ?? '').trim()
    if (testoUnita === '') throw new BadRequestException("Indica l'unità di misura.")
    const unita = normalizzaUnitaRegistro(testoUnita).unita
    if (unita.length > 10) {
      throw new BadRequestException("L'unità di misura può avere al massimo 10 caratteri.")
    }

    const stato = (dati.statoFisico ?? '').trim().toUpperCase()
    if (stato.length > 50) {
      throw new BadRequestException('Lo stato fisico può avere al massimo 50 caratteri.')
    }

    const note = (dati.note ?? '').trim()
    if (note.length > 500) {
      throw new BadRequestException('Le note possono avere al massimo 500 caratteri.')
    }

    const giorno = dati.dataRiferimento
    if (
      typeof giorno !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(giorno) ||
      Number.isNaN(giornoComeData(giorno).getTime()) ||
      dataComeGiorno(giornoComeData(giorno)) !== giorno
    ) {
      throw new BadRequestException('La data di riferimento non è una data valida (AAAA-MM-GG).')
    }
    // Confronto fra stringhe 'AAAA-MM-GG': mai fra istanti.
    if (giorno > giornoItaliano(new Date())) {
      throw new BadRequestException('La data di riferimento non può essere nel futuro.')
    }

    return {
      statoFisico: stato === '' ? null : stato,
      quantita,
      unita,
      dataRiferimento: giorno,
      origini: this.validaOrigini(dati.origini, quantita),
      note: note === '' ? null : note,
    }
  }

  /** G2 */
  private validaOrigini(
    origini: OrigineGiacenza[] | undefined | null,
    quantita: number
  ): OrigineGiacenza[] {
    if (origini === undefined || origini === null) return []
    if (!Array.isArray(origini)) throw new BadRequestException('Le origini non sono valide.')
    if (origini.length > ORIGINI_MASSIME) {
      throw new BadRequestException(`Le origini possono essere al massimo ${ORIGINI_MASSIME}.`)
    }
    const annoMassimo = annoSolareItaliano(new Date())
    const viste = new Set<string>()
    const risultato: OrigineGiacenza[] = []
    for (const o of origini) {
      if (!o || !Number.isInteger(o.anno) || o.anno < ANNO_ORIGINE_MINIMO || o.anno > annoMassimo) {
        throw new BadRequestException(
          `L'anno di un'origine deve essere compreso fra ${ANNO_ORIGINE_MINIMO} e ${annoMassimo}.`
        )
      }
      if (!Number.isInteger(o.protocollo) || o.protocollo < 1) {
        throw new BadRequestException(
          "Il protocollo di un'origine deve essere un numero intero maggiore di zero."
        )
      }
      const chiave = `${o.anno}/${o.protocollo}`
      if (viste.has(chiave)) {
        throw new BadRequestException(`L'origine ${chiave} è indicata più di una volta.`)
      }
      viste.add(chiave)
      if (o.quantita === undefined || o.quantita === null) {
        risultato.push({ anno: o.anno, protocollo: o.protocollo })
        continue
      }
      if (typeof o.quantita !== 'number' || !Number.isFinite(o.quantita) || o.quantita <= 0) {
        throw new BadRequestException(
          `La quantità dell'origine ${chiave} deve essere maggiore di zero.`
        )
      }
      if (!haAlPiuDueDecimali(o.quantita)) {
        throw new BadRequestException(
          `La quantità dell'origine ${chiave} può avere al massimo 2 decimali.`
        )
      }
      risultato.push({ anno: o.anno, protocollo: o.protocollo, quantita: o.quantita })
    }
    if (risultato.length > 0 && risultato.every(o => o.quantita !== undefined)) {
      const somma = risultato.reduce((t, o) => t + centesimi(o.quantita as number), 0)
      if (somma > centesimi(quantita)) {
        throw new BadRequestException(
          `La somma delle quantità delle origini (${formattaQuantita(somma / 100)}) supera la ` +
            `quantità della giacenza (${formattaQuantita(quantita)}).`
        )
      }
    }
    return risultato
  }

  /** G3 sotto il lock: un'altra apertura dello stesso CER (con o senza "*"), stato fisico e famiglia di unità. */
  private async controllaUnicita(
    tx: Client,
    tenantId: string,
    registroId: string,
    cerCode: string,
    valori: DatiNormalizzati,
    escludiId?: string
  ): Promise<void> {
    const senzaStella = cerCode.replace(/\*$/, '')
    const candidate = await tx.giacenzaIniziale.findMany({
      where: {
        tenantId,
        registroId,
        cerCode: { in: [senzaStella, `${senzaStella}*`] },
        statoFisico: valori.statoFisico,
        ...(escludiId ? { id: { not: escludiId } } : {}),
      },
      select: { unita: true },
    })
    const famiglia = famigliaUnita(valori.unita)
    if (candidate.some(c => famigliaUnita(c.unita) === famiglia)) {
      throw new ConflictException(MSG_DUPLICATA)
    }
  }

  /** G4: usata = uno SCARICO dello stesso CER nel registro, registrato dopo l'apertura. */
  private async controllaNonUsata(tx: Client, tenantId: string, riga: RigaGiacenza): Promise<void> {
    const righe = await tx.$queryRaw<Array<{ trovato: number }>>`
      SELECT 1 AS trovato
      FROM waste_movements wm
      WHERE wm.tenant_id = ${tenantId}::uuid
        AND wm.registro_id = ${riga.registroId}::uuid
        AND wm.type = 'SCARICO'
        AND regexp_replace(wm.cer_code, '[^0-9]', '', 'g') = ${cerSoloCifre(riga.cerCode)}
        AND wm.created_at >= (
          SELECT gi.created_at FROM giacenze_iniziali gi
          WHERE gi.id = ${riga.id}::uuid AND gi.tenant_id = ${tenantId}::uuid
        )
      LIMIT 1`
    if (righe.length > 0) throw new ConflictException(MSG_USATA)
  }

  /** G8: avviso non bloccante se il registro ha già carichi "Altro carico" dello stesso CER. */
  private async avvisoAltroCarico(
    tx: Client,
    tenantId: string,
    registroId: string,
    cerCode: string
  ): Promise<string[]> {
    const movimenti = await tx.$queryRaw<
      Array<{ progressive_number: number; progressive_year: number }>
    >`
      SELECT progressive_number, progressive_year
      FROM waste_movements wm
      WHERE tenant_id = ${tenantId}::uuid
        AND registro_id = ${registroId}::uuid
        AND type = 'CARICO'
        AND causale = 'ALTRO_CARICO'
        AND ${sqlVigente('wm')}
        AND regexp_replace(cer_code, '[^0-9]', '', 'g') = ${cerSoloCifre(cerCode)}
      ORDER BY progressive_year, progressive_number
      LIMIT ${AVVISO_ALTRO_CARICO_ESEMPI}`
    if (movimenti.length === 0) return []
    const esempi = movimenti.map(m => `${m.progressive_number}/${m.progressive_year}`).join(', ')
    return [
      'Nel registro ci sono carichi «Altro carico» dello stesso CER: se servivano a registrare ' +
        'la stessa giacenza di apertura, la quantità è contata due volte ' +
        `(movimenti: ${esempi}).`,
    ]
  }

  private async audit(
    tx: Client,
    tenantId: string,
    userId: string,
    action: string,
    riga: RigaGiacenza,
    verbo: string
  ): Promise<void> {
    const quantita = Number(riga.quantita)
    const dataRiferimento = dataComeGiorno(riga.dataRiferimento)
    await tx.activityLog.create({
      data: {
        tenantId,
        userId,
        action,
        description:
          `Giacenza iniziale ${verbo}: CER ${riga.cerCode}, ` +
          `${formattaQuantita(quantita)} ${riga.unita} al ${dataRiferimento}`,
        metadata: {
          id: riga.id,
          registroId: riga.registroId,
          cerCode: riga.cerCode,
          quantita,
          unita: riga.unita,
          dataRiferimento,
        },
      },
    })
  }

  private comeErroreHttp(err: unknown, registroId?: string): unknown {
    if (!(err instanceof DomainError)) return err
    if (registroId && err instanceof RegistroNonTrovatoError) {
      return new NotFoundException(err.message)
    }
    return new BadRequestException(err.message)
  }
}

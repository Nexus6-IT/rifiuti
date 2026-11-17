import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  eGiornoDiCalendario,
  giornoItaliano,
  inizioGiornoItaliano,
} from '../../core/time/anno-italiano'
import type { MovimentoDaClassificare } from '../../domain/comunicazioni/classifica-consorzio'
import {
  cercaCampiNonRappresentabili,
  codificaCp1252,
  nonRappresentabili,
} from '../../domain/comunicazioni/fisso/codifica-cp1252'
import { costruisciManifest } from '../../domain/comunicazioni/manifest'
import {
  RegistroTracciati,
  type TracciatoComunicazione,
} from '../../domain/comunicazioni/tracciato-comunicazione'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'
import { leggiIntegrazioni } from '../mud/aggregazione/mud-integrazioni'
import {
  ComunicazioneConBloccantiError,
  ComunicazioneNonTrovataError,
} from './comunicazioni-orso.port'
import {
  ConfermaVerificaRichiestaError,
  FileNonCodificabileError,
  TracciatoNonDisponibileError,
  PREPARATORI_TRACCIATO,
  REGISTRO_TRACCIATI,
  RichiestaComunicazioneNonValidaError,
  type AnteprimaTracciato,
  type AvvisoTracciato,
  type ComunicazioneTracciatoVista,
  type ComunicazioniTracciatoPort,
  type FileTracciato,
  type PreparatoreTracciato,
  type RichiestaComunicazione,
  type UnitaPropria,
} from './comunicazioni-tracciato.port'
import { ConfigurazioneComunicazioniService } from './configurazione-comunicazioni.service'
import { leggiDettagliTracciato } from './lettore-dettagli-tracciato'
import { leggiMovimentiOrso, type MovimentoOrso } from './lettore-movimenti-orso'
import { MarcaturaConsorziService } from './marcatura-consorzi.service'

/** Un file copre al massimo cinque anni: oltre, il periodo e' quasi certamente un errore. */
const GIORNI_MASSIMI = 366 * 5
const LIMITE_ELENCO = 200

const SELEZIONE_VISTA = {
  id: true,
  consorzio: true,
  unitaLocaleId: true,
  periodoDa: true,
  periodoA: true,
  tracciato: true,
  versione: true,
  stato: true,
  hashDati: true,
  nomeFile: true,
  generataIl: true,
  generataDa: true,
  inviataIl: true,
  inviataDa: true,
} as const

type RigaVista = Prisma.ComunicazioneConsorzioGetPayload<{ select: typeof SELEZIONE_VISTA }>

const mezzanotteUtc = (d: string) => new Date(`${d}T00:00:00.000Z`)
const giornoSuccessivo = (d: string) =>
  new Date(mezzanotteUtc(d).getTime() + 86_400_000).toISOString().slice(0, 10)
const comeGiorno = (d: Date) => d.toISOString().slice(0, 10)

/** Aggiunge il `charset` al tipo MIME se il tracciato non lo dichiara (O.R.SO.: `application/xml`). */
export function contentTypeConCharset(contentType: string, codifica: string): string {
  return /charset=/i.test(contentType) ? contentType : `${contentType}; charset=${codifica}`
}

/** Hash dei dati che finiscono nel file: stessi dati, stesso hash. */
export function hashDatiTracciato(dati: unknown): string {
  return createHash('sha256').update(JSON.stringify(dati)).digest('hex')
}

interface Calcolo {
  unita: UnitaPropria
  periodo: { da: string; a: string }
  parametri: Record<string, string>
  nomeTracciato: string
  dati: unknown
  avvisi: AvvisoTracciato[]
  bloccanti: boolean
  numeroRecord: number
  numeroMovimenti: number
  movimentiInFile: ReadonlyArray<MovimentoOrso>
  hashDati: string
  /** Contenuto del file (testo); `null` se i dati non rispettano il tracciato e non si serializza. */
  contenuto: string | null
  tracciato: TracciatoComunicazione<unknown>
  preparatore: PreparatoreTracciato
}

const MASSIMO_AVVISI_CARATTERI = 20

/**
 * Comunicazione a tracciato generica (4.9c-f, A5): stessa meccanica di O.R.SO. (anteprima,
 * idempotenza per hash, istantanea dei movimenti, «segna inviata», modifica dopo l'invio) per i
 * tracciati a record. Il tracciato mette solo cio' che gli e' proprio (selezione, preparazione dei
 * dati, nome del file) tramite un `PreparatoreTracciato`; il file si salva come testo e si codifica
 * allo scaricamento (D6).
 */
@Injectable()
export class ComunicazioniTracciatoService implements ComunicazioniTracciatoPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marcatura: MarcaturaConsorziService,
    private readonly configurazioni: ConfigurazioneComunicazioniService,
    @Inject(PREPARATORI_TRACCIATO)
    private readonly preparatori: ReadonlyArray<PreparatoreTracciato>,
    @Inject(REGISTRO_TRACCIATI) private readonly registro: RegistroTracciati
  ) {}

  private preparatore(consorzio: string): PreparatoreTracciato {
    const p = this.preparatori.find(x => x.consorzio === consorzio)
    if (!p)
      throw new RichiestaComunicazioneNonValidaError([`consorzio non supportato: ${consorzio}`])
    return p
  }

  /** Tracciato di una riga: per versione completa, oppure `<tracciato>-<versione>` (O.R.SO.). */
  private tracciatoDiRiga(r: {
    consorzio: string
    tracciato: string
    versione: string
  }): TracciatoComunicazione<unknown> | null {
    for (const v of [r.versione, `${r.tracciato}-${r.versione}`]) {
      try {
        return this.registro.get(r.consorzio, v)
      } catch {
        // prossimo tentativo
      }
    }
    return null
  }

  private vista(r: RigaVista, hashAttuale: string | null): ComunicazioneTracciatoVista {
    const stato = r.stato === 'INVIATA' ? 'INVIATA' : 'GENERATA'
    const t = this.tracciatoDiRiga(r)
    return {
      id: r.id,
      consorzio: r.consorzio,
      unitaLocaleId: r.unitaLocaleId,
      periodoDa: comeGiorno(r.periodoDa),
      periodoA: comeGiorno(r.periodoA),
      tracciato: r.tracciato,
      versione: r.versione,
      stato,
      hashDati: r.hashDati,
      nomeFile: r.nomeFile,
      generataIl: r.generataIl.toISOString(),
      generataDa: r.generataDa ?? '',
      ...(r.inviataIl ? { inviataIl: r.inviataIl.toISOString() } : {}),
      ...(r.inviataDa ? { inviataDa: r.inviataDa } : {}),
      modificataDopoInvio:
        stato === 'INVIATA' && hashAttuale !== null && hashAttuale !== r.hashDati,
      // Un tracciato non piu' registrato si tratta con la massima cautela.
      affidabilita: t?.affidabilita ?? 'RICAVATO_WINWASTE',
      notaAffidabilita: t?.notaAffidabilita ?? 'Tracciato non piu’ disponibile nel registro.',
    }
  }

  private controllaRichiesta(p: PreparatoreTracciato, r: RichiestaComunicazione): void {
    const errori: string[] = []
    if (!eGiornoDiCalendario(r.da) || !eGiornoDiCalendario(r.a)) errori.push('periodo non valido')
    else {
      const inizio = mezzanotteUtc(r.da)
      const fine = mezzanotteUtc(r.a)
      if (fine < inizio) errori.push('periodo non valido: la fine precede l’inizio')
      else if ((fine.getTime() - inizio.getTime()) / 86_400_000 > GIORNI_MASSIMI) {
        errori.push('periodo troppo lungo: al massimo cinque anni')
      }
    }
    if (errori.length === 0) errori.push(...(p.validaRichiesta?.(r) ?? []))
    if (errori.length > 0) throw new RichiestaComunicazioneNonValidaError(errori)
  }

  private async calcola(tenantId: string, r: RichiestaComunicazione): Promise<Calcolo> {
    const preparatore = this.preparatore(r.consorzio)
    this.controllaRichiesta(preparatore, r)
    const tracciato = this.registro.get<unknown>(preparatore.consorzio, preparatore.versione)
    const parametri = { ...(r.parametri ?? {}) }

    const [unitaRiga, tenant] = await Promise.all([
      this.prisma.rentriUnitaLocale.findFirst({
        where: { id: r.unitaLocaleId, tenantId },
        select: {
          id: true,
          denominazione: true,
          numIscrSito: true,
          indirizzo: true,
          civico: true,
          cap: true,
          comune: true,
          provincia: true,
          progressivoMud: true,
        },
      }),
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          partitaIva: true,
          codiceFiscale: true,
          ragioneSociale: true,
          atecoCode: true,
          legaleRappresentanteCognome: true,
          legaleRappresentanteNome: true,
        },
      }),
    ])
    if (!unitaRiga) throw new ComunicazioneNonTrovataError()
    const unita: UnitaPropria = unitaRiga

    // Pesi specifici del MUD di ciascun anno solare toccato dal periodo (una lettura per anno).
    const annoDa = Number(r.da.slice(0, 4))
    const annoA = Number(r.a.slice(0, 4))
    const anni = Array.from({ length: annoA - annoDa + 1 }, (_, i) => annoDa + i)
    const [catalogo, reportMud] = await Promise.all([
      caricaCatalogoCausali(this.prisma, tenantId),
      this.prisma.mUDReport.findMany({
        where: { tenantId, year: { in: anni } },
        select: { year: true, reportData: true },
        orderBy: { id: 'asc' },
      }),
    ])
    const pesiSpecificiPerAnno: Record<
      number,
      ReturnType<typeof leggiIntegrazioni>['pesiSpecifici']
    > = {}
    for (const anno of anni) {
      pesiSpecificiPerAnno[anno] = leggiIntegrazioni(
        reportMud.find(x => x.year === anno)?.reportData
      ).pesiSpecifici
    }
    const lettura = await leggiMovimentiOrso(this.prisma, {
      tenantId,
      unitaLocaleId: unita.id,
      da: inizioGiornoItaliano(r.da),
      a: inizioGiornoItaliano(giornoSuccessivo(r.a)),
      catalogo,
      pesiSpecificiPerAnno,
    })

    // Selezione dei movimenti (D1).
    let movimenti = lettura.movimenti
    const selezione = preparatore.selezione
    if (selezione.tipo === 'MARCATI') {
      const daClassificare: MovimentoDaClassificare[] = movimenti.map(m => ({
        radiceId: m.radiceId,
        registroId: m.registroId,
        verso: m.tipo,
        cer: m.cer,
        causale: m.causale,
        giorno: giornoItaliano(m.movementDate),
      }))
      const esiti = await this.marcatura.classifica(tenantId, daClassificare)
      movimenti = movimenti.filter((_, i) =>
        esiti[i].marcature.some(x => x.consorzio === selezione.consorzio)
      )
    }

    const dettagli = await leggiDettagliTracciato(this.prisma, {
      tenantId,
      movimenti: movimenti.map(m => ({ firId: m.firId, radiceId: m.radiceId })),
      tracciato: preparatore.datiTracciato,
    })
    const configurazione = preparatore.configurazione
      ? (await this.configurazioni.leggi(tenantId, unita.id, preparatore.configurazione)).dati
      : undefined

    const preparazione = await preparatore.prepara({
      tenantId,
      azienda: tenant,
      unita,
      periodo: { da: r.da, a: r.a },
      parametri,
      movimenti,
      dettagli,
      configurazione,
      catalogo,
    })

    const avvisi = [...preparazione.avvisi]
    const erroriTracciato = tracciato.validaDati(preparazione.dati)
    if (erroriTracciato.length > 0 && !avvisi.some(a => a.bloccante)) {
      avvisi.unshift({
        codice: 'DATI_NON_VALIDI',
        messaggio: `I dati non rispettano il tracciato. ${erroriTracciato.slice(0, 5).join('; ')}`,
        movimentoIds: [],
        bloccante: true,
      })
    }
    // Rete di sicurezza (valida per ogni tracciato): un carattere che la codifica non rappresenta
    // si blocca qui, con campo e movimento, cosi' il file salvato si puo' sempre scaricare.
    let contenuto: string | null = null
    if (erroriTracciato.length === 0) {
      contenuto = tracciato.serializza(preparazione.dati)
      if (tracciato.codifica === 'windows-1252') {
        const campi = cercaCampiNonRappresentabili(preparazione.dati)
        const nuovi: AvvisoTracciato[] = campi.slice(0, MASSIMO_AVVISI_CARATTERI).map(c => ({
          codice: 'CARATTERI_NON_RAPPRESENTABILI',
          messaggio: `Il campo «${c.campo}» contiene caratteri non rappresentabili in Windows-1252: ${c.caratteri.join(' ')}. Correggili prima di generare il file.`,
          movimentoIds: c.movimentoIds,
          bloccante: true,
          campo: c.campo,
        }))
        // Carattere introdotto dalla serializzazione stessa, fuori da qualunque campo dei dati.
        const nelFile = nonRappresentabili(contenuto)
        if (nuovi.length === 0 && nelFile.length > 0) {
          nuovi.push({
            codice: 'CARATTERI_NON_RAPPRESENTABILI',
            messaggio: `Il file conterrebbe caratteri non rappresentabili in Windows-1252: ${nelFile.join(' ')}.`,
            movimentoIds: [],
            bloccante: true,
            campo: 'file',
          })
        }
        avvisi.unshift(...nuovi)
      }
    }
    return {
      unita,
      periodo: { da: r.da, a: r.a },
      parametri,
      nomeTracciato: preparatore.nomeTracciato(parametri),
      dati: preparazione.dati,
      avvisi,
      bloccanti: avvisi.some(a => a.bloccante),
      numeroRecord: preparatore.contaRecord(preparazione.dati),
      numeroMovimenti: preparazione.movimentiInFile.length,
      movimentiInFile: preparazione.movimentiInFile,
      hashDati: hashDatiTracciato(preparazione.dati),
      contenuto,
      tracciato,
      preparatore,
    }
  }

  private chiave(tenantId: string, c: Calcolo, consorzio: string) {
    return {
      tenantId,
      consorzio,
      unitaLocaleId: c.unita.id,
      periodoDa: mezzanotteUtc(c.periodo.da),
      periodoA: mezzanotteUtc(c.periodo.a),
      tracciato: c.nomeTracciato,
      versione: c.tracciato.versione,
      hashDati: c.hashDati,
    }
  }

  async anteprima(tenantId: string, r: RichiestaComunicazione): Promise<AnteprimaTracciato> {
    const c = await this.calcola(tenantId, r)
    const ultima = await this.prisma.comunicazioneConsorzio.findFirst({
      where: {
        tenantId,
        consorzio: r.consorzio,
        unitaLocaleId: c.unita.id,
        periodoDa: mezzanotteUtc(r.da),
        periodoA: mezzanotteUtc(r.a),
        tracciato: c.nomeTracciato,
      },
      orderBy: [{ generataIl: 'desc' }, { id: 'desc' }],
      select: SELEZIONE_VISTA,
    })
    return {
      unitaLocale: { id: c.unita.id, nome: c.unita.denominazione },
      consorzio: r.consorzio,
      periodo: c.periodo,
      tracciato: c.nomeTracciato,
      versione: c.tracciato.versione,
      affidabilita: c.tracciato.affidabilita,
      notaAffidabilita: c.tracciato.notaAffidabilita,
      numeroRecord: c.numeroRecord,
      numeroMovimenti: c.numeroMovimenti,
      avvisi: c.avvisi,
      bloccanti: c.bloccanti,
      hashDati: c.hashDati,
      ...(ultima ? { ultima: this.vista(ultima, c.hashDati) } : {}),
    }
  }

  /** Genera il file; idempotente: gli stessi dati restituiscono la comunicazione gia' generata. */
  async genera(
    tenantId: string,
    utenteId: string,
    r: RichiestaComunicazione
  ): Promise<ComunicazioneTracciatoVista> {
    const c = await this.calcola(tenantId, r)
    if (c.bloccanti) throw new ComunicazioneConBloccantiError(c.avvisi.filter(a => a.bloccante))
    const chiave = this.chiave(tenantId, c, r.consorzio)
    const cerca = () =>
      this.prisma.comunicazioneConsorzio.findFirst({ where: chiave, select: SELEZIONE_VISTA })
    const esistente = await cerca()
    if (esistente) return this.vista(esistente, c.hashDati)

    // Senza bloccanti `calcola` ha gia' serializzato (dati validi): si riusa lo stesso testo.
    const contenuto = c.contenuto ?? c.tracciato.serializza(c.dati)
    const snapshot = c.movimentiInFile.map(m => ({
      tenantId,
      movimentoId: m.id,
      registroId: m.registroId,
      movimentoTipo: m.tipo,
      quantitaKg: new Prisma.Decimal(m.kg ?? 0),
    }))
    const nomeFile = c.preparatore.nomeFile(
      { unita: c.unita, periodo: c.periodo, parametri: c.parametri },
      c.dati
    )
    try {
      const creata = await this.prisma.$transaction(async tx => {
        const riga = await tx.comunicazioneConsorzio.create({
          data: { ...chiave, nomeFile, contenuto, stato: 'GENERATA', generataDa: utenteId },
          select: SELEZIONE_VISTA,
        })
        await tx.comunicazioneConsorzioMovimento.createMany({
          data: snapshot.map(m => ({ ...m, comunicazioneId: riga.id })),
        })
        return riga
      })
      return this.vista(creata, c.hashDati)
    } catch (e) {
      // Due richieste uguali insieme: vince la prima, l'altra restituisce la sua riga.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const gia = await cerca()
        if (gia) return this.vista(gia, c.hashDati)
      }
      throw e
    }
  }

  /** Hash attuale dei dati di una comunicazione salvata, o `null` se non si puo' ricalcolare. */
  private async hashAttuale(tenantId: string, r: RigaVista): Promise<string | null> {
    return this.ricalcola(tenantId, r).then(
      c => c.hashDati,
      () => null
    )
  }

  private ricalcola(tenantId: string, r: RigaVista): Promise<Calcolo> {
    const p = this.preparatore(r.consorzio)
    return this.calcola(tenantId, {
      consorzio: r.consorzio,
      unitaLocaleId: r.unitaLocaleId,
      da: comeGiorno(r.periodoDa),
      a: comeGiorno(r.periodoA),
      parametri: p.parametriDaTracciato?.(r.tracciato) ?? {},
    })
  }

  async elenca(
    tenantId: string,
    f: { consorzio?: string; unitaLocaleId?: string; da?: string; a?: string } = {}
  ): Promise<ComunicazioneTracciatoVista[]> {
    // Una data impossibile (2026-02-31) passerebbe il formato e darebbe Invalid Date a Prisma.
    if ((f.da && !eGiornoDiCalendario(f.da)) || (f.a && !eGiornoDiCalendario(f.a))) {
      throw new RichiestaComunicazioneNonValidaError(['periodo non valido'])
    }
    const righe = await this.prisma.comunicazioneConsorzio.findMany({
      where: {
        tenantId,
        ...(f.consorzio ? { consorzio: f.consorzio } : {}),
        ...(f.unitaLocaleId ? { unitaLocaleId: f.unitaLocaleId } : {}),
        ...(f.da ? { periodoDa: mezzanotteUtc(f.da) } : {}),
        ...(f.a ? { periodoA: mezzanotteUtc(f.a) } : {}),
      },
      orderBy: [{ generataIl: 'desc' }, { id: 'desc' }],
      take: LIMITE_ELENCO,
      select: SELEZIONE_VISTA,
    })
    // L'hash attuale serve solo per le inviate e solo con sede e periodo nel filtro: senza, il
    // ricalcolo per ogni riga inviata sarebbe troppo oneroso.
    const calcolaHash = f.unitaLocaleId !== undefined && f.da !== undefined && f.a !== undefined
    const attuali = new Map<string, string | null>()
    const out: ComunicazioneTracciatoVista[] = []
    for (const r of righe) {
      let hash: string | null = null
      if (r.stato === 'INVIATA' && calcolaHash) {
        const k = `${r.consorzio}|${r.tracciato}`
        if (!attuali.has(k)) attuali.set(k, await this.hashAttuale(tenantId, r))
        hash = attuali.get(k) ?? null
      }
      out.push(this.vista(r, hash))
    }
    return out
  }

  async file(tenantId: string, id: string): Promise<FileTracciato> {
    const r = await this.prisma.comunicazioneConsorzio.findFirst({
      where: { id, tenantId },
      select: { nomeFile: true, contenuto: true, consorzio: true, tracciato: true, versione: true },
    })
    if (!r) throw new ComunicazioneNonTrovataError()
    const t = this.tracciatoDiRiga(r)
    // Non si indovina la codifica: un file Windows-1252 servito come UTF-8 sarebbe corrotto.
    if (!t) throw new TracciatoNonDisponibileError(r.tracciato, r.versione)
    let contenuto: Buffer
    try {
      contenuto =
        t.codifica === 'windows-1252'
          ? codificaCp1252(r.contenuto)
          : Buffer.from(r.contenuto, 'utf8')
    } catch (e) {
      if (e instanceof RangeError) throw new FileNonCodificabileError(e.message)
      throw e
    }
    return {
      nomeFile: r.nomeFile,
      contenuto,
      contentType: contentTypeConCharset(t.contentType, t.codifica),
    }
  }

  async consorzioDi(tenantId: string, id: string): Promise<string> {
    const r = await this.prisma.comunicazioneConsorzio.findFirst({
      where: { id, tenantId },
      select: { consorzio: true },
    })
    if (!r) throw new ComunicazioneNonTrovataError()
    return r.consorzio
  }

  async manifest(tenantId: string, id: string): Promise<{ nomeFile: string; testo: string }> {
    const r = await this.prisma.comunicazioneConsorzio.findFirst({
      where: { id, tenantId },
      select: SELEZIONE_VISTA,
    })
    if (!r) throw new ComunicazioneNonTrovataError()
    const t = this.tracciatoDiRiga(r)
    const p = this.preparatori.find(x => x.consorzio === r.consorzio)
    const unita = await this.prisma.rentriUnitaLocale.findFirst({
      where: { id: r.unitaLocaleId, tenantId },
      select: { denominazione: true, numIscrSito: true },
    })
    // Avvisi, numero di record e modifiche si ricavano ricalcolando: se i dati sono cambiati dopo
    // la generazione il ricalcolo non descrive piu' il file, e il manifest lo dice.
    const attuale = p ? await this.ricalcola(tenantId, r).catch(() => null) : null
    const invariati = attuale !== null && attuale.hashDati === r.hashDati
    const stato = r.stato === 'INVIATA' ? 'INVIATA' : 'GENERATA'
    const avvisi = (invariati ? attuale.avvisi.filter(a => !a.bloccante) : []).map(a => ({
      codice: a.codice,
      messaggio: a.messaggio,
      movimenti: (a.movimenti ?? []).map(m => `${m.data} ${m.numero} ${m.cer}`),
    }))
    if (attuale !== null && !invariati) {
      avvisi.push({
        codice: 'DATI_CAMBIATI',
        messaggio:
          'I dati sono cambiati dopo la generazione: gli avvisi e il numero di record non descrivono piu’ il file.',
        movimenti: [],
      })
    }
    const testo = costruisciManifest({
      consorzio: r.consorzio,
      tracciato: r.tracciato,
      versione: r.versione,
      affidabilita: t?.affidabilita ?? 'RICAVATO_WINWASTE',
      notaAffidabilita: t?.notaAffidabilita ?? 'Tracciato non piu’ disponibile nel registro.',
      codifica: t?.codifica ?? 'utf-8',
      nomeFile: r.nomeFile,
      hashDati: r.hashDati,
      periodoDa: comeGiorno(r.periodoDa),
      periodoA: comeGiorno(r.periodoA),
      sede: unita ? `${unita.denominazione} (${unita.numIscrSito})` : r.unitaLocaleId,
      numeroRecord: invariati ? attuale.numeroRecord : null,
      numeroRecordMotivo: p ? 'DATI_CAMBIATI' : 'NON_RICALCOLABILE',
      generataIl: r.generataIl.toISOString(),
      stato,
      ...(r.inviataIl ? { inviataIl: r.inviataIl.toISOString() } : {}),
      ...(r.inviataDa ? { inviataDa: r.inviataDa } : {}),
      modificataDopoInvio: stato === 'INVIATA' && attuale !== null && !invariati,
      avvisi,
      differenzeDaWinWaste: [...(p?.differenzeDaWinWaste ?? [])],
      inferenze: [...(p?.inferenze ?? [])],
    })
    return { nomeFile: `${r.nomeFile}.manifest.txt`, testo }
  }

  async segnaInviata(
    tenantId: string,
    utenteId: string,
    id: string,
    confermaVerifica = false
  ): Promise<ComunicazioneTracciatoVista> {
    const r = await this.prisma.comunicazioneConsorzio.findFirst({
      where: { id, tenantId },
      select: SELEZIONE_VISTA,
    })
    if (!r) throw new ComunicazioneNonTrovataError()
    const t = this.tracciatoDiRiga(r)
    // Un tracciato ricavato da WinWaste non si segna inviato senza la conferma esplicita (Q2). Se e'
    // gia' inviato la richiesta e' idempotente e non serve.
    if (
      r.stato === 'GENERATA' &&
      (t?.affidabilita ?? 'RICAVATO_WINWASTE') === 'RICAVATO_WINWASTE' &&
      !confermaVerifica
    ) {
      throw new ConfermaVerificaRichiestaError()
    }
    // Atomica: solo la richiesta che trova la comunicazione ancora GENERATA la segna.
    await this.prisma.comunicazioneConsorzio.updateMany({
      where: { id, tenantId, stato: 'GENERATA' },
      data: { stato: 'INVIATA', inviataIl: new Date(), inviataDa: utenteId },
    })
    const corrente = await this.prisma.comunicazioneConsorzio.findFirst({
      where: { id, tenantId },
      select: SELEZIONE_VISTA,
    })
    if (!corrente) throw new ComunicazioneNonTrovataError()
    return this.vista(corrente, await this.hashAttuale(tenantId, corrente))
  }
}

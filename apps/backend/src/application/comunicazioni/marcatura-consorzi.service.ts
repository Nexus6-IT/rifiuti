import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { eGiornoDiCalendario, giornoItaliano } from '../../core/time/anno-italiano'
import type { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'
import {
  CONSORZI,
  classificaConsorzi,
  eConsorzio,
  normalizzaCerRegola,
  regoleEfficaci,
  type Consorzio,
  type MovimentoDaClassificare,
  type OverrideMovimento,
  type RegolaConsorzioDef,
  type VersoMovimento,
} from '../../domain/comunicazioni/classifica-consorzio'
import { REGOLE_CONSORZIO_DI_SISTEMA } from '../../domain/comunicazioni/regole-consorzio-sistema'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  ConsorzioRegolaNonModificabileError,
  MarcaturaNonValidaError,
  MovimentoNonTrovatoError,
  RegolaConsorzioNonTrovataError,
  type InputRegolaConsorzio,
  type MarcaturaConsorziPort,
  type MarcaturaMovimentoVista,
  type RegolaConsorzioVista,
} from './marcatura-consorzi.port'

const LIMITE_MOVIMENTI = 200
/** Una regola senza data vale da sempre: non deve spegnere quelle di sistema per il passato. */
const DA_SEMPRE = '1970-01-01'

type RigaRegola = Prisma.RegolaConsorzioGetPayload<Record<string, never>>

const comeGiorno = (d: Date): string => d.toISOString().slice(0, 10)

function definizione(r: RigaRegola): RegolaConsorzioDef {
  return {
    id: r.id,
    consorzio: r.consorzio as Consorzio,
    verso: r.verso,
    cerPrefisso: r.cerPrefisso,
    cerEsatto: r.cerEsatto,
    causaleCodice: r.causaleCodice,
    registroId: r.registroId,
    attiva: r.attiva,
    validaDal: comeGiorno(r.validaDal),
  }
}

function vistaDa(d: RegolaConsorzioDef, sistema: boolean, inVigore: boolean): RegolaConsorzioVista {
  return {
    id: sistema ? null : (d.id ?? null),
    consorzio: d.consorzio,
    verso: d.verso,
    cer: d.cerEsatto ?? d.cerPrefisso ?? '',
    cerEsatto: d.cerEsatto !== null,
    causaleCodice: d.causaleCodice,
    registroId: d.registroId,
    attiva: d.attiva,
    validaDal: d.validaDal,
    sistema,
    inVigore,
  }
}

/**
 * La causale deve esistere nel catalogo (di sistema o dell'azienda) per il verso della regola, o per
 * uno dei due se la regola vale per entrambi: il confronto e' esatto, quindi un codice scritto male
 * non prenderebbe mai nessun movimento.
 */
function causaleEsiste(catalogo: CatalogoCausali, codice: string, verso: VersoMovimento | null) {
  const giorno = giornoItaliano(new Date())
  const versi: VersoMovimento[] = verso ? [verso] : ['CARICO', 'SCARICO']
  return versi.some(v => catalogo.comportamento(v, codice, giorno) !== null)
}

/**
 * Convalida l'input e lo porta ai campi del database. Lancia `MarcaturaNonValidaError`.
 * `registroId` e `attiva` assenti restano `undefined`: in modifica non si toccano, in creazione
 * valgono i default. La data assente e' decisa da chi chiama (creazione: da sempre).
 */
function campiRegola(
  input: InputRegolaConsorzio,
  catalogo: CatalogoCausali,
  /** Causale gia' salvata (solo in modifica): se non cambia non si ricontrolla sul catalogo di oggi. */
  causaleEsistente?: string | null
) {
  if (!eConsorzio(input.consorzio)) throw new MarcaturaNonValidaError('Consorzio non valido.')
  const cer = normalizzaCerRegola(input.cer ?? '')
  if (!cer) {
    throw new MarcaturaNonValidaError(
      'CER non valido: indica 2 o 4 cifre (capitolo o sottocapitolo) oppure le 6 cifre del codice.'
    )
  }
  const verso = input.verso ?? null
  if (verso !== null && verso !== 'CARICO' && verso !== 'SCARICO') {
    throw new MarcaturaNonValidaError('Verso non valido.')
  }
  if (typeof input.validaDal === 'string' && !eGiornoDiCalendario(input.validaDal)) {
    throw new MarcaturaNonValidaError('Data di inizio validità non valida.')
  }
  const causale = input.causaleCodice?.trim() || null
  // Una causale ritirata dal catalogo non deve impedire di salvare la regola che la usa gia'.
  if (
    causale !== null &&
    causale !== causaleEsistente &&
    !causaleEsiste(catalogo, causale, verso)
  ) {
    throw new MarcaturaNonValidaError(`Causale non valida: «${causale}» non è nel catalogo.`)
  }
  return {
    consorzio: input.consorzio,
    verso: verso as VersoMovimento | null,
    cerPrefisso: cer.cerPrefisso,
    cerEsatto: cer.cerEsatto,
    causaleCodice: causale,
    ...(input.registroId === undefined ? {} : { registroId: input.registroId }),
    ...(input.attiva === undefined ? {} : { attiva: input.attiva }),
    // `null` = da sempre; assente = invariata (in creazione la decide chi chiama).
    ...(input.validaDal === undefined
      ? {}
      : { validaDal: new Date(`${input.validaDal ?? DA_SEMPRE}T00:00:00.000Z`) }),
  }
}

/**
 * Marcatura dei movimenti per consorzio (4.9b, T10): regole per azienda e correzione sul singolo
 * movimento (D3 = a). Non tocca `WasteMovement`: le correzioni stanno sulla radice della catena,
 * quindi seguono rettifiche e annullamenti. La classificazione e' del dominio puro.
 */
@Injectable()
export class MarcaturaConsorziService implements MarcaturaConsorziPort {
  constructor(private readonly prisma: PrismaService) {}

  async regoleDellAzienda(tenantId: string): Promise<RegolaConsorzioDef[]> {
    const righe = await this.prisma.regolaConsorzio.findMany({
      where: { tenantId },
      orderBy: [{ consorzio: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    return righe.map(definizione)
  }

  async elencaRegole(tenantId: string): Promise<RegolaConsorzioVista[]> {
    const proprie = await this.regoleDellAzienda(tenantId)
    // Le regole di sistema si mostrano solo per i consorzi dove l'azienda non ne ha di proprie:
    // alla prima regola propria vengono copiate fra quelle dell'azienda (vedi `creaRegola`).
    const consorziConRegole = new Set(proprie.map(r => r.consorzio))
    return [
      ...proprie.map(r => vistaDa(r, false, true)),
      ...REGOLE_CONSORZIO_DI_SISTEMA.filter(r => !consorziConRegole.has(r.consorzio)).map(r =>
        vistaDa(r, true, true)
      ),
    ].sort(
      (a, b) =>
        CONSORZI.indexOf(a.consorzio) - CONSORZI.indexOf(b.consorzio) ||
        Number(a.sistema) - Number(b.sistema)
    )
  }

  private async controllaRegistro(
    tenantId: string,
    registroId: string | null | undefined
  ): Promise<void> {
    if (registroId === null || registroId === undefined) return
    const registro = await this.prisma.registroRifiuti.findFirst({
      where: { id: registroId, tenantId },
      select: { id: true },
    })
    if (!registro) throw new MarcaturaNonValidaError('Registro non trovato.')
  }

  async creaRegola(
    tenantId: string,
    userId: string,
    input: InputRegolaConsorzio
  ): Promise<RegolaConsorzioVista> {
    const campi = campiRegola(input, await caricaCatalogoCausali(this.prisma, tenantId))
    await this.controllaRegistro(tenantId, campi.registroId)
    const riga = await this.prisma.$transaction(async tx => {
      // Un lock per azienda e consorzio: due prime regole in parallelo non copiano due volte.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`regole-consorzio|${tenantId}|${campi.consorzio}`}))`
      const esistenti = await tx.regolaConsorzio.count({
        where: { tenantId, consorzio: campi.consorzio },
      })
      if (esistenti === 0) {
        // Alla prima regola propria le regole di sistema del consorzio diventano dell'azienda
        // (stesso periodo di validita'): aggiungere una regola non ne spegne altre in silenzio,
        // e l'azienda puo' togliere o cambiare ciascuna copia.
        const copie = REGOLE_CONSORZIO_DI_SISTEMA.filter(r => r.consorzio === campi.consorzio)
        if (copie.length > 0) {
          await tx.regolaConsorzio.createMany({
            data: copie.map(r => ({
              tenantId,
              consorzio: r.consorzio,
              verso: r.verso,
              cerPrefisso: r.cerPrefisso,
              cerEsatto: r.cerEsatto,
              causaleCodice: r.causaleCodice,
              registroId: r.registroId,
              attiva: r.attiva,
              validaDal: new Date(`${r.validaDal}T00:00:00.000Z`),
              creataDa: userId,
            })),
          })
        }
      }
      return tx.regolaConsorzio.create({
        data: {
          ...campi,
          validaDal: campi.validaDal ?? new Date(`${DA_SEMPRE}T00:00:00.000Z`),
          tenantId,
          creataDa: userId,
        },
      })
    })
    return vistaDa(definizione(riga), false, true)
  }

  async modificaRegola(
    tenantId: string,
    id: string,
    input: InputRegolaConsorzio
  ): Promise<RegolaConsorzioVista> {
    const esistente = await this.prisma.regolaConsorzio.findFirst({ where: { id, tenantId } })
    if (!esistente) throw new RegolaConsorzioNonTrovataError()
    // Cambiare consorzio aggirerebbe la copia delle regole di sistema (e ne spegnerebbe in silenzio).
    if (input.consorzio !== esistente.consorzio) throw new ConsorzioRegolaNonModificabileError()
    const campi = campiRegola(
      input,
      await caricaCatalogoCausali(this.prisma, tenantId),
      esistente.causaleCodice
    )
    await this.controllaRegistro(tenantId, campi.registroId)
    const esito = await this.prisma.regolaConsorzio.updateMany({
      where: { id, tenantId },
      data: campi,
    })
    if (esito.count === 0) throw new RegolaConsorzioNonTrovataError()
    const riga = await this.prisma.regolaConsorzio.findFirstOrThrow({ where: { id, tenantId } })
    return vistaDa(definizione(riga), false, true)
  }

  async eliminaRegola(tenantId: string, id: string): Promise<void> {
    const esito = await this.prisma.regolaConsorzio.deleteMany({ where: { id, tenantId } })
    if (esito.count === 0) throw new RegolaConsorzioNonTrovataError()
  }

  /** Il movimento e la radice della sua catena. */
  private async radice(tenantId: string, movimentoId: string): Promise<string> {
    const m = await this.prisma.wasteMovement.findFirst({
      where: { id: movimentoId, tenantId },
      select: { id: true, movimentoOriginaleId: true },
    })
    if (!m) throw new MovimentoNonTrovatoError()
    return m.movimentoOriginaleId ?? m.id
  }

  async impostaOverride(
    tenantId: string,
    userId: string,
    movimentoId: string,
    consorzio: string,
    escluso: boolean
  ): Promise<MarcaturaMovimentoVista> {
    if (!eConsorzio(consorzio)) throw new MarcaturaNonValidaError('Consorzio non valido.')
    const radiceId = await this.radice(tenantId, movimentoId)
    const originale = await this.prisma.wasteMovement.findFirstOrThrow({
      where: { id: radiceId, tenantId },
      select: { registroId: true, type: true },
    })
    await this.prisma.datiConsorzioMovimento.upsert({
      where: {
        tenantId_movimentoOriginaleId_consorzio: {
          tenantId,
          movimentoOriginaleId: radiceId,
          consorzio,
        },
      },
      create: {
        tenantId,
        registroId: originale.registroId,
        verso: originale.type,
        movimentoOriginaleId: radiceId,
        consorzio,
        escluso,
        creatoDa: userId,
      },
      update: { escluso },
    })
    return (await this.consorziDeiMovimenti(tenantId, [movimentoId]))[movimentoId]
  }

  async rimuoviOverride(
    tenantId: string,
    movimentoId: string,
    consorzio: string
  ): Promise<MarcaturaMovimentoVista> {
    if (!eConsorzio(consorzio)) throw new MarcaturaNonValidaError('Consorzio non valido.')
    const radiceId = await this.radice(tenantId, movimentoId)
    await this.prisma.datiConsorzioMovimento.deleteMany({
      where: { tenantId, movimentoOriginaleId: radiceId, consorzio },
    })
    return (await this.consorziDeiMovimenti(tenantId, [movimentoId]))[movimentoId]
  }

  /** Classifica i movimenti dati (esiti nello stesso ordine), con le regole in vigore e le correzioni sulle loro radici. */
  async classifica(
    tenantId: string,
    movimenti: ReadonlyArray<MovimentoDaClassificare>
  ): Promise<MarcaturaMovimentoVista[]> {
    if (movimenti.length === 0) return []
    const regole = regoleEfficaci(
      await this.regoleDellAzienda(tenantId),
      REGOLE_CONSORZIO_DI_SISTEMA
    )
    const radici = [...new Set(movimenti.map(m => m.radiceId))]
    const correzioni = await this.prisma.datiConsorzioMovimento.findMany({
      where: { tenantId, movimentoOriginaleId: { in: radici } },
      select: { movimentoOriginaleId: true, consorzio: true, escluso: true },
    })
    const perRadice = new Map<string, OverrideMovimento[]>()
    for (const c of correzioni) {
      if (!eConsorzio(c.consorzio)) continue
      const lista = perRadice.get(c.movimentoOriginaleId) ?? []
      lista.push({ consorzio: c.consorzio, escluso: c.escluso })
      perRadice.set(c.movimentoOriginaleId, lista)
    }
    // Stesso ordine dell'input: due annotazioni della stessa catena possono avere CER diversi.
    return movimenti.map(m => ({
      ...classificaConsorzi(m, regole, perRadice.get(m.radiceId) ?? []),
      // Senza correzioni restano solo le marcature da regola: sono i consorzi che una regola prende.
      regolaPrende: classificaConsorzi(m, regole, []).marcature.map(x => x.consorzio),
    }))
  }

  async consorziDeiMovimenti(
    tenantId: string,
    movimentoIds: string[]
  ): Promise<Record<string, MarcaturaMovimentoVista>> {
    const ids = [...new Set(movimentoIds)]
    if (ids.length > LIMITE_MOVIMENTI) {
      throw new MarcaturaNonValidaError(`Al massimo ${LIMITE_MOVIMENTI} movimenti per richiesta.`)
    }
    const righe = await this.prisma.wasteMovement.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        movimentoOriginaleId: true,
        registroId: true,
        type: true,
        cerCode: true,
        causale: true,
        movementDate: true,
      },
    })
    const daClassificare = righe.map(r => ({
      id: r.id,
      m: {
        radiceId: r.movimentoOriginaleId ?? r.id,
        registroId: r.registroId,
        verso: r.type,
        cer: r.cerCode,
        causale: r.causale,
        giorno: giornoItaliano(r.movementDate),
      } satisfies MovimentoDaClassificare,
    }))
    const esiti = await this.classifica(
      tenantId,
      daClassificare.map(d => d.m)
    )
    const out: Record<string, MarcaturaMovimentoVista> = {}
    daClassificare.forEach((d, i) => {
      out[d.id] = esiti[i]
    })
    return out
  }
}

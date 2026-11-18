import { Injectable } from '@nestjs/common'
import {
  eGiornoDiCalendario,
  giornoItaliano,
  inizioGiornoItaliano,
} from '../../core/time/anno-italiano'
import {
  eConsorzio,
  type MovimentoDaClassificare,
} from '../../domain/comunicazioni/classifica-consorzio'
import { convertiInKg } from '../../domain/waste-movement/unita-misura-registro'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'
import { leggiIntegrazioni } from '../mud/aggregazione/mud-integrazioni'
import { estrattoConsorzioCsv, type RigaEstrattoConsorzio } from './estratto-consorzio-csv'
import { leggiMovimentiOrso, type MovimentoOrso } from './lettore-movimenti-orso'
import { MarcaturaConsorziService } from './marcatura-consorzi.service'
import {
  MarcaturaNonValidaError,
  type EstrattoConsorzio,
  type EstrattoConsorziPort,
  type KgStimatiAnno,
} from './marcatura-consorzi.port'

/** Un estratto copre al massimo cinque anni: oltre, il periodo e' quasi certamente un errore. */
const GIORNI_MASSIMI = 366 * 5

const mezzanotteUtc = (d: string) => new Date(`${d}T00:00:00.000Z`)
const giornoSuccessivo = (d: string) =>
  new Date(mezzanotteUtc(d).getTime() + 86_400_000).toISOString().slice(0, 10)

/**
 * Estratto CSV per consorzio e periodo (4.9b, T11): i movimenti vigenti marcati per quel consorzio
 * (regole + correzioni), con controparte, CER, kg e FIR. Riusa il lettore dei movimenti vigenti di
 * 4.9a (`leggiMovimentiOrso`), una sede alla volta. Senza filtro di sede («tutte le sedi») legge
 * anche i registri senza sede (storici o importati); con una sede li esclude. Il periodo e' sui
 * giorni di Roma: inizio alle 00:00 del primo giorno, fine alle 00:00 del giorno dopo l'ultimo.
 * I pesi specifici (kg per unita' non di massa) sono quelli del MUD di ciascun anno solare di Roma
 * toccato dal periodo: una sola lettura dei MUD per tutti gli anni, e ogni movimento usa i pesi del proprio anno.
 * Per un anno senza MUD (di solito l'anno in corso) si ripiega sui pesi del MUD precedente piu'
 * vicino che ne abbia, e l'estratto lo dichiara (`kgStimati`, `avvisi`): il ripiego vale solo qui,
 * le comunicazioni O.R.SO. non lo usano e i loro hash non cambiano.
 */
@Injectable()
export class EstrattoConsorziService implements EstrattoConsorziPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marcatura: MarcaturaConsorziService
  ) {}

  async estratto(
    tenantId: string,
    params: { consorzio: string; da: string; a: string; unitaLocaleId?: string }
  ): Promise<EstrattoConsorzio> {
    const { consorzio, da, a } = params
    if (!eConsorzio(consorzio)) throw new MarcaturaNonValidaError('Consorzio non valido.')
    if (!eGiornoDiCalendario(da) || !eGiornoDiCalendario(a))
      throw new MarcaturaNonValidaError('Periodo non valido.')
    const inizio = mezzanotteUtc(da)
    const fineIncl = mezzanotteUtc(a)
    if (Number.isNaN(inizio.getTime()) || Number.isNaN(fineIncl.getTime()) || fineIncl < inizio) {
      throw new MarcaturaNonValidaError('Periodo non valido: la fine precede l’inizio.')
    }
    if ((fineIncl.getTime() - inizio.getTime()) / 86_400_000 > GIORNI_MASSIMI) {
      throw new MarcaturaNonValidaError('Periodo troppo lungo: al massimo cinque anni.')
    }
    // Limiti sul giorno di Roma (con l'ora legale); fine ESCLUSA del lettore: il giorno dopo l'ultimo.
    const daIstante = inizioGiornoItaliano(da)
    const aIstante = inizioGiornoItaliano(giornoSuccessivo(a))

    const sedi = await this.prisma.rentriUnitaLocale.findMany({
      where: { tenantId, ...(params.unitaLocaleId ? { id: params.unitaLocaleId } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    if (params.unitaLocaleId && sedi.length === 0) {
      throw new MarcaturaNonValidaError('Sede non trovata.')
    }

    // Anni solari di Roma toccati dal periodo: i report MUD di tutti gli anni si leggono con una
    // sola query e ogni movimento usa i pesi specifici del MUD del proprio anno.
    const annoDa = Number(da.slice(0, 4))
    const annoA = Number(a.slice(0, 4))
    const anni = Array.from({ length: annoA - annoDa + 1 }, (_, i) => annoDa + i)
    const [catalogo, reportMud] = await Promise.all([
      caricaCatalogoCausali(this.prisma, tenantId),
      this.prisma.mUDReport.findMany({
        where: { tenantId, year: { in: anni } },
        select: { year: true, reportData: true },
        orderBy: { id: 'asc' },
      }),
    ])
    // `MUDReport` e' unico per (azienda, anno): al piu' un report per anno.
    type PesiSpecifici = ReturnType<typeof leggiIntegrazioni>['pesiSpecifici']
    const pesiSpecificiPerAnno: Record<number, PesiSpecifici> = {}
    const annoMudDiRipiego = new Map<number, number>()
    // Anno «mancante» = nessun MUD oppure MUD senza alcun peso specifico (bozza): stesso criterio
    // con cui si scelgono i MUD precedenti di ripiego. Il ripiego e' per anno intero, non per CER.
    const mancanti: number[] = []
    for (const anno of anni) {
      const record = reportMud.find(r => r.year === anno)
      pesiSpecificiPerAnno[anno] = leggiIntegrazioni(record?.reportData).pesiSpecifici
      if (Object.keys(pesiSpecificiPerAnno[anno]).length === 0) mancanti.push(anno)
    }
    if (mancanti.length > 0) {
      // Ripiego: MUD piu' vicino PRECEDENTE all'anno mancante, fra quelli con almeno un peso.
      const precedenti = (
        await this.prisma.mUDReport.findMany({
          where: { tenantId, year: { lt: Math.max(...mancanti) } },
          select: { year: true, reportData: true },
          orderBy: { year: 'desc' },
        })
      )
        .map(r => ({ year: r.year, pesi: leggiIntegrazioni(r.reportData).pesiSpecifici }))
        .filter(r => Object.keys(r.pesi).length > 0)
      for (const anno of mancanti) {
        const vicino = precedenti.find(r => r.year < anno)
        if (!vicino) continue
        pesiSpecificiPerAnno[anno] = vicino.pesi
        annoMudDiRipiego.set(anno, vicino.year)
      }
    }

    const righe: Array<RigaEstrattoConsorzio & { ordine: string }> = []
    const ambiti: Array<string | null> = sedi.map(s => s.id)
    if (!params.unitaLocaleId) ambiti.push(null)
    // Si leggono tutti gli ambiti e si classifica una volta sola: le regole dell'azienda
    // si caricano una volta per estratto, non una per sede.
    const letti: MovimentoOrso[] = []
    for (const ambito of ambiti) {
      // Una lettura per ambito sull'intero periodo: ogni movimento usa i pesi del proprio anno
      // solare di Roma (`pesiSpecificiPerAnno`), non una lettura per anno.
      const lettura = await leggiMovimentiOrso(this.prisma, {
        tenantId,
        unitaLocaleId: ambito,
        da: daIstante,
        a: aIstante,
        catalogo,
        pesiSpecificiPerAnno,
      })
      letti.push(...lettura.movimenti)
    }
    const daClassificare: MovimentoDaClassificare[] = letti.map(m => ({
      radiceId: m.radiceId,
      registroId: m.registroId,
      verso: m.tipo,
      cer: m.cer,
      causale: m.causale,
      giorno: giornoItaliano(m.movementDate),
    }))
    const esiti = await this.marcatura.classifica(tenantId, daClassificare)
    const stimatiPerAnno = new Map<number, number>()
    letti.forEach((m, i) => {
      const marcatura = esiti[i].marcature.find(x => x.consorzio === consorzio)
      if (!marcatura) return
      const data = giornoItaliano(m.movementDate)
      const anno = Number(data.slice(0, 4))
      const annoMud = annoMudDiRipiego.get(anno)
      // Stimato = unita' non di massa convertita con i pesi di un MUD di un altro anno.
      const stimato =
        annoMud !== undefined && m.kg !== null && convertiInKg(m.quantita, m.unita) === null
      if (stimato) stimatiPerAnno.set(anno, (stimatiPerAnno.get(anno) ?? 0) + 1)
      righe.push({
        data,
        numero: m.numero,
        verso: m.tipo,
        cer: m.cer,
        pericoloso: m.pericoloso,
        descrizione: m.descrizione,
        kg: m.kg,
        quantita: m.quantita,
        unita: m.unita,
        controparte: m.controparte,
        indirizzoControparte: m.indirizzoControparte,
        firNumero: m.firNumero,
        origine: marcatura.origine,
        kgStimatiDaMud: stimato ? annoMud : undefined,
        ordine: `${data}|${m.numero.split('/')[1]}|${m.numero.split('/')[0].padStart(10, '0')}|${m.id}`,
      })
    })
    righe.sort((x, y) => x.ordine.localeCompare(y.ordine))
    const kgStimati: KgStimatiAnno[] = [...stimatiPerAnno.entries()]
      .sort(([x], [y]) => x - y)
      .map(([anno, nRighe]) => ({
        anno,
        annoMud: annoMudDiRipiego.get(anno) as number,
        righe: nRighe,
      }))
    return {
      kgStimati,
      avvisi: kgStimati.map(
        k =>
          `I kg dei movimenti del ${k.anno} in unità non di massa sono stimati con i pesi specifici del MUD ${k.annoMud}, perché il MUD ${k.anno} è assente o senza pesi specifici (${k.righe} ${k.righe === 1 ? 'riga' : 'righe'}).`
      ),
      nomeFile: `estratto-${consorzio.toLowerCase()}-${da}_${a}.csv`,
      csv: estrattoConsorzioCsv(consorzio, righe),
      righe: righe.length,
    }
  }
}

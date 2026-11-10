import { Injectable } from '@nestjs/common'
import { giornoItaliano } from '../../core/time/anno-italiano'
import {
  eConsorzio,
  type MovimentoDaClassificare,
} from '../../domain/comunicazioni/classifica-consorzio'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'
import { leggiIntegrazioni } from '../mud/aggregazione/mud-integrazioni'
import { estrattoConsorzioCsv, type RigaEstrattoConsorzio } from './estratto-consorzio-csv'
import { leggiMovimentiOrso } from './lettore-movimenti-orso'
import { MarcaturaConsorziService } from './marcatura-consorzi.service'
import {
  MarcaturaNonValidaError,
  type EstrattoConsorzio,
  type EstrattoConsorziPort,
} from './marcatura-consorzi.port'

const DATA = /^\d{4}-\d{2}-\d{2}$/
/** Un estratto copre al massimo cinque anni: oltre, il periodo e' quasi certamente un errore. */
const GIORNI_MASSIMI = 366 * 5

const mezzanotteUtc = (d: string) => new Date(`${d}T00:00:00.000Z`)

/**
 * Estratto CSV per consorzio e periodo (4.9b, T11): i movimenti vigenti marcati per quel consorzio
 * (regole + correzioni), con controparte, CER, kg e FIR. Riusa il lettore dei movimenti vigenti di
 * 4.9a (`leggiMovimentiOrso`), una sede alla volta. I registri senza sede (storici) non sono letti
 * dal lettore e restano fuori dall'estratto.
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
    if (!DATA.test(da) || !DATA.test(a)) throw new MarcaturaNonValidaError('Periodo non valido.')
    const inizio = mezzanotteUtc(da)
    const fineIncl = mezzanotteUtc(a)
    if (Number.isNaN(inizio.getTime()) || Number.isNaN(fineIncl.getTime()) || fineIncl < inizio) {
      throw new MarcaturaNonValidaError('Periodo non valido: la fine precede l’inizio.')
    }
    if ((fineIncl.getTime() - inizio.getTime()) / 86_400_000 > GIORNI_MASSIMI) {
      throw new MarcaturaNonValidaError('Periodo troppo lungo: al massimo cinque anni.')
    }
    // Fine ESCLUSA del lettore: il giorno dopo l'ultimo.
    const fine = new Date(fineIncl.getTime() + 86_400_000)

    const sedi = await this.prisma.rentriUnitaLocale.findMany({
      where: { tenantId, ...(params.unitaLocaleId ? { id: params.unitaLocaleId } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    if (params.unitaLocaleId && sedi.length === 0) {
      throw new MarcaturaNonValidaError('Sede non trovata.')
    }

    const [catalogo, record] = await Promise.all([
      caricaCatalogoCausali(this.prisma, tenantId),
      this.prisma.mUDReport.findFirst({
        where: { tenantId, year: Number(a.slice(0, 4)) },
        select: { reportData: true },
      }),
    ])
    const pesiSpecifici = leggiIntegrazioni(record?.reportData).pesiSpecifici

    const righe: Array<RigaEstrattoConsorzio & { ordine: string }> = []
    for (const sede of sedi) {
      const lettura = await leggiMovimentiOrso(this.prisma, {
        tenantId,
        unitaLocaleId: sede.id,
        da: inizio,
        a: fine,
        catalogo,
        pesiSpecifici,
      })
      const daClassificare: MovimentoDaClassificare[] = lettura.movimenti.map(m => ({
        radiceId: m.radiceId,
        registroId: m.registroId,
        verso: m.tipo,
        cer: m.cer,
        causale: m.causale,
        giorno: giornoItaliano(m.movementDate),
      }))
      const esiti = await this.marcatura.classifica(tenantId, daClassificare)
      lettura.movimenti.forEach((m, i) => {
        const marcatura = esiti[i].marcature.find(x => x.consorzio === consorzio)
        if (!marcatura) return
        const data = giornoItaliano(m.movementDate)
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
          ordine: `${data}|${m.numero.split('/')[1]}|${m.numero.split('/')[0].padStart(10, '0')}|${m.id}`,
        })
      })
    }
    righe.sort((x, y) => x.ordine.localeCompare(y.ordine))
    return {
      nomeFile: `estratto-${consorzio.toLowerCase()}-${da}_${a}.csv`,
      csv: estrattoConsorzioCsv(consorzio, righe),
      righe: righe.length,
    }
  }
}

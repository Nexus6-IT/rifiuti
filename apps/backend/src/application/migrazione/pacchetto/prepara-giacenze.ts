/**
 * `migrazione:prepara`, ambito GIACENZE (I6): MOVIMENTI + `[GIACENZE RIFIUTI]` -> fase `giacenze`
 * (una riga per famiglia registro/CER/stato fisico, in kg al taglio). Pura: niente Prisma ne' NestJS,
 * gira sulla workstation. Il calcolo e' `calcolaGiacenzeAlTaglio` (dominio): ricalcolo indipendente
 * da `RELAZ` e dalle giacenze iniziali, confrontato con `GIASCAR`. Le differenze vanno nel rapporto
 * per il cliente, mai corrette in silenzio.
 *
 * Il registro di una riga e' il MAGAZZINO WinWaste (`MAG`, o `MAG1`/`MAG2` del movimento) tradotto
 * dalla mappa (`registri[].legacy`). Un magazzino non in mappa e' uno scarto tipato e contato.
 *
 * Si prepara solo se lo staging ha sia `MOVIMENTI` sia `GIACENZE RIFIUTI` (un'estrazione conforme li
 * ha entrambi): senza `GIACENZE RIFIUTI` non c'e' apertura da portare.
 */
import { chiaveGiacenza } from '../../../domain/migrazione/chiavi-legacy'
import {
  calcolaGiacenzeAlTaglio,
  CodiceAvvisoGiacenze,
  CodiceScartoGiacenze,
  CaricoAltraUl,
  DifferenzaGiascar,
} from '../../../domain/migrazione/winwaste/giacenze-taglio'
import { StagingAperto } from '../staging/lettore-staging'
import { parsaGiacenzeRifiuti } from '../staging/parser/giacenze-rifiuti'
import { parsaMovimenti } from '../staging/parser/movimenti'
import { sorgenteDa } from '../staging/parser/scarti'
import { MappaImport } from './mappa-import'
import { VoceConteggio } from './prepara-anagrafiche'
import { RecordGiacenza } from './record-giacenze'

export type { CodiceAvvisoGiacenze, CodiceScartoGiacenze }

export interface RisultatoGiacenzePacchetto {
  readonly giacenze: readonly RecordGiacenza[]
  /** Carichi per cui `GIASCAR` non coincide col ricalcolo da `RELAZ` (>= 0,001 kg). */
  readonly differenzeGiascar: readonly DifferenzaGiascar[]
  /** Carichi di OPER 15, 24, 16, 26 su un'altra UL: fuori dalla giacenza (Q2), da inserire a mano se servono. */
  readonly caricoAltraUl: readonly CaricoAltraUl[]
  readonly scarti: ReadonlyArray<VoceConteggio<string>>
  readonly avvisi: ReadonlyArray<VoceConteggio<CodiceAvvisoGiacenze>>
}

export async function preparaGiacenze(
  staging: StagingAperto,
  mappa: MappaImport
): Promise<RisultatoGiacenzePacchetto> {
  if (!staging.ha('MOVIMENTI') || !staging.ha('GIACENZE RIFIUTI')) {
    return { giacenze: [], differenzeGiascar: [], caricoAltraUl: [], scarti: [], avvisi: [] }
  }
  const contesto = { ditta: mappa.ditta, anno: mappa.anno }
  const movimenti = await parsaMovimenti(sorgenteDa(staging, 'MOVIMENTI'), contesto)
  const righe = await parsaGiacenzeRifiuti(sorgenteDa(staging, 'GIACENZE RIFIUTI'))
  const registri = new Map(mappa.registri.map(r => [r.legacy.toUpperCase(), r.registroId]))
  const esito = calcolaGiacenzeAlTaglio({
    movimenti: movimenti.record,
    righeGiacenza: righe.record,
    dataTaglio: mappa.dataTaglio,
    registroDi: codice => registri.get(codice.trim().toUpperCase()) ?? null,
  })

  const conta = new Map<string, { tabella: string; codice: string; conteggio: number }>()
  const aggiungi = (tabella: string, codice: string, n = 1) => {
    const k = `${tabella}|${codice}`
    const v = conta.get(k)
    if (v) v.conteggio += n
    else conta.set(k, { tabella, codice, conteggio: n })
  }
  for (const s of movimenti.scarti) aggiungi('MOVIMENTI', s.codice)
  for (const s of righe.scarti) aggiungi('GIACENZE RIFIUTI', s.codice)
  for (const s of esito.scarti) aggiungi('GIACENZE', s.codice, s.conteggio)

  const giacenze: RecordGiacenza[] = esito.famiglie.map(f => ({
    legacyKey: chiaveGiacenza(
      mappa.ditta,
      mappa.anno,
      f.registroId,
      f.cerCode.replace(/\D/g, ''),
      f.statoFisico
    ),
    registroId: f.registroId,
    cerCode: f.cerCode,
    statoFisico: f.statoFisico,
    quantita: f.quantitaKg,
    unita: 'KG',
    dataRiferimento: mappa.dataTaglio,
    origini: f.origini.map(o => ({ anno: o.anno, protocollo: o.protocollo, quantita: o.quantita })),
  }))
  return {
    giacenze,
    differenzeGiascar: esito.differenzeGiascar,
    caricoAltraUl: esito.caricoAltraUl,
    scarti: [...conta.values()],
    avvisi: esito.avvisi.map(a => ({
      tabella: 'GIACENZE',
      codice: a.codice,
      conteggio: a.conteggio,
    })),
  }
}

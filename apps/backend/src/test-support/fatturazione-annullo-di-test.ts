import type { PrismaClient } from '@prisma/client'
import { AnnulloStornoService } from '../application/fatturazione/annullo-storno.service'
import { DocumentiFatturaService } from '../application/fatturazione/documenti-fattura.service'
import * as lockLegame from '../application/legami-movimento/lock-legame'
import type { PrismaService } from '../infrastructure/persistence/prisma.service'
import type { AziendaT18, ContrattoT18 } from './fatturazione-t18-di-test'
import { creaBancoT19, type BancoT19, type OpzioniBancoT19 } from './fatturazione-t19-di-test'

/**
 * Banco del Task 20 (annullo e storno), sopra quello del Task 19: crea documenti DEFINITIVI veri
 * (anteprima + definitiva), chiama il servizio e legge lo stato finale col PROPRIETARIO. Le
 * barriere sono le stesse del Task 19 (`pg_stat_activity`, mai uno sleep come sincronizzazione).
 */
export interface DefinitivoT20 {
  id: string
  numero: number
  contrattoId: string
  legameId: string
  movimentoId: string
}

export interface DocumentoLetto {
  id: string
  stato: string
  tipo_documento: string
  numero: number | null
  numero_testo: string | null
  anno: number
  data_documento: string
  elaborazione_id: string | null
  documento_origine_id: string | null
  versione: number
  emesso_il: Date | null
  annullato_da: string | null
  annullato_il: Date | null
  motivo_annullo: string | null
  totale_imponibile: string
  totale_iva: string
  totale_documento: string
  netto_a_pagare: string
  registro_iva_id: string
  definito_da: string | null
  fotografia: Record<string, unknown>
}

export interface LegameLetto {
  id: string
  stato: string
  versione: number
  documento_id: string | null
  riferimento_fattura: string | null
  fatturato_il: Date | null
  movimento_vigente_id: string
  movimento_originale_id: string
  scostamento_dopo_fattura: boolean
  scostamento_il: Date | null
  scostamento_gestito_il: Date | null
  scostamento_gestito_da: string | null
  scostamento_nota: string | null
  elenco_id: string | null
}

export function creaBancoT20(o: OpzioniBancoT19) {
  const t19: BancoT19 = creaBancoT19(o)
  const { owner, app } = o

  const banco = {
    t19,
    servizio: undefined as unknown as AnnulloStornoService,

    /** Da chiamare in `beforeEach`. */
    reset(): void {
      t19.reset()
      banco.servizio = new AnnulloStornoService(app, new DocumentiFatturaService(app))
    },

    /**
     * `n` contratti (ciascuno col suo legame confermato), anteprima e definitiva: `n` documenti
     * DEFINITIVI numerati 1..n nel registro predefinito. Restituisce i documenti in ordine di
     * numero.
     */
    async definitivi(
      az: AziendaT18,
      n: number,
      opz: {
        data?: string
        contratti?: (ContrattoT18 & { legameId: string | null })[]
        parametri?: Parameters<BancoT19['pronta']>[1]
      } = {}
    ): Promise<DefinitivoT20[]> {
      const contratti = opz.contratti ?? []
      for (let i = contratti.length; i < n; i++) {
        contratti.push(await t19.contratto(az, { data: opz.data }))
      }
      const e = await t19.pronta(az, opz.parametri)
      const esito = await t19.definitiva(az, e)
      if (esito.esito !== 'DEFINITIVA') throw new Error(`definitiva non riuscita: ${esito.esito}`)
      const docs = await t19.documenti(e.id)
      const perContratto = new Map(contratti.map(c => [c.contrattoId, c]))
      const risultato: DefinitivoT20[] = []
      for (const d of docs) {
        const c = perContratto.get(d.contratto_id)
        if (!c) continue
        const [mov] = await owner.$queryRawUnsafe<{ id: string }[]>(
          `SELECT movimento_originale_id::text AS id FROM legami_movimento WHERE id = $1::uuid`,
          c.legameId
        )
        risultato.push({
          id: d.id,
          numero: d.numero as number,
          contrattoId: c.contrattoId,
          legameId: c.legameId as string,
          movimentoId: mov.id,
        })
      }
      return risultato.sort((a, b) => a.numero - b.numero)
    },

    async documento(id: string): Promise<DocumentoLetto> {
      return (
        await owner.$queryRawUnsafe<DocumentoLetto[]>(
          `SELECT id::text, stato::text, tipo_documento, numero, numero_testo, anno::int,
                  data_documento::text, elaborazione_id::text, documento_origine_id::text,
                  versione, emesso_il, annullato_da::text, annullato_il, motivo_annullo,
                  totale_imponibile::text, totale_iva::text, totale_documento::text,
                  netto_a_pagare::text, registro_iva_id::text, definito_da::text, fotografia
           FROM documenti_fattura WHERE id = $1::uuid`,
          id
        )
      )[0]
    },

    async versioneDi(id: string): Promise<number> {
      return (await banco.documento(id)).versione
    },

    /** Il TD04 non annullato che storna `origineId`, se c'e'. */
    async stornoDi(origineId: string): Promise<DocumentoLetto | undefined> {
      const [r] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM documenti_fattura
         WHERE documento_origine_id = $1::uuid AND tipo_documento = 'TD04' AND stato <> 'ANNULLATO'`,
        origineId
      )
      return r ? banco.documento(r.id) : undefined
    },

    legami(ids: string[]): Promise<LegameLetto[]> {
      return owner.$queryRawUnsafe<LegameLetto[]>(
        `SELECT id::text, stato::text, versione, documento_id::text, riferimento_fattura,
                fatturato_il, movimento_vigente_id::text, movimento_originale_id::text,
                scostamento_dopo_fattura, scostamento_il, scostamento_gestito_il,
                scostamento_gestito_da::text, scostamento_nota, elenco_id::text
         FROM legami_movimento WHERE id = ANY($1::uuid[]) ORDER BY id`,
        ids
      )
    },

    /** Conteggi delle tabelle figlie di un documento. */
    async figlie(id: string) {
      const [r] = await owner.$queryRawUnsafe<
        { righe: number; riepiloghi: number; rate: number }[]
      >(
        `SELECT (SELECT count(*) FROM righe_documento_fattura WHERE documento_id = $1::uuid)::int AS righe,
                (SELECT count(*) FROM riepiloghi_iva_documento WHERE documento_id = $1::uuid)::int AS riepiloghi,
                (SELECT count(*) FROM rate_documento_fattura WHERE documento_id = $1::uuid)::int AS rate`,
        id
      )
      return r
    },

    righeComplete(id: string) {
      return owner.$queryRawUnsafe<
        {
          numero_linea: number
          tipo_riga: string
          legame_id: string | null
          riga_legame_id: string | null
          movimento_fatturato_id: string | null
          riga_addebito_id: string | null
          prezzo_totale: string
          quantita: string | null
          descrizione: string
        }[]
      >(
        `SELECT numero_linea, tipo_riga::text, legame_id::text, riga_legame_id::text,
                movimento_fatturato_id::text, riga_addebito_id::text, prezzo_totale::text,
                quantita::text, descrizione
         FROM righe_documento_fattura WHERE documento_id = $1::uuid ORDER BY numero_linea`,
        id
      )
    },

    audit(tenantId: string, azione: string) {
      return owner.$queryRawUnsafe<{ metadata: Record<string, unknown> }[]>(
        `SELECT metadata FROM activity_logs WHERE tenant_id = $1::uuid AND action = $2
         ORDER BY created_at`,
        tenantId,
        azione
      )
    },

    annulla(
      az: AziendaT18,
      id: string,
      b: { motivo?: string; versione: number } = { versione: 0 }
    ) {
      return t19.nel(az.tenantId, () =>
        banco.servizio.annulla(az.tenantId, az.utenteId, id, {
          motivo: b.motivo ?? 'errore di fatturazione',
          versione: b.versione,
        })
      )
    },

    /** Annulla leggendo la versione attuale. */
    async annullaCorrente(az: AziendaT18, id: string, motivo?: string) {
      return banco.annulla(az, id, { motivo, versione: await banco.versioneDi(id) })
    },

    storna(
      az: AziendaT18,
      id: string,
      b: { motivo?: string; dataDocumento?: string; rifatturabile?: boolean; versione: number }
    ) {
      return t19.nel(az.tenantId, () =>
        banco.servizio.storna(az.tenantId, az.utenteId, id, {
          motivo: b.motivo ?? 'reso della merce',
          dataDocumento: b.dataDocumento ?? '2026-04-20',
          rifatturabile: b.rifatturabile ?? true,
          versione: b.versione,
        })
      )
    },

    async stornaCorrente(
      az: AziendaT18,
      id: string,
      b: { motivo?: string; dataDocumento?: string; rifatturabile?: boolean } = {}
    ) {
      return banco.storna(az, id, { ...b, versione: await banco.versioneDi(id) })
    },

    /**
     * Esegue `fn` con la PRIMA chiamata a `bloccaRigheLegame` ferma, quando l'annullo/storno ha
     * gia' preso numerazione, documento e legami. `durante` parte con l'operazione ferma; l'operazione
     * riparte quando `durante` ha finito o chiama `rilascia`.
     */
    async conOperazioneInPausa<R, S>(
      operazione: () => Promise<S>,
      durante: (rilascia: () => void) => Promise<R>
    ): Promise<{ esito: PromiseSettledResult<S>; risultato: R }> {
      let rilascia!: () => void
      const cancello = new Promise<void>(r => (rilascia = r))
      let fermo!: () => void
      const eFerma = new Promise<void>(r => (fermo = r))
      const originale = lockLegame.bloccaRigheLegame
      let prima = true
      const spia = jest
        .spyOn(lockLegame, 'bloccaRigheLegame')
        .mockImplementation(async (...a: Parameters<typeof originale>) => {
          await originale(...a)
          if (prima) {
            prima = false
            fermo()
            await cancello
          }
        })
      try {
        const op = operazione()
        const settled = op.then(
          (v): PromiseSettledResult<S> => ({ status: 'fulfilled', value: v }),
          (e): PromiseSettledResult<S> => ({ status: 'rejected', reason: e })
        )
        const fase = await Promise.race([
          eFerma.then(() => 'ferma' as const),
          settled.then(() => 'fine' as const),
        ])
        if (fase === 'fine') throw new Error("l'operazione e finita senza fermarsi")
        let risultato: R
        try {
          risultato = await durante(rilascia)
        } finally {
          rilascia()
        }
        return { esito: await settled, risultato }
      } finally {
        spia.mockRestore()
      }
    },
  }
  return banco
}

export type BancoT20 = ReturnType<typeof creaBancoT20>

/** Aggiunge una RETTIFICA alla catena del movimento (col proprietario): la testa va avanti. */
export async function aggiungiRettificaDiTest(
  owner: PrismaClient,
  tenantId: string,
  radiceId: string
): Promise<string> {
  const origine = await owner.wasteMovement.findUniqueOrThrow({ where: { id: radiceId } })
  const ultimo = await owner.wasteMovement.aggregate({
    where: { registroId: origine.registroId, progressiveYear: 2026 },
    _max: { progressiveNumber: true },
  })
  const c = await owner.wasteMovement.create({
    data: {
      tenantId,
      registroId: origine.registroId,
      progressiveYear: 2026,
      progressiveNumber: (ultimo._max.progressiveNumber ?? 0) + 1,
      type: origine.type,
      movementDate: origine.movementDate,
      causale: origine.causale,
      cerCode: origine.cerCode,
      quantity: '90',
      unit: 'KG',
      tipoAnnotazione: 'RETTIFICA',
      movimentoRettificatoId: radiceId,
      movimentoOriginaleId: radiceId,
      motivoAnnotazione: 'prova',
    },
  })
  return c.id
}

export type { PrismaService }

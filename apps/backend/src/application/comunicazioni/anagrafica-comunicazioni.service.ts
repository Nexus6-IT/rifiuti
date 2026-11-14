import { Injectable } from '@nestjs/common'
import type { AnagraficaComunicazioniSede } from '@prisma/client'
import { eGiornoDiCalendario } from '../../core/time/anno-italiano'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  AnagraficaComunicazioniNonValidaError,
  SedeDittaNonTrovataError,
  type AnagraficaComunicazioniPort,
  type AnagraficaComunicazioniVista,
  type InputAnagraficaComunicazioni,
  type RisoluzioneIstat,
} from './anagrafica-comunicazioni.port'

const comeGiorno = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)
const comeData = (s: string | null | undefined): Date | null =>
  s ? new Date(`${s}T00:00:00.000Z`) : null
const vuotoANull = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

function vista(
  sedeDittaId: string,
  r: AnagraficaComunicazioniSede | null
): AnagraficaComunicazioniVista {
  return {
    sedeDittaId,
    eComune: r?.eComune ?? false,
    codiceIstatComune: r?.codiceIstatComune ?? null,
    codiceAteco: r?.codiceAteco ?? null,
    codiceOrso: r?.codiceOrso ?? null,
    alboDataIscrizione: comeGiorno(r?.alboDataIscrizione ?? null),
    alboClassi: r?.alboClassi ?? null,
    autorizzazioneData: comeGiorno(r?.autorizzazioneData ?? null),
    legaleRappresentanteCognome: r?.legaleRappresentanteCognome ?? null,
    legaleRappresentanteNome: r?.legaleRappresentanteNome ?? null,
    esclusaOrr: r?.esclusaOrr ?? false,
  }
}

/**
 * Dati delle sedi delle ditte (controparti) per le comunicazioni ai consorzi (4.9c-f, D3). Una
 * riga per sede; nessuna colonna nuova su `sedi_ditte`.
 */
@Injectable()
export class AnagraficaComunicazioniService implements AnagraficaComunicazioniPort {
  constructor(private readonly prisma: PrismaService) {}

  private async sede(tenantId: string, sedeDittaId: string) {
    const s = await this.prisma.sedeDitta.findFirst({
      where: { id: sedeDittaId, tenantId },
      select: { id: true, comune: true, provincia: true },
    })
    if (!s) throw new SedeDittaNonTrovataError()
    return s
  }

  async leggi(tenantId: string, sedeDittaId: string): Promise<AnagraficaComunicazioniVista> {
    await this.sede(tenantId, sedeDittaId)
    const r = await this.prisma.anagraficaComunicazioniSede.findFirst({
      where: { tenantId, sedeDittaId },
    })
    return vista(sedeDittaId, r)
  }

  async imposta(
    tenantId: string,
    sedeDittaId: string,
    input: InputAnagraficaComunicazioni
  ): Promise<AnagraficaComunicazioniVista> {
    await this.sede(tenantId, sedeDittaId)
    const errori: string[] = []
    const istat = vuotoANull(input.codiceIstatComune)
    const ateco = vuotoANull(input.codiceAteco)
    const orso = vuotoANull(input.codiceOrso)
    const albo = vuotoANull(input.alboDataIscrizione)
    const autorizzazione = vuotoANull(input.autorizzazioneData)
    const alboClassi = vuotoANull(input.alboClassi)
    const cognome = vuotoANull(input.legaleRappresentanteCognome)
    const nome = vuotoANull(input.legaleRappresentanteNome)

    if (istat !== null) {
      if (!/^[0-9]{6}$/.test(istat)) errori.push('codiceIstatComune: 6 cifre')
      else if (
        !(await this.prisma.istatComune.findUnique({
          where: { code: istat },
          select: { code: true },
        }))
      ) {
        errori.push('codiceIstatComune: il codice non esiste fra i comuni ISTAT')
      }
    }
    if (ateco !== null && !/^([0-9]{2}\.[0-9]{2}\.[0-9]{2}|[0-9]{6})$/.test(ateco)) {
      errori.push('codiceAteco: formato NN.NN.NN oppure 6 cifre')
    }
    if (orso !== null && !/^[0-9]{1,9}$/.test(orso)) errori.push('codiceOrso: da 1 a 9 cifre')
    if (albo !== null && !eGiornoDiCalendario(albo))
      errori.push('alboDataIscrizione: giorno AAAA-MM-GG')
    if (autorizzazione !== null && !eGiornoDiCalendario(autorizzazione)) {
      errori.push('autorizzazioneData: giorno AAAA-MM-GG')
    }
    if (alboClassi !== null && alboClassi.length > 30)
      errori.push('alboClassi: al massimo 30 caratteri')
    if (cognome !== null && cognome.length > 25) {
      errori.push('legaleRappresentanteCognome: al massimo 25 caratteri')
    }
    if (nome !== null && nome.length > 25)
      errori.push('legaleRappresentanteNome: al massimo 25 caratteri')
    if (errori.length > 0) throw new AnagraficaComunicazioniNonValidaError(errori)

    const dati = {
      eComune: input.eComune ?? false,
      codiceIstatComune: istat,
      codiceAteco: ateco,
      codiceOrso: orso,
      alboDataIscrizione: comeData(albo),
      alboClassi,
      autorizzazioneData: comeData(autorizzazione),
      legaleRappresentanteCognome: cognome,
      legaleRappresentanteNome: nome,
      esclusaOrr: input.esclusaOrr ?? false,
    }
    const r = await this.prisma.anagraficaComunicazioniSede.upsert({
      where: { tenantId_sedeDittaId: { tenantId, sedeDittaId } },
      create: { tenantId, sedeDittaId, ...dati },
      update: dati,
    })
    return vista(sedeDittaId, r)
  }

  async risolviIstat(tenantId: string, sedeDittaId: string): Promise<RisoluzioneIstat> {
    const sede = await this.sede(tenantId, sedeDittaId)
    const forzato = await this.prisma.anagraficaComunicazioniSede.findFirst({
      where: { tenantId, sedeDittaId },
      select: { codiceIstatComune: true },
    })
    if (forzato?.codiceIstatComune) return { codice: forzato.codiceIstatComune, origine: 'FORZATO' }
    const nome = sede.comune?.trim()
    const sigla = sede.provincia?.trim().toUpperCase()
    if (!nome || !sigla) return { codice: null, motivo: 'COMUNE_O_PROVINCIA_MANCANTE' }
    const comuni = await this.prisma.istatComune.findMany({
      // Come in `RisolutoreComuneIstat`: maiuscole insensibili, nessun'altra normalizzazione.
      where: { name: { equals: nome, mode: 'insensitive' }, provinciaSigla: sigla },
      select: { code: true },
      take: 2,
    })
    if (comuni.length === 0) return { codice: null, motivo: 'COMUNE_NON_TROVATO' }
    if (comuni.length > 1) return { codice: null, motivo: 'COMUNE_AMBIGUO' }
    return { codice: comuni[0].code, origine: 'DA_NOME' }
  }
}

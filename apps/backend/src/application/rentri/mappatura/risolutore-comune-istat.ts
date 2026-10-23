import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RisolutoreComune } from './mappa-parti'

/**
 * Traduce (nome comune + sigla provincia) nel `comune_id` che RENTRI si
 * aspetta dentro `IndirizzoModel.citta`.
 *
 * PERCHE' NON CHIAMA RENTRI. Il contratto delle codifiche dichiara
 * `comune_id` come «Codice ISTAT comune» e `provincia_id` come «Codice ISTAT
 * provincia» (`docs/contracts/rentri/codifiche.yaml`, parametri di
 * `/lookup/comuni/{provincia_id}`). Sono gli stessi codici che teniamo gia'
 * nella tabella `istat_comuni`, popolata dal seed: risolvere in locale evita
 * una chiamata di rete per ogni parte di ogni formulario, e quindi anche il
 * limitatore di frequenza per azienda.
 *
 * L'ASSUNZIONE, dichiarata: che il nostro codice ISTAT e quello del catalogo
 * RENTRI coincidano. E' quanto entrambi i lati dichiarano, ma non e' stato
 * verificato contro l'ambiente reale. Se un giorno divergessero, questo e'
 * il punto unico da cambiare — e la sostituzione con una lettura da
 * `RentriCodificheClient.comuniProvincia` non tocca nulla d'altro, perche' i
 * mappatori dipendono dalla porta `RisolutoreComune`, non da questa classe.
 *
 * Comune sconosciuto o provincia che non combacia: `null`, mai un codice di
 * ripiego. Il mappatore trasforma quel `null` in un rifiuto esplicito.
 */
@Injectable()
export class RisolutoreComuneIstat implements RisolutoreComune {
  constructor(private readonly prisma: PrismaService) {}

  async risolvi(nomeComune: string, provinciaSigla: string): Promise<string | null> {
    const nome = nomeComune?.trim()
    const sigla = provinciaSigla?.trim().toUpperCase()
    if (!nome || !sigla) return null

    const comune = await this.prisma.db.istatComune.findFirst({
      where: {
        // I nomi ISTAT hanno accenti e maiuscole proprie ("Forlì", "L'Aquila"):
        // il confronto e' insensibile alle maiuscole, non normalizza altro.
        name: { equals: nome, mode: 'insensitive' },
        provinciaSigla: sigla,
      },
      select: { code: true },
    })

    return comune?.code ?? null
  }
}

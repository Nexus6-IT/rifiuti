// Codifiche di addebito: gruppo, categoria, categorie statistiche e centro di ricavo (4.2a, D4).
// Una tabella per cinque elenchi, distinti dal `genere`, con codice unico per (azienda, genere).
// Il comportamento comune con le codifiche del contratto della 4.1 (lock ottimistico D14,
// disattivazione al posto della cancellazione D13/R44, audit D16, creazione in linea R24) sta in
// `clienti/codifiche-tabella` (R25); qui solo le differenze: generi, codice numerico di tre cifre
// (`domain/listino/codifica-addebito`) e referenti (addebiti e righe dei listini).
import { Injectable } from '@nestjs/common'
import {
  ETICHETTE_GENERE_ADDEBITO,
  MSG_CODICE_CODIFICA,
  normalizzaCodificaAddebito,
  validaCodificaAddebito,
  type DatiCodificaAddebito,
  type GenereCodificaAddebito,
} from '../../domain/listino/codifica-addebito'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type { DescrizioneEntita, VincoliNoti } from '../clienti/anagrafica-versionata'
import {
  CodificheTabella,
  type CodificaVistaBase,
  type DelegatoCodifica,
  type FiltroCodificheBase,
  type ModificaCodificaBase,
  type NuovaCodificaBase,
} from '../clienti/codifiche-tabella'
import { COLONNE_CODIFICA_ADDEBITO, contaUsiListino } from './uso-listino'

const ENTITA: DescrizioneEntita = {
  prefisso: 'CODIFICA_ADDEBITO',
  soggetto: 'La codifica di addebito',
  femminile: true,
  // R9: il testo di ripiego direbbe "clienti o contratti", che qui non c'entrano.
  inUso: {
    codice: 'CODIFICA_ADDEBITO_IN_USO',
    messaggio:
      "La codifica è usata da addebiti dell'archivio o da righe dei listini: disattivala invece di eliminarla.",
  },
}

/** Unica chiave unica di business della tabella: (azienda, genere, codice). */
const VINCOLI: VincoliNoti = {
  codifiche_addebito_tenant_id_genere_codice_key: {
    codice: 'CODIFICA_ADDEBITO_CODICE_DUPLICATO',
    messaggio: 'Esiste già una codifica con questo codice in questo elenco.',
  },
}

export type CodificaAddebitoVista = CodificaVistaBase<GenereCodificaAddebito>
/** Il `genere` si sceglie alla creazione e non cambia piu'. Codice assente o null = primo libero. */
export type NuovaCodificaAddebito = NuovaCodificaBase<GenereCodificaAddebito>
export type ModificaCodificaAddebito = ModificaCodificaBase
export type FiltroCodificheAddebito = FiltroCodificheBase<GenereCodificaAddebito>

@Injectable()
export class CodificheAddebitoService {
  private readonly motore: CodificheTabella<GenereCodificaAddebito>

  constructor(prisma: PrismaService) {
    this.motore = new CodificheTabella<GenereCodificaAddebito>(prisma, {
      prefisso: 'CODIFICA_ADDEBITO',
      entita: ENTITA,
      vincoli: VINCOLI,
      tabellaSql: 'codifiche_addebito',
      tipoGenereSql: 'genere_codifica_addebito',
      prefissoLock: 'codifiche-addebito-codice:',
      descrizioneAudit: 'Codifica di addebito',
      messaggioCodiceMancante: MSG_CODICE_CODIFICA,
      delegato: c => c.codificaAddebito as unknown as DelegatoCodifica,
      controllaGenere: g =>
        typeof g === 'string' && Object.prototype.hasOwnProperty.call(ETICHETTE_GENERE_ADDEBITO, g)
          ? (g as GenereCodificaAddebito)
          : null,
      normalizza: normalizzaCodificaAddebito,
      valida: d => validaCodificaAddebito(d as DatiCodificaAddebito),
      contaUsi: (client, tenantId, ids) =>
        contaUsiListino(client, tenantId, ids, COLONNE_CODIFICA_ADDEBITO),
    })
  }

  list(tenantId: string, filtro: FiltroCodificheAddebito): Promise<CodificaAddebitoVista[]> {
    return this.motore.list(tenantId, filtro)
  }

  getById(tenantId: string, id: string): Promise<CodificaAddebitoVista> {
    return this.motore.getById(tenantId, id)
  }

  /** Il codice che la creazione in linea assegnerebbe adesso (solo informativo: non riserva nulla). */
  prossimoCodice(tenantId: string, genere: GenereCodificaAddebito): Promise<string> {
    return this.motore.prossimoCodice(tenantId, genere)
  }

  crea(
    tenantId: string,
    utenteId: string,
    dati: NuovaCodificaAddebito
  ): Promise<CodificaAddebitoVista> {
    return this.motore.crea(tenantId, utenteId, dati)
  }

  modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaCodificaAddebito
  ): Promise<CodificaAddebitoVista> {
    return this.motore.modifica(tenantId, utenteId, id, m)
  }

  elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return this.motore.elimina(tenantId, utenteId, id, versione)
  }
}

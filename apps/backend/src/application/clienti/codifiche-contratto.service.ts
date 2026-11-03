// Codifiche del contratto: categorie, tipi e motivi di annullo (4.1a, D26). Una tabella per tre
// elenchi, distinti dal `genere`, con codice unico per (azienda, genere). Lock ottimistico (D14),
// disattivazione al posto della cancellazione quando la codifica e' in uso (D13) e audit (D16).
// Il comportamento comune con le codifiche di addebito sta in `codifiche-tabella` (R25); qui solo
// le differenze: generi, regole del codice (domain/clienti/codifica-contratto) e referenti.
//
// Creazione in linea: senza `codice` il servizio assegna il primo codice numerico libero del genere.
import { Injectable } from '@nestjs/common'
import {
  normalizzaCodifica,
  validaCodifica,
  type DatiCodifica,
  type GenereCodifica,
} from '../../domain/clienti/codifica-contratto'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type { DescrizioneEntita, VincoliNoti } from './anagrafica-versionata'
import {
  CodificheTabella,
  type CodificaVistaBase,
  type DelegatoCodifica,
  type FiltroCodificheBase,
  type ModificaCodificaBase,
  type NuovaCodificaBase,
} from './codifiche-tabella'
import { COLONNE_CODIFICA, contaUsi } from './uso-tabelle-fatturazione'

const ENTITA: DescrizioneEntita = {
  prefisso: 'CODIFICA_CONTRATTO',
  soggetto: 'La codifica del contratto',
  femminile: true,
}

/** Unica chiave unica di business della tabella: (azienda, genere, codice). */
const VINCOLI: VincoliNoti = {
  codifiche_contratto_tenant_id_genere_codice_key: {
    codice: 'CODIFICA_CONTRATTO_CODICE_DUPLICATO',
    messaggio: 'Esiste già una codifica con questo codice in questo elenco.',
  },
}

const GENERI: readonly string[] = ['CATEGORIA', 'TIPO', 'MOTIVO_ANNULLO']

export type CodificaVista = CodificaVistaBase<GenereCodifica>
/** Il `genere` si sceglie alla creazione e non cambia piu'. Codice omesso = primo numerico libero (D26). */
export type NuovaCodifica = NuovaCodificaBase<GenereCodifica>
export type ModificaCodifica = ModificaCodificaBase
export type FiltroCodifiche = FiltroCodificheBase<GenereCodifica>

@Injectable()
export class CodificheContrattoService {
  private readonly motore: CodificheTabella<GenereCodifica>

  constructor(prisma: PrismaService) {
    this.motore = new CodificheTabella<GenereCodifica>(prisma, {
      prefisso: 'CODIFICA_CONTRATTO',
      entita: ENTITA,
      vincoli: VINCOLI,
      tabellaSql: 'codifiche_contratto',
      tipoGenereSql: 'genere_codifica_contratto',
      prefissoLock: 'codifiche-contratto-codice:',
      descrizioneAudit: 'Codifica del contratto',
      messaggioCodiceMancante: 'Indica il codice.',
      delegato: c => c.codificaContratto as unknown as DelegatoCodifica,
      controllaGenere: g =>
        typeof g === 'string' && GENERI.includes(g) ? (g as GenereCodifica) : null,
      normalizza: normalizzaCodifica,
      valida: d => validaCodifica(d as DatiCodifica),
      contaUsi: (client, tenantId, ids) => contaUsi(client, tenantId, ids, COLONNE_CODIFICA),
    })
  }

  list(tenantId: string, filtro: FiltroCodifiche): Promise<CodificaVista[]> {
    return this.motore.list(tenantId, filtro)
  }

  getById(tenantId: string, id: string): Promise<CodificaVista> {
    return this.motore.getById(tenantId, id)
  }

  /** Il codice che la creazione in linea assegnerebbe adesso (solo informativo: non riserva nulla). */
  prossimoCodice(tenantId: string, genere: GenereCodifica): Promise<string> {
    return this.motore.prossimoCodice(tenantId, genere)
  }

  crea(tenantId: string, utenteId: string, dati: NuovaCodifica): Promise<CodificaVista> {
    return this.motore.crea(tenantId, utenteId, dati)
  }

  modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaCodifica
  ): Promise<CodificaVista> {
    return this.motore.modifica(tenantId, utenteId, id, m)
  }

  elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return this.motore.elimina(tenantId, utenteId, id, versione)
  }
}

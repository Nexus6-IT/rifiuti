import { Controller, Get, RequestMethod, Type, UseGuards } from '@nestjs/common'
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants'
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { FEATURE_KEYS, FeatureKey } from '../application/admin/feature-catalog'
import { AppModule } from '../app.module'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { JwtAuthGuard as JwtAuthGuardCore } from '../core/auth/jwt-auth.guard'
import {
  RICHIEDE_MODULO,
  RichiedeModulo,
  SENZA_MODULO,
  SenzaModulo,
} from '../core/decorators/richiede-modulo.decorator'
import { leggiControllerReali, senzaCommenti } from '../test-support/sorgenti-controller'

/**
 * Copertura dei moduli commerciali sui controller.
 *
 * Ogni controller montato dichiara a quale modulo appartiene (`@RichiedeModulo`) oppure sta
 * nell'area base (`BASE`, sempre attiva). Un controller nuovo che non e' in nessun elenco fa
 * fallire il test: la decisione sul modulo va presa quando lo si scrive, non dopo.
 *
 * Due livelli: (1) statico, sui sorgenti (ogni file e' in un solo elenco, le voci non sono
 * orfane, il decoratore di classe e' quello atteso); (2) a runtime, con `DiscoveryService` +
 * `Reflector` sui controller realmente raggiungibili da `AppModule` (chiavi effettive per ogni
 * metodo, `JwtAuthGuard`, nessun conflitto fra i due decoratori).
 */

/**
 * Voce di un controller di modulo.
 *  - `chiavi`: decoratore di CLASSE (basta una delle chiavi);
 *  - `metodi`: decoratore sul singolo metodo (nome del metodo -> chiavi, oppure `'senza-modulo'`
 *    per una rotta pubblica). Senza `chiavi` deve coprire OGNI rotta; con `chiavi` indica solo le
 *    eccezioni (rotte condivise con altri moduli, che allargano l'elenco).
 */
interface VoceModulo {
  motivo: string
  chiavi?: readonly FeatureKey[]
  metodi?: Record<string, readonly FeatureKey[] | 'senza-modulo'>
}

const LETTURA_ANAGRAFICHE = ['anagrafiche', 'fir', 'registro', 'contratti', 'pese'] as const

/** Letture delle anagrafiche condivise con FIR, registro e contratti (P2: basta una delle chiavi). */
const LETTURE_REGISTRY: Record<string, readonly FeatureKey[]> = {
  listProduttori: LETTURA_ANAGRAFICHE,
  getProduttore: LETTURA_ANAGRAFICHE,
  listTrasportatori: LETTURA_ANAGRAFICHE,
  getTrasportatore: LETTURA_ANAGRAFICHE,
  listDestinatari: LETTURA_ANAGRAFICHE,
  getDestinatario: LETTURA_ANAGRAFICHE,
}

const CONTRATTI = (motivo: string): VoceModulo => ({ chiavi: ['contratti'], motivo })

export const MAPPA_MODULI: Record<string, VoceModulo> = {
  // fir
  'api/fir/fir.controller.v2.ts': {
    chiavi: ['fir'],
    motivo: 'Formulari: rotte /fir; la lista e una lettura condivisa con registro, pese e RENTRI',
    metodi: { list: ['fir', 'registro', 'pese', 'rentri'] },
  },
  'api/signatures/signatures.controller.ts': {
    motivo:
      'Firma dei FIR (fir). verify e verify-url sono pubbliche (QR code sulla copia cartacea): ' +
      'senza autenticazione e senza azienda, quindi senza modulo',
    metodi: {
      applySignature: ['fir'],
      verifySignaturesDettaglio: ['fir'],
      verifySignatures: 'senza-modulo',
      getVerificationUrl: 'senza-modulo',
    },
  },
  'api/pdf/pdf.controller.ts': {
    motivo: 'Un solo controller per due moduli: il PDF del FIR (fir) e quello del MUD (mud)',
    metodi: { downloadFIR: ['fir'], downloadFIRSerie: ['fir'], downloadMUD: ['mud'] },
  },
  // cer: catalogo condiviso in lettura con FIR, registro e giacenze
  'api/cer/cer.controller.ts': {
    chiavi: ['cer', 'fir', 'registro', 'giacenze'],
    motivo: 'Catalogo CER: sola lettura, usato anche da FIR, registro e giacenze (P2)',
  },
  // anagrafiche
  'api/registry/registry.controller.ts': {
    chiavi: ['anagrafiche'],
    motivo:
      'Produttori, trasportatori, destinatari: scrittura solo con anagrafiche, letture condivise',
    metodi: LETTURE_REGISTRY,
  },
  'api/registry/ditte.controller.ts': {
    chiavi: ['anagrafiche'],
    motivo: 'Ditte e sedi: scrittura solo con anagrafiche, ricerca e dettaglio condivisi',
    metodi: { cerca: LETTURA_ANAGRAFICHE, dettaglio: LETTURA_ANAGRAFICHE },
  },
  // registro
  'api/registro/registro.controller.ts': {
    chiavi: ['registro'],
    motivo:
      'Registro cronologico; letture condivise: elenco dei registri (giacenze, pese, contratti) e movimenti (pese, contratti)',
    metodi: {
      elencaRegistri: ['registro', 'giacenze', 'pese', 'contratti'],
      lista: ['registro', 'pese', 'contratti'],
    },
  },
  'api/registro/causali-registro.controller.ts': {
    chiavi: ['registro'],
    motivo: 'Causali del registro cronologico',
  },
  // mud
  'api/mud/mud.controller.ts': { chiavi: ['mud'], motivo: 'Dichiarazione MUD' },
  'api/comunicazioni/comunicazioni.controller.ts': {
    chiavi: ['comunicazioni'],
    motivo: 'Comunicazioni ai consorzi (O.R.SO.)',
  },
  'api/comunicazioni/marcatura-consorzi.controller.ts': {
    chiavi: ['comunicazioni'],
    motivo: 'Marcatura dei movimenti per consorzio: regole, correzioni, estratto',
  },
  // giacenze
  'application/giacenze/giacenze.controller.ts': {
    chiavi: ['giacenze'],
    motivo: 'Giacenze e depositi temporanei',
  },
  'application/abbinamenti/abbinamenti.controller.ts': {
    chiavi: ['giacenze'],
    motivo: 'Abbinamenti scarico-carico: pagina /giacenze/abbinamenti',
  },
  // contratti (e tutta la fatturazione: nessuna chiave `fatturazione`, D1a)
  'application/contracts/contract.controller.ts': CONTRATTI('Contratti con i clienti'),
  'api/clienti/agenti.controller.ts': CONTRATTI('Anagrafica agenti dei clienti'),
  'api/clienti/allegati-contratto-cliente.controller.ts': CONTRATTI(
    'Allegati dei contratti cliente'
  ),
  'api/clienti/clienti.controller.ts': CONTRATTI('Anagrafica dei clienti'),
  'api/clienti/codifiche-contratto.controller.ts': CONTRATTI('Codifiche dei contratti'),
  'api/clienti/condizioni-pagamento.controller.ts': CONTRATTI('Condizioni di pagamento'),
  'api/clienti/conti-correnti.controller.ts': CONTRATTI('Conti correnti'),
  'api/clienti/contratti-cliente.controller.ts': CONTRATTI('Contratti dei clienti'),
  'api/clienti/registri-iva.controller.ts': CONTRATTI('Registri IVA'),
  'api/clienti/spese-accessorie.controller.ts': CONTRATTI('Spese accessorie'),
  'api/clienti/testi-fatturazione.controller.ts': CONTRATTI('Testi di fatturazione'),
  'api/modelli-stampa/modelli-stampa.controller.ts': {
    chiavi: ['fir', 'ritiri'],
    motivo: 'Modelli di stampa di FIR e distinta dei ritiri',
  },
  'api/listino/addebiti.controller.ts': CONTRATTI('Listino: addebiti'),
  'api/listino/allegati-elenco.controller.ts': CONTRATTI('Listino: allegati degli elenchi'),
  'api/listino/codici-iva.controller.ts': CONTRATTI('Listino: codici IVA'),
  'api/listino/codifiche-addebito.controller.ts': CONTRATTI('Listino: codifiche degli addebiti'),
  'api/listino/elenchi-addebiti.controller.ts': CONTRATTI('Listino: elenchi degli addebiti'),
  'api/listino/elenchi-contratto.controller.ts': CONTRATTI('Listino: elenchi visti dal contratto'),
  'api/listino/righe-addebito.controller.ts': CONTRATTI('Listino: righe di addebito'),
  'api/listino/variazioni-prezzi.controller.ts': CONTRATTI('Listino: variazioni di prezzo'),
  'api/fatturazione/cedente.controller.ts': CONTRATTI('Fatturazione: cedente'),
  'api/fatturazione/documenti-fattura.controller.ts': CONTRATTI('Fatturazione: documenti'),
  'api/fatturazione/elaborazioni.controller.ts': CONTRATTI('Fatturazione: elaborazioni'),
  'api/fatturazione/export-contabile.controller.ts': CONTRATTI('Fatturazione: export contabile'),
  'api/fatturazione/numerazioni.controller.ts': CONTRATTI('Fatturazione: numerazioni'),
  'api/fatturazione/scostamenti.controller.ts': CONTRATTI(
    'Fatturazione: scostamenti (controller senza prefisso, decoratore di classe)'
  ),
  'api/legami-movimento/impostazioni-fatturazione.controller.ts': CONTRATTI(
    'Impostazioni di fatturazione e legami'
  ),
  'api/legami-movimento/legami-movimento.controller.ts': CONTRATTI(
    'Legami movimento-cliente-prezzo'
  ),
  'api/legami-movimento/movimento-legame.controller.ts': CONTRATTI(
    'Legame di un movimento (prefisso registro/movimenti ma funzione dei contratti)'
  ),
  // esg, anomalie, pese, reference data
  'application/esg/esg.controller.ts': { chiavi: ['esg'], motivo: 'Cruscotto ESG' },
  'application/anomaly/anomaly.controller.ts': {
    chiavi: ['anomalie'],
    motivo: 'Anomalie e controlli di coerenza',
  },
  'api/pese/pese.controller.ts': {
    chiavi: ['pese'],
    motivo: 'Pese in ingresso e uscita; elenco automezzi letto anche dai ritiri',
    metodi: { elencaAutomezzi: ['pese', 'ritiri'] },
  },
  'api/pese/agenti-pesa.controller.ts': {
    chiavi: ['pese'],
    motivo: 'Agenti di pesa e letture dello strumento (4.8b)',
  },
  'api/ritiri/ritiri.controller.ts': { chiavi: ['ritiri'], motivo: 'Ritiri programmati' },
  'api/ritiri/stampa-ritiri.controller.ts': {
    chiavi: ['ritiri'],
    motivo: 'Distinta dei ritiri e stampa dei FIR dei ritiri',
  },
  'application/reference-data/reference-data.controller.ts': {
    chiavi: ['reference_data'],
    motivo: 'Dati di riferimento (SUPER_ADMIN)',
  },
  // rentri: tutti i controller, anche quelli usati dalle pagine FIR e registro (il FE nasconde i pulsanti)
  'api/rentri/rentri-codifiche.controller.ts': { chiavi: ['rentri'], motivo: 'RENTRI: codifiche' },
  'api/rentri/rentri-credential.controller.ts': {
    chiavi: ['rentri'],
    motivo: 'RENTRI: certificato',
  },
  'api/rentri/rentri-diagnostica.controller.ts': {
    chiavi: ['rentri'],
    motivo: 'RENTRI: diagnostica',
  },
  'api/rentri/rentri-fir-lifecycle.controller.ts': {
    chiavi: ['rentri'],
    motivo: 'RENTRI: ciclo di vita del FIR',
  },
  'api/rentri/rentri-formulari.controller.ts': {
    chiavi: ['rentri'],
    motivo: 'RENTRI: formulari (controller senza prefisso, decoratore di classe)',
  },
  'api/rentri/rentri-modalita-legame.controller.ts': {
    chiavi: ['rentri'],
    motivo: 'RENTRI: modalita di legame',
  },
  'api/rentri/rentri-registro.controller.ts': { chiavi: ['rentri'], motivo: 'RENTRI: registro' },
  'api/rentri/rentri-scorta.controller.ts': {
    chiavi: ['rentri'],
    motivo: 'RENTRI: blocchi e scorta',
  },
  'api/rentri/rentri-siti.controller.ts': { chiavi: ['rentri'], motivo: 'RENTRI: siti' },
  'api/rentri/rentri-sync.controller.ts': { chiavi: ['rentri'], motivo: 'RENTRI: trasmissioni' },
  'api/rentri/rentri-unita-locale.controller.ts': {
    chiavi: ['rentri'],
    motivo:
      'RENTRI: unita locali; l elenco e una lettura condivisa con le comunicazioni (scelta sede)',
    metodi: { list: ['rentri', 'comunicazioni'] },
  },
}

/** Area base: sempre attiva, mai dietro un modulo. Ogni voce ha il suo motivo. */
export const BASE: Record<string, string> = {
  'auth/controllers/auth.controller.ts': 'Login, refresh e logout: precedono ogni azienda',
  'auth/controllers/dev-auth.controller.ts': 'Login di sviluppo: precede ogni azienda',
  'api/auth/auth.controller.ts': 'Autenticazione: precede ogni azienda',
  'api/access-request/access-request.controller.ts':
    'Richiesta di accesso (lead): pubblica, senza utente',
  'api/agenti-pesa/ingresso-agente.controller.ts':
    "Rotte dell'agente di pesa: senza utente, autenticate dal token dell'agente; il modulo pese lo verifica AgentePesaGuard",
  'api/me/me-features.controller.ts': 'Dice al frontend quali moduli sono attivi',
  'api/me/membership.controller.ts': "Appartenenza dell'utente alle aziende e selezione azienda",
  'api/admin/access-request-admin.controller.ts': 'Amministrazione di piattaforma (SUPER_ADMIN)',
  'api/admin/audit-piattaforma.controller.ts': 'Amministrazione di piattaforma (SUPER_ADMIN)',
  'api/admin/system-health.controller.ts': 'Amministrazione di piattaforma (SUPER_ADMIN)',
  'api/admin/tenant.controller.ts': 'Gestione delle aziende e dei loro moduli (SUPER_ADMIN)',
  'api/admin/user-admin.controller.ts': 'Gestione utenti',
  'application/billing/billing.controller.ts':
    'Abbonamento e pagamento: serve anche a chi non ha moduli; il webhook di Stripe e pubblico',
  'api/dashboard/andamento.controller.ts':
    'Cruscotto iniziale: base (la parte giacenze si filtra nel servizio, seguito)',
  'api/dashboard/attenzione.controller.ts': 'Cruscotto iniziale: base',
  'api/dashboard/dashboard.controller.ts': 'Cruscotto iniziale: base',
  'api/notifications/notifications.controller.ts': 'Notifiche in-app: base',
  'api/audit/audit.controller.ts': "Registro delle attivita' dell'azienda: base",
  'api/permissions/audit.controller.ts': 'Ruoli e permessi: base',
  'api/permissions/consultant.controller.ts': 'Consulenti e aziende clienti: base',
  'api/permissions/permission.controller.ts': 'Ruoli e permessi: base',
  'api/permissions/role.controller.ts': 'Ruoli e permessi: base',
  'api/permissions/temporary-permission.controller.ts': 'Ruoli e permessi: base',
  'api/permissions/user-role.controller.ts': 'Ruoli e permessi: base',
  'api/policies/policies.controller.ts': 'Termini e privacy: base',
  'api/task-assignment/task-assignment.controller.ts': 'Assegnazione attivita: base',
  'infrastructure/monitoring/health-check.controller.ts': 'Health check: pubblico',
  'api/monitoring/metrics.controller.ts': 'Metriche: pubbliche (protette dalla rete)',
}

/** Controller dichiarati ma non montati in nessun modulo: codice morto, non esposto. */
export const NON_MONTATI: Record<string, string> = {
  'api/fir/fir.controller.example.ts': 'Esempio di documentazione: nessun modulo lo registra',
  'api/fir/fir.controller.ts':
    'Vecchio controller base (solo create/list): sostituito da FIRControllerV2, non registrato',
}

// ---------------------------------------------------------------------------------------------
// Livello statico
// ---------------------------------------------------------------------------------------------

/** File che dichiarano davvero un controller (un commento che cita il decoratore non conta). */
export function controllerDichiarati(file: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rel, testo] of Object.entries(file)) {
    if (/^@Controller\(/m.test(senzaCommenti(testo))) out[rel] = testo
  }
  return out
}

/** Nome della classe controller dichiarata nel sorgente. */
export function nomeControllerDi(testo: string): string | undefined {
  const codice = senzaCommenti(testo)
  const i = codice.search(/^@Controller\(/m)
  if (i < 0) return undefined
  return /^export class (\w+)/m.exec(codice.slice(i))?.[1]
}

/** Elenchi di chiavi dei `@RichiedeModulo(...)` a livello di classe (a inizio riga). */
export function chiaviDiClasse(testo: string): string[][] {
  return [...senzaCommenti(testo).matchAll(/^@RichiedeModulo\(([^)]*)\)/gm)].map(m =>
    [...m[1].matchAll(/'([a-z_]+)'/g)].map(k => k[1])
  )
}

function stessoInsieme(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
}

/** Problemi statici di un insieme di controller rispetto agli elenchi. */
export function problemiStatici(
  file: Record<string, string>,
  mappa: Record<string, VoceModulo>,
  base: Record<string, string>,
  nonMontati: Record<string, string>
): string[] {
  const problemi: string[] = []
  const dichiarati = controllerDichiarati(file)
  const elenchi: [string, Record<string, unknown>][] = [
    ['MAPPA_MODULI', mappa],
    ['BASE', base],
    ['NON_MONTATI', nonMontati],
  ]

  for (const rel of Object.keys(dichiarati)) {
    const dove = elenchi.filter(([, e]) => rel in e).map(([n]) => n)
    if (dove.length === 0) problemi.push(`${rel}: controller in nessun elenco (modulo da decidere)`)
    if (dove.length > 1) problemi.push(`${rel}: in piu elenchi (${dove.join(', ')})`)
  }

  for (const [nome, elenco] of elenchi) {
    for (const [rel, voce] of Object.entries(elenco)) {
      if (!(rel in dichiarati))
        problemi.push(`${nome}: voce orfana ${rel} (file assente o senza controller)`)
      const motivo = typeof voce === 'string' ? voce : (voce as VoceModulo).motivo
      if (motivo.trim().length <= 10) problemi.push(`${nome}: ${rel} senza motivo`)
    }
  }

  for (const [rel, voce] of Object.entries(mappa)) {
    const testo = dichiarati[rel]
    if (testo === undefined) continue
    for (const k of [...(voce.chiavi ?? []), ...Object.values(voce.metodi ?? {}).flat()]) {
      if (k !== 'senza-modulo' && !(FEATURE_KEYS as readonly string[]).includes(k)) {
        problemi.push(`${rel}: chiave sconosciuta ${k}`)
      }
    }
    const inClasse = chiaviDiClasse(testo)
    if (voce.chiavi) {
      if (inClasse.length !== 1) {
        problemi.push(`${rel}: serve un solo @RichiedeModulo di classe, trovati ${inClasse.length}`)
      } else if (!stessoInsieme(inClasse[0], voce.chiavi)) {
        problemi.push(
          `${rel}: chiavi di classe [${inClasse[0].join(', ')}], attese [${voce.chiavi.join(', ')}]`
        )
      }
    } else {
      if (!voce.metodi || Object.keys(voce.metodi).length === 0) {
        problemi.push(`${rel}: ne chiavi di classe ne metodi`)
      }
      if (inClasse.length > 0) problemi.push(`${rel}: voce per-metodo con decoratore di classe`)
    }
    if (/^@SenzaModulo\(/m.test(senzaCommenti(testo))) {
      problemi.push(`${rel}: @SenzaModulo di classe su un controller di modulo`)
    }
  }

  for (const rel of [...Object.keys(base), ...Object.keys(nonMontati)]) {
    const testo = dichiarati[rel]
    if (testo !== undefined && /\bRichiedeModulo\s*\(/.test(senzaCommenti(testo))) {
      problemi.push(`${rel}: area base con @RichiedeModulo`)
    }
  }
  return problemi.sort()
}

// ---------------------------------------------------------------------------------------------
// Livello runtime
// ---------------------------------------------------------------------------------------------

interface Istanza {
  metatype: Type<unknown>
}

type Effettivo = { tipo: 'chiavi'; chiavi: readonly string[] } | { tipo: 'senza' } | null

/** Stessa precedenza dell'interceptor: metodo, poi classe; a pari livello conta `@RichiedeModulo`. */
function effettivo(reflector: Reflector, classe: Type<unknown>, fn: () => unknown): Effettivo {
  for (const bersaglio of [fn, classe]) {
    const chiavi = reflector.get<string[] | undefined>(RICHIEDE_MODULO, bersaglio)
    if (chiavi && chiavi.length > 0) return { tipo: 'chiavi', chiavi }
    if (reflector.get<string | undefined>(SENZA_MODULO, bersaglio) !== undefined) {
      return { tipo: 'senza' }
    }
  }
  return null
}

/**
 * Rotte dichiarate dalla classe stessa: quelle ereditate da una classe base NON sono viste
 * (oggi nessun controller eredita rotte; `nessunControllerEreditaRotte` lo impone).
 */
function rotte(classe: Type<unknown>): { nome: string; fn: () => unknown; get: boolean }[] {
  const proto = classe.prototype as Record<string, unknown>
  return Object.getOwnPropertyNames(proto)
    .filter(nome => nome !== 'constructor')
    .map(nome => ({ nome, fn: proto[nome] }))
    .filter(
      (r): r is { nome: string; fn: () => unknown } =>
        typeof r.fn === 'function' &&
        Reflect.hasMetadata(PATH_METADATA, r.fn) &&
        Reflect.hasMetadata(METHOD_METADATA, r.fn)
    )
    .map(r => ({
      ...r,
      get: Reflect.getMetadata(METHOD_METADATA, r.fn) === RequestMethod.GET,
    }))
}

function haJwtGuard(classe: Type<unknown>, fn: () => unknown): boolean {
  const guards = [
    ...((Reflect.getMetadata(GUARDS_METADATA, classe) as unknown[]) ?? []),
    ...((Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? []),
  ]
  // Le due classi reali (auth/guards e core/auth): una classe omonima altrove non vale.
  return guards.some(g => g === JwtAuthGuard || g === JwtAuthGuardCore)
}

/** Problemi dei controller montati (metatype) rispetto agli elenchi. `fileDiClasse`: nome -> file. */
export function problemiRuntime(
  montati: Type<unknown>[],
  reflector: Reflector,
  fileDiClasse: Record<string, string>,
  mappa: Record<string, VoceModulo>,
  base: Record<string, string>,
  nonMontati: Record<string, string>
): string[] {
  const problemi: string[] = []
  const nomiMontati = new Set(montati.map(c => c.name))

  for (const [rel] of Object.entries(nonMontati)) {
    const nome = Object.entries(fileDiClasse).find(([, f]) => f === rel)?.[0]
    if (nome && nomiMontati.has(nome)) problemi.push(`${rel}: dichiarato non montato ma montato`)
  }

  for (const classe of montati) {
    const rel = fileDiClasse[classe.name]
    if (!rel) {
      problemi.push(`${classe.name}: classe montata senza file noto`)
      continue
    }
    const eDiModulo = rel in mappa
    const eBase = rel in base
    if (!eDiModulo && !eBase) {
      problemi.push(`${rel}: montato ma in nessun elenco`)
      continue
    }
    const voce = mappa[rel]
    const elencoRotte = rotte(classe)
    const bersagli: [string, () => unknown | Type<unknown>][] = [
      [classe.name, classe as unknown as () => unknown],
      ...elencoRotte.map(r => [`${classe.name}.${r.nome}`, r.fn] as [string, () => unknown]),
    ]

    for (const [nome, b] of bersagli) {
      const richiede = reflector.get(RICHIEDE_MODULO, b)
      const senza = reflector.get(SENZA_MODULO, b)
      if (richiede !== undefined && senza !== undefined) {
        problemi.push(`${rel}: ${nome} ha sia @RichiedeModulo sia @SenzaModulo`)
      }
      if (eBase && richiede !== undefined)
        problemi.push(`${rel}: ${nome} area base con @RichiedeModulo`)
    }
    if (eBase) continue

    const nomiRotte = elencoRotte.map(r => r.nome)
    for (const m of Object.keys(voce.metodi ?? {})) {
      if (!nomiRotte.includes(m)) problemi.push(`${rel}: metodo ${m} dell'elenco non esiste`)
    }
    for (const r of elencoRotte) {
      const atteso = voce.metodi?.[r.nome] ?? voce.chiavi
      const eff = effettivo(reflector, classe, r.fn)
      if (atteso === undefined) {
        problemi.push(`${rel}: ${r.nome} senza modulo atteso`)
        continue
      }
      if (atteso === 'senza-modulo') {
        if (eff?.tipo !== 'senza') problemi.push(`${rel}: ${r.nome} dovrebbe essere @SenzaModulo`)
        continue
      }
      if (eff?.tipo !== 'chiavi') {
        problemi.push(`${rel}: ${r.nome} senza @RichiedeModulo (atteso [${atteso.join(', ')}])`)
      } else if (!stessoInsieme(eff.chiavi, atteso)) {
        problemi.push(
          `${rel}: ${r.nome} richiede [${eff.chiavi.join(', ')}], atteso [${atteso.join(', ')}]`
        )
      }
      // Una rotta di modulo non e' mai pubblica: l'interceptor risponde 401 senza utente.
      if (!haJwtGuard(classe, r.fn)) problemi.push(`${rel}: ${r.nome} senza JwtAuthGuard`)
      // Un metodo allarga le chiavi della classe, non le restringe.
      if (
        voce.chiavi &&
        eff?.tipo === 'chiavi' &&
        !voce.chiavi.every(k => eff.chiavi.includes(k))
      ) {
        problemi.push(`${rel}: ${r.nome} restringe le chiavi di classe`)
      }
    }
  }
  return problemi.sort()
}

function controllerRaggiungibili(radice: unknown): Type<unknown>[] {
  const visti = new Set<unknown>()
  const out: Type<unknown>[] = []
  const coda: unknown[] = [radice]
  while (coda.length > 0) {
    let corrente = coda.shift() as { module?: unknown } | undefined
    if (corrente && typeof corrente === 'object' && 'module' in corrente) {
      corrente = corrente.module as { module?: unknown }
    }
    if (!corrente || visti.has(corrente)) continue
    visti.add(corrente)
    out.push(
      ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, corrente) as Type<unknown>[]) ?? [])
    )
    coda.push(...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, corrente) as unknown[]) ?? []))
  }
  return out
}

function fileDiClasse(file: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rel, testo] of Object.entries(controllerDichiarati(file))) {
    const nome = nomeControllerDi(testo)
    if (nome) out[nome] = rel
  }
  return out
}

describe('moduli: ogni controller dichiara il suo modulo (statico)', () => {
  const reali = leggiControllerReali()

  it('ogni controller dichiarato sta in un solo elenco, senza voci orfane ne chiavi sbagliate', () => {
    expect(problemiStatici(reali, MAPPA_MODULI, BASE, NON_MONTATI)).toEqual([])
  })

  it('un controller nuovo non elencato fa fallire la guardia', () => {
    const finto = { 'api/nuovo/nuovo.controller.ts': "@Controller('nuovo')\nexport class N {}" }
    expect(problemiStatici({ ...reali, ...finto }, MAPPA_MODULI, BASE, NON_MONTATI)).toEqual([
      'api/nuovo/nuovo.controller.ts: controller in nessun elenco (modulo da decidere)',
    ])
  })

  it('una voce orfana (file assente) fa fallire la guardia', () => {
    const problemi = problemiStatici(
      reali,
      {
        ...MAPPA_MODULI,
        'api/sparito/sparito.controller.ts': { chiavi: ['fir'], motivo: 'file cancellato' },
      },
      { ...BASE, 'api/base-sparita.controller.ts': 'file cancellato anche questo' },
      NON_MONTATI
    )
    expect(problemi).toEqual([
      'BASE: voce orfana api/base-sparita.controller.ts (file assente o senza controller)',
      'MAPPA_MODULI: voce orfana api/sparito/sparito.controller.ts (file assente o senza controller)',
    ])
  })

  it('la guardia stessa: chiavi diverse, decoratore mancante, base decorata, due elenchi', () => {
    const file = {
      'a.controller.ts': "@RichiedeModulo('cer')\n@Controller('a')\nexport class A {}",
      'b.controller.ts': "@Controller('b')\nexport class B {}",
      'c.controller.ts': "@RichiedeModulo('fir')\n@Controller('c')\nexport class C {}",
      'd.controller.ts': "// @Controller('d') solo un commento\nexport class D {}",
    }
    const mappa: Record<string, VoceModulo> = {
      'a.controller.ts': { chiavi: ['fir'], motivo: 'chiavi diverse da quelle scritte' },
      'b.controller.ts': { chiavi: ['fir'], motivo: 'decoratore di classe mancante' },
      'c.controller.ts': { chiavi: ['fir'], motivo: 'in mappa e anche in base' },
    }
    expect(
      problemiStatici(file, mappa, { 'c.controller.ts': 'in mappa e anche in base' }, {})
    ).toEqual([
      'a.controller.ts: chiavi di classe [cer], attese [fir]',
      'b.controller.ts: serve un solo @RichiedeModulo di classe, trovati 0',
      'c.controller.ts: area base con @RichiedeModulo',
      'c.controller.ts: in piu elenchi (MAPPA_MODULI, BASE)',
    ])
  })

  it('i file che citano il decoratore solo in un commento non sono controller', () => {
    expect(Object.keys(controllerDichiarati(reali))).not.toContain('fir/fir.module.ts')
    expect(Object.keys(controllerDichiarati(reali))).toContain(
      'api/fatturazione/scostamenti.controller.ts'
    )
  })
})

describe('moduli: i controller montati nell app (DiscoveryService + Reflector)', () => {
  const reali = leggiControllerReali()
  const classi = fileDiClasse(reali)
  let reflector: Reflector
  let montati: Type<unknown>[]

  beforeAll(async () => {
    // I controller reali raggiungibili da AppModule; le loro dipendenze sono finte perche'
    // compilare AppModule richiede database, Redis e Keycloak.
    const dalModulo = controllerRaggiungibili(AppModule)
    const modulo = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: dalModulo,
    })
      .useMocker(
        () => new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : () => undefined) })
      )
      .compile()
    reflector = modulo.get(Reflector)
    montati = modulo
      .get(DiscoveryService)
      .getControllers()
      .map(w => (w as unknown as Istanza).metatype)
    await modulo.close().catch(() => undefined)
  }, 60000)

  it("l'app monta molti controller (la scoperta funziona)", () => {
    expect(montati.length).toBeGreaterThan(60)
  })

  it('ogni rotta montata ha il modulo atteso, JwtAuthGuard e nessun conflitto di decoratori', () => {
    expect(problemiRuntime(montati, reflector, classi, MAPPA_MODULI, BASE, NON_MONTATI)).toEqual([])
  })

  it('nessun controller montato eredita rotte da una classe base (rotte() non le vedrebbe)', () => {
    const ereditano = montati.filter(c => {
      const base = Object.getPrototypeOf(c.prototype) as object
      return (
        base !== Object.prototype && Object.getOwnPropertyNames(base).some(n => n !== 'constructor')
      )
    })
    expect(ereditano.map(c => c.name)).toEqual([])
  })

  it('CERController ha JwtAuthGuard: il catalogo non e piu leggibile senza login', () => {
    const cer = montati.find(c => c.name === 'CERController')!
    expect(cer).toBeDefined()
    expect(haJwtGuard(cer, () => undefined)).toBe(true)
  })

  describe('la guardia stessa (controller finti)', () => {
    @Controller('x')
    @UseGuards(JwtAuthGuard)
    @RichiedeModulo('fir')
    class Giusto {
      @Get() uno() {}
    }
    @Controller('x')
    class SenzaDecoratore {
      @Get() uno() {}
    }
    @Controller('x')
    @RichiedeModulo('fir')
    class SenzaGuard {
      @Get() uno() {}
    }
    @Controller('x')
    @UseGuards(JwtAuthGuard)
    @RichiedeModulo('fir')
    class Conflitto {
      @Get()
      @RichiedeModulo('fir')
      @SenzaModulo('prova di conflitto')
      uno() {}
    }
    @Controller('x')
    @UseGuards(JwtAuthGuard)
    @RichiedeModulo('fir')
    class Restringe {
      @Get()
      @RichiedeModulo('cer')
      uno() {}
    }
    @Controller('x')
    @UseGuards(JwtAuthGuard)
    @RichiedeModulo('fir')
    class BaseDecorata {
      @Get() uno() {}
    }

    const file = Object.fromEntries(
      [Giusto, SenzaDecoratore, SenzaGuard, Conflitto, Restringe, BaseDecorata].map(c => [
        c.name,
        `${c.name}.ts`,
      ])
    )
    const voce = (chiavi: FeatureKey[]): VoceModulo => ({ chiavi, motivo: 'controller di prova' })
    const mappa: Record<string, VoceModulo> = {
      'Giusto.ts': voce(['fir']),
      'SenzaDecoratore.ts': voce(['fir']),
      'SenzaGuard.ts': voce(['fir']),
      'Conflitto.ts': voce(['fir']),
      'Restringe.ts': voce(['fir']),
    }
    const r = new Reflector()

    it('accetta un controller corretto', () => {
      expect(problemiRuntime([Giusto], r, file, mappa, {}, {})).toEqual([])
    })
    it('segnala il decoratore mancante', () => {
      expect(problemiRuntime([SenzaDecoratore], r, file, mappa, {}, {})).toEqual([
        'SenzaDecoratore.ts: uno senza @RichiedeModulo (atteso [fir])',
        'SenzaDecoratore.ts: uno senza JwtAuthGuard',
      ])
    })
    it('segnala il JwtAuthGuard mancante', () => {
      expect(problemiRuntime([SenzaGuard], r, file, mappa, {}, {})).toEqual([
        'SenzaGuard.ts: uno senza JwtAuthGuard',
      ])
    })
    it('segnala i due decoratori sullo stesso metodo', () => {
      expect(problemiRuntime([Conflitto], r, file, mappa, {}, {})).toContain(
        'Conflitto.ts: Conflitto.uno ha sia @RichiedeModulo sia @SenzaModulo'
      )
    })
    it('segnala un metodo che restringe le chiavi di classe', () => {
      expect(problemiRuntime([Restringe], r, file, mappa, {}, {})).toContain(
        'Restringe.ts: uno restringe le chiavi di classe'
      )
    })
    it('segnala un controller di base con @RichiedeModulo e uno non elencato', () => {
      expect(
        problemiRuntime(
          [BaseDecorata],
          r,
          file,
          {},
          { 'BaseDecorata.ts': 'area base di prova' },
          {}
        )
      ).toEqual(['BaseDecorata.ts: BaseDecorata area base con @RichiedeModulo'])
      expect(problemiRuntime([Giusto], r, file, {}, {}, {})).toEqual([
        'Giusto.ts: montato ma in nessun elenco',
      ])
    })
    it('segnala un metodo elencato che non esiste e una rotta non coperta', () => {
      const m: Record<string, VoceModulo> = {
        'Giusto.ts': { motivo: 'solo per metodo', metodi: { fantasma: ['fir'] } },
      }
      expect(problemiRuntime([Giusto], r, file, m, {}, {})).toEqual([
        "Giusto.ts: metodo fantasma dell'elenco non esiste",
        'Giusto.ts: uno senza modulo atteso',
      ])
    })
    it('segnala un controller non montato che invece e montato', () => {
      expect(
        problemiRuntime([Giusto], r, file, mappa, {}, { 'Giusto.ts': 'dovrebbe essere morto' })
      ).toContain('Giusto.ts: dichiarato non montato ma montato')
    })
  })
})

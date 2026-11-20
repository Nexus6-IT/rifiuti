/**
 * Test d'architettura (Fase 3, D4/Q5): ogni file sotto `src/` che chiama un metodo di SCRITTURA
 * verso RENTRI su un FIR (POST/PUT/DELETE del client `RENTRIApiClient`) deve chiamare anche
 * `verificaFirNonBloccato`. Un nuovo punto di scrittura senza la guardia fa fallire il test: e' la
 * rete che tiene i FIR importati fuori da RENTRI finche' non sono riconciliati (3.6).
 *
 * Lettura del sorgente, come `punti-di-sistema.spec.ts`. Nota: `acquisisci-formulario-rentri` e'
 * nell'elenco perche' guarda il FIR bersaglio dell'aggancio (scelta COLLEGA_ESISTENTE); il ramo
 * NUOVO crea un FIR che nasce legato e non e' un import (Q5), quindi non ha nulla da bloccare.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const SRC = join(__dirname, '..', '..')

/** Metodi del client che scrivono su RENTRI per un FIR (censimento del Task 0). */
const SCRITTURE = [
  'creaFormulario',
  'inviaAccettazione',
  'annullaFormulario',
  'inviaNoteAnnullamento',
  'richiediHashPerFirma',
  'autorizzaFirmaRemota',
  'firmaHashRemoto',
  'inviaAcquisizioneFirma',
  // FIR in viaggio P1: annullamento dell'ultima firma e reset dei dati non firmati.
  'rollbackFirma',
  'resetStato',
  // FIR in viaggio P2: quantita' e dati di trasporto.
  'inviaQuantita',
  'inviaTrasporto',
  // FIR in viaggio P4: annotazione.
  'inviaAnnotazione',
  // FIR in viaggio P5: sosta tecnica.
  'inviaSostaTecnica',
  'caricaAllegato',
  'eliminaAllegato',
  'rilasciaVisibilita',
  'acquisisciVisibilita',
  // RentriTrasmissioniClient (trasmissione dati FIR, obbligo dal 15/09/2026): oggi senza chiamanti.
  'inviaTrasmissione',
  'annullaTrasmissione',
  'estraiDatiXfir',
  // RentriCopieClient (copie digitali/cartacee del FIR): oggi senza chiamanti.
  'caricaCopiaDigitale',
  'caricaCopiaCartacea',
  'confermaCopiaDigitale',
  'confermaCopiaCartacea',
  'eliminaCopiaDigitaleCaricata',
  'eliminaCopiaCartaceaCaricata',
  // RentriXfirClient: carica l'xFIR di un formulario (POST /formulari/{numeroFir}/xfir). Non censito:
  // `validaXfir` e `RentriRegistriClient.validaRegistro` (validazioni senza stato, non scrivono sull'ente).
  'caricaXfir',
]
// Indipendente dal nome del ricevitore (`this.trasmissioniClient.`, `copie.`, `a?.b.`, ...).
// Non censiti di proposito: `RentriVidimazioneClient.vidimaFir/annullaFir` (operano su blocchi di
// numeri vidimati, non su un FIR dell'archivio: un importato non ci passa) e
// `RentriRegistriClient.inviaMovimenti` (movimenti, guardati da `trasmetti-lotto-registro`).
// Unica eccezione: un ricevitore che finisce in `UseCase` e' un'altra facciata applicativa (es.
// `gestisciAllegatiFIRUseCase.caricaAllegato` nel controller), che a sua volta e' un chiamante censito.
// Il lookbehind esclude solo un ricevitore che finisce in `UseCase` (con `?` opzionale): qualunque
// altro ricevitore (identificatore, `)`, `]`, factory per tenant) e' una chiamata; `<T>` generico ammesso.
const CHIAMATA = new RegExp(
  `(?<!UseCase\\s*\\??)\\s*\\.\\s*(${SCRITTURE.join('|')})\\s*(?:<[^>]*>)?\\s*\\(`,
  'g'
)

function metodiScrittura(testo: string): string[] {
  return [...testo.matchAll(CHIAMATA)].map(m => m[1])
}

/** File che DEVONO risultare guardati (se uno sparisce dal censimento il test lo dice). */
const ATTESI = [
  'application/rentri/accetta-o-respingi-fir.use-case.ts',
  'application/rentri/acquisisci-formulario-rentri.use-case.ts',
  'application/rentri/annotazione-rentri.use-case.ts',
  'application/rentri/annulla-fir-rentri.use-case.ts',
  'application/rentri/completa-operazione-con-firma.use-case.ts',
  'application/rentri/gestisci-allegati-fir.use-case.ts',
  'application/rentri/invia-dati-viaggio-fir-rentri.use-case.ts',
  'application/rentri/rilascia-formulario-rentri.use-case.ts',
  'application/rentri/rollback-e-reset-fir-rentri.use-case.ts',
  'application/rentri/sosta-tecnica-rentri.use-case.ts',
  'application/rentri/sync-fir-to-rentri.use-case.ts',
]

function sorgenti(dir: string, uscita: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) sorgenti(p, uscita)
    else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts')) uscita.push(p)
  }
  return uscita
}

describe('Fase 3: ogni scrittura verso RENTRI su un FIR passa da verificaFirNonBloccato', () => {
  const trovati = new Map<string, string[]>()
  for (const file of sorgenti(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/')
    // Il client stesso definisce i metodi: non e' un chiamante.
    if (rel.startsWith('infrastructure/rentri/')) continue
    const testo = readFileSync(file, 'utf8')
    const metodi = metodiScrittura(testo)
    if (metodi.length > 0) trovati.set(rel, metodi)
  }

  it('la regex riconosce qualunque ricevitore, anche su piu righe', () => {
    const casi = [
      'await this.trasmissioniClient.inviaTrasmissione(x)',
      'this.copie\n  .caricaCopiaCartacea (y)',
      'a?.b.estraiDatiXfir(z)',
      'this.factory.per(t).inviaTrasmissione(x)',
      '(await this.c()).inviaTrasmissione(x)',
      'this.clients[0].inviaTrasmissione(x)',
      'this.c.inviaTrasmissione<T>(x)',
      'this.xfir.caricaXfir(n, x, t)',
    ]
    for (const c of casi) expect(metodiScrittura(c)).toHaveLength(1)
    expect(metodiScrittura('this.gestisciAllegatiFIRUseCase.caricaAllegato(x)')).toHaveLength(0)
    expect(metodiScrittura('this.gestisciAllegatiFIRUseCase?.caricaAllegato(x)')).toHaveLength(0)
  })

  it("il censimento trova i chiamanti attesi (il test non puo' passare a vuoto)", () => {
    expect([...trovati.keys()].sort()).toEqual([...ATTESI].sort())
  })

  it.each([...trovati.keys()].sort())('%s chiama verificaFirNonBloccato', rel => {
    const testo = readFileSync(join(SRC, rel), 'utf8')
    expect(testo).toMatch(/\bverificaFirNonBloccato\s*\(/)
    expect(testo).toContain("domain/fir/guardia-invio-rentri'")
  })
})

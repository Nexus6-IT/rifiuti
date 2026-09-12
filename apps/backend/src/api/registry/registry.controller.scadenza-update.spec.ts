/**
 * RegistryController — mapScadenzaUpdate (Task 3 scadenzario, giro di correzione 1)
 *
 * File separato da `registry.controller.spec.ts` di proposito: quel file è
 * al momento in lavorazione IN PARALLELO da un altro agente (Task 4,
 * "stato di scadenza nell'elenco") sullo stesso albero condiviso — unire i
 * due qui avrebbe fatto sì che chi committa per secondo si porti dentro il
 * lavoro a metà dell'altro. Stesso `RegistryController`, stessa suite
 * logica, file distinto.
 *
 * Copertura mirata al rilievo Importante del giro di correzione 1:
 * `mapScadenzaUpdate` traduce il valore in arrivo dal DTO di update (assente
 * / `null` / stringa ISO) nel valore da passare al comando (`undefined` /
 * `null` / `Date`). Questa distinzione è quella che decide se una scadenza
 * viene lasciata invariata o azzerata esplicitamente — un'inversione qui non
 * produce un errore visibile, produce un avviso di scadenza che smette di
 * partire in silenzio. Da sola, la copertura di dominio
 * (`trasportatore.spec.ts`/`destinatario.spec.ts`) non la intercetta perché
 * non arriva mai a chiamare questo mapper.
 *
 * Il costruttore di RegistryController prende 15 use case: non servono per
 * testare questo helper privato e puro, quindi si istanzia bypassando il
 * controllo dei parametri (pattern minimale per testare un metodo privato
 * senza montare l'intero grafo di dipendenze).
 *
 * Verificato manualmente (giro di correzione 1) che entrambi i test
 * "undefined"/"null" falliscono se si inverte la logica di
 * `mapScadenzaUpdate` — non solo che passano con l'implementazione attuale.
 */
import { RegistryController } from './registry.controller'

function creaController(): RegistryController {
  return new (RegistryController as any)()
}

describe('RegistryController — mapScadenzaUpdate', () => {
  let controller: RegistryController

  beforeEach(() => {
    controller = creaController()
  })

  it('campo assente nella richiesta (undefined) → undefined: la scadenza esistente non viene toccata', () => {
    const risultato = (controller as any).mapScadenzaUpdate(undefined)

    expect(risultato).toBeUndefined()
  })

  it('campo esplicitamente nullo (null) → null: azzera davvero la scadenza esistente', () => {
    const risultato = (controller as any).mapScadenzaUpdate(null)

    expect(risultato).toBeNull()
  })

  it('stringa ISO → Date corrispondente: imposta una nuova scadenza', () => {
    const risultato = (controller as any).mapScadenzaUpdate('2027-01-15')

    expect(risultato).toBeInstanceOf(Date)
    expect((risultato as Date).toISOString().slice(0, 10)).toBe('2027-01-15')
  })
})

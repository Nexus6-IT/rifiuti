// Package driver definisce il contratto fra gli strumenti di pesa e il nucleo dell'agente.
package driver

import (
	"context"
	"encoding/json"
	"time"

	"wasteflow/agente-pesa/internal/driver/trasporto"
	"wasteflow/agente-pesa/internal/orologio"
)

// MaxFrame e' la lunghezza massima del frame originale conservato in una lettura.
const MaxFrame = 256

// StatoCampione e' lo stato dichiarato dal driver per ogni campione letto.
type StatoCampione int

const (
	Stabile StatoCampione = iota
	Instabile
	Sottocarico
	Sovraccarico
	Errore
)

// Campione e' una lettura dello strumento. Solo Stabile e Definitivo diventa una lettura firmata.
type Campione struct {
	Centesimi    int64         // peso in centesimi di kg, mai float
	Stato        StatoCampione //
	AlibiID      string        // vuoto se lo strumento non lo fornisce
	OraStrumento *time.Time    // nil se lo strumento non la fornisce
	Grezzo       []byte        // frame originale, al massimo 256 byte
	Definitivo   bool          // true = pesata da registrare (MP, tasto stampa, ...)
}

// DaRegistrare e' il filtro del nucleo: solo un campione definitivo e stabile diventa una lettura.
func DaRegistrare(c Campione) bool { return c.Definitivo && c.Stato == Stabile }

// Parametri e' quanto una fabbrica riceve per costruire un driver.
type Parametri struct {
	Dati         json.RawMessage   // "parametri" dello strumento nel file di configurazione
	CartellaDati string            // cartella dei dati dell'agente (stato persistente del driver)
	Orologio     orologio.Orologio // nil = orologio di sistema
}

// Driver legge uno strumento e produce campioni.
type Driver interface {
	Nome() string   // "SIMULATA", "D800-MP", ...
	Simulato() bool // true solo per il driver SIMULATA
	// Esegui produce campioni su out finche' ctx e' aperto; ritorna nil a ctx chiuso, errore se fatale.
	Esegui(ctx context.Context, out chan<- Campione) error
}

// Fabbrica costruisce un driver; t apre il trasporto (nil per i driver che non ne hanno bisogno).
type Fabbrica func(p Parametri, t trasporto.Apri) (Driver, error)

// Protocollo descrive un driver a domanda/risposta: la richiesta da inviare e la lettura di un frame.
type Protocollo interface {
	Richiesta() []byte
	Valida(frame []byte) (Campione, error)
}

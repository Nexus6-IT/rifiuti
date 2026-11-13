// Package driver definisce il contratto fra gli strumenti di pesa e il nucleo dell'agente.
// Qui c'e' solo il tipo Campione (serve a lettura.Nuova); interfacce Driver, registro e
// trasporti arrivano nel task G3.
package driver

import "time"

// StatoCampione e' lo stato dichiarato dal driver per ogni campione letto.
type StatoCampione int

const (
	Stabile StatoCampione = iota
	Instabile
	Sottocarico
	Sovraccarico
	Errore
)

// Campione e' una lettura dello strumento. Solo Stabile diventa una lettura firmata.
type Campione struct {
	Centesimi    int64         // peso in centesimi di kg, mai float
	Stato        StatoCampione //
	AlibiID      string        // vuoto se lo strumento non lo fornisce
	OraStrumento *time.Time    // nil se lo strumento non la fornisce
	Grezzo       []byte        // frame originale, al massimo 256 byte
	Definitivo   bool          // true = pesata da registrare (MP, tasto stampa, ...)
}

//go:build !windows

// Package servizio integra l'agente con il gestore dei servizi di Windows; fuori da Windows
// c'e' solo uno stub (esecuzione in primo piano) per i test e lo sviluppo.
package servizio

import (
	"context"
	"errors"
)

// NomeServizio e' il nome del servizio Windows (e dell'account virtuale NT SERVICE\<nome>).
const NomeServizio = "WasteFlowAgentePesa"

// Esegui esegue f in primo piano.
func Esegui(ctx context.Context, f func(ctx context.Context) error) error { return f(ctx) }

// Gestisci (installa, rimuovi, avvia, ferma) esiste solo su Windows.
func Gestisci(azione, exe, dati string) error {
	return errors.New("la gestione del servizio e' disponibile solo su Windows")
}

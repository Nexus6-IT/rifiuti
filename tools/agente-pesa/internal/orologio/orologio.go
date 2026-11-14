// Package orologio astrae l'ora e l'attesa, cosi' i test non aspettano davvero.
package orologio

import (
	"context"
	"runtime"
	"sync"
	"time"
)

// Orologio fornisce l'ora corrente e una attesa interrompibile dal contesto.
type Orologio interface {
	Adesso() time.Time
	// Dormi attende d; ritorna l'errore del contesto se viene chiuso prima.
	Dormi(ctx context.Context, d time.Duration) error
}

type reale struct{}

// Reale e' l'orologio di sistema.
var Reale Orologio = reale{}

func (reale) Adesso() time.Time { return time.Now() }

func (reale) Dormi(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Finto avanza solo quando qualcuno dorme: Dormi ritorna subito e sposta l'ora in avanti.
type Finto struct {
	mu      sync.Mutex
	ora     time.Time
	dormite []time.Duration
}

// NuovoFinto crea un orologio finto che parte da ora.
func NuovoFinto(ora time.Time) *Finto { return &Finto{ora: ora} }

func (f *Finto) Adesso() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.ora
}

// Avanza sposta l'ora in avanti senza registrare una attesa.
func (f *Finto) Avanza(d time.Duration) {
	f.mu.Lock()
	f.ora = f.ora.Add(d)
	f.mu.Unlock()
}

func (f *Finto) Dormi(ctx context.Context, d time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f.mu.Lock()
	f.dormite = append(f.dormite, d)
	f.ora = f.ora.Add(d)
	f.mu.Unlock()
	runtime.Gosched()
	return nil
}

// Dormite restituisce le attese richieste finora, in ordine.
func (f *Finto) Dormite() []time.Duration {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]time.Duration(nil), f.dormite...)
}

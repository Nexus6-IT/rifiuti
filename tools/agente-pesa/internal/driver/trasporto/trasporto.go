// Package trasporto fornisce i canali (TCP, seriale) su cui parlano i driver degli strumenti.
package trasporto

import (
	"context"
	"errors"
	"io"
	"time"

	"wasteflow/agente-pesa/internal/orologio"
)

// Trasporto e' un canale bidirezionale con scadenza.
type Trasporto interface {
	io.ReadWriteCloser
	SetDeadline(time.Time) error
}

// Apri apre un trasporto: TCP con timeout di connessione; seriale non disponibile in 4.8b.
type Apri func(ctx context.Context) (Trasporto, error)

// ErrNonDisponibile: il trasporto non e' implementato in questa versione (seriale).
var ErrNonDisponibile = errors.New("trasporto non disponibile in questa versione")

// ErrTimeout: nessun dato entro la scadenza.
var ErrTimeout = errors.New("timeout in lettura")

// Persistente apre il trasporto e chiama fn; se la connessione fallisce o fn ritorna un errore,
// attende con backoff esponenziale (min, 2*min, ... max, azzerato a ogni connessione riuscita) e
// riapre. Ritorna nil a ctx chiuso, ErrNonDisponibile subito se il trasporto non esiste.
func Persistente(ctx context.Context, apri Apri, clock orologio.Orologio, min, max time.Duration, fn func(Trasporto) error) error {
	b := min
	for ctx.Err() == nil {
		t, err := apri(ctx)
		if err != nil {
			if errors.Is(err, ErrNonDisponibile) {
				return err
			}
			if clock.Dormi(ctx, b) != nil {
				return nil
			}
			if b *= 2; b > max {
				b = max
			}
			continue
		}
		b = min
		stop := context.AfterFunc(ctx, func() { t.Close() }) // sblocca letture e scritture in corso
		errFn := fn(t)
		stop()
		t.Close()
		if ctx.Err() != nil {
			return nil
		}
		_ = errFn // connessione persa o frame illeggibile: si riapre dopo il backoff
		if clock.Dormi(ctx, b) != nil {
			return nil
		}
	}
	return nil
}

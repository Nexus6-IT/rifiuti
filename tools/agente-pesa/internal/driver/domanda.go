package driver

import (
	"context"
	"errors"
	"time"

	"wasteflow/agente-pesa/internal/driver/trasporto"
	"wasteflow/agente-pesa/internal/orologio"
)

// DomandaRisposta e' lo scheletro di un driver a domanda/risposta: invia la richiesta del Protocollo
// ogni intervallo, legge un frame, lo fa interpretare al Protocollo. Un driver reale (es. D800)
// fornisce solo il Protocollo; connessione, riconnessione e frame sono gia' qui.
type DomandaRisposta struct {
	nome       string
	apri       trasporto.Apri
	proto      Protocollo
	delim      []byte
	intervallo time.Duration
	timeout    time.Duration
	clock      orologio.Orologio
}

// NuovaDomandaRisposta costruisce il driver; clock nil = orologio di sistema.
func NuovaDomandaRisposta(nome string, apri trasporto.Apri, p Protocollo, delim []byte, intervallo time.Duration, clock orologio.Orologio) *DomandaRisposta {
	if clock == nil {
		clock = orologio.Reale
	}
	return &DomandaRisposta{nome: nome, apri: apri, proto: p, delim: delim, intervallo: intervallo, timeout: 3 * time.Second, clock: clock}
}

func (d *DomandaRisposta) Nome() string   { return d.nome }
func (d *DomandaRisposta) Simulato() bool { return false }

func (d *DomandaRisposta) Esegui(ctx context.Context, out chan<- Campione) error {
	if d.apri == nil {
		return trasporto.ErrNonDisponibile
	}
	return trasporto.Persistente(ctx, d.apri, d.clock, time.Second, 30*time.Second, func(t trasporto.Trasporto) error {
		lf := trasporto.NuovoLettoreFrame(t, d.delim, MaxFrame, d.timeout)
		for ctx.Err() == nil {
			_ = t.SetDeadline(time.Now().Add(d.timeout))
			if _, err := t.Write(d.proto.Richiesta()); err != nil {
				return err
			}
			var c Campione
			frame, err := lf.Leggi()
			switch {
			case errors.Is(err, trasporto.ErrTimeout):
				c = Campione{Stato: Errore}
			case err != nil:
				return err
			default:
				if c, err = d.proto.Valida(frame); err != nil {
					c = Campione{Stato: Errore}
				}
				c.Grezzo = frame
			}
			select {
			case out <- c:
			case <-ctx.Done():
				return nil
			}
			if d.clock.Dormi(ctx, d.intervallo) != nil {
				return nil
			}
		}
		return nil
	})
}

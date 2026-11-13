package trasporto

import (
	"context"
	"fmt"
)

// Seriale e' l'interfaccia per le porte COM: in 4.8b nessun driver reale la usa, quindi apre
// sempre con ErrNonDisponibile. Un'implementazione vera sostituira' solo questa funzione.
func Seriale(porta string, baud int) Apri {
	return func(context.Context) (Trasporto, error) {
		return nil, fmt.Errorf("%w: porta seriale %s a %d baud", ErrNonDisponibile, porta, baud)
	}
}

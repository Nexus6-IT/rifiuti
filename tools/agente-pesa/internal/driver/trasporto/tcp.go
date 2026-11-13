package trasporto

import (
	"context"
	"net"
	"time"
)

// TCP apre una connessione verso indirizzo ("host:porta") con timeout di connessione.
func TCP(indirizzo string, timeout time.Duration) Apri {
	return func(ctx context.Context) (Trasporto, error) {
		d := net.Dialer{Timeout: timeout}
		c, err := d.DialContext(ctx, "tcp", indirizzo)
		if err != nil {
			return nil, err
		}
		return c, nil
	}
}

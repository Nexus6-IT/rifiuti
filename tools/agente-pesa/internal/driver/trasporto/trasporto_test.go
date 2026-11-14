package trasporto

import (
	"context"
	"errors"
	"io"
	"net"
	"testing"
	"time"

	"wasteflow/agente-pesa/internal/orologio"
)

func TestTCPLeggeDalServer(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err == nil {
			c.Write([]byte("ciao"))
			c.Close()
		}
	}()
	tr, err := TCP(ln.Addr().String(), time.Second)(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tr.Close()
	b, _ := io.ReadAll(tr)
	if string(b) != "ciao" {
		t.Fatalf("letto %q", b)
	}
}

func TestTCPPortaChiusaDaErrore(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	ind := ln.Addr().String()
	ln.Close()
	if _, err := TCP(ind, 200*time.Millisecond)(context.Background()); err == nil {
		t.Fatal("attesa un errore di connessione")
	}
}

func TestSerialeNonDisponibile(t *testing.T) {
	if _, err := Seriale("COM1", 9600)(context.Background()); !errors.Is(err, ErrNonDisponibile) {
		t.Fatalf("errore %v", err)
	}
}

type connFinta struct{ net.Conn }

func (connFinta) Close() error { return nil }

func TestPersistenteRiconnetteConBackoff(t *testing.T) {
	clock := orologio.NuovoFinto(time.Unix(0, 0))
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	tentativi, chiamate := 0, 0
	apri := func(context.Context) (Trasporto, error) {
		if tentativi++; tentativi <= 3 {
			return nil, errors.New("rifiutata")
		}
		return connFinta{a}, nil
	}
	err := Persistente(ctx, apri, clock, time.Second, 30*time.Second, func(Trasporto) error {
		if chiamate++; chiamate == 2 {
			stop()
			return nil
		}
		return errors.New("connessione persa")
	})
	if err != nil {
		t.Fatal(err)
	}
	// tre rifiuti: 1s, 2s, 4s; poi connessione, caduta: attesa di nuovo 1s (azzerata); seconda connessione.
	atteso := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, time.Second}
	got := clock.Dormite()
	if len(got) != len(atteso) {
		t.Fatalf("attese %v, attese %v", got, atteso)
	}
	for i := range atteso {
		if got[i] != atteso[i] {
			t.Fatalf("attese %v, attese %v", got, atteso)
		}
	}
}

func TestPersistenteSerialeSubitoErrore(t *testing.T) {
	err := Persistente(context.Background(), Seriale("COM1", 9600), orologio.Reale, time.Second, time.Second, func(Trasporto) error { return nil })
	if !errors.Is(err, ErrNonDisponibile) {
		t.Fatalf("errore %v", err)
	}
}

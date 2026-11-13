package driver_test

import (
	"bufio"
	"context"
	"errors"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"wasteflow/agente-pesa/internal/driver"
	"wasteflow/agente-pesa/internal/driver/trasporto"
	"wasteflow/agente-pesa/internal/orologio"
)

// protocolloEco e' il modello per un driver a domanda/risposta: chiede "P" e legge "ST,GS,  1234.50kg".
// Un driver reale (D800) cambia solo questi due metodi.
type protocolloEco struct{}

func (protocolloEco) Richiesta() []byte { return []byte("P\r\n") }
func (protocolloEco) Valida(frame []byte) (driver.Campione, error) {
	s := string(frame)
	if !strings.HasPrefix(s, "ST,GS,") || !strings.HasSuffix(s, "kg") {
		return driver.Campione{}, errors.New("frame sconosciuto")
	}
	v := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(s, "ST,GS,"), "kg"))
	i, d, _ := strings.Cut(v, ".")
	kg, err := strconv.ParseInt(i, 10, 64)
	if err != nil {
		return driver.Campione{}, err
	}
	dec, _ := strconv.ParseInt(d, 10, 64)
	return driver.Campione{Centesimi: kg*100 + dec, Stato: driver.Stabile, Definitivo: true}, nil
}

func TestDriverDomandaRispostaSuPipe(t *testing.T) {
	cliente, server := net.Pipe()
	defer server.Close()
	go func() { // lo "strumento"
		r := bufio.NewReader(server)
		for {
			if _, err := r.ReadString('\n'); err != nil {
				return
			}
			if _, err := server.Write([]byte("ST,GS,  1234.50kg\r\n")); err != nil {
				return
			}
		}
	}()
	apri := func(context.Context) (trasporto.Trasporto, error) { return cliente, nil }
	d := driver.NuovaDomandaRisposta("ECO", apri, protocolloEco{}, []byte("\r\n"), time.Millisecond, orologio.NuovoFinto(time.Unix(0, 0)))
	ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	out := make(chan driver.Campione)
	fine := make(chan error, 1)
	go func() { fine <- d.Esegui(ctx, out) }()
	for i := 0; i < 2; i++ {
		c := <-out
		if c.Centesimi != 123450 || !driver.DaRegistrare(c) || string(c.Grezzo) != "ST,GS,  1234.50kg" {
			t.Fatalf("campione %+v", c)
		}
	}
	stop()
	if err := <-fine; err != nil {
		t.Fatal(err)
	}
	if d.Nome() != "ECO" || d.Simulato() {
		t.Fatal("nome o simulato sbagliati")
	}
}

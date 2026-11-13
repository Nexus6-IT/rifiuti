package simulata

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"wasteflow/agente-pesa/internal/driver"
	"wasteflow/agente-pesa/internal/orologio"
)

func avvia(t *testing.T, dir string, dati string, quanti int) []driver.Campione {
	t.Helper()
	d, err := driver.Crea(Nome, driver.Parametri{
		Dati: json.RawMessage(dati), CartellaDati: dir, Orologio: orologio.NuovoFinto(time.Date(2026, 11, 13, 10, 0, 0, 0, time.UTC)),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !d.Simulato() || d.Nome() != "SIMULATA" {
		t.Fatal("deve essere simulato")
	}
	ctx, stop := context.WithCancel(context.Background())
	out := make(chan driver.Campione)
	fine := make(chan error, 1)
	go func() { fine <- d.Esegui(ctx, out) }()
	var got []driver.Campione
	for len(got) < quanti {
		got = append(got, <-out)
	}
	stop()
	if err := <-fine; err != nil {
		t.Fatal(err)
	}
	return got
}

func TestSequenzaInstabiliPoiStabile(t *testing.T) {
	got := avvia(t, t.TempDir(), `{"pesi":[24880,"12.5"],"intervalloS":10,"semeCasuale":7}`, 8)
	for i, c := range got {
		if i%4 < 3 {
			if c.Stato != driver.Instabile || c.Definitivo {
				t.Fatalf("campione %d: atteso instabile, %+v", i, c)
			}
			continue
		}
		if !driver.DaRegistrare(c) || c.OraStrumento == nil || len(c.Grezzo) == 0 {
			t.Fatalf("campione %d: atteso stabile definitivo, %+v", i, c)
		}
	}
	if got[3].Centesimi != 2488000 || got[7].Centesimi != 1250 {
		t.Fatalf("pesi %d e %d", got[3].Centesimi, got[7].Centesimi)
	}
	if got[3].AlibiID != "SIM-000001" || got[7].AlibiID != "SIM-000002" {
		t.Fatalf("alibi %q %q", got[3].AlibiID, got[7].AlibiID)
	}
}

func TestAlibiRipresoDopoRiavvio(t *testing.T) {
	dir := t.TempDir()
	avvia(t, dir, `{"pesi":[100],"semeCasuale":1}`, 8) // due stabili: SIM-000001 e 000002
	got := avvia(t, dir, `{"pesi":[100],"semeCasuale":1}`, 4)
	if got[3].AlibiID != "SIM-000003" {
		t.Fatalf("alibi dopo il riavvio: %q", got[3].AlibiID)
	}
}

func TestSovraccaricoSecondoProbabilita(t *testing.T) {
	sempre := avvia(t, t.TempDir(), `{"pesi":[100],"probabilitaSovraccarico":1}`, 10)
	if sempre[0].Stato != driver.Sovraccarico || driver.DaRegistrare(sempre[0]) {
		t.Fatalf("atteso sovraccarico scartabile: %+v", sempre[0])
	}
	mai := avvia(t, t.TempDir(), `{"pesi":[100],"probabilitaSovraccarico":0}`, 20)
	for _, c := range mai {
		if c.Stato == driver.Sovraccarico {
			t.Fatal("sovraccarico con probabilita' zero")
		}
	}
}

func TestParametriNonValidi(t *testing.T) {
	for nome, dati := range map[string]string{
		"senza pesi":    `{}`,
		"peso zero":     `{"pesi":[0]}`,
		"peso decimale": `{"pesi":["1.234"]}`,
		"chiave ignota": `{"pesi":[1],"pesi2":[2]}`,
		"probabilita":   `{"pesi":[1],"probabilitaSovraccarico":2}`,
	} {
		if _, err := driver.Crea(Nome, driver.Parametri{Dati: json.RawMessage(dati), CartellaDati: t.TempDir()}, nil); err == nil {
			t.Errorf("%s: attesa un errore", nome)
		}
	}
}

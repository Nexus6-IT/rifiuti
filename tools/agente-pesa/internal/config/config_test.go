package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "wasteflow/agente-pesa/internal/driver/simulata"
)

const id1 = "11111111-1111-4111-8111-111111111111"

func base() Config {
	return Config{
		Server: "https://wasteflow.example", Simulazione: true,
		Strumenti: []Strumento{{StrumentoID: id1, Driver: "SIMULATA"}},
		Log:       Log{Livello: "info", MaxMB: 10, File: 5},
	}
}

func TestValida(t *testing.T) {
	v := Vincoli{CartellaDati: "/dati", StrumentiServer: []string{id1}}
	if err := base().Valida(v); err != nil {
		t.Fatalf("configurazione valida rifiutata: %v", err)
	}
	casi := map[string]func(*Config, *Vincoli){
		"SIMULATA senza simulazione": func(c *Config, _ *Vincoli) { c.Simulazione = false },
		"percorso relativo":          func(_ *Config, v *Vincoli) { v.CartellaDati = "dati/agente" },
		"strumento non assegnato":    func(_ *Config, v *Vincoli) { v.StrumentiServer = []string{"22222222-2222-4222-8222-222222222222"} },
		"driver ignoto":              func(c *Config, _ *Vincoli) { c.Strumenti[0].Driver = "BOH" },
		"driver mancante":            func(c *Config, _ *Vincoli) { c.Strumenti[0].Driver = "" },
		"http non locale":            func(c *Config, _ *Vincoli) { c.Server = "http://wasteflow.example" },
		"strumento doppio":           func(c *Config, _ *Vincoli) { c.Strumenti = append(c.Strumenti, c.Strumenti[0]) },
		"tcp senza indirizzo":        func(c *Config, _ *Vincoli) { c.Strumenti[0].Trasporto = &Trasporto{Tipo: "tcp"} },
	}
	for nome, muta := range casi {
		c, vv := base(), v
		c.Strumenti = append([]Strumento(nil), c.Strumenti...)
		muta(&c, &vv)
		if err := c.Valida(vv); err == nil {
			t.Errorf("%s: attesa un errore", nome)
		}
	}
	c := base()
	c.Strumenti[0].Driver = "BOH"
	if err := c.Valida(v); err == nil || !strings.Contains(err.Error(), "SIMULATA") {
		t.Errorf("l'errore deve elencare i driver disponibili: %v", err)
	}
}

func TestServerLocaleInHttpAmmesso(t *testing.T) {
	for _, s := range []string{"http://127.0.0.1:3000", "http://localhost:3000", "https://x.it"} {
		if err := ValidaServer(s); err != nil {
			t.Errorf("%s: %v", s, err)
		}
	}
	for _, s := range []string{"http://10.0.0.5", "ftp://x", "x.it", ""} {
		if ValidaServer(s) == nil {
			t.Errorf("%q doveva essere rifiutato", s)
		}
	}
}

func TestSalvaECaricaERefuso(t *testing.T) {
	p := filepath.Join(t.TempDir(), NomeFile)
	if err := Salva(p, base()); err != nil {
		t.Fatal(err)
	}
	c, err := Carica(p)
	if err != nil || c.Server != "https://wasteflow.example" || len(c.Strumenti) != 1 {
		t.Fatalf("config %+v err %v", c, err)
	}
	os.WriteFile(p, []byte(`{"server":"https://x","simulazionee":true}`), 0o644)
	if _, err := Carica(p); err == nil {
		t.Fatal("un refuso nelle chiavi deve dare errore")
	}
}

package driver

import (
	"strings"
	"testing"

	"wasteflow/agente-pesa/internal/driver/trasporto"
)

func fabbricaVuota(Parametri, trasporto.Apri) (Driver, error) { return nil, nil }

func TestRegistroNomeDuplicatoPanic(t *testing.T) {
	Registra("PROVA-DUP", fabbricaVuota)
	defer func() {
		if recover() == nil {
			t.Fatal("attesa una panic per il nome duplicato")
		}
	}()
	Registra("PROVA-DUP", fabbricaVuota)
}

func TestCreaDriverIgnotoElencaIDisponibili(t *testing.T) {
	Registra("PROVA-ELENCO", fabbricaVuota)
	_, err := Crea("NON-ESISTE", Parametri{}, nil)
	if err == nil || !strings.Contains(err.Error(), "NON-ESISTE") || !strings.Contains(err.Error(), "PROVA-ELENCO") {
		t.Fatalf("errore poco leggibile: %v", err)
	}
	if !Esiste("PROVA-ELENCO") || Esiste("NON-ESISTE") {
		t.Fatal("Esiste sbagliato")
	}
}

func TestDaRegistrare(t *testing.T) {
	casi := []struct {
		c      Campione
		atteso bool
	}{
		{Campione{Stato: Stabile, Definitivo: true}, true},
		{Campione{Stato: Stabile, Definitivo: false}, false},
		{Campione{Stato: Instabile, Definitivo: true}, false},
		{Campione{Stato: Sottocarico, Definitivo: true}, false},
		{Campione{Stato: Sovraccarico, Definitivo: true}, false},
		{Campione{Stato: Errore, Definitivo: true}, false},
	}
	for i, k := range casi {
		if DaRegistrare(k.c) != k.atteso {
			t.Errorf("caso %d: atteso %v", i, k.atteso)
		}
	}
}

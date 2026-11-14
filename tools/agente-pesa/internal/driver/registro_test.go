package driver

import (
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"wasteflow/agente-pesa/internal/driver/trasporto"
)

func fabbricaVuota(Parametri, trasporto.Apri) (Driver, error) { return nil, nil }

// provaN rende unico il nome per ogni esecuzione: il registro e' globale e -count>1 rilancia i test.
var provaN atomic.Int32

func nomeUnico(base string) string { return fmt.Sprintf("%s-%d", base, provaN.Add(1)) }

func TestRegistroNomeDuplicatoPanic(t *testing.T) {
	dup := nomeUnico("PROVA-DUP")
	Registra(dup, fabbricaVuota)
	defer func() {
		if recover() == nil {
			t.Fatal("attesa una panic per il nome duplicato")
		}
	}()
	Registra(dup, fabbricaVuota)
}

func TestCreaDriverIgnotoElencaIDisponibili(t *testing.T) {
	elenco := nomeUnico("PROVA-ELENCO")
	Registra(elenco, fabbricaVuota)
	_, err := Crea("NON-ESISTE", Parametri{}, nil)
	if err == nil || !strings.Contains(err.Error(), "NON-ESISTE") || !strings.Contains(err.Error(), elenco) {
		t.Fatalf("errore poco leggibile: %v", err)
	}
	if !Esiste(elenco) || Esiste("NON-ESISTE") {
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

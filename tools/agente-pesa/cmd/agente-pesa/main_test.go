package main

import (
	"bytes"
	"fmt"
	"runtime"
	"strings"
	"testing"
)

func TestVersione(t *testing.T) {
	var out bytes.Buffer
	if codice := esegui([]string{"versione"}, &out, &out); codice != 0 {
		t.Fatalf("codice di uscita %d", codice)
	}
	atteso := fmt.Sprintf("agente-pesa %s (%s/%s)\n", versione, runtime.GOOS, runtime.GOARCH)
	if out.String() != atteso {
		t.Fatalf("uscita %q, attesa %q", out.String(), atteso)
	}
}

func TestComandoIgnoto(t *testing.T) {
	var out, errOut bytes.Buffer
	if codice := esegui([]string{"boh"}, &out, &errOut); codice != 2 {
		t.Fatalf("codice di uscita %d, atteso 2", codice)
	}
	if errOut.Len() == 0 {
		t.Fatal("nessun messaggio d'errore")
	}
}

func TestStatoSenzaAvvioEUsoAbbina(t *testing.T) {
	var out, errOut bytes.Buffer
	if codice := esegui([]string{"stato", "--dati", t.TempDir()}, &out, &errOut); codice != 1 || errOut.Len() == 0 {
		t.Fatalf("stato senza file: codice %d err %q", codice, errOut.String())
	}
	errOut.Reset()
	if codice := esegui([]string{"abbina", "--dati", t.TempDir()}, &out, &errOut); codice != 2 {
		t.Fatalf("abbina senza argomenti: codice %d", codice)
	}
	errOut.Reset()
	if codice := esegui([]string{"abbina", "--dati", t.TempDir(), "--server", "http://esempio.it", "--codice", "X"}, &out, &errOut); codice != 1 {
		t.Fatalf("abbina con http non locale: codice %d err %q", codice, errOut.String())
	}
}

func TestEseguiSenzaAbbinamentoDaErrore(t *testing.T) {
	var out, errOut bytes.Buffer
	if codice := esegui([]string{"esegui", "--dati", t.TempDir()}, &out, &errOut); codice != 1 {
		t.Fatalf("codice %d", codice)
	}
}

func TestCodiceDaStdinEDaAmbiente(t *testing.T) {
	var out, errOut bytes.Buffer
	// il server http non locale fa fallire l'abbinamento DOPO aver letto il codice: 1, non 2 (uso)
	stdin = strings.NewReader("ABCD-EFGH-JKMN\n")
	if c := esegui([]string{"abbina", "--dati", t.TempDir(), "--server", "http://esempio.it", "--codice", "-"}, &out, &errOut); c != 1 {
		t.Fatalf("da stdin: codice %d err %q", c, errOut.String())
	}
	t.Setenv(envCodice, "ABCD-EFGH-JKMN")
	if c := esegui([]string{"abbina", "--dati", t.TempDir(), "--server", "http://esempio.it"}, &out, &errOut); c != 1 {
		t.Fatalf("da ambiente: codice %d", c)
	}
	t.Setenv(envCodice, "")
	if c := esegui([]string{"abbina", "--dati", t.TempDir(), "--server", "http://esempio.it"}, &out, &errOut); c != 2 {
		t.Fatalf("senza codice: codice %d, atteso 2", c)
	}
	stdin = strings.NewReader("")
	if c := esegui([]string{"abbina", "--dati", t.TempDir(), "--server", "http://esempio.it", "--codice", "-"}, &out, &errOut); c != 2 {
		t.Fatalf("stdin vuoto: codice %d, atteso 2", c)
	}
}

package main

import (
	"bytes"
	"fmt"
	"runtime"
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

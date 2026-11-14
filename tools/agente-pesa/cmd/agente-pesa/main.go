// Comando agente-pesa: agente locale di pesa di WasteFlow.
//
//	agente-pesa abbina --server https://... --codice XXXX-XXXX-XXXX [--dati DIR]
//	agente-pesa esegui [--dati DIR]            in primo piano (Ctrl+C per fermare)
//	agente-pesa stato [--dati DIR]
//	agente-pesa servizio installa|rimuovi|avvia|ferma|esegui [--dati DIR]   (Windows)
//	agente-pesa versione
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"wasteflow/agente-pesa/internal/agente"
	"wasteflow/agente-pesa/internal/config"
	_ "wasteflow/agente-pesa/internal/driver/simulata" // registra il driver SIMULATA
	"wasteflow/agente-pesa/internal/registro"
	"wasteflow/agente-pesa/internal/servizio"
)

// versione e' sovrascritta in build con -ldflags "-X main.versione=<tag>".
var versione = "dev"

// envCodice e' la variabile d'ambiente alternativa a --codice.
const envCodice = "WASTEFLOW_CODICE"

// stdin e' sostituibile nei test.
var stdin io.Reader = os.Stdin

// leggiCodice: il valore di --codice; "-" legge una riga da stdin; vuoto cade sulla variabile d'ambiente.
func leggiCodice(v string) (string, error) {
	switch v {
	case "":
		return strings.TrimSpace(os.Getenv(envCodice)), nil
	case "-":
		riga, err := bufio.NewReader(stdin).ReadString('\n')
		if err != nil && riga == "" {
			return "", fmt.Errorf("nessun codice su stdin: %w", err)
		}
		return strings.TrimSpace(riga), nil
	}
	return v, nil
}

const uso = "uso: agente-pesa <comando> (comandi: abbina, esegui, stato, servizio, versione)"

func nuovoFlagSet(nome string, errOut io.Writer) (*flag.FlagSet, *string) {
	fs := flag.NewFlagSet(nome, flag.ContinueOnError)
	fs.SetOutput(errOut)
	dati := fs.String("dati", config.CartellaPredefinita(), "cartella dati dell'agente")
	return fs, dati
}

func esegui(args []string, out, errOut io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(errOut, uso)
		return 2
	}
	switch args[0] {
	case "versione":
		fmt.Fprintf(out, "agente-pesa %s (%s/%s)\n", versione, runtime.GOOS, runtime.GOARCH)
		return 0
	case "abbina":
		fs, dati := nuovoFlagSet("abbina", errOut)
		server := fs.String("server", "", "indirizzo del backend WasteFlow (https://...)")
		codice := fs.String("codice", "", "codice di abbinamento (XXXX-XXXX-XXXX); `-` lo legge da stdin, se omesso dalla variabile "+envCodice+" (cosi' non resta nella cronologia dei comandi)")
		if err := fs.Parse(args[1:]); err != nil {
			return 2
		}
		cod, err := leggiCodice(*codice)
		if err != nil {
			fmt.Fprintln(errOut, "codice di abbinamento:", err)
			return 2
		}
		*codice = cod
		if *server == "" || *codice == "" {
			fmt.Fprintln(errOut, "servono --server e --codice")
			return 2
		}
		o := agente.Opzioni{Dati: *dati, Versione: versione}
		r, err := agente.Abbina(context.Background(), o, *server, *codice)
		if err != nil {
			fmt.Fprintln(errOut, "abbinamento non riuscito:", err)
			return 1
		}
		fmt.Fprintf(out, "Abbinato all'azienda %s (agente %s).\n", r.Azienda.RagioneSociale, r.AgenteID)
		fmt.Fprintf(out, "Strumenti assegnati: %d. Completare driver e parametri in %s, poi avviare il servizio.\n",
			len(r.Strumenti), filepath.Join(*dati, config.NomeFile))
		return 0
	case "esegui":
		fs, dati := nuovoFlagSet("esegui", errOut)
		if err := fs.Parse(args[1:]); err != nil {
			return 2
		}
		return eseguiAgente(*dati, errOut, errOut, false)
	case "stato":
		fs, dati := nuovoFlagSet("stato", errOut)
		if err := fs.Parse(args[1:]); err != nil {
			return 2
		}
		st, k, err := agente.LeggiStato(*dati)
		if err != nil {
			fmt.Fprintf(errOut, "nessuno stato in %s: l'agente non e' mai stato avviato? (%v)\n", *dati, err)
			return 1
		}
		st.Scrivi(out, k)
		return 0
	case "servizio":
		if len(args) < 2 {
			fmt.Fprintln(errOut, "uso: agente-pesa servizio installa|rimuovi|avvia|ferma|esegui [--dati DIR]")
			return 2
		}
		fs, dati := nuovoFlagSet("servizio", errOut)
		if err := fs.Parse(args[2:]); err != nil {
			return 2
		}
		if args[1] == "esegui" {
			return eseguiAgente(*dati, errOut, errOut, true)
		}
		exe, err := os.Executable()
		if err != nil {
			fmt.Fprintln(errOut, err)
			return 1
		}
		if err := servizio.Gestisci(args[1], exe, *dati); err != nil {
			fmt.Fprintln(errOut, "servizio:", err)
			return 1
		}
		fmt.Fprintf(out, "servizio %s: %s eseguito.\n", servizio.NomeServizio, args[1])
		return 0
	default:
		fmt.Fprintf(errOut, "comando sconosciuto: %q\n%s\n", args[0], uso)
		return 2
	}
}

// eseguiAgente avvia il ciclo dell'agente; comeServizio lo lascia gestire dal gestore dei servizi.
func eseguiAgente(dati string, errOut, _ io.Writer, comeServizio bool) int {
	log, chiudi := creaLog(dati, errOut, !comeServizio)
	defer chiudi()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Info("agente di pesa in avvio", "versione", versione, "dati", dati)
	err := servizio.Esegui(ctx, func(ctx context.Context) error {
		return agente.Esegui(ctx, agente.Opzioni{Dati: dati, Versione: versione, Log: log})
	})
	if err != nil {
		log.Error("agente fermato per errore", "errore", err)
		fmt.Fprintln(errOut, "errore:", err)
		return 1
	}
	log.Info("agente di pesa fermato")
	return 0
}

func creaLog(dati string, errOut io.Writer, anchePerTerminale bool) (*slog.Logger, func()) {
	c, err := config.Carica(filepath.Join(dati, config.NomeFile))
	if err != nil {
		c = config.Config{Log: config.Log{Livello: "info", MaxMB: 10, File: 5}}
	}
	var w io.Writer = errOut
	chiudi := func() {}
	if rot, err := registro.NuovoRotante(filepath.Join(dati, "log", "agente-pesa.log"), int64(c.Log.MaxMB)<<20, c.Log.File); err == nil {
		chiudi = func() { rot.Close() }
		w = rot
		if anchePerTerminale {
			w = io.MultiWriter(rot, errOut)
		}
	}
	return registro.Nuovo(w, c.Log.Livello), chiudi
}

func main() {
	os.Exit(esegui(os.Args[1:], os.Stdout, os.Stderr))
}

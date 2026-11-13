// Comando agente-pesa: agente locale di pesa di WasteFlow.
// In questo scheletro esiste solo il comando `versione`; gli altri arrivano coi task G5-G6.
package main

import (
	"fmt"
	"io"
	"os"
	"runtime"
)

// versione e' sovrascritta in build con -ldflags "-X main.versione=<tag>".
var versione = "dev"

func esegui(args []string, out, errOut io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(errOut, "uso: agente-pesa <comando> (comandi: versione)")
		return 2
	}
	switch args[0] {
	case "versione":
		fmt.Fprintf(out, "agente-pesa %s (%s/%s)\n", versione, runtime.GOOS, runtime.GOARCH)
		return 0
	default:
		fmt.Fprintf(errOut, "comando sconosciuto: %q\n", args[0])
		return 2
	}
}

func main() {
	os.Exit(esegui(os.Args[1:], os.Stdout, os.Stderr))
}

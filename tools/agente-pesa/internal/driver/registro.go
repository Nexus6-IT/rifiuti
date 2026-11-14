package driver

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"wasteflow/agente-pesa/internal/driver/trasporto"
)

var (
	mu        sync.RWMutex
	fabbriche = map[string]Fabbrica{}
)

// Registra aggiunge un driver; si chiama dall'init() di ogni driver. Un nome doppio e' un errore
// di programmazione: panic all'avvio.
func Registra(nome string, f Fabbrica) {
	mu.Lock()
	defer mu.Unlock()
	if nome == "" || f == nil {
		panic("driver: nome o fabbrica mancante")
	}
	if _, ok := fabbriche[nome]; ok {
		panic("driver: nome gia' registrato: " + nome)
	}
	fabbriche[nome] = f
}

// Esiste dice se un driver e' registrato.
func Esiste(nome string) bool {
	mu.RLock()
	defer mu.RUnlock()
	_, ok := fabbriche[nome]
	return ok
}

// Nomi elenca i driver registrati, in ordine alfabetico.
func Nomi() []string {
	mu.RLock()
	defer mu.RUnlock()
	n := make([]string, 0, len(fabbriche))
	for k := range fabbriche {
		n = append(n, k)
	}
	sort.Strings(n)
	return n
}

// Crea costruisce il driver indicato; per un nome ignoto l'errore elenca quelli disponibili.
func Crea(nome string, p Parametri, t trasporto.Apri) (Driver, error) {
	mu.RLock()
	f, ok := fabbriche[nome]
	mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("driver %q sconosciuto; disponibili: %s", nome, strings.Join(Nomi(), ", "))
	}
	return f(p, t)
}

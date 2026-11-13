//go:build windows

package firma

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// DPAPI a livello di macchina: il servizio (account virtuale) e l'amministratore che esegue
// "abbina" leggono lo stesso file; una copia su un'altra macchina non si decifra.
func proteggi(b []byte) ([]byte, error) {
	return dpapi(b, true)
}

func sproteggi(b []byte) ([]byte, error) {
	return dpapi(b, false)
}

func dpapi(b []byte, cifra bool) ([]byte, error) {
	var in, out windows.DataBlob
	if len(b) > 0 {
		in = windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
	}
	var err error
	if cifra {
		err = windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN|windows.CRYPTPROTECT_LOCAL_MACHINE, &out)
	} else {
		err = windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	}
	if err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}

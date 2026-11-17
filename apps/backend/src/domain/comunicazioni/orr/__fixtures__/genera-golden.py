# Genera orr-sintetico.txt e orr-campi.json SENZA usare il serializzatore (D15).
# Offset e lunghezze (1-based) copiati dalla tabella di `winwaste/docs/comunicazioni-orr-campania.md` §5.
# Uso: python3 genera-golden.py   (dalla cartella __fixtures__)
import json

CAMPI = [  # (campo, offset, lunghezza)
 ("a1",1,4),("a2",5,2),("a3",7,15),("a4",22,8),("a5",30,3),
 ("b1",33,6),("b2",39,11),("b3",50,3),("b4",53,3),
 ("c1",56,1),("c2",57,45),("c3",102,16),("c4",118,8),("c5",126,45),("c6",171,5),("c7",176,6),("c8",182,8),
 ("c9",190,45),("c10",235,5),("c11",240,6),("c12",246,8),("c13",254,3),
 ("d1",257,1),("d2",258,45),("d3",303,16),("d4",319,8),("d5",327,45),("d6",372,5),("d7",377,6),("d8",383,8),
 ("d9",391,45),("d10",436,5),("d11",441,6),("d12",447,8),("d13",455,16),("d14",471,30),
 ("e1",501,45),("e2",546,16),("e3",562,8),("e4",570,45),("e5",615,5),("e6",620,6),("e7",626,8),
 ("e8",634,45),("e9",679,5),("e10",684,6),("e11",690,8),("e12",698,16),("e13",714,3),
 ("F1",717,2),
]

Z = "00000000"
# Valori attesi (senza riempimento); i campi non elencati sono spazi. Il campo F1 e' CRLF.
REC1 = {  # file T, trasportatore
 "a1":"2025","a2":"01","a3":"AB1234567890123","a4":"20250115","a5":"TRA",
 "b1":"150110","b2":"00001250500","b4":"D15",
 "c1":"0","c2":"Rossi Imballaggi S.r.l.","c3":"01234567890","c4":Z,"c5":"Via Roma, 12","c6":"80100","c7":"063049",
 "c8":Z,"c9":"Via Napoli, 3","c10":"80100","c11":"063049","c12":"38.21.09","c13":"PRO",
 "d1":"0","d2":"Trasporti Veloci S.p.A.","d3":"09876543210","d4":Z,"d5":"Via Appia, 100","d6":"81100","d7":"061022",
 "d8":Z,"d9":"Via Kennedy, 7","d10":"81100","d11":"061022","d12":"20200315","d13":"NA012345","d14":"1 2 4",
 "e1":"Impianto Società Verde S.r.l.","e2":"11223344556","e3":Z,"e4":"Corso Umberto, 5","e5":"80133","e6":"063049",
 "e7":Z,"e8":"Z.I. Asi, 8","e9":"81025","e10":"061053","e11":"20190610","e12":"AUT-2019-0042","e13":"STO",
}
REC2 = {  # file S, stoccaggio, nessun trasporto
 "a1":"2025","a2":"01","a3":"CD9876543210987","a4":"20250120","a5":"STO",
 "b1":"200201","b2":"00000300250","b4":"R13",
 "c1":"0","c2":"Verdi & Figli Costruzioni","c3":"05544332211","c4":Z,"c5":"Via Toledo, 200","c6":"80134","c7":"063049",
 "c8":Z,"c9":"Via del Mare, 1","c10":"80070","c11":"063003","c12":"41.20.00","c13":"PRO",
 "d1":"1","d4":Z,"d8":Z,
 "e1":"Impianto Società Verde S.r.l.","e2":"11223344556","e3":Z,"e4":"Corso Umberto, 5","e5":"80133","e6":"063049",
 "e7":Z,"e8":"Z.I. Asi, 8","e9":"81025","e10":"061053","e11":"20190610","e12":"AUT-2019-0042","e13":"STO",
}

def riga(valori):
    out = []
    pos = 1
    for nome, off, lun in CAMPI:
        assert off == pos, (nome, off, pos)
        v = "\r\n" if nome == "F1" else valori.get(nome, "")
        assert len(v) <= lun, (nome, v)
        out.append(v.ljust(lun))
        pos += lun
    s = "".join(out)
    assert len(s) == 718, len(s)
    return s

with open("orr-sintetico.txt", "wb") as f:
    f.write((riga(REC1) + riga(REC2)).encode("cp1252"))
with open("orr-campi.json", "w") as f:
    json.dump([{"campo": c, "offset": o, "lunghezza": l} for c, o, l in CAMPI], f, indent=1)
    f.write("\n")

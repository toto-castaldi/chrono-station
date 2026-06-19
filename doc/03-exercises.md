001. Il catalogo esercizi è **per-utente**: ogni operatore censisce i propri esercizi nella pagina di onboarding (sezione dedicata) prima di assegnarli alle squadre. Non esiste più una lista fissa nell'applicazione né un seed condiviso: il catalogo di un nuovo utente parte **vuoto**. Una squadra in onboarding sceglie e ordina i propri esercizi a partire dal catalogo dell'utente

002. Il censimento è un CRUD completo (consentito solo in stato `onboarding`): si possono **aggiungere**, **modificare** ed **eliminare** esercizi. Un esercizio non può essere eliminato finché è presente nell'ordine di una squadra (prima va rimosso da quelle squadre). Il nome dell'esercizio è univoco per utente (confronto case-insensitive)

003. Ogni esercizio ha un nome e un obiettivo opzionale (ripetizioni o distanza: tipo + valore intero positivo + unità). L'obiettivo è informativo: la chiusura dell'esercizio è sempre manuale (vedi doc/00-requirements.md 009-010)

005. Ogni esercizio può avere un'**immagine** associata, **opzionale**: caricata in onboarding (upload di un file dal dispositivo, ridimensionato/compresso lato client) e mostrata durante l'esecuzione, così l'operatore riconosce l'esercizio corrente a colpo d'occhio. Se un esercizio non ha immagine, in esecuzione si mostra un **placeholder**. L'immagine si può sostituire o rimuovere in onboarding (come per gli altri campi del catalogo). I byte sono salvati nel DB (BYTEA) e serviti da un endpoint dedicato (doc/05, doc/06)

004. Lista di esempio/ispirazione (stile Hyrox), utile come riferimento per l'operatore — non è precaricata:
- SkiErg — distanza (es. 1000 m)
- Sled Push — distanza (es. 50 m)
- Sled Pull — distanza (es. 50 m)
- Burpee Broad Jump — distanza/ripetizioni
- Rowing — distanza (es. 1000 m)
- Farmers Carry — distanza (es. 200 m)
- Sandbag Lunges — distanza (es. 100 m)
- Wall Balls — ripetizioni (es. 100)

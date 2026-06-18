001. Le pagine dell'applicazione sono poche. La prima di onboarding del circuito. La seconda del circuito in esecuzione. La terza con i risultati finali

002. Nella pagina di onboarding si censiscono le squadre che partecipano al circuito. Una squadra può essere composta da una o più persone. Una squadra sceglie anche un colore

003. In onboarding, per ogni squadra, viene definito l'ordine degli esercizi

004. Gli esercizi vengono scelti tra una lista predefinita (vedi doc/03-exercises.md)

005. Finito onboarding si passa a pagina di esecuzione

006. C'è un tasto per far partire esecuzione, uno per mettere in pausa e uno per stoppare. Start e stop hanno "alert" di conferma

007. In esecuzione partita c'è un contatore globale del tempo che passa

008. Tutte le squadre corrono in parallelo: partono insieme allo Start e ciascuna avanza secondo il proprio ordine di esercizi

009. Per ogni squadra l'operatore chiude l'esercizio corrente con un tap; alla chiusura viene registrato il tempo parziale (cumulativo dallo Start) e la squadra avanza al proprio esercizio successivo

010. Un esercizio può avere un obiettivo opzionale (numero di ripetizioni o distanza) mostrato durante l'esecuzione; la chiusura resta comunque manuale, via tap dell'operatore

011. La pausa è globale: ferma il contatore globale e congela il tempo di tutte le squadre; alla ripresa i tempi ripartono da dove erano

012. Una squadra ha finito quando ha chiuso tutti i propri esercizi; il suo tempo totale coincide con il parziale dell'ultimo esercizio

013. L'allenamento termina quando l'operatore preme Stop (con alert di conferma), che porta alla pagina dei risultati. Anche se tutte le squadre hanno già finito, il controllo della chiusura resta all'operatore

014. La pagina dei risultati mostra la classifica delle squadre per tempo totale crescente, con il dettaglio dei tempi parziali per esercizio di ciascuna squadra

015. Dopo lo Start (e relativa conferma) parte un conto alla rovescia iniziale (es. 3-2-1); il contatore globale inizia da zero al termine del countdown e le squadre partono insieme

016. Squadre, membri e ordine degli esercizi si definiscono solo in onboarding: dopo lo Start sono congelati e non più modificabili

017. L'operatore può annullare (undo) l'ultima chiusura di esercizio di una squadra: l'esercizio corrente viene riaperto e il parziale errato scartato

018. In onboarding una squadra può essere aggiunta solo se ha un nome e almeno un membro. Nome e colore devono essere univoci tra le squadre; il confronto del nome è senza distinzione tra maiuscole e minuscole (case-insensitive)

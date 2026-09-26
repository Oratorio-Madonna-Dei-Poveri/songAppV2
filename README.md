# MdP SongApp

**MdP SongApp** è una web application leggera progettata per consentire agli utenti di richiedere brani musicali durante un evento, fornendo al DJ un'interfaccia dedicata per gestire la coda in tempo reale e all'amministratore strumenti di controllo avanzati.

## Screenshot / Mockup
*(Inserire screenshot dell'interfaccia utente qui)*
*(Inserire screenshot dell'interfaccia DJ qui)*
*(Inserire screenshot dell'interfaccia Admin qui)*

## Architettura
Il progetto utilizza un'architettura completamente serverless e gratuita (entro i limiti del free tier):
- **Frontend:** HTML, CSS, Vanilla JavaScript (nessun framework pesante, caricamento ultra-veloce).
- **Hosting:** GitHub Pages (Gratuito, distribuzione globale).
- **Backend / Database:** Supabase (PostgreSQL, Realtime, Edge Functions).
- **Integrazione Dati:** Deezer API (Ricerca brani proxyata in modo sicuro tramite Supabase Edge Function).

## Struttura dei File
```text
.
├── admin.html             # Interfaccia di amministrazione
├── dj.html                # Interfaccia di gestione per il DJ
├── index.html             # Interfaccia utente per richiedere brani
├── js/
│   └── config.js          # Configurazione di Supabase (URL e chiavi API)
├── supabase/
│   ├── schema.sql         # Struttura del database, tabelle e policy RLS
│   ├── functions.sql      # Funzioni RPC per il database
│   └── functions/
│       └── search-songs/  # Edge function per la ricerca brani su Deezer
│           └── index.ts
├── setup-guide.md         # Guida dettagliata all'installazione
└── README.md              # Questo file
```

## Setup Rapido
Per configurare il progetto per il tuo evento, devi:
1. Creare un database Supabase.
2. Eseguire gli script SQL per la creazione del database.
3. Configurare e pubblicare l'Edge Function.
4. Ospitare il sito su GitHub Pages.

Per le istruzioni dettagliate passo-passo in italiano, consulta il file **[setup-guide.md](./setup-guide.md)**.

## Tecnologie Utilizzate
- HTML5, CSS3, JavaScript (ES6+)
- Supabase (Auth, Database, Realtime, Edge Functions, RPC)
- Deno (Per l'Edge Function)
- API di Deezer

## Limiti Free Tier Supabase
Questo progetto è ottimizzato per funzionare fluidamente all'interno del Free Tier di Supabase, che attualmente offre:
- 500MB di spazio database
- 2GB di larghezza di banda mensile
- 2 milioni di richieste Edge Function al mese
- Fino a 200 connessioni Realtime simultanee

Questi limiti sono più che sufficienti per eventi, feste o serate. Per evitare il blocco del progetto in periodi prolungati di inutilizzo, ricordati di metterlo in pausa o di interagire periodicamente con il database.

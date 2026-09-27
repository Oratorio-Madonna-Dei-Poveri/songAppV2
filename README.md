# MdP SongApp

**MdP SongApp** è una web application leggera progettata per consentire agli utenti e allo staff di richiedere brani musicali durante eventi e feste dell'Oratorio, fornendo al DJ un'interfaccia dedicata per gestire la coda in tempo reale e all'amministratore strumenti di controllo e monitoraggio avanzati.

## Architettura
Il progetto utilizza un'architettura completamente serverless e gratuita (entro i limiti del free tier):
- **Frontend:** HTML, CSS, Vanilla JavaScript (nessun framework pesante, caricamento ultra-veloce).
- **Hosting:** GitHub Pages (Gratuito, distribuzione globale).
- **Backend / Database:** Supabase (PostgreSQL, Realtime, Edge Functions).
- **Integrazione Dati:** Deezer API (Proxy tramite Supabase Edge Function con caching e abort controller).

## Pagine e Sezioni
- **`index.html` (Utenti):** Ricerca brani da Deezer, aggiunta con click diretto, eliminazione/sostituzione brani personali, pop-up Crediti ✦Sirio.
- **`staff.html` (Staff):** Vista simile a quella degli utenti con inserimento prioritario sotto il blocco brani dello staff. Abilitabile/disabilitabile dall'admin con messaggio motivazionale.
- **`dj.html` (DJ Console):** Gestione scaletta brani in tempo reale, drag & drop per riordinare, visualizzazione indicatore brani dello Staff, marcatura brani come suonati.
- **`admin.html` (SysAdmin):** Statistiche in tempo reale, note private per ogni brano (in coda e suonati), svuotamento playlist, ban brani, gestione portale staff, export CSV completo, monitoraggio salute e vitali del DB (latenza, dimensioni, PostgreSQL).

## Struttura dei File
```text
.
├── admin.html             # Interfaccia di amministrazione
├── dj.html                # Interfaccia di gestione per il DJ
├── index.html             # Interfaccia utente per richiedere brani
├── staff.html             # Interfaccia riservata alle richieste dello staff
├── css/
│   └── style.css          # Foglio di stile principale (Dark theme, icone SVG, responsive)
├── js/
│   ├── admin.js           # Logica pannello amministratore e metriche DB
│   ├── config.js          # Configurazione di Supabase (URL e chiavi API)
│   ├── dj.js              # Logica console DJ
│   ├── realtime.js        # Modulo Supabase Realtime, icone SVG e presenza
│   ├── search.js          # Modulo ricerca Deezer con caching e AbortController
│   ├── staff.js           # Logica portale staff e algoritmo a blocchi
│   ├── supabase-init.js   # Inizializzazione client Supabase e session ID
│   └── user.js            # Logica interfaccia utente
├── supabase/
│   ├── schema.sql         # Schema database completo
│   ├── functions.sql      # Funzioni RPC complete
│   ├── migration_staff_notes_vitals.sql  # Script migrazione rapido per aggiornare un DB esistente
│   └── functions/
│       └── search-songs/  # Edge function per la ricerca brani su Deezer
│           └── index.ts
├── setup-guide.md         # Guida dettagliata all'installazione
└── README.md              # Questo file
```

## Setup Rapido
Per configurare il progetto per il tuo evento:
1. Crea un database Supabase.
2. Esegui gli script SQL nel SQL Editor di Supabase (`schema.sql` e `functions.sql`, o `migration_staff_notes_vitals.sql` se hai già il DB creato).
3. Configura le credenziali in `js/config.js`.
4. Deploy dell'Edge Function di ricerca (`supabase functions deploy search-songs --no-verify-jwt`).
5. Pubblica il sito su GitHub Pages.

Per le istruzioni dettagliate passo-passo in italiano, consulta il file **[setup-guide.md](./setup-guide.md)**.

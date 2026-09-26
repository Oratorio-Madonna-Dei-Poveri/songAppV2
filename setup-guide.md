# Guida all'installazione di MdP SongApp

Benvenuto nella guida di configurazione per **MdP SongApp**. Segui questi passaggi attentamente per configurare il database Supabase e pubblicare l'applicazione.

## 1. Configurazione Supabase
1. Vai su [supabase.com](https://supabase.com) e crea un account gratuito.
2. Crea un nuovo progetto:
   - Scegli un nome per il progetto (es. `mdp-songapp`).
   - Imposta una password sicura per il database.
   - Scegli la regione più vicina (es. `EU (Frankfurt)`).
   - Clicca su "Create new project" e attendi il completamento del setup.

## 2. Configurazione Database (SQL Editor e Realtime)

In questa fase andiamo a creare le tabelle necessarie (`playlist` e `banned_songs`), le relative policy di sicurezza e le funzioni per consentire all'app di funzionare correttamente.

### A. Esecuzione dello Schema (`schema.sql`)
1. Nella dashboard del tuo progetto su Supabase, guarda il menu laterale a sinistra.
2. Clicca sull'icona **SQL Editor** (ha la forma di un terminale con `>_`).
3. In alto a sinistra o al centro della schermata, clicca sul pulsante **"New query"** (o premi il tasto verde `+ New Query`).
4. Apri con il tuo editor di testo il file locale del progetto [`supabase/schema.sql`](file:///d:/Documenti/Oratorio/Altro/prova_app_lista_dj/supabase/schema.sql), seleziona tutto il testo (`Ctrl + A`) e copialo (`Ctrl + C`).
5. Torna nella finestra dell'SQL Editor di Supabase e incolla tutto il codice (`Ctrl + V`).
6. Clicca sul pulsante verde **"Run"** in basso a destra (oppure premi la scorciatoia da tastiera `Ctrl + Invio` / `Cmd + Enter`).
7. Se l'esecuzione va a buon fine, comparirà un messaggio in verde in basso tipo **"Success. No rows returned"**. Questo significa che le tabelle `playlist` e `banned_songs` sono state create con successo insieme ai relativi indici e abilitazioni.

### B. Esecuzione delle Funzioni RPC (`functions.sql`)
1. Rimanendo nell'**SQL Editor**, clicca nuovamente in alto a sinistra su **"+"** o **"New query"** per aprire una scheda pulita.
2. Apri il file locale [`supabase/functions.sql`](file:///d:/Documenti/Oratorio/Altro/prova_app_lista_dj/supabase/functions.sql), copia l'intero contenuto e incollalo nell'editor di Supabase.
3. Clicca di nuovo sul pulsante **"Run"** (o premi `Ctrl + Invio`).
4. Attendi il messaggio di conferma **"Success"**. Ora tutte le funzioni per aggiungere, eliminare, riordinare brani e gestire i ban con privilegi elevati (`SECURITY DEFINER`) sono pronte.

### C. Verifica e Attivazione di Supabase Realtime
Il Realtime è fondamentale: è il componente che permette agli utenti, al DJ e all'Admin di vedere i brani aggiunti, eliminati o riordinati istantaneamente senza dover ricaricare la pagina web.

Lo script `schema.sql` include già i comandi SQL per aggiungere le tabelle alla pubblicazione Realtime, ma è caldamente consigliato fare una verifica visiva nella dashboard di Supabase. Esistono due modi nella dashboard a seconda della versione dell'interfaccia:

#### Metodo 1 (Dalla sezione Database):
1. Nel menu a sinistra di Supabase, clicca sull'icona **Database** (icona a forma di cilindro/database).
2. Nel sottomenu, clicca su **Publications** (o **Replication** nelle versioni precedenti).
3. Troverai una riga chiamata `supabase_realtime`. Clicca sul numero di tabelle associate (es. `2 tables`) o su **Edit** / icona matita.
4. Assicurati che le tabelle **`playlist`** e **`banned_songs`** siano entrambe spuntate/attive.
5. In alternativa, se presente la voce **"Source"**, puoi impostare **"All tables in schema"** oppure verificare che per entrambe le tabelle siano abilitati gli eventi:
   - **INSERT** (quando qualcuno aggiunge un brano)
   - **UPDATE** (quando viene modificato o riordinato)
   - **DELETE** (quando il DJ o l'utente elimina un brano)
6. Clicca su **Save** per salvare le modifiche.

#### Metodo 2 (Direttamente da Table Editor):
1. Nel menu a sinistra, clicca su **Table Editor** (icona a forma di tabella foglio di calcolo).
2. Seleziona la tabella `playlist`.
3. In alto a destra, clicca sui tre puntini `...` o su **"Edit Table"**.
4. Scorri verso il basso nella finestra modale fino alla sezione **Realtime**.
5. Assicurati che la casella **"Enable Realtime"** sia spuntata. Se non lo è, spuntala e clicca su **Save**.
6. Ripeti lo stesso identico passaggio per la tabella `banned_songs`.

## 3. Configurazione Progetto Locale
7. Trova le chiavi API:
   - Vai su **Settings** → **API**.
   - Copia il `Project URL` e la chiave anonima (`anon public`).
8. Apri il file `js/config.js` nel tuo editor di testo.
   - Sostituisci `YOUR_SUPABASE_URL` con l'URL copiato.
   - Sostituisci `YOUR_SUPABASE_ANON_KEY` con la chiave anonima copiata.
   - Salva il file.

## 4. Deploy Edge Function per la ricerca brani
9. Assicurati di avere [Node.js](https://nodejs.org/) installato.
10. Installa la CLI di Supabase aprendo un terminale ed eseguendo:
    ```bash
    npm install -g supabase
    ```
11. Effettua il login da terminale:
    ```bash
    supabase login
    ```
    (Si aprirà il browser per autorizzare l'accesso).
12. Collega il progetto locale a Supabase:
    - Trova il tuo `Project Ref` in **Settings** → **General**.
    ```bash
    supabase link --project-ref IL_TUO_PROJECT_REF
    ```
13. Esegui il deploy della funzione serverless:
    ```bash
    supabase functions deploy search-songs --no-verify-jwt
    ```
    *IMPORTANTE: il flag `--no-verify-jwt` permette le chiamate non autenticate, essenziale per il funzionamento dell'app.*

## 5. Pubblicazione su GitHub Pages
14. Crea un nuovo repository su [GitHub](https://github.com) (es. `mdp-songapp`).
15. Carica (push) tutto il codice del progetto nel repository.
16. Abilita GitHub Pages:
    - Nel repository GitHub, vai su **Settings** → **Pages**.
    - In **Source**, scegli `Deploy from a branch`.
    - Sotto **Branch**, seleziona `main` (o `master`) e la cartella `/ (root)`.
    - Clicca su **Save**.
17. Attendi qualche minuto. Il tuo sito sarà disponibile all'indirizzo: `https://USERNAME.github.io/NOME_REPO/`

## 6. Accesso all'App
Una volta pubblicata, potrai accedere alle seguenti pagine:
- **Utente:** `https://USERNAME.github.io/NOME_REPO/index.html` (Questo è il link da condividere con il pubblico per richiedere le canzoni).
- **DJ:** `https://USERNAME.github.io/NOME_REPO/dj.html` (Privato, per il DJ per gestire e riordinare i brani in coda).
- **Admin:** `https://USERNAME.github.io/NOME_REPO/admin.html` (Privato, per gestire i brani, bannare canzoni o svuotare la playlist).

---

## Risoluzione Problemi (Troubleshooting)
- **I brani non si caricano / errore di ricerca:** Assicurati che l'Edge Function sia stata deployata correttamente con il flag `--no-verify-jwt` e che l'URL in `js/config.js` sia corretto.
- **Le canzoni non appaiono in tempo reale:** Controlla che Supabase Realtime sia attivato per le tabelle in Settings → Database → Replication.
- **Permesso negato nel database:** Controlla di aver eseguito correttamente i file `schema.sql` e `functions.sql`. Tutte le policy RLS e i `SECURITY DEFINER` devono essere presenti.

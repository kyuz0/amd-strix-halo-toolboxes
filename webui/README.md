# Strix Halo WebUI

Ein Webinterface für die llama.cpp-Toolboxes dieses Repositories: Modelle
herunterladen und verwalten, Server starten und stoppen, Live-Logs mitlesen,
Images und die App selbst aktualisieren — alles im Browser statt per SSH.

Läuft als `systemd --user`-Dienst auf der Strix-Halo-Box und startet nach einem
Reboot automatisch mit.

## Installation

```bash
git clone https://github.com/st3v0rr/amd-strix-halo-toolboxes.git
cd amd-strix-halo-toolboxes/webui
./install.sh
```

Der Installer prüft die Voraussetzungen, baut das Frontend, legt die
Konfiguration an, installiert die systemd-Unit und aktiviert Lingering. Am Ende
gibt er die URL und ein **einmalig angezeigtes** Passwort aus.

**Nicht mit `sudo` ausführen.** Podman läuft hier rootless; ein als root
angelegter Dienst würde Container erzeugen, die dein Benutzer nicht verwalten
kann.

Optionen:

```
--port PORT           Port des Webinterfaces (Default 8420)
--bind ADDR           Bind-Adresse (Default 0.0.0.0; 127.0.0.1 hinter einem Reverse-Proxy)
--models-dir DIR      Modellverzeichnis (Default ~/models)
--open-firewall       firewall-cmd fuer den Port ausfuehren
--no-start            Unit installieren, aber nicht starten
```

Ein erneuter Lauf ist idempotent und überschreibt die Zugangsdaten nicht.

### Voraussetzungen

| Werkzeug | Nötig für | Fehlt es? |
|---|---|---|
| Node ≥ 20.11 | die App | `sudo dnf install nodejs22` |
| podman | Container | `sudo dnf install podman` |
| git | Self-Update | Pflicht |
| python3 | VRAM-Schätzer | Schätzung bleibt deaktiviert |
| `hf` | Modell-Downloads | `pipx install "huggingface_hub[cli]"` |

Der Benutzer muss in den Gruppen `video` und `render` sein, sonst schlägt
`--device /dev/kfd` fehl:

```bash
sudo usermod -aG video,render "$USER"   # danach neu anmelden
```

## Betrieb

```bash
systemctl --user status  strix-halo-webui
systemctl --user restart strix-halo-webui
journalctl --user -u strix-halo-webui -f
```

Passwort vergessen:

```bash
webui/scripts/shx-passwd              # interaktiv
webui/scripts/shx-passwd --generate   # neues erzeugen und anzeigen
```

Funktionsprüfung einer laufenden Instanz:

```bash
SHX_PASSWORD=… webui/scripts/smoke.sh http://box:8420
```

## Was wo liegt

| Pfad | Inhalt |
|---|---|
| `~/.config/strix-halo-webui/config.json` | Zugangsdaten, JWT-Secret, HF-Token, Einstellungen (0600) |
| `~/.config/strix-halo-webui/profiles.json` | Server-Profile inkl. API-Keys (0600) |
| `~/.local/state/strix-halo-webui/state.json` | Job-Historie, Image-Digests, Feature-Cache |
| `~/.local/state/strix-halo-webui/app.log` | Anwendungslog, rotiert bei 5 MB |
| `~/models` (konfigurierbar) | die GGUF-Dateien |

Konfiguration und Zustand liegen **außerhalb** des Repositories, damit ein
`git pull` beim Self-Update sie nicht anfassen kann.

## Sicherheit

Die App ist ein **Gerät für ein vertrauenswürdiges LAN**, kein internetfähiger
Dienst. Sie bringt kein TLS mit; für eine Veröffentlichung gehört ein
Reverse-Proxy davor und `--bind 127.0.0.1`.

Was sie tut:

- Ein Admin-Konto, Passwort per scrypt gehasht, JWT in einem
  httpOnly-Cookie (`SameSite=Strict`, 12 h).
- CSRF-Schutz dreifach: SameSite, Origin-Abgleich und ein Pflicht-Header
  `X-Requested-With`. CORS ist gar nicht erst aktiviert.
- Login-Drosselung: 5 Versuche je 15 Minuten und IP.
- Kein Shell-Aufruf, nirgends — alle Subprozesse laufen mit Argv-Arrays
  (per ESLint-Regel erzwungen).
- Modellpfade werden gegen Traversal *und* Symlink-Ausbrüche geprüft.
- Nur Images aus `docker.io/st3v0rr/amd-strix-halo-toolboxes` sind erlaubt;
  beliebige Referenzen lassen sich in den Einstellungen freischalten.
- HF-Token und API-Keys werden aus Logs, SSE-Streams und Fehlermeldungen
  entfernt.

Bekannter Vorbehalt: der API-Key eines Servers steht im Container-Argv und ist
über `podman inspect` für jeden Prozess desselben Benutzers sichtbar — genauso
wie bei `run-llama-server.sh`. Wer das vermeiden will, kann llama-server
stattdessen `--api-key-file` mit einer Datei im Models-Mount übergeben (über
das Feld „Zusätzliche Argumente").

## Wie das Starten funktioniert

Das Backend baut das `podman run`-Argv selbst, als exakte Portierung von
`run-llama-server.sh`. Dass beide identisch sind, wird nicht behauptet, sondern
geprüft:

```bash
npm run test:parity
```

Dabei läuft das **echte** Skript gegen ein Fake-podman, das nur seine Argumente
ausgibt, und das Ergebnis wird mit dem unseres Builders verglichen.

Zwei Eigenheiten aus dem Skript sind dabei besonders wichtig:

- Auf Strix Halo sind Flash Attention und kein mmap zwingend. Die Schreibweise
  hat sich geändert (`-fa 1 --no-mmap` → `-fa on --load-mode none`), deshalb
  wird sie am Image ermittelt und pro **Image-ID** zwischengespeichert — nach
  einem Pull erkennt die App automatisch neu.
- Fehlt die Modelldatei, wird der Start verweigert. Sonst bricht llama-server
  ab und `--restart unless-stopped` erzeugt eine stille Neustart-Schleife.

Container werden mit `shx.*`-Labels markiert. Damit erkennt die App ihre
eigenen wieder — auch nach einem Reboot oder einem gelöschten `state.json` —
und lässt von Hand gestartete Container in Ruhe.

## Autostart

Rootless-Container kommen beim Boot **nicht** von selbst zurück. Statt
`podman-restart.service` zu aktivieren (was zu Doppelstarts führt), gleicht die
App 15 Sekunden nach ihrem eigenen Start alle Profile mit `autostart` ab:

- Container läuft → nichts tun
- Container existiert, gestoppt → starten
- Container fehlt → neu anlegen

Nacheinander mit 5 Sekunden Abstand, weil zwei gleichzeitig ladende große
Modelle den Unified Memory zerlegen. Das Ergebnis steht auf der Übersichtsseite;
ein fehlgeschlagener Autostart ist also nicht still.

## Self-Update

Die Updates-Seite zeigt neue Commits des getrackten Branches und wendet sie an:
`git pull --ff-only` → ggf. `npm ci` → ggf. `npm run build` → Dienst neu starten.

Bei lokalen Änderungen wird das Update **abgelehnt** — auf der Box wird an den
Skripten gearbeitet, und ein Update darf das nicht überfahren.

Der Updater läuft über `systemd-run --user` in einer eigenen transienten Unit.
Ein normales Kind läge in der cgroup unseres Dienstes und würde vom
abschließenden `systemctl restart` mitten im `npm ci` erschlagen.

## Entwicklung

Ohne podman, ohne GPU, auf einem beliebigen Rechner:

```bash
npm install
npm run dev      # API auf 8420 (Mock), Vite auf 5173, Zugang admin/devdev
```

Der Mock-Modus ist ein Konfigurationstausch, kein Code-Zweig: jeder externe
Prozess läuft über `server/src/lib/exec.js`, und `dev/bin/podman` bzw.
`dev/bin/hf` sind echte ausführbare Attrappen, die aufgezeichnete Ausgaben
abspielen — inklusive Carriage-Return-Fortschritt und wachsender
`.incomplete`-Dateien. Damit werden die echten Streaming- und Parser-Pfade
getestet, nicht Umgehungen davon.

```bash
npm test           # Unit-Tests (node --test)
npm run test:parity  # Argv-Vergleich gegen run-llama-server.sh
npm run lint
npm run build
```

Beide Zweige der fa/mmap-Erkennung lassen sich umschalten:

```bash
SHX_MOCK_HELP_VARIANT=old npm run dev
```

## Aufbau

```
webui/
  server/src/
    auth/      scrypt-Passwörter, JWT, Middleware
    config/    XDG-Pfade, zod-Schemata, atomarer JSON-Store
    lib/       exec (Subprozesse), sse, jobs, ansi, redact, ringbuffer
    podman/    argv, labels, features, client, servers, logstream, autostart
    models/    scan, paths (Traversal-Schutz), estimator, hfapi, download
    images/    catalog, registry, pullparse, service
    system/    amdgpu, host, monitor
    updates/   git, apply
    routes/    die REST-API
  web/src/     React + Vite
  dev/         Mock-Attrappen, Fixtures, Parity-Harness
  scripts/     self-update.sh, smoke.sh, shx-passwd
```

Bewusst **keine nativen npm-Module**. `npm ci` muss auf der Box nach jedem
Node-Upgrade durchlaufen — sonst wäre ausgerechnet das Self-Update die
Bruchstelle. Deshalb scrypt statt bcrypt und JSON-Dateien statt SQLite.

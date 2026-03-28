# Game

## Jouer en local

- Installer les dépendances: `npm install`
- Lancer en mode dev (serveur local + watch TS): `npm run dev:web`
- Ouvrir: `http://localhost:5173/`

## Publier sur GitHub Pages (jouable en ligne)

### 1) Préparer la build Pages

- `npm install`
- `npm run build:pages`

Ça génère un site statique dans `docs/` (avec JS bundle + assets).

### 2) Mettre sur GitHub

1. Crée un repo sur GitHub (ex: `game`)
2. Dans ce dossier, initialise git et pousse:

- `git init`
- `git add -A`
- `git commit -m "Initial commit"`
- `git branch -M main`
- `git remote add origin https://github.com/<ton-user>/<ton-repo>.git`
- `git push -u origin main`

### 3) Activer GitHub Pages

Sur GitHub: **Settings → Pages**

- **Source**: `Deploy from a branch`
- **Branch**: `main`
- **Folder**: `/docs`

Après quelques secondes/minutes, ton jeu sera accessible à:
`https://<ton-user>.github.io/<ton-repo>/`

### Mettre à jour le site

À chaque changement:

- Option simple (1 commande):
	- `npm.cmd run deploy:pages`

- Option manuelle:
	- `npm.cmd run build:pages`
	- `git add docs`
	- `git commit -m "Update pages build"`
	- `git push`

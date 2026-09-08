# Fanzy — Aime des photos, gagne des FCFA

Plateforme où des annonceurs payent pour que leurs photos soient vues et aimées,
et où les utilisateurs sont rémunérés en FCFA, retirables via **MTN MoMo** et
**Moov Money**.

## ⚠️ À lire avant de lancer le projet

1. **Le modèle économique doit être réel avant l'ouverture au public.**
   Le montant versé par like (`reward_fcfa` dans la table `photos`) doit rester
   **inférieur** à ce que les annonceurs payent réellement pour cette visibilité.
   Ne verse jamais plus que ce que le budget publicitaire prépayé (`advertisers.prepaid_balance_fcfa`)
   permet de couvrir — sinon tu rembourses les anciens utilisateurs avec l'argent
   des nouveaux, ce qui est un schéma pyramidal, illégal et voué à l'échec.
2. **Vérification d'identité obligatoire.** Avant tout retrait réel, mets en place
   une vérification par OTP (code SMS) à l'inscription, pour éviter la fraude
   (faux comptes créés pour multiplier les likes).
3. **Statut légal.** Manipuler de l'argent via un agrégateur mobile money nécessite
   généralement un compte marchand vérifié (registre de commerce). Renseigne-toi
   auprès de l'agrégateur choisi avant le lancement.

## Structure du projet

Tout est à la racine, en un minimum de fichiers :

```
likeandgagne/
├── index.html        → Page du site (front-end)
├── style.css          → Styles
├── app.js             → Logique front-end (appels à l'API)
├── server.js          → API backend complète (Express : auth, photos/likes,
│                         portefeuille, profil, retrait) — un seul fichier
├── schema.sql          → Schéma de base de données PostgreSQL (compatible Supabase)
├── package.json        → Dépendances du backend
└── .env.example        → Variables d'environnement à configurer
```

Le contenu et le fonctionnement sont identiques à une version en plusieurs
dossiers (routes séparées, etc.) — seule l'organisation des fichiers a changé,
pour un projet plus simple à parcourir.

## Pourquoi GitHub Pages ne suffit pas à lui seul

GitHub Pages héberge uniquement des fichiers statiques (HTML/CSS/JS) — donc
`index.html`, `style.css` et `app.js` peuvent y être publiés tels quels. Mais
gérer des comptes, des soldes et des paiements réels nécessite un serveur qui
tourne en continu et une vraie base de données, que GitHub Pages ne fournit
pas. Le fichier `server.js` doit être déployé ailleurs (Render, Railway,
Fly.io... tous ont un plan gratuit suffisant pour démarrer).

## Étapes de déploiement

### 1. Base de données
- Crée un projet sur [Supabase](https://supabase.com) (gratuit pour démarrer).
- Dans l'éditeur SQL, exécute le contenu de `schema.sql`.
- Récupère l'URL de connexion (`DATABASE_URL`).

### 2. Backend (server.js)
```bash
cp .env.example .env
# remplis .env avec ta DATABASE_URL, un JWT_SECRET aléatoire, et les clés
# de ton agrégateur de paiement (voir ci-dessous)
npm install
npm start
```
Déploie ensuite ce projet sur [Render](https://render.com) ou
[Railway](https://railway.app) (branche ton repo GitHub, ils redéploient
automatiquement à chaque push).

### 3. Agrégateur de paiement mobile money
`server.js` contient un point d'intégration (fonction `processPayout`) à
compléter avec l'API de l'agrégateur de ton choix. Options courantes en
Afrique de l'Ouest, qui gèrent MTN MoMo **et** Moov Money :
- [FedaPay](https://fedapay.com)
- [Kkiapay](https://kkiapay.me)
- [CinetPay](https://cinetpay.com)

Consulte leur documentation pour les identifiants exacts et le format d'appel —
chaque agrégateur a sa propre API de "transfert"/"disbursement".

### 4. Frontend (GitHub Pages)
- Dans `app.js`, remplace `API_BASE` par l'URL de ton backend déployé.
- Dans les paramètres du repo GitHub : **Settings → Pages → Deploy from branch**,
  choisis la branche principale et le dossier racine (`/`).
- Ton site sera accessible à `https://ton-pseudo.github.io/nom-du-repo/`.

## Prochaines étapes suggérées
- Ajouter la vérification OTP par SMS à l'inscription.
- Ajouter un tableau de bord pour les annonceurs (dépôt de budget, suivi des likes).
- Ajouter des règles anti-fraude plus poussées (détection de comportement de bot,
  limite de likes par jour, etc.).

# Tableau de bord Vinted multi-comptes

Tableau de bord pour suivre plusieurs comptes Vinted : ventes, annonces, vues, porte-monnaie, bénéfice. Chaque compte a ses propres données ; le tableau de bord additionne tous les comptes (ou en montre un seul avec le filtre « Compte »).

Aucune donnée d'exemple : tout part de zéro et se remplit avec tes comptes.

## Lancer

Il faut [Node.js](https://nodejs.org) 18 ou plus.

```bash
npm install   # une seule fois (SDK Claude)
npm start
```

Ouvre ensuite http://localhost:3000 dans ton navigateur.

- Les données sont enregistrées dans `data/db.json`, avec des sauvegardes automatiques dans `data/backups/` (une toutes les 10 minutes au plus, les 30 dernières gardées).
- Le serveur n'écoute que sur ton ordinateur. Pour l'ouvrir à ton réseau local (ex. depuis ton téléphone) : `HOST=0.0.0.0 npm start`. Ne l'expose pas sur Internet : il n'y a pas de mot de passe.
- Autre port : `PORT=4000 npm start`.
- Sans serveur, `public/index.html` s'ouvre aussi directement, mais les données restent alors dans le navigateur et la synchro automatique ne marche pas.

## Pages

- **Tableau de bord** : bénéfice, chiffre d'affaires, commandes, vues avec comparaison à la période d'avant (même heure), porte-monnaie, objectif du mois, graphes, classement des comptes sur 14 jours, dernières ventes, journal, statut des articles, ventes par heure, top catégories. Périodes : Aujourd'hui, Hier, 7 jours, 30 jours, Ce mois, Mois dernier.
- **Ventes** : toutes les ventes, recherche et filtres, ajout / modification / suppression, statut modifiable dans le tableau, import et export CSV.
- **Annonces** : à sourcer, prêtes à publier, en ligne, vendues… « Créer la vente » depuis une annonce reprend son titre, son prix et son coût.
- **Comptes** : ajout, modification, statut, porte-monnaie, suppression, synchro Vinted.
- **Réglages** : objectif mensuel, coût d'achat par défaut, sauvegarde / restauration, tout effacer.

## Du sourcing à la mise en vente

1. **Sourcer un article** (page Annonces) : colle le lien du produit chez ton fournisseur, « Lire la page » récupère titre, prix et image quand le site le permet (sinon saisis-les). Indique la livraison, les frais et le prix de revente prévu, ou clique « Estimer avec l'IA ». La marge s'affiche avant d'acheter. L'article part dans « À sourcer ».
2. **Fiche annonce** : quand tu as l'article, ajoute tes vraies photos. Elles sont redimensionnées, et si tu le veux corrigées automatiquement (lumière, balance des couleurs) et recadrées en 3:4. Aucune image n'est générée : l'acheteur voit le vrai article.
3. **Remplir avec l'IA** : l'IA regarde tes photos et rédige titre, description, état, couleur, catégorie, et propose un prix. Elle signale ce qu'il faut vérifier (taille, marque…). Relis toujours avant de publier.
4. **Préparer la publication** : télécharge les photos dans l'ordre, ouvre le formulaire Vinted, copie chaque champ en un clic, publie, puis clique « C'est publié ». L'annonce passe « En ligne » et compte dans les publications du tableau de bord.
5. **Créer la vente** depuis la fiche quand l'article est vendu : prix, coût et frais sont repris, l'annonce passe « Vendue ».

La mise en ligne reste faite par toi sur Vinted : publier automatiquement demanderait de contourner les protections de Vinted, ce qui expose tes comptes à une suspension.

## IA (Claude, ChatGPT ou Gemini)

Dans Réglages > Intelligence artificielle : choisis l'IA, colle ta clé API, « Tester la connexion ». Les clés restent sur ton ordinateur dans `data/config.json` (jamais renvoyées au navigateur). Tu peux aussi utiliser les variables d'environnement `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` ou `GEMINI_API_KEY`.

- Claude : SDK officiel, modèle par défaut `claude-opus-5-5`, avec repli automatique sur un autre modèle Claude si une demande est refusée.
- ChatGPT : modèle par défaut `gpt-4.1-mini`. Gemini : `gemini-2.5-flash`. Change le nom du modèle dans Réglages si ton compte en utilise un autre.
- Chaque appel est facturé par le fournisseur choisi (quelques centimes par annonce selon le modèle).

## Calculs

- Chiffre d'affaires = somme des prix de vente (ventes annulées exclues).
- Bénéfice = prix − coût d'achat − frais. Une vente sans coût d'achat utilise le « coût par défaut » des réglages (0 % au départ) : renseigne tes coûts pour un bénéfice juste.
- Vues : relevées à chaque synchro ; le tableau de bord compte les vues gagnées depuis la synchro précédente, jour par jour. La toute première synchro sert de point de départ.
- Publications : annonces passées « En ligne » (date de publication).

## Connecter un compte Vinted

Vinted ne propose pas d'API officielle. La synchro passe par un favori (bookmarklet) :

1. Lance l'appli (`npm start`) et ouvre la page **Comptes**.
2. Fais glisser le bouton « ↻ Synchro Vinted » dans ta barre de favoris.
3. Ouvre www.vinted.fr dans le même navigateur, connecte-toi au compte voulu, clique le favori.
4. Le favori lit tes ventes, tes annonces (vues, favoris) et ton porte-monnaie avec ta session, puis les envoie au tableau de bord. Un compte inconnu est créé automatiquement. Recommence pour chaque compte, et à chaque fois que tu veux mettre à jour.

Ton mot de passe n'est jamais demandé ni stocké. Si la fenêtre du tableau de bord ne s'ouvre pas, le favori propose de copier les données : colle-les dans Comptes > « Coller des données de synchro ».

Limites à connaître :

- Le favori utilise les adresses internes du site Vinted (`/api/v2/users/current`, `/api/v2/my_orders`, `/api/v2/wardrobe/…/items`). Elles ne sont pas documentées et peuvent changer : si une synchro est incomplète, le message d'erreur s'affiche sur la carte du compte. L'import CSV et la saisie manuelle restent possibles.
- Les statuts de commande Vinted sont convertis par mots-clés (annulée, terminée, livrée, à envoyer, envoyée). Un statut modifié à la main n'est plus écrasé par la synchro.
- Les conditions d'utilisation de Vinted encadrent le multi-comptes et l'automatisation : vérifie-les, un compte peut être suspendu.

## Import CSV

Première ligne = en-têtes. Colonnes reconnues (séparateur `;` ou `,`) : `date`, `compte`, `article`, `prix`, `coût`, `frais`, `statut`, `catégorie`. Seules `article` et `prix` sont obligatoires. Dates `jj/mm/aaaa hh:mm` ou `aaaa-mm-jj`. Les comptes inconnus sont créés. L'export CSV utilise le même format.

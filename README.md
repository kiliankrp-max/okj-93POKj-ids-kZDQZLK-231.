# Tableau de bord Vinted

Reproduction du dashboard vu dans la vidéo : thème sombre, mêmes blocs, mêmes chiffres sur 30 jours (6 792 € de bénéfice, 12 688 € de CA, 427 commandes…), plus des fonctions en plus.

## Ouvrir

Double-clique sur `index.html`. Aucune installation, aucun serveur.

## Repris de la vidéo

- Périodes : Aujourd'hui, Hier, 7 jours, 30 jours, Ce mois, Mois dernier
- KPI : bénéfice (achats, studio), chiffre d'affaires (panier moyen), commandes, avec ▲ % comparé à la période d'avant, même heure
- Porte-monnaie : disponible et en attente de validation
- Graphes : bénéfice par jour (pic, dernier point, moyenne), chiffre d'affaires et commandes, vues par jour, publications et commandes
- Classement des comptes sur 14 jours, avec « Voir les 7 autres comptes »
- Dernières ventes

## En plus

- 4ᵉ KPI « Vues » avec taux de conversion, courbe miniature sous chaque KPI
- Infobulles au survol (ou au doigt sur mobile) sur tous les graphes
- Filtre par compte (menu, ou clic dans le classement) et tri du classement (bénéfice, CA, ventes)
- Tiroir « Toutes les ventes » : recherche, statut de chaque vente, copie en CSV
- Objectif du mois modifiable
- Activité de Claude en direct (simulée), statut des articles, ventes par heure, top catégories
- Mise en page mobile

## Brancher tes vraies données

Les chiffres actuels sont des données d'exemple. Tout vient de `buildData()` dans `index.html`, qui renvoie :

- `orders` : liste de ventes `{ t, acc, title, cat, col, bg, price, profit, achat, studio, status }`
  - `t` : date en millisecondes, `acc` : identifiant du compte (`agathe`, `alix`…)
  - `status` : `ship` (à envoyer), `sent` (envoyée), `wait` (en attente de validation), `done` (validée)
- `V` et `PB` : vues et publications par jour et par heure (`[jour][heure]`, 100 jours, le dernier = aujourd'hui)
- `SH` : part de chaque compte par jour, pour filtrer les vues et publications
- `wallet` : `{ dispo, wait }`

Remplace le contenu de la fonction par tes exports en gardant cette forme : le reste du tableau de bord suit.

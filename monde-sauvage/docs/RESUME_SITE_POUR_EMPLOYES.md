
# Resume du site Monde Sauvage (document interne)

Date de mise a jour: 2026-05-18
Public: nouveaux employes et equipe interne
But: comprendre rapidement le site, les sections, et ou nous sommes rendus.

## 1) Vision et objectif
Le site Monde Sauvage est a la fois:
- Une vitrine qui met en valeur les chalets et l experience.
- Un outil de reservation simple pour convertir des visiteurs en clients.
- Un systeme fiable pour eviter les doubles reservations.

## 2) Portee du projet (ce que le site couvre)
- Presentation des chalets (photos, description, capacite, prix).
- Parcours de reservation en ligne (choix des dates, formulaire, confirmation).
- Synchronisation avec Google Calendar pour la disponibilite.
- Base de donnees centrale pour toutes les reservations.

## 3) Sections principales du site (vue business)

### 3.1 Carte interactive
- Permet de visualiser l offre sur une carte.
- Chaque point ouvre la fiche du chalet.
- Objectif: decouverte rapide et engagement.

### 3.2 Fiche d un chalet
- Photos, description, commodites, capacite et prix.
- Section de reservation visible directement.
- Objectif: donner assez d infos pour prendre une decision.

### 3.3 Reservation en ligne
- Choix des dates d arrivee et de depart.
- Verification automatique de la disponibilite.
- Calcul du prix total selon le nombre de nuits.
- Formulaire client simple (nom, email, notes).
- Confirmation immediate apres la demande.

### 3.4 Calendrier et synchronisation
- Les reservations du site se synchronisent vers Google Calendar.
- Les evenements crees dans Google Calendar reviennent dans le site.
- Objectif: eviter les conflits et les doubles reservations.

## 4) Fonctionnement de la reservation (version simple)
1. Le client choisit un chalet et des dates.
2. Le systeme verifie la disponibilite (base de donnees + calendrier Google si connecte).
3. Si disponible, le client soumet la demande.
4. La reservation est enregistree et apparait dans le calendrier.

## 5) Systeme et flux de donnees (niveau business)
- Source principale: la base de donnees.
- Calendrier Google: utilise comme source secondaire et synchronise.
- Objectif: une seule realite pour la disponibilite.

## 6) Etat actuel du projet (ou nous sommes rendus)
### Fonctionnel et en place
- Parcours complet de reservation fonctionne de bout en bout.
- Verification de disponibilite en temps reel.
- Synchronisation bidirectionnelle avec Google Calendar.
- Calcul automatique du prix.
- Interface adaptee au mobile.

### Limites connues (par design)
- Pas de paiement en ligne pour le moment.
- Pas d emails automatiques.
- Pas de tableau de bord admin avance.

## 7) Roadmap (prochaines etapes prevues)
1. Paiement en ligne (ex: Stripe) pour confirmer les reservations.
2. Notifications automatiques (courriels clients et equipe).
3. Tableau de bord admin pour gerer les reservations et rapports.

## 8) Ce que chaque nouvel employe doit retenir
- Le site est un outil de vente et un outil de gestion.
- La base de donnees est la source principale; Google Calendar est synchronise.
- Le but est d eviter les conflits de dates.
- Les prochaines phases ajoutent paiement, notifications et gestion interne.

## 9) Points de suivi (pour savoir ou nous sommes rendus)
- Statut des reservations en ligne: en production interne.
- Sync calendrier: active et operationnelle.
- Paiements: non demarre.
- Notifications: non demarre.
- Admin dashboard: non demarre.

## 10) Questions frequentes (reponse courte)
- La reservation est elle finale? Non, elle est enregistree et confirmee seulement si les dates sont disponibles.
- Pourquoi Google Calendar? Pour eviter les doubles reservations et garder l agenda a jour.

## 11) Besoin d aide
- Questions operationnelles: voir la documentation interne de reservation.
- Questions clients: rappeler que la disponibilite est verifiee avant confirmation.

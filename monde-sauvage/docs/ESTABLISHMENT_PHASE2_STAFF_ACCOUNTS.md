# Phase 2 — Comptes employés pour l’établissement

**Contexte aujourd’hui (test terrain)** : une seule connexion application par établissement, avec **un compte GoogleOAuth** rattaché à la ligne `Etablissement`. Les sous-agendas (chalets, unités d’inventaire) sont créés sous ce compte ; le partage avec l’équipe se fait via **Google Calendar** (partage natif des agendas), documenté dans l’onglet Calendrier du modal Établissement.

**Objectif phase 2** : permettre à plusieurs **utilisateurs Supabase** (authentifiés) d’agir sur le **même** établissement avec des rôles (propriétaire, lecture seule, gestionnaire réservations, etc.).

## Ébauche technique (non implémenté)

1. **Table** `establishment_members` (ou équivalent)  
   - `establishment_id` (FK → `"Etablissement".key`)  
   - `user_id` (FK → `auth.users`)  
   - `role` (`owner` | `staff` | `viewer`, …)  
   - `invited_email`, `invited_at`, `accepted_at` pour le flux d’invitation  
   - Unique (`establishment_id`, `user_id`)

2. **RLS** : étendre les politiques sur `chalets`, `equipment_kind`, `inventory_unit`, `bookings`, `establishment_clients`, etc., pour autoriser `user_id` tant qu’il existe une ligne membre active pour l’établissement concerné — en plus du propriétaire actuel (`Etablissement.owner_id`).

3. **Invitations** : Edge Function ou Auth `inviteUserByEmail` + lien d’acceptation ; à la première connexion, rattacher l’utilisateur à l’établissement.

4. **UI** : section « Équipe » dans le modal Établissement (liste des membres, invitation par courriel, révocation). Le flux Google OAuth peut rester **un seul refresh token par établissement** côté propriétaire tant que la politique produit le reste partagé via Google.

5. **Sécurité** : ne pas répliquer les politiques `anon` permissives héritées d’autres tables ; toute nouvelle policy doit être testée avec des comptes réels (RLS smoke tests).

Cette phase est volontairement hors du périmètre du premier test avec une pourvoirie réelle afin de limiter la surface d’auth et les risques avant la validation terrain.

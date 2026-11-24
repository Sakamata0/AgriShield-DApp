# 📦 Stockage Hors-Chaîne (Off-Chain Data Storage)

Ce dossier simule le stockage distribué hors-chaîne (**IPFS / Base décentralisée**) pour l'application **AgriShield**.

---

## 1. Pourquoi stocker ces fichiers en Off-Chain ?
Conformément aux principes étudiés au **Chapitre 4 (Ethereum)** :
1. **Coût en Gas prohibitif :** Enregistrer des coordonnées polygonales GPS complètes, des numéros cadastraux et des descriptions de parcelles directement dans l'EVM consommerait des dizaines de milliers d'unités de gas inutiles.
2. **Confidentialité & RGPD :** Les données d'exploitation et titres fonciers doivent rester sous le contrôle de l'agriculteur et de la coopérative.

---

## 2. Le Mécanisme d'Ancrage Cryptographique (Proof of Existence)

Pour chaque police souscrite :
1. Le document JSON complet (ex: `parcel_POL-1.json`) est conservé hors-chaîne (sur IPFS ou serveur décentralisé).
2. Sa fonction d'empreinte cryptographique (**Keccak-256**) est calculée par le client Web3 (`app.js`).
3. **Seul le hash résultant de 32 octets (`0x...`)** est enregistré de façon immuable dans le Smart Contract (`AgriShield.sol`) dans la variable `ipfsMetadataHash`.

---

## 3. Structure d'un Fichier Métadonnées (`parcel_POL-X.json`)

Chaque fichier JSON contient :
* **`policyId` :** Identifiant numérique de la police associée.
* **`parcelMetadata` :** Localisation, numéro de titre foncier, type de culture, superficie et polygone GPS.
* **`insuranceTerms` :** Paramètres contractuels (seuil météo, durée, prime, indemnité).
* **`iotWeatherStation` :** Identifiant de la station météo et adresse de l'Oracle autorisé.
* **`timestamp` :** Date de génération du document.

---

## 4. Vérification d'Intégrité (Exemple)

Pour vérifier qu'un document n'a pas été altéré, il suffit de recalculer son empreinte :
```bash
# Exemple de vérification d'empreinte avec Node.js
node -e "const fs = require('fs'); const ethers = require('ethers'); const data = fs.readFileSync('parcel_POL-1.json'); console.log('Hash Keccak-256:', ethers.utils.keccak256(data));"
```
Si le fichier a été modifié ne serait-ce que d'un espace, le hash calculé ne correspondra plus à celui ancré dans le Smart Contract.

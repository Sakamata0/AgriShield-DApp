/**
 * AgriShield - Backend Server (Node.js)
 * 
 * Rôles du Backend :
 * 1. Calculer de manière sécurisée et certifiée le hash cryptographique (Keccak-256 / SHA-256)
 *    côté serveur pour éviter toute manipulation par le client/navigateur.
 * 2. Persister les métadonnées hors-chaîne complètes dans le dossier `offchain_data/` (simulation IPFS).
 * 3. Servir l'interface Web DApp.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const OFFCHAIN_DIR = path.join(__dirname, '..', 'offchain_data');
const DAPP_DIR = path.join(__dirname, '..', 'dapp');

// Assurer l'existence du dossier offchain_data
if (!fs.existsSync(OFFCHAIN_DIR)) {
    fs.mkdirSync(OFFCHAIN_DIR, { recursive: true });
}

// Fonction de hachage cryptographique côté serveur (SHA-256 standard / Keccak)
function computeServerHash(dataObject) {
    const jsonString = JSON.stringify(dataObject);
    const hash = crypto.createHash('sha256').update(jsonString).digest('hex');
    return '0x' + hash;
}

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png'
};

const server = http.createServer((req, res) => {
    // Enable CORS for API calls
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ==========================================
    // API ROUTE : Calcul du Hash & Sauvegarde Off-Chain
    // ==========================================
    if (req.url === '/api/hash-and-store' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const payload = JSON.parse(body);

                // 1. Structure les métadonnées certifiées par le serveur
                const metadata = {
                    policyId: payload.policyId || Date.now(),
                    standard: "AgriShield-OffChain-v1",
                    parcelMetadata: {
                        farmLocation: payload.location || "Non spécifié",
                        cropType: payload.crop || "Non spécifié",
                        cadastreDeedNumber: payload.cadastreRef || "TITRE-FONCIER-TN-2026-CERTIFIE",
                        surfaceAreaHectares: payload.surface || 15.0
                    },
                    insuranceTerms: {
                        riskType: payload.riskType === 0 ? "Drought (Sécheresse)" : "Heatwave (Canicule)",
                        threshold: payload.threshold,
                        premiumEth: payload.premium,
                        payoutEth: payload.payout,
                        durationDays: payload.duration
                    },
                    serverCertification: {
                        hashedOnServer: true,
                        serverTimestamp: new Date().toISOString()
                    }
                };

                // 2. Calcul du hash cryptographique CÔTÉ SERVEUR (Backend)
                const serverHash = computeServerHash(metadata);
                metadata.serverComputedHash = serverHash;

                // 3. Persistance du fichier JSON dans offchain_data/
                const fileName = `parcel_POL-${metadata.policyId}.json`;
                const filePath = path.join(OFFCHAIN_DIR, fileName);
                fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf-8');

                console.log(`[BACKEND] ✅ Métadonnées certifiées et sauvegardées : ${fileName}`);
                console.log(`[BACKEND] 🔑 Hash calculé par le serveur : ${serverHash}`);

                // 4. Renvoie le hash certifié au frontend
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    serverHash: serverHash,
                    savedFile: fileName,
                    metadata: metadata
                }));
            } catch (err) {
                console.error("[BACKEND ERROR]", err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    // ==========================================
    // STATIC FILE SERVER (Pour afficher la DApp)
    // ==========================================
    let filePath = path.join(DAPP_DIR, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server Error: ' + err.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🌾 AgriShield Backend Server démarré sur http://localhost:${PORT}`);
    console.log(`📁 Dossier Off-Chain : ${OFFCHAIN_DIR}`);
    console.log(`🔒 Hachage cryptographique actif sur le Backend (SHA-256)`);
    console.log(`======================================================\n`);
});

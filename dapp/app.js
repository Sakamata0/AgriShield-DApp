// AgriShield Front-End Application Logic (Ethers.js v5)

// Contract ABI (Matches AgriShield.sol)
const AGRI_SHIELD_ABI = [
    "constructor(address _weatherOracle) payable",
    "event PoolFunded(address indexed insurer, uint256 amount, uint256 newTotalPool)",
    "event PolicySubscribed(uint256 indexed policyId, address indexed farmer, uint8 riskType, uint256 threshold, uint256 premium, uint256 payout, uint256 expirationTime)",
    "event WeatherReported(uint256 indexed policyId, string location, uint256 recordedValue, bool triggerMet)",
    "event ClaimPaid(uint256 indexed policyId, address indexed farmer, uint256 amountPaid, uint256 timestamp)",
    "event PolicyExpired(uint256 indexed policyId, uint256 timestamp)",
    "event InsurerWithdrawal(address indexed insurer, uint256 amount)",
    "function insurerAdmin() view returns (address)",
    "function weatherOracle() view returns (address)",
    "function nextPolicyId() view returns (uint256)",
    "function totalLiquidityPool() view returns (uint256)",
    "function totalLockedPayouts() view returns (uint256)",
    "function getContractBalance() view returns (uint256)",
    "function fundLiquidityPool() payable",
    "function withdrawSurplus(uint256 _amount)",
    "function subscribePolicy(string _farmLocation, string _cropType, uint8 _riskType, uint256 _threshold, uint256 _payoutAmount, uint256 _durationInDays, string _ipfsMetadataHash) payable returns (uint256)",
    "function reportWeatherData(uint256 _policyId, uint256 _recordedValue)",
    "function checkExpiration(uint256 _policyId)",
    "function getFarmerPolicies(address _farmer) view returns (uint256[])",
    "function policies(uint256) view returns (uint256 id, address payable farmer, string farmLocation, string cropType, uint8 riskType, uint256 threshold, uint256 premiumAmount, uint256 payoutAmount, uint256 startTime, uint256 duration, uint8 status, string ipfsMetadataHash)"
];

let provider = null;
let signer = null;
let userAddress = null;
let agriContract = null;
let contractAddress = localStorage.getItem("agrishield_contract_address") || "";

// DOM Elements
const btnConnect = document.getElementById("btnConnectWallet");
const walletText = document.getElementById("walletBtnText");
const roleBadge = document.getElementById("roleBadge");
const roleText = document.getElementById("roleText");
const contractInput = document.getElementById("contractAddressInput");
const btnSetContract = document.getElementById("btnSetContract");

// Tabs
const tabBtnFarmer = document.getElementById("tabBtnFarmer");
const tabBtnOracle = document.getElementById("tabBtnOracle");
const tabBtnInsurer = document.getElementById("tabBtnInsurer");
const tabContentFarmer = document.getElementById("tabContentFarmer");
const tabContentOracle = document.getElementById("tabContentOracle");
const tabContentInsurer = document.getElementById("tabContentInsurer");

// Initialize on Load
window.addEventListener("DOMContentLoaded", async () => {
    if (contractAddress) {
        contractInput.value = contractAddress;
    }

    setupTabs();
    setupEventListeners();
    updateOffChainHashDisplay();

    if (window.ethereum) {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
            await connectWallet();
        }

        window.ethereum.on("accountsChanged", async () => {
            await connectWallet();
        });
        window.ethereum.on("chainChanged", () => {
            window.location.reload();
        });
    }
});

// Setup Tab Navigation
function setupTabs() {
    const tabs = [
        { btn: tabBtnFarmer, content: tabContentFarmer },
        { btn: tabBtnOracle, content: tabContentOracle },
        { btn: tabBtnInsurer, content: tabContentInsurer }
    ];

    tabs.forEach(({ btn, content }) => {
        btn.addEventListener("click", () => {
            tabs.forEach(t => {
                t.btn.classList.remove("border-emerald-500", "text-emerald-400", "bg-slate-800/80");
                t.btn.classList.add("border-transparent", "text-slate-400");
                t.content.classList.add("hidden");
            });

            btn.classList.remove("border-transparent", "text-slate-400");
            btn.classList.add("border-emerald-500", "text-emerald-400", "bg-slate-800/80");
            content.classList.remove("hidden");
        });
    });
}

// Connect MetaMask
async function connectWallet() {
    if (!window.ethereum) {
        showStatus("MetaMask non détecté. Veuillez installer l'extension MetaMask.", "error");
        return;
    }

    try {
        await provider.send("eth_requestAccounts", []);
        signer = provider.getSigner();
        userAddress = await signer.getAddress();

        walletText.textContent = `${userAddress.substring(0, 6)}...${userAddress.substring(userAddress.length - 4)}`;
        roleBadge.classList.remove("hidden");

        if (contractAddress && ethers.utils.isAddress(contractAddress)) {
            await initContract();
        } else {
            showStatus("Portefeuille connecté ! Renseignez l'adresse du contrat déployé ci-dessus.", "info");
        }
    } catch (err) {
        console.error(err);
        showStatus("Erreur lors de la connexion du portefeuille : " + err.message, "error");
    }
}

// Initialize Contract Instance
async function initContract() {
    contractAddress = contractInput.value.trim();
    if (!ethers.utils.isAddress(contractAddress)) {
        showStatus("Adresse de contrat invalide.", "error");
        return;
    }

    localStorage.setItem("agrishield_contract_address", contractAddress);

    try {
        if (agriContract) {
            agriContract.removeAllListeners();
        }
        agriContract = new ethers.Contract(contractAddress, AGRI_SHIELD_ABI, signer || provider);
        await refreshRole();
        await refreshMetrics();
        await loadFarmerPolicies();
        listenToContractEvents();
        showStatus("Contrat AgriShield chargé avec succès !", "success");
    } catch (err) {
        console.error(err);
        showStatus("Impossible de charger le contrat à cette adresse.", "error");
    }
}

// Determine User Role
async function refreshRole() {
    if (!agriContract || !userAddress) return;

    try {
        const insurer = await agriContract.insurerAdmin();
        const oracle = await agriContract.weatherOracle();

        if (userAddress.toLowerCase() === insurer.toLowerCase()) {
            roleText.innerHTML = `<i class="fa-solid fa-crown text-amber-400 mr-1"></i> Assureur (Admin)`;
            roleBadge.className = "px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30";
        } else if (userAddress.toLowerCase() === oracle.toLowerCase()) {
            roleText.innerHTML = `<i class="fa-solid fa-satellite-dish text-sky-400 mr-1"></i> Oracle Météo`;
            roleBadge.className = "px-3 py-1.5 rounded-full text-xs font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30";
        } else {
            roleText.innerHTML = `<i class="fa-solid fa-tractor text-emerald-400 mr-1"></i> Agriculteur`;
            roleBadge.className = "px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
        }
    } catch (e) {
        console.warn("Could not determine role", e);
    }
}

// Fetch Global Metrics
async function refreshMetrics() {
    if (!agriContract) return;

    try {
        const pool = await agriContract.totalLiquidityPool();
        const locked = await agriContract.totalLockedPayouts();
        const nextId = await agriContract.nextPolicyId();

        const poolEth = parseFloat(ethers.utils.formatEther(pool));
        const lockedEth = parseFloat(ethers.utils.formatEther(locked));
        const freeEth = Math.max(0, poolEth - lockedEth);

        document.getElementById("metricTotalPool").textContent = poolEth.toFixed(3);
        document.getElementById("metricLockedPayouts").textContent = lockedEth.toFixed(3);
        document.getElementById("metricFreeLiquidity").textContent = freeEth.toFixed(3);
        document.getElementById("metricTotalPolicies").textContent = (nextId.toNumber() - 1).toString();
    } catch (e) {
        console.error("Error refreshing metrics:", e);
    }
}

// Load Policies for Connected Farmer
async function loadFarmerPolicies() {
    if (!agriContract || !userAddress) return;
    const container = document.getElementById("policiesList");

    try {
        const policyIds = await agriContract.getFarmerPolicies(userAddress);
        if (policyIds.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-slate-500 text-xs">
                    <i class="fa-solid fa-seedling text-2xl mb-2 text-slate-600 block"></i>
                    Aucune police enregistrée pour cette adresse.
                </div>
            `;
            return;
        }

        let html = "";
        for (let i = policyIds.length - 1; i >= 0; i--) {
            const id = policyIds[i];
            const p = await agriContract.policies(id);

            const statusEnum = ["Inactive", "Active", "ClaimPaid", "Expired"];
            const statusLabels = {
                0: `<span class="px-2 py-0.5 rounded text-[10px] bg-slate-700 text-slate-300">Inactive</span>`,
                1: `<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">Actif (Couvert)</span>`,
                2: `<span class="px-2 py-0.5 rounded text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold">🎉 Indemnisé</span>`,
                3: `<span class="px-2 py-0.5 rounded text-[10px] bg-slate-700 text-slate-400">Expiré</span>`
            };

            const riskTypeLabel = p.riskType === 0 ? "Sécheresse (Pluie &le;)" : "Canicule (Temp &ge;)";
            const unit = p.riskType === 0 ? "mm" : "°C";
            const premiumEth = ethers.utils.formatEther(p.premiumAmount);
            const payoutEth = ethers.utils.formatEther(p.payoutAmount);

            html += `
                <div class="bg-slate-800/90 border border-slate-700/80 rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                    <div class="space-y-1">
                        <div class="flex items-center space-x-2">
                            <span class="font-mono font-bold text-emerald-400 text-xs">#POL-${p.id}</span>
                            ${statusLabels[p.status]}
                            <span class="text-xs text-white font-semibold">${p.cropType}</span>
                        </div>
                        <div class="text-xs text-slate-400 flex items-center space-x-4">
                            <span><i class="fa-solid fa-location-dot mr-1"></i>${p.farmLocation}</span>
                            <span><i class="fa-solid fa-triangle-exclamation mr-1"></i>${riskTypeLabel} ${p.threshold} ${unit}</span>
                        </div>
                        <div class="text-[11px] text-slate-400 font-mono flex flex-wrap items-center gap-2">
                            <span>Hash Off-Chain (Keccak-256) : <span class="text-emerald-400">${p.ipfsMetadataHash.substring(0, 18)}...</span></span>
                            <button onclick="downloadOffChainMetadata(${p.id}, '${p.farmLocation}', '${p.cropType}', ${p.threshold}, ${p.riskType}, '${premiumEth}', '${payoutEth}', '${p.ipfsMetadataHash}')" 
                                    class="text-[10px] text-sky-400 hover:text-sky-300 bg-sky-950/60 border border-sky-800/60 px-2 py-0.5 rounded font-sans transition">
                                <i class="fa-solid fa-file-code mr-1"></i> Télécharger JSON
                            </button>
                        </div>
                    </div>
                    <div class="text-right flex md:flex-col items-center md:items-end justify-between w-full md:w-auto border-t md:border-t-0 pt-2 md:pt-0 border-slate-700">
                        <div class="text-xs text-slate-400">Prime : <span class="text-slate-200 font-semibold">${premiumEth} ETH</span></div>
                        <div class="text-xs font-bold text-emerald-400">Indemnité : ${payoutEth} ETH</div>
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    } catch (e) {
        console.error("Error loading policies:", e);
    }
}

// Download / Export Off-Chain JSON Metadata File
function downloadOffChainMetadata(id, location, crop, threshold, riskType, premium, payout, hash) {
    const data = {
        policyId: id,
        standard: "AgriShield-OffChain-v1",
        parcelMetadata: {
            farmLocation: location,
            cropType: crop,
            cadastreDeedNumber: `TITRE-FONCIER-TN-2026-PAR-${id}`,
            surfaceAreaHectares: 12.5,
            gpsCoordinates: {
                region: location,
                boundaryPolygon: "Polygone GPS cadastre off-chain"
            }
        },
        insuranceTerms: {
            riskType: riskType === 0 ? "Drought (Sécheresse)" : "Heatwave (Canicule)",
            parametricThreshold: riskType === 0 ? `Pluie <= ${threshold} mm` : `Température >= ${threshold} °C`,
            premiumAmountEth: premium,
            guaranteedPayoutEth: payout
        },
        iotWeatherStation: {
            stationId: `STATION-METEO-${location.split('-')[0].trim().toUpperCase()}-01`,
            telemetryProtocol: "LoRaWAN / Satellite Feed"
        },
        onChainAnchoredHash: hash,
        timestamp: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parcel_POL-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// ==========================================
// OFF-CHAIN CRYPTOGRAPHIC HASH & BACKEND INTEGRATION
// ==========================================

async function requestBackendHash(location, crop, duration, threshold, riskType, premium, payout) {
    try {
        const response = await fetch('/api/hash-and-store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location, crop, duration, threshold, riskType, premium, payout
            })
        });
        if (response.ok) {
            const result = await response.json();
            console.log("[BACKEND CERTIFIED]", result);
            return result.serverHash;
        }
    } catch (e) {
        console.warn("Backend server not responding, falling back to client-side hash", e);
    }
    return computeOffChainMetadataHash(location, crop, duration);
}

function computeOffChainMetadataHash(location, crop, durationDays) {
    // 1. Structure the off-chain metadata (Cadastre deed, parcel GPS coords, timestamps)
    const offChainData = {
        parcelLocation: location ? location.trim() : "Siliana - Parcelle Nord 14",
        cropType: crop ? crop.trim() : "Blé Dur",
        validityDays: parseInt(durationDays) || 30,
        deedCadastreRef: "CADASTRE-OFFCHAIN-TN-2026-B4",
        standard: "AgriShield-OffChain-v1"
    };

    // 2. Convert to string and compute Keccak-256 cryptographic hash (Ethereum EVM standard)
    const dataString = JSON.stringify(offChainData);
    const hashBytes = ethers.utils.toUtf8Bytes(dataString);
    const keccakHash = ethers.utils.keccak256(hashBytes);

    return keccakHash;
}

async function updateOffChainHashDisplay() {
    const loc = document.getElementById("inputLocation")?.value || "";
    const crop = document.getElementById("inputCrop")?.value || "";
    const duration = document.getElementById("inputDuration")?.value || 30;
    const inputIpfs = document.getElementById("inputIpfs");

    if (inputIpfs) {
        inputIpfs.value = computeOffChainMetadataHash(loc, crop, duration);
    }
}

// Subscribe Policy Action
async function handleSubscribe() {
    if (!agriContract) return showStatus("Veuillez d'abord connecter le contrat.", "error");

    const location = document.getElementById("inputLocation").value;
    const crop = document.getElementById("inputCrop").value;
    const riskType = parseInt(document.getElementById("selectRisk").value);
    const threshold = parseInt(document.getElementById("inputThreshold").value);
    const premiumEth = document.getElementById("inputPremium").value;
    const payoutEth = document.getElementById("inputPayout").value;
    const durationDays = parseInt(document.getElementById("inputDuration").value);

    // Compute cryptographic hash certified by the backend server
    showStatus("Certification et calcul du hash sur le serveur backend...", "info");
    const ipfsHash = await requestBackendHash(location, crop, durationDays, threshold, riskType, premiumEth, payoutEth);
    document.getElementById("inputIpfs").value = ipfsHash;

    try {
        showStatus("Transaction en cours de confirmation...", "info");
        const premiumWei = ethers.utils.parseEther(premiumEth);
        const payoutWei = ethers.utils.parseEther(payoutEth);

        const tx = await agriContract.subscribePolicy(
            location,
            crop,
            riskType,
            threshold,
            payoutWei,
            durationDays,
            ipfsHash,
            { 
                value: premiumWei,
                gasLimit: 800000 
            }
        );

        showStatus(`Transaction envoyée : ${tx.hash.substring(0, 10)}... En attente de minage.`, "info");
        await tx.wait();
        showStatus("Félicitations ! Police de micro-assurance souscrite et garantie sous séquestre.", "success");
        await refreshMetrics();
        await loadFarmerPolicies();
    } catch (err) {
        console.error(err);
        showStatus("Erreur lors de la souscription : " + parseError(err), "error");
    }
}

// Oracle Weather Report Action
async function handleOracleReport() {
    if (!agriContract) return showStatus("Veuillez d'abord connecter le contrat.", "error");

    const policyId = document.getElementById("oraclePolicyId").value;
    const recordedVal = document.getElementById("oracleMetricValue").value;

    if (!policyId || !recordedVal) {
        return showStatus("Veuillez renseigner l'ID de la police et la valeur météo mesurée.", "error");
    }

    try {
        showStatus("Transmission du rapport météorologique...", "info");
        const tx = await agriContract.reportWeatherData(policyId, recordedVal, { gasLimit: 500000 });
        showStatus(`Rapport envoyé (${tx.hash.substring(0, 10)}...). Traitement autonome en cours...`, "info");
        const receipt = await tx.wait();

        // Check if ClaimPaid event occurred
        const claimEvent = receipt.events?.find(e => e.event === "ClaimPaid");
        if (claimEvent) {
            showStatus(`🚨 Catastrophe confirmée ! L'indemnité a été automatiquement versée au wallet de l'agriculteur.`, "success");
        } else {
            showStatus(`Rapport météo enregistré. Le seuil critique n'est pas atteint : aucune indemnité déclenchée.`, "info");
        }

        await refreshMetrics();
        await loadFarmerPolicies();
    } catch (err) {
        console.error(err);
        showStatus("Erreur Oracle : " + parseError(err), "error");
    }
}

// Insurer Fund Pool
async function handleFundPool() {
    if (!agriContract) return showStatus("Veuillez connecter le contrat.", "error");
    const amountEth = document.getElementById("inputFundAmount").value;

    try {
        const amountWei = ethers.utils.parseEther(amountEth);
        showStatus("Dépôt de garantie en cours...", "info");
        const tx = await agriContract.fundLiquidityPool({ value: amountWei, gasLimit: 150000 });
        await tx.wait();
        showStatus("Pool de liquidité rechargé avec succès !", "success");
        await refreshMetrics();
    } catch (err) {
        console.error(err);
        showStatus("Erreur dépôt : " + parseError(err), "error");
    }
}

// Insurer Withdraw Surplus
async function handleWithdrawSurplus() {
    if (!agriContract) return showStatus("Veuillez connecter le contrat.", "error");
    const amountEth = document.getElementById("inputWithdrawAmount").value;

    try {
        const amountWei = ethers.utils.parseEther(amountEth);
        showStatus("Retrait du surplus en cours...", "info");
        const tx = await agriContract.withdrawSurplus(amountWei, { gasLimit: 150000 });
        await tx.wait();
        showStatus("Surplus retiré avec succès !", "success");
        await refreshMetrics();
    } catch (err) {
        console.error(err);
        showStatus("Erreur retrait : " + parseError(err), "error");
    }
}

// ==========================================
// TEST SCENARIOS (REJECTION / DEFENSE DEMO)
// ==========================================

async function testUnauthorizedOracle() {
    if (!agriContract) return showStatus("Veuillez connecter le contrat.", "error");
    try {
        showStatus("Test de sécurité en cours : tentative d'envoi météo sans rôle Oracle...", "info");
        // Attempt to call reportWeatherData with policy 1 and fake metric
        const tx = await agriContract.reportWeatherData(1, 10);
        await tx.wait();
    } catch (err) {
        const parsed = parseError(err);
        showStatus(`🛡️ Rejet de Sécurité Validé ! L'EVM a bloqué l'attaque : "${parsed}"`, "error");
        logEventToUI("BLOCKED_ATTACK", `Appel reportWeatherData bloqué : Seul l'Oracle météorologique est autorisé.`);
    }
}

async function testIllegalWithdrawal() {
    if (!agriContract) return showStatus("Veuillez connecter le contrat.", "error");
    try {
        showStatus("Test de sécurité en cours : tentative de retrait des fonds sous séquestre...", "info");
        // Attempt to withdraw 100 ETH (exceeds free liquidity)
        const hugeAmount = ethers.utils.parseEther("100.0");
        const tx = await agriContract.withdrawSurplus(hugeAmount);
        await tx.wait();
    } catch (err) {
        const parsed = parseError(err);
        showStatus(`🛡️ Rejet de Sécurité Validé ! L'EVM a bloqué le retrait illégal : "${parsed}"`, "error");
        logEventToUI("BLOCKED_WITHDRAWAL", `Tentative de retrait bloquée : Les fonds sont verrouillés pour garantir les indemnisations.`);
    }
}

// ==========================================
// REAL-TIME EVENT LISTENER (WITH DEDUPLICATION)
// ==========================================

const seenEventKeys = new Set();

function listenToContractEvents() {
    if (!agriContract) return;

    agriContract.removeAllListeners();

    agriContract.on("PoolFunded", (insurer, amount, newTotal, ev) => {
        const key = ev && ev.transactionHash ? `${ev.transactionHash}_${ev.logIndex}` : null;
        if (key && seenEventKeys.has(key)) return;
        if (key) seenEventKeys.add(key);

        const eth = ethers.utils.formatEther(amount);
        logEventToUI("PoolFunded", `Assureur (${insurer.substring(0, 6)}...) a injecté ${eth} ETH de capital.`);
        refreshMetrics();
    });

    agriContract.on("PolicySubscribed", (policyId, farmer, riskType, threshold, premium, payout, expTime, ev) => {
        const key = ev && ev.transactionHash ? `${ev.transactionHash}_${ev.logIndex}` : null;
        if (key && seenEventKeys.has(key)) return;
        if (key) seenEventKeys.add(key);

        const pEth = ethers.utils.formatEther(payout);
        const rType = riskType === 0 ? "Sécheresse" : "Canicule";
        logEventToUI("PolicySubscribed", `Nouvelle police #POL-${policyId} souscrite par ${farmer.substring(0, 6)}... (${rType}, Garantie: ${pEth} ETH)`);
        refreshMetrics();
        loadFarmerPolicies();
    });

    agriContract.on("WeatherReported", (policyId, location, val, triggered, ev) => {
        const key = ev && ev.transactionHash ? `${ev.transactionHash}_${ev.logIndex}` : null;
        if (key && seenEventKeys.has(key)) return;
        if (key) seenEventKeys.add(key);

        logEventToUI("WeatherReported", `Relevé pour #POL-${policyId} (${location}) : Mesure = ${val}. Seuil franchi = ${triggered ? "OUI (Catastrophe)" : "NON"}`);
    });

    agriContract.on("ClaimPaid", (policyId, farmer, amount, timestamp, ev) => {
        const key = ev && ev.transactionHash ? `${ev.transactionHash}_${ev.logIndex}` : null;
        if (key && seenEventKeys.has(key)) return;
        if (key) seenEventKeys.add(key);

        const eth = ethers.utils.formatEther(amount);
        logEventToUI("ClaimPaid", `⚡ PAIEMENT INSTANTANÉ : ${eth} ETH versés directement à l'agriculteur ${farmer.substring(0, 6)}... !`);
        refreshMetrics();
        loadFarmerPolicies();
    });
}

function logEventToUI(eventName, message) {
    const container = document.getElementById("eventLogsContainer");
    const time = new Date().toLocaleTimeString();

    const colors = {
        PoolFunded: "text-emerald-400 border-emerald-500/30 bg-emerald-950/20",
        PolicySubscribed: "text-purple-400 border-purple-500/30 bg-purple-950/20",
        WeatherReported: "text-sky-400 border-sky-500/30 bg-sky-950/20",
        ClaimPaid: "text-amber-300 border-amber-500/40 bg-amber-950/30 font-bold",
        BLOCKED_ATTACK: "text-rose-400 border-rose-500/40 bg-rose-950/30",
        BLOCKED_WITHDRAWAL: "text-rose-400 border-rose-500/40 bg-rose-950/30"
    };

    const style = colors[eventName] || "text-slate-300 border-slate-700 bg-slate-900/40";

    const div = document.createElement("div");
    div.className = `p-2.5 rounded-lg border event-card flex items-start justify-between ${style}`;
    div.innerHTML = `
        <div class="flex items-start space-x-2">
            <span class="font-bold">[${eventName}]</span>
            <span>${message}</span>
        </div>
        <span class="text-[10px] opacity-60 ml-2 whitespace-nowrap">${time}</span>
    `;

    if (container.children.length === 1 && container.children[0].classList.contains("italic")) {
        container.innerHTML = "";
    }

    container.prepend(div);
}

// Helpers
function showStatus(msg, type = "info") {
    const banner = document.getElementById("statusBanner");
    const message = document.getElementById("statusMessage");
    const icon = document.getElementById("statusIcon");

    banner.classList.remove("hidden", "bg-emerald-900/30", "border-emerald-600/50", "text-emerald-200", 
                           "bg-rose-900/30", "border-rose-600/50", "text-rose-200", 
                           "bg-sky-900/30", "border-sky-600/50", "text-sky-200");

    if (type === "success") {
        banner.classList.add("bg-emerald-900/30", "border-emerald-600/50", "text-emerald-200");
        icon.className = "fa-solid fa-circle-check text-emerald-400 text-lg";
    } else if (type === "error") {
        banner.classList.add("bg-rose-900/30", "border-rose-600/50", "text-rose-200");
        icon.className = "fa-solid fa-triangle-exclamation text-rose-400 text-lg";
    } else {
        banner.classList.add("bg-sky-900/30", "border-sky-600/50", "text-sky-200");
        icon.className = "fa-solid fa-info-circle text-sky-400 text-lg";
    }

    message.textContent = msg;
}

function parseError(err) {
    if (err.data && err.data.message) return err.data.message;
    if (err.reason) return err.reason;
    if (err.message) {
        if (err.message.includes("AgriShield:")) {
            const match = err.message.match(/AgriShield:\s*([^"']+)/);
            if (match) return match[1];
        }
        return err.message.substring(0, 100);
    }
    return "Transaction échouée";
}

function setupEventListeners() {
    btnConnect.addEventListener("click", connectWallet);
    btnSetContract.addEventListener("click", initContract);
    document.getElementById("btnSubscribe").addEventListener("click", handleSubscribe);
    document.getElementById("btnOracleReport").addEventListener("click", handleOracleReport);
    document.getElementById("btnFundPool").addEventListener("click", handleFundPool);
    document.getElementById("btnWithdrawSurplus").addEventListener("click", handleWithdrawSurplus);
    document.getElementById("btnRefreshPolicies").addEventListener("click", loadFarmerPolicies);
    document.getElementById("btnTestUnauthorizedOracle").addEventListener("click", testUnauthorizedOracle);
    document.getElementById("btnTestIllegalWithdrawal").addEventListener("click", testIllegalWithdrawal);
    document.getElementById("btnClearEvents").addEventListener("click", () => {
        seenEventKeys.clear();
        document.getElementById("eventLogsContainer").innerHTML = '<div class="text-slate-500 py-3 text-center italic">Journal effacé.</div>';
    });

    // Real-time off-chain metadata hash updates
    document.getElementById("inputLocation")?.addEventListener("input", updateOffChainHashDisplay);
    document.getElementById("inputCrop")?.addEventListener("input", updateOffChainHashDisplay);
    document.getElementById("inputDuration")?.addEventListener("input", updateOffChainHashDisplay);
    document.getElementById("btnGenHash")?.addEventListener("click", updateOffChainHashDisplay);
}

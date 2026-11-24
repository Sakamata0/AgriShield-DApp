// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgriShield - Parametric Agricultural Micro-Insurance
 * @notice Autonomous weather-triggered drought and heat insurance for smallholder farmers.
 * @dev Eliminates human adjusters and delays via verified Oracle triggers and smart escrow.
 */
contract AgriShield {
    // ==========================================
    // ENUMS & STRUCTS
    // ==========================================

    enum PolicyStatus {
        Inactive,       // 0: Policy not yet purchased
        Active,         // 1: Premium paid, coverage ongoing
        ClaimPaid,      // 2: Trigger condition met, indemnification paid to farmer
        Expired         // 3: Coverage period elapsed without disaster, funds unclaimable
    }

    enum RiskType {
        Drought,        // Triggered when rainfall is below threshold (e.g. < 20 mm)
        Heatwave        // Triggered when temperature exceeds threshold (e.g. > 42 °C)
    }

    struct Policy {
        uint256 id;
        address payable farmer;
        string farmLocation;      // e.g. "Kairouan - Parcelle B4"
        string cropType;          // e.g. "Blé dur / Céréales"
        RiskType riskType;
        uint256 threshold;        // Rainfall in mm (e.g. 20) or Temp in °C (e.g. 42)
        uint256 premiumAmount;    // Amount paid by farmer (in wei)
        uint256 payoutAmount;     // Payout received in case of disaster (in wei)
        uint256 startTime;
        uint256 duration;         // Duration in seconds
        PolicyStatus status;
        string ipfsMetadataHash;  // Off-chain parcel deed / satellite zone hash
    }

    // ==========================================
    // STATE VARIABLES
    // ==========================================

    address public immutable insurerAdmin;
    address public weatherOracle;

    uint256 public nextPolicyId = 1;
    uint256 public totalLiquidityPool;
    uint256 public totalLockedPayouts;

    // Mapping: policyId => Policy details
    mapping(uint256 => Policy) public policies;

    // List of policy IDs associated with a specific farmer address
    mapping(address => uint256[]) public farmerPolicies;

    // Reentrancy guard state
    uint8 private _unlocked = 1;

    // ==========================================
    // EVENTS
    // ==========================================

    event PoolFunded(address indexed insurer, uint256 amount, uint256 newTotalPool);
    event PolicySubscribed(
        uint256 indexed policyId,
        address indexed farmer,
        RiskType riskType,
        uint256 threshold,
        uint256 premium,
        uint256 payout,
        uint256 expirationTime
    );
    event WeatherReported(
        uint256 indexed policyId,
        string location,
        uint256 recordedValue,
        bool triggerMet
    );
    event ClaimPaid(
        uint256 indexed policyId,
        address indexed farmer,
        uint256 amountPaid,
        uint256 timestamp
    );
    event PolicyExpired(uint256 indexed policyId, uint256 timestamp);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event InsurerWithdrawal(address indexed insurer, uint256 amount);

    // ==========================================
    // MODIFIERS
    // ==========================================

    modifier onlyInsurer() {
        require(msg.sender == insurerAdmin, "AgriShield: Only Insurer Admin allowed");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == weatherOracle, "AgriShield: Only authorized Weather Oracle allowed");
        _;
    }

    modifier nonReentrant() {
        require(_unlocked == 1, "AgriShield: Reentrancy protection");
        _unlocked = 0;
        _;
        _unlocked = 1;
    }

    // ==========================================
    // CONSTRUCTOR
    // ==========================================

    /**
     * @notice Initializes the AgriShield contract.
     * @param _weatherOracle Address of the automated weather oracle / bot.
     */
    constructor(address _weatherOracle) payable {
        require(_weatherOracle != address(0), "AgriShield: Invalid oracle address");
        insurerAdmin = msg.sender;
        weatherOracle = _weatherOracle;

        if (msg.value > 0) {
            totalLiquidityPool += msg.value;
            emit PoolFunded(msg.sender, msg.value, totalLiquidityPool);
        }
    }

    // ==========================================
    // INSURER ACTIONS (Liquidity Pool & Config)
    // ==========================================

    /**
     * @notice Insurer deposits capital into the escrow pool to back payout guarantees.
     */
    function fundLiquidityPool() external payable onlyInsurer {
        require(msg.value > 0, "AgriShield: Must send ETH to fund pool");
        totalLiquidityPool += msg.value;
        emit PoolFunded(msg.sender, msg.value, totalLiquidityPool);
    }

    /**
     * @notice Allows changing the oracle address if updated.
     */
    function updateOracle(address _newOracle) external onlyInsurer {
        require(_newOracle != address(0), "AgriShield: Invalid oracle address");
        emit OracleUpdated(weatherOracle, _newOracle);
        weatherOracle = _newOracle;
    }

    /**
     * @notice Allows insurer to withdraw surplus funds (funds not locked in active policies).
     * @param _amount Amount of wei to withdraw.
     */
    function withdrawSurplus(uint256 _amount) external onlyInsurer nonReentrant {
        uint256 freeLiquidity = totalLiquidityPool > totalLockedPayouts 
            ? totalLiquidityPool - totalLockedPayouts 
            : 0;
        require(_amount <= freeLiquidity, "AgriShield: Insufficient free liquidity (funds locked in active policies)");

        totalLiquidityPool -= _amount;
        (bool success, ) = insurerAdmin.call{value: _amount}("");
        require(success, "AgriShield: ETH transfer failed");

        emit InsurerWithdrawal(insurerAdmin, _amount);
    }

    // ==========================================
    // FARMER ACTIONS (Subscription)
    // ==========================================

    /**
     * @notice Farmer buys a micro-insurance policy by paying the required premium.
     * @param _farmLocation Geographic location / parcel reference.
     * @param _cropType Crop cultivated.
     * @param _riskType Drought (0) or Heatwave (1).
     * @param _threshold Trigger value (e.g. 20 for rainfall < 20mm, or 42 for temp > 42°C).
     * @param _payoutAmount Promised compensation in case of disaster.
     * @param _durationInDays Coverage duration in days.
     * @param _ipfsMetadataHash IPFS CID containing parcel deed, photo, off-chain coords.
     */
    function subscribePolicy(
        string calldata _farmLocation,
        string calldata _cropType,
        RiskType _riskType,
        uint256 _threshold,
        uint256 _payoutAmount,
        uint256 _durationInDays,
        string calldata _ipfsMetadataHash
    ) external payable returns (uint256) {
        require(msg.value > 0, "AgriShield: Premium must be > 0");
        require(_payoutAmount > msg.value, "AgriShield: Payout must exceed premium");
        require(_durationInDays > 0, "AgriShield: Duration must be at least 1 day");

        // Solvency check: ensure pool has enough liquidity to back this policy payout
        uint256 requiredPool = totalLockedPayouts + _payoutAmount;
        require(
            address(this).balance >= requiredPool,
            "AgriShield: Insurer liquidity pool insufficient to underwrite this policy"
        );

        uint256 policyId = nextPolicyId++;
        uint256 durationSecs = _durationInDays * 1 days;

        policies[policyId] = Policy({
            id: policyId,
            farmer: payable(msg.sender),
            farmLocation: _farmLocation,
            cropType: _cropType,
            riskType: _riskType,
            threshold: _threshold,
            premiumAmount: msg.value,
            payoutAmount: _payoutAmount,
            startTime: block.timestamp,
            duration: durationSecs,
            status: PolicyStatus.Active,
            ipfsMetadataHash: _ipfsMetadataHash
        });

        // Update state
        totalLiquidityPool += msg.value;
        totalLockedPayouts += _payoutAmount;
        farmerPolicies[msg.sender].push(policyId);

        emit PolicySubscribed(
            policyId,
            msg.sender,
            _riskType,
            _threshold,
            msg.value,
            _payoutAmount,
            block.timestamp + durationSecs
        );

        return policyId;
    }

    // ==========================================
    // ORACLE ACTIONS (Autonomous Trigger)
    // ==========================================

    /**
     * @notice Called autonomously by the Weather Oracle with verified environmental readings.
     * @dev If the value breaches the parametric threshold, the smart contract pays the farmer instantly.
     * @param _policyId Policy identifier.
     * @param _recordedValue Weather metric (e.g. 12 mm for rainfall, or 45 °C for temp).
     */
    function reportWeatherData(
        uint256 _policyId,
        uint256 _recordedValue
    ) external onlyOracle nonReentrant {
        Policy storage p = policies[_policyId];
        require(p.status == PolicyStatus.Active, "AgriShield: Policy is not active");

        // Check if policy has expired
        if (block.timestamp > p.startTime + p.duration) {
            p.status = PolicyStatus.Expired;
            totalLockedPayouts -= p.payoutAmount;
            emit PolicyExpired(_policyId, block.timestamp);
            return;
        }

        bool triggerConditionMet = false;

        if (p.riskType == RiskType.Drought) {
            // Drought triggered if recorded rainfall <= threshold (e.g. 10mm <= 20mm)
            if (_recordedValue <= p.threshold) {
                triggerConditionMet = true;
            }
        } else if (p.riskType == RiskType.Heatwave) {
            // Heatwave triggered if recorded temperature >= threshold (e.g. 45°C >= 42°C)
            if (_recordedValue >= p.threshold) {
                triggerConditionMet = true;
            }
        }

        emit WeatherReported(_policyId, p.farmLocation, _recordedValue, triggerConditionMet);

        if (triggerConditionMet) {
            p.status = PolicyStatus.ClaimPaid;
            totalLockedPayouts -= p.payoutAmount;
            totalLiquidityPool -= p.payoutAmount;

            // Immediate autonomous transfer to the farmer (No paper claim required)
            (bool success, ) = p.farmer.call{value: p.payoutAmount}("");
            require(success, "AgriShield: Claim transfer to farmer failed");

            emit ClaimPaid(_policyId, p.farmer, p.payoutAmount, block.timestamp);
        }
    }

    /**
     * @notice Marks a policy as expired once its duration has passed without disaster.
     * @dev Frees up the locked escrow funds back to the pool. Anyone can call this.
     */
    function checkExpiration(uint256 _policyId) external {
        Policy storage p = policies[_policyId];
        require(p.status == PolicyStatus.Active, "AgriShield: Policy not active");
        require(block.timestamp > p.startTime + p.duration, "AgriShield: Policy duration has not elapsed yet");

        p.status = PolicyStatus.Expired;
        totalLockedPayouts -= p.payoutAmount;

        emit PolicyExpired(_policyId, block.timestamp);
    }

    // ==========================================
    // GETTERS & UTILITIES
    // ==========================================

    function getFarmerPolicies(address _farmer) external view returns (uint256[] memory) {
        return farmerPolicies[_farmer];
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {
        totalLiquidityPool += msg.value;
        emit PoolFunded(msg.sender, msg.value, totalLiquidityPool);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/AgriShield.sol";

/**
 * @title AgriShieldTest
 * @notice Automated test suite for AgriShield validating all nominal and security scenarios.
 * @dev Can be run directly inside Remix IDE (Remix Tests plugin) or as a test runner.
 */
contract AgriShieldTest {
    AgriShield public agriShield;
    address public oracleAccount;
    address public farmerAccount;

    // Receive ETH to test transfers
    receive() external payable {}

    function beforeEach() public {
        oracleAccount = address(0x1111111111111111111111111111111111111111);
        farmerAccount = address(0x2222222222222222222222222222222222222222);

        // Deploy AgriShield with this contract as Insurer and initial pool of 2 ETH
        agriShield = new AgriShield{value: 2 ether}(oracleAccount);
    }

    /// @notice Test 1: Check initial pool balance and role configuration
    function testInitialState() public {
        require(agriShield.totalLiquidityPool() == 2 ether, "Initial pool must be 2 ETH");
        require(agriShield.insurerAdmin() == address(this), "Insurer should be this test contract");
        require(agriShield.weatherOracle() == oracleAccount, "Oracle address should match");
    }

    /// @notice Test 2: Farmer successfully subscribes to drought micro-policy
    function testSubscribePolicySuccess() public {
        // Subscribe with 0.05 ETH premium and 0.5 ETH payout
        uint256 policyId = agriShield.subscribePolicy{value: 0.05 ether}(
            "Siliana - Parcelle Nord",
            "Ble Dur",
            AgriShield.RiskType.Drought,
            20,             // Threshold: <= 20mm
            0.5 ether,      // Payout
            30,             // Duration 30 days
            "QmTestIPFSHash123"
        );

        require(policyId == 1, "First policy ID must be 1");
        require(agriShield.totalLockedPayouts() == 0.5 ether, "Locked payout must be 0.5 ETH");
    }

    /// @notice Test 3: Solvency check rejection if insurer pool cannot cover payout
    function testSolvencyRejection() public {
        // Attempt to subscribe with payout of 5 ETH while pool only has 2 ETH
        try agriShield.subscribePolicy{value: 0.05 ether}(
            "Zaghouan",
            "Olivier",
            AgriShield.RiskType.Drought,
            15,
            5 ether, // Exceeds pool balance
            30,
            "QmTest"
        ) {
            revert("Should have failed due to pool insolvency");
        } catch Error(string memory reason) {
            // Success: EVM reverted with solvency error
            require(bytes(reason).length > 0, "Expected revert string");
        }
    }
}

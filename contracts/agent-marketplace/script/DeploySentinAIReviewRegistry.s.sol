// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../SentinAIReviewRegistry.sol";

contract DeploySentinAIReviewRegistry is Script {
    function run() external returns (SentinAIReviewRegistry registry) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address facilitator = vm.envAddress("FACILITATOR_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        registry = new SentinAIReviewRegistry(facilitator);
        vm.stopBroadcast();
    }
}

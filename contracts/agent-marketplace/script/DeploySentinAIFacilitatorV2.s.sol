// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../SentinAIFacilitatorV2.sol";

contract DeploySentinAIFacilitatorV2 is Script {
    function deploy(address tonToken) public returns (SentinAIFacilitatorV2 facilitator) {
        facilitator = new SentinAIFacilitatorV2(tonToken);
    }

    function run() external returns (SentinAIFacilitatorV2 facilitator) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address tonToken = vm.envAddress("TON_TOKEN_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        facilitator = deploy(tonToken);
        vm.stopBroadcast();
    }
}

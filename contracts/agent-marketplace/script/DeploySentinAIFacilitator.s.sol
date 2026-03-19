// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../SentinAIFacilitator.sol";

contract DeploySentinAIFacilitator is Script {
    function deploy(address tonToken) public returns (SentinAIFacilitator facilitator) {
        facilitator = new SentinAIFacilitator(tonToken);
    }

    function run() external returns (SentinAIFacilitator facilitator) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address tonToken = vm.envAddress("TON_TOKEN_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        facilitator = deploy(tonToken);
        vm.stopBroadcast();
    }
}

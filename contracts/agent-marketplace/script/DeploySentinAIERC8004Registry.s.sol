// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../SentinAIERC8004Registry.sol";

contract DeploySentinAIERC8004Registry is Script {
    function deploy() public returns (SentinAIERC8004Registry registry) {
        registry = new SentinAIERC8004Registry();
    }

    function run() external returns (SentinAIERC8004Registry registry) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        registry = deploy();
        vm.stopBroadcast();
    }
}

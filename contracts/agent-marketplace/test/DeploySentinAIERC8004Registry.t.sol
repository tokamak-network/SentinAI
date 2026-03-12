// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../SentinAIERC8004Registry.sol";
import "../script/DeploySentinAIERC8004Registry.s.sol";

contract DeploySentinAIERC8004RegistryTest is Test {
    function test_deploy_returnsFreshRegistryInstance() public {
        DeploySentinAIERC8004Registry script = new DeploySentinAIERC8004Registry();

        SentinAIERC8004Registry registry = script.deploy();

        assertTrue(address(registry) != address(0));
        assertEq(registry.nextAgentId(), 1);
        assertEq(registry.MAX_AGENT_URI_LENGTH(), 512);
    }
}

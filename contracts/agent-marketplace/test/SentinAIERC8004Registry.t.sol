// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../SentinAIERC8004Registry.sol";

contract SentinAIERC8004RegistryTest is Test {
    SentinAIERC8004Registry internal registry;

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed agent,
        string agentURI
    );

    event Register(address indexed agent, string agentURI);

    function setUp() public {
        registry = new SentinAIERC8004Registry();
    }

    function test_register_assignsMonotonicAgentIdAndStoresLatestRegistration() public {
        uint256 firstAgentId = registry.register("https://sentinai.example.com/api/agent-marketplace/agent.json");
        uint256 secondAgentId = registry.register("https://sentinai.example.com/api/agent-marketplace/agent-v2.json");

        assertEq(firstAgentId, 1);
        assertEq(secondAgentId, 2);
        assertEq(registry.nextAgentId(), 3);
        assertEq(registry.agentOwnerOf(2), address(this));
        assertEq(registry.agentUriOf(2), "https://sentinai.example.com/api/agent-marketplace/agent-v2.json");
        assertEq(registry.latestAgentIdOf(address(this)), 2);
    }

    function test_register_emitsCanonicalAndLegacyEvents() public {
        string memory agentURI = "https://sentinai.example.com/api/agent-marketplace/agent.json";

        vm.expectEmit(true, true, false, true);
        emit AgentRegistered(1, address(this), agentURI);
        vm.expectEmit(true, false, false, true);
        emit Register(address(this), agentURI);

        registry.register(agentURI);
    }

    function test_register_revertsOnEmptyAgentUri() public {
        vm.expectRevert(SentinAIERC8004Registry.EmptyAgentURI.selector);
        registry.register("");
    }

    function test_register_revertsWhenAgentUriExceedsLimit() public {
        string memory longUri = new string(513);

        vm.expectRevert(
            abi.encodeWithSelector(
                SentinAIERC8004Registry.AgentUriTooLong.selector,
                513,
                registry.MAX_AGENT_URI_LENGTH()
            )
        );
        registry.register(longUri);
    }
}

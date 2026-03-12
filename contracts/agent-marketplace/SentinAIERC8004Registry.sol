// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SentinAIERC8004Registry
/// @notice Minimal permissionless registry for Phase 1 agent marketplace discovery.
/// @dev This contract keeps append-only registrations and emits both a canonical
///      event and a legacy-compatible event so the current app can migrate
///      cleanly to the deployed ABI.
contract SentinAIERC8004Registry {
    error EmptyAgentURI();
    error AgentUriTooLong(uint256 length, uint256 maxLength);

    uint256 public constant MAX_AGENT_URI_LENGTH = 512;

    uint256 public nextAgentId = 1;

    mapping(uint256 => address) public agentOwnerOf;
    mapping(uint256 => string) public agentUriOf;
    mapping(address => uint256) public latestAgentIdOf;

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed agent,
        string agentURI
    );

    event Register(address indexed agent, string agentURI);

    /// @notice Registers a marketplace agent manifest URI for the caller.
    /// @param agentURI The metadata endpoint, expected off-chain to resolve to
    ///        the caller's `/api/agent-marketplace/agent.json`.
    /// @return agentId The newly assigned monotonic registry identifier.
    function register(string calldata agentURI) external returns (uint256 agentId) {
        uint256 uriLength = bytes(agentURI).length;
        if (uriLength == 0) {
            revert EmptyAgentURI();
        }
        if (uriLength > MAX_AGENT_URI_LENGTH) {
            revert AgentUriTooLong(uriLength, MAX_AGENT_URI_LENGTH);
        }

        agentId = nextAgentId;
        nextAgentId = agentId + 1;

        agentOwnerOf[agentId] = msg.sender;
        agentUriOf[agentId] = agentURI;
        latestAgentIdOf[msg.sender] = agentId;

        emit AgentRegistered(agentId, msg.sender, agentURI);
        emit Register(msg.sender, agentURI);
    }
}

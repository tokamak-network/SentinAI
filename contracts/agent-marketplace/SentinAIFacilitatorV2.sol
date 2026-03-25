// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title SentinAIFacilitatorV2
/// @notice Trustless x402 payment settlement for SeigToken (TON) using approveAndCall pattern.
/// @dev SeigToken restricts transferFrom to msg.sender == from || msg.sender == to.
///      This contract implements onApprove() to receive tokens from buyer (as recipient),
///      then forwards to merchant (as sender). Two-hop transfer satisfies SeigToken rules.
///
///      Flow: Buyer calls TON.approveAndCall(Facilitator, amount, settleData)
///        1. TON approves Facilitator
///        2. TON calls Facilitator.onApprove(buyer, Facilitator, amount, settleData)
///        3. Facilitator: transferFrom(buyer → Facilitator) ✅ (Facilitator = recipient)
///        4. Facilitator: transfer(Facilitator → merchant)  ✅ (Facilitator = sender)
contract SentinAIFacilitatorV2 {
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant PAYMENT_AUTHORIZATION_TYPEHASH = keccak256(
        "PaymentAuthorization(address buyer,address merchant,address asset,"
        "uint256 amount,string resource,bytes32 nonce,uint256 validAfter,uint256 validBefore)"
    );

    IERC20 public immutable tonToken;
    address public immutable owner;

    mapping(bytes32 => bool) public usedNonces;

    event Settled(
        bytes32 indexed nonce,
        address indexed buyer,
        address indexed merchant,
        uint256 amount,
        string resource
    );

    constructor(address _tonToken) {
        tonToken = IERC20(_tonToken);
        owner = msg.sender;
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("SentinAI x402 TON Facilitator"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    /// @notice Called by TON contract during approveAndCall.
    /// @dev Decodes settlement parameters from data, verifies EIP-712 signature,
    ///      then executes two-hop transfer: buyer → this → merchant.
    /// @param sender The buyer who called approveAndCall
    /// @param amount Amount of TON approved and to be transferred
    /// @param data ABI-encoded settlement parameters
    /// @return true on success
    function onApprove(
        address sender,
        address, /* spender (this contract) */
        uint256 amount,
        bytes calldata data
    ) external returns (bool) {
        require(msg.sender == address(tonToken), "only TON");

        // Decode settlement parameters
        (
            address merchant,
            string memory resource,
            bytes32 nonce,
            uint256 validAfter,
            uint256 validBefore,
            bytes memory signature
        ) = abi.decode(data, (address, string, bytes32, uint256, uint256, bytes));

        // Validate timing
        require(block.timestamp >= validAfter, "not yet valid");
        require(block.timestamp <= validBefore, "expired");

        // Validate nonce
        require(!usedNonces[nonce], "nonce replay");
        usedNonces[nonce] = true;

        // Validate signature length
        require(signature.length == 65, "invalid signature length");

        // Verify EIP-712 signature
        bytes32 structHash = keccak256(abi.encode(
            PAYMENT_AUTHORIZATION_TYPEHASH,
            sender,      // buyer
            merchant,
            address(tonToken),
            amount,
            keccak256(bytes(resource)),
            nonce,
            validAfter,
            validBefore
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == sender, "invalid signature");

        // Two-hop transfer (SeigToken compatible):
        // 1. buyer → Facilitator (msg.sender = Facilitator = recipient ✅)
        require(tonToken.transferFrom(sender, address(this), amount), "transfer from buyer failed");
        // 2. Facilitator → merchant (msg.sender = Facilitator = sender ✅)
        require(tonToken.transfer(merchant, amount), "transfer to merchant failed");

        emit Settled(nonce, sender, merchant, amount, resource);
        return true;
    }

    /// @notice Legacy settle function for standard ERC20 tokens (non-SeigToken).
    /// @dev Kept for backward compatibility. Will revert with SeigToken.
    function settle(
        address buyer,
        address merchant,
        address asset,
        uint256 amount,
        string calldata resource,
        bytes32 nonce,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata signature
    ) external returns (bool) {
        require(asset == address(tonToken), "wrong asset");
        require(block.timestamp >= validAfter, "not yet valid");
        require(block.timestamp <= validBefore, "expired");
        require(!usedNonces[nonce], "nonce replay");
        require(signature.length == 65, "invalid signature length");

        usedNonces[nonce] = true;

        bytes32 structHash = keccak256(abi.encode(
            PAYMENT_AUTHORIZATION_TYPEHASH,
            buyer,
            merchant,
            asset,
            amount,
            keccak256(bytes(resource)),
            nonce,
            validAfter,
            validBefore
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(bytes1(signature[64]));

        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == buyer, "invalid signature");

        require(tonToken.transferFrom(buyer, merchant, amount), "transfer failed");

        emit Settled(nonce, buyer, merchant, amount, resource);
        return true;
    }
}

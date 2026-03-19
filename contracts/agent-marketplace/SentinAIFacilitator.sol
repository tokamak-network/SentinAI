// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title SentinAIFacilitator
/// @notice Trustless x402 payment settlement contract using EIP-712 signed authorizations.
/// @dev settle() verifies buyer's EIP-712 signature and atomically executes TON transferFrom.
///      Any caller can execute settlement — no relayer privilege required.
contract SentinAIFacilitator {
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

    /// @notice Settle a payment by verifying the buyer's EIP-712 signature and executing TON transfer.
    /// @param buyer The address that signed the payment authorization.
    /// @param merchant The recipient of the TON payment.
    /// @param asset Must equal tonToken address.
    /// @param amount Amount of TON (in smallest unit) to transfer.
    /// @param resource The canonicalized API resource path being purchased.
    /// @param nonce Unique nonce to prevent replay attacks.
    /// @param validAfter Timestamp after which the authorization is valid.
    /// @param validBefore Timestamp before which the authorization is valid.
    /// @param signature 65-byte ECDSA signature (r || s || v) from buyer over EIP-712 digest.
    /// @return true on success.
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

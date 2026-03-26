// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../SentinAIFacilitatorV2.sol";
import "../SentinAIReviewRegistry.sol";

/// @dev Mock SeigToken that restricts transferFrom to sender or recipient
contract MockSeigToken is Test {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    /// @dev SeigToken restriction: only sender or recipient can call transferFrom
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(msg.sender == from || msg.sender == to, "SeigToken: only sender or recipient can transfer");
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount || msg.sender == from, "insufficient allowance");
        balanceOf[from] -= amount;
        if (msg.sender != from) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[to] += amount;
        return true;
    }

    /// @dev Simulates TON's approveAndCall
    function approveAndCall(address spender, uint256 amount, bytes calldata data) external returns (bool) {
        allowance[msg.sender][spender] = amount;

        // Call onApprove on the spender
        (bool success, bytes memory ret) = spender.call(
            abi.encodeWithSignature(
                "onApprove(address,address,uint256,bytes)",
                msg.sender,  // owner/sender
                spender,     // spender
                amount,
                data
            )
        );
        require(success, "onApprove call failed");

        bool result = abi.decode(ret, (bool));
        require(result, "onApprove returned false");

        return true;
    }
}

contract SentinAIFacilitatorV2Test is Test {
    SentinAIFacilitatorV2 public facilitator;
    MockSeigToken public ton;

    uint256 internal buyerKey = 0xB0B;
    address internal buyer;
    address internal merchant = address(0xABCD);
    uint256 internal amount = 1000e18;

    function setUp() public {
        ton = new MockSeigToken();
        facilitator = new SentinAIFacilitatorV2(address(ton));
        buyer = vm.addr(buyerKey);
        ton.mint(buyer, amount * 10);
    }

    function _buildDigest(
        address _buyer,
        address _merchant,
        uint256 _amount,
        string memory _resource,
        bytes32 _nonce,
        uint256 _validAfter,
        uint256 _validBefore
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            facilitator.PAYMENT_AUTHORIZATION_TYPEHASH(),
            _buyer,
            _merchant,
            address(ton),
            _amount,
            keccak256(bytes(_resource)),
            _nonce,
            _validAfter,
            _validBefore
        ));
        return keccak256(abi.encodePacked("\x19\x01", facilitator.DOMAIN_SEPARATOR(), structHash));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _encodeSettleData(
        address _merchant,
        string memory _resource,
        bytes32 _nonce,
        uint256 _validAfter,
        uint256 _validBefore,
        bytes memory _signature
    ) internal pure returns (bytes memory) {
        return abi.encode(_merchant, _resource, _nonce, _validAfter, _validBefore, _signature);
    }

    function test_onApprove_twoHopTransfer() public {
        bytes32 nonce = keccak256("nonce-v2-1");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);
        bytes memory data = _encodeSettleData(merchant, resource, nonce, validAfter, validBefore, sig);

        uint256 buyerBefore = ton.balanceOf(buyer);
        uint256 merchantBefore = ton.balanceOf(merchant);

        // Buyer calls approveAndCall → triggers onApprove → two-hop transfer
        vm.prank(buyer);
        ton.approveAndCall(address(facilitator), amount, data);

        assertEq(ton.balanceOf(buyer), buyerBefore - amount, "buyer balance should decrease");
        assertEq(ton.balanceOf(merchant), merchantBefore + amount, "merchant balance should increase");
        assertEq(ton.balanceOf(address(facilitator)), 0, "facilitator should hold zero");
        assertTrue(facilitator.usedNonces(nonce), "nonce should be marked used");
    }

    function test_onApprove_emitsSettledEvent() public {
        bytes32 nonce = keccak256("nonce-v2-event");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);
        bytes memory data = _encodeSettleData(merchant, resource, nonce, validAfter, validBefore, sig);

        vm.expectEmit(true, true, true, true);
        emit SentinAIFacilitatorV2.Settled(nonce, buyer, merchant, amount, resource);

        vm.prank(buyer);
        ton.approveAndCall(address(facilitator), amount, data);
    }

    function test_onApprove_revertsOnNonceReplay() public {
        bytes32 nonce = keccak256("nonce-v2-replay");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);
        bytes memory data = _encodeSettleData(merchant, resource, nonce, validAfter, validBefore, sig);

        vm.prank(buyer);
        ton.approveAndCall(address(facilitator), amount, data);

        // Second call with same nonce should revert
        vm.prank(buyer);
        vm.expectRevert("onApprove call failed");
        ton.approveAndCall(address(facilitator), amount, data);
    }

    function test_onApprove_revertsOnExpired() public {
        vm.warp(10000);
        bytes32 nonce = keccak256("nonce-v2-expired");
        uint256 validAfter = block.timestamp - 7200;
        uint256 validBefore = block.timestamp - 1;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);
        bytes memory data = _encodeSettleData(merchant, resource, nonce, validAfter, validBefore, sig);

        vm.prank(buyer);
        vm.expectRevert("onApprove call failed");
        ton.approveAndCall(address(facilitator), amount, data);
    }

    function test_onApprove_revertsOnWrongSigner() public {
        bytes32 nonce = keccak256("nonce-v2-wrong");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, amount, resource, nonce, validAfter, validBefore);
        uint256 wrongKey = 0xDEAD;
        bytes memory sig = _sign(wrongKey, digest);
        bytes memory data = _encodeSettleData(merchant, resource, nonce, validAfter, validBefore, sig);

        vm.prank(buyer);
        vm.expectRevert("onApprove call failed");
        ton.approveAndCall(address(facilitator), amount, data);
    }

    function test_onApprove_revertsIfNotCalledByTon() public {
        bytes32 nonce = keccak256("nonce-v2-notton");
        bytes memory data = _encodeSettleData(merchant, "/api/test", nonce, 0, 99999999999, "");

        // Direct call to onApprove (not from TON) should revert
        vm.expectRevert("only TON");
        facilitator.onApprove(buyer, address(facilitator), amount, data);
    }

    function test_onApprove_revertsSelfTrade() public {
        // buyer == merchant → should revert
        bytes32 nonce = keccak256("nonce-self-trade");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, buyer, amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);
        bytes memory data = _encodeSettleData(buyer, resource, nonce, validAfter, validBefore, sig);

        vm.prank(buyer);
        vm.expectRevert("onApprove call failed");
        ton.approveAndCall(address(facilitator), amount, data);
    }

    function test_onApprove_autoRecordsTrade() public {
        // Set up ReviewRegistry
        SentinAIReviewRegistry registry = new SentinAIReviewRegistry(address(facilitator));
        facilitator.setReviewRegistry(address(registry));

        bytes32 nonce = keccak256("nonce-auto-trade");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/sequencer-health";

        bytes32 digest = _buildDigest(buyer, merchant, amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);
        bytes memory data = _encodeSettleData(merchant, resource, nonce, validAfter, validBefore, sig);

        vm.prank(buyer);
        ton.approveAndCall(address(facilitator), amount, data);

        // Verify trade was auto-recorded
        assertEq(registry.tradeCount(merchant), 1);
        assertEq(registry.totalTrades(), 1);
    }

    function test_onApprove_worksWithoutRegistry() public {
        // No registry set → should still settle successfully
        bytes32 nonce = keccak256("nonce-no-registry");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);
        bytes memory data = _encodeSettleData(merchant, resource, nonce, validAfter, validBefore, sig);

        uint256 merchantBefore = ton.balanceOf(merchant);

        vm.prank(buyer);
        ton.approveAndCall(address(facilitator), amount, data);

        assertEq(ton.balanceOf(merchant), merchantBefore + amount);
    }

    function test_onApprove_facilitatorHoldsZeroAfterSettle() public {
        // Ensure facilitator never accumulates tokens
        bytes32 nonce1 = keccak256("nonce-v2-zero-1");
        bytes32 nonce2 = keccak256("nonce-v2-zero-2");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        // First settlement
        bytes32 digest1 = _buildDigest(buyer, merchant, amount, resource, nonce1, validAfter, validBefore);
        bytes memory sig1 = _sign(buyerKey, digest1);
        vm.prank(buyer);
        ton.approveAndCall(address(facilitator), amount, _encodeSettleData(merchant, resource, nonce1, validAfter, validBefore, sig1));

        // Second settlement
        bytes32 digest2 = _buildDigest(buyer, merchant, amount, resource, nonce2, validAfter, validBefore);
        bytes memory sig2 = _sign(buyerKey, digest2);
        vm.prank(buyer);
        ton.approveAndCall(address(facilitator), amount, _encodeSettleData(merchant, resource, nonce2, validAfter, validBefore, sig2));

        assertEq(ton.balanceOf(address(facilitator)), 0, "facilitator must hold zero after settlements");
    }
}

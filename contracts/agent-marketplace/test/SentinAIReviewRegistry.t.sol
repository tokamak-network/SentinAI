// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../SentinAIReviewRegistry.sol";

contract MockFacilitator {
    mapping(bytes32 => bool) public usedNonces;

    function markNonceUsed(bytes32 nonce) external {
        usedNonces[nonce] = true;
    }
}

contract SentinAIReviewRegistryTest is Test {
    SentinAIReviewRegistry public registry;
    MockFacilitator public facilitator;

    address internal buyer = address(0xB0B);
    address internal operator = address(0xABCD);

    event ReviewSubmitted(
        address indexed reviewer,
        address indexed operator,
        bytes32 indexed settlementNonce,
        uint8 dataAccuracy,
        uint8 responseSpeed,
        uint8 uptime,
        uint8 valueForMoney,
        string comment
    );

    function setUp() public {
        facilitator = new MockFacilitator();
        registry = new SentinAIReviewRegistry(address(facilitator));
    }

    function test_submitReview_storesAndEmits() public {
        bytes32 nonce = keccak256("nonce-1");
        facilitator.markNonceUsed(nonce);

        vm.expectEmit(true, true, true, true);
        emit ReviewSubmitted(buyer, operator, nonce, 5, 4, 5, 4, "great data");

        vm.prank(buyer);
        registry.submitReview(operator, nonce, 5, 4, 5, 4, "great data");

        assertEq(registry.reviewCount(operator), 1);
        assertEq(registry.totalReviews(), 1);
        assertTrue(registry.reviewed(nonce));

        SentinAIReviewRegistry.Review memory r = registry.getOperatorReview(operator, 0);
        assertEq(r.reviewer, buyer);
        assertEq(r.operator, operator);
        assertEq(r.settlementNonce, nonce);
        assertEq(r.dataAccuracy, 5);
        assertEq(r.responseSpeed, 4);
        assertEq(r.uptime, 5);
        assertEq(r.valueForMoney, 4);
        assertEq(r.comment, "great data");
    }

    function test_submitReview_revertsIfNotSettled() public {
        bytes32 nonce = keccak256("nonce-not-settled");

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(SentinAIReviewRegistry.NotSettled.selector, nonce));
        registry.submitReview(operator, nonce, 5, 5, 5, 5, "");
    }

    function test_submitReview_revertsIfAlreadyReviewed() public {
        bytes32 nonce = keccak256("nonce-dup");
        facilitator.markNonceUsed(nonce);

        vm.prank(buyer);
        registry.submitReview(operator, nonce, 5, 5, 5, 5, "first");

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(SentinAIReviewRegistry.AlreadyReviewed.selector, nonce));
        registry.submitReview(operator, nonce, 5, 5, 5, 5, "second");
    }

    function test_submitReview_revertsOnInvalidRating() public {
        bytes32 nonce = keccak256("nonce-invalid");
        facilitator.markNonceUsed(nonce);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(SentinAIReviewRegistry.InvalidRating.selector, 0));
        registry.submitReview(operator, nonce, 0, 5, 5, 5, "");

        bytes32 nonce2 = keccak256("nonce-invalid-2");
        facilitator.markNonceUsed(nonce2);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(SentinAIReviewRegistry.InvalidRating.selector, 6));
        registry.submitReview(operator, nonce2, 6, 5, 5, 5, "");
    }

    function test_multipleReviewsForSameOperator() public {
        bytes32 nonce1 = keccak256("nonce-multi-1");
        bytes32 nonce2 = keccak256("nonce-multi-2");
        bytes32 nonce3 = keccak256("nonce-multi-3");
        facilitator.markNonceUsed(nonce1);
        facilitator.markNonceUsed(nonce2);
        facilitator.markNonceUsed(nonce3);

        vm.prank(buyer);
        registry.submitReview(operator, nonce1, 5, 5, 5, 5, "");

        vm.prank(address(0xCAFE));
        registry.submitReview(operator, nonce2, 3, 3, 3, 3, "average");

        vm.prank(address(0xDEAD));
        registry.submitReview(operator, nonce3, 1, 2, 1, 2, "poor");

        assertEq(registry.reviewCount(operator), 3);
        assertEq(registry.totalReviews(), 3);

        SentinAIReviewRegistry.Review memory r1 = registry.getOperatorReview(operator, 0);
        SentinAIReviewRegistry.Review memory r2 = registry.getOperatorReview(operator, 1);
        SentinAIReviewRegistry.Review memory r3 = registry.getOperatorReview(operator, 2);

        assertEq(r1.dataAccuracy, 5);
        assertEq(r2.dataAccuracy, 3);
        assertEq(r3.dataAccuracy, 1);
    }

    function test_differentOperators() public {
        address op2 = address(0x1234);
        bytes32 nonce1 = keccak256("nonce-op1");
        bytes32 nonce2 = keccak256("nonce-op2");
        facilitator.markNonceUsed(nonce1);
        facilitator.markNonceUsed(nonce2);

        vm.prank(buyer);
        registry.submitReview(operator, nonce1, 5, 5, 5, 5, "");

        vm.prank(buyer);
        registry.submitReview(op2, nonce2, 3, 3, 3, 3, "");

        assertEq(registry.reviewCount(operator), 1);
        assertEq(registry.reviewCount(op2), 1);
        assertEq(registry.totalReviews(), 2);
    }

    // ─── recordTrade tests ───

    function test_recordTrade_fromFacilitator() public {
        bytes32 nonce = keccak256("trade-1");
        facilitator.markNonceUsed(nonce);

        // Simulate facilitator calling recordTrade
        vm.prank(address(facilitator));
        registry.recordTrade(buyer, operator, 100e18, "/api/sequencer-health", nonce);

        assertEq(registry.tradeCount(operator), 1);
        assertEq(registry.totalTrades(), 1);
    }

    function test_recordTrade_revertsIfNotFacilitator() public {
        bytes32 nonce = keccak256("trade-unauthorized");

        vm.prank(buyer);
        vm.expectRevert(SentinAIReviewRegistry.OnlyFacilitator.selector);
        registry.recordTrade(buyer, operator, 100e18, "/api/test", nonce);
    }

    function test_recordTrade_multipleTrades() public {
        for (uint256 i = 0; i < 5; i++) {
            bytes32 nonce = keccak256(abi.encodePacked("trade-multi-", i));
            facilitator.markNonceUsed(nonce);

            vm.prank(address(facilitator));
            registry.recordTrade(buyer, operator, 100e18, "/api/test", nonce);
        }

        assertEq(registry.tradeCount(operator), 5);
        assertEq(registry.totalTrades(), 5);
    }

    // ─── existing tests ───

    function test_emptyComment() public {
        bytes32 nonce = keccak256("nonce-empty");
        facilitator.markNonceUsed(nonce);

        vm.prank(buyer);
        registry.submitReview(operator, nonce, 4, 4, 4, 4, "");

        SentinAIReviewRegistry.Review memory r = registry.getOperatorReview(operator, 0);
        assertEq(bytes(r.comment).length, 0);
    }
}

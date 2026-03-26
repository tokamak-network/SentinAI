// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFacilitator {
    function usedNonces(bytes32 nonce) external view returns (bool);
}

/// @title SentinAIReviewRegistry
/// @notice On-chain review registry for marketplace data purchases.
/// @dev Two types of reviews:
///      1. Auto-review: Settled event from Facilitator (trade proof, no extra tx)
///      2. Manual review: Buyer submits star ratings (separate tx, requires purchase proof)
///
///      Purchase proof: Facilitator.usedNonces(settlementNonce) must be true.
///      One manual review per settlement nonce (prevents spam).
contract SentinAIReviewRegistry {
    IFacilitator public immutable facilitator;

    struct Review {
        address reviewer;
        address operator;
        bytes32 settlementNonce;
        uint8 dataAccuracy;    // 1-5
        uint8 responseSpeed;   // 1-5
        uint8 uptime;          // 1-5
        uint8 valueForMoney;   // 1-5
        string comment;
        uint256 timestamp;
    }

    /// @dev nonce → reviewed (one review per purchase)
    mapping(bytes32 => bool) public reviewed;

    /// @dev operator → review count
    mapping(address => uint256) public reviewCount;

    /// @dev All reviews stored sequentially
    Review[] public allReviews;

    /// @dev operator → review indices in allReviews
    mapping(address => uint256[]) internal operatorReviewIndices;

    /// @dev Trade record (auto-recorded by Facilitator on settlement)
    struct TradeRecord {
        address buyer;
        address operator;
        uint256 amount;
        string resource;
        uint256 timestamp;
    }

    TradeRecord[] public allTrades;
    mapping(address => uint256) public tradeCount;
    mapping(address => uint256[]) internal operatorTradeIndices;

    event TradeRecorded(
        address indexed buyer,
        address indexed operator,
        uint256 amount,
        string resource,
        bytes32 indexed nonce
    );

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

    error NotSettled(bytes32 nonce);
    error AlreadyReviewed(bytes32 nonce);
    error InvalidRating(uint8 value);
    error OnlyFacilitator();

    constructor(address _facilitator) {
        facilitator = IFacilitator(_facilitator);
    }

    /// @notice Record a trade automatically (called by Facilitator during settlement)
    /// @dev Only callable by the Facilitator contract. No extra tx for buyer.
    function recordTrade(
        address buyer,
        address operator,
        uint256 amount,
        string calldata resource,
        bytes32 nonce
    ) external {
        if (msg.sender != address(facilitator)) revert OnlyFacilitator();

        uint256 idx = allTrades.length;
        allTrades.push(TradeRecord({
            buyer: buyer,
            operator: operator,
            amount: amount,
            resource: resource,
            timestamp: block.timestamp
        }));
        operatorTradeIndices[operator].push(idx);
        tradeCount[operator]++;

        emit TradeRecorded(buyer, operator, amount, resource, nonce);
    }

    /// @notice Get trade count for an operator
    function getTradeCount(address operator) external view returns (uint256) {
        return tradeCount[operator];
    }

    /// @notice Get total trades across all operators
    function totalTrades() external view returns (uint256) {
        return allTrades.length;
    }

    /// @notice Submit a review for a data purchase.
    /// @param operator The operator whose data was purchased
    /// @param settlementNonce The nonce from the Facilitator settlement (purchase proof)
    /// @param dataAccuracy Rating 1-5
    /// @param responseSpeed Rating 1-5
    /// @param uptime Rating 1-5
    /// @param valueForMoney Rating 1-5
    /// @param comment Optional text comment
    function submitReview(
        address operator,
        bytes32 settlementNonce,
        uint8 dataAccuracy,
        uint8 responseSpeed,
        uint8 uptime,
        uint8 valueForMoney,
        string calldata comment
    ) external {
        // Verify purchase happened on-chain
        if (!facilitator.usedNonces(settlementNonce)) {
            revert NotSettled(settlementNonce);
        }

        // One review per settlement
        if (reviewed[settlementNonce]) {
            revert AlreadyReviewed(settlementNonce);
        }

        // Validate ratings (1-5)
        if (dataAccuracy < 1 || dataAccuracy > 5) revert InvalidRating(dataAccuracy);
        if (responseSpeed < 1 || responseSpeed > 5) revert InvalidRating(responseSpeed);
        if (uptime < 1 || uptime > 5) revert InvalidRating(uptime);
        if (valueForMoney < 1 || valueForMoney > 5) revert InvalidRating(valueForMoney);

        reviewed[settlementNonce] = true;

        uint256 idx = allReviews.length;
        allReviews.push(Review({
            reviewer: msg.sender,
            operator: operator,
            settlementNonce: settlementNonce,
            dataAccuracy: dataAccuracy,
            responseSpeed: responseSpeed,
            uptime: uptime,
            valueForMoney: valueForMoney,
            comment: comment,
            timestamp: block.timestamp
        }));

        operatorReviewIndices[operator].push(idx);
        reviewCount[operator]++;

        emit ReviewSubmitted(
            msg.sender,
            operator,
            settlementNonce,
            dataAccuracy,
            responseSpeed,
            uptime,
            valueForMoney,
            comment
        );
    }

    /// @notice Get review count for an operator
    function getReviewCount(address operator) external view returns (uint256) {
        return reviewCount[operator];
    }

    /// @notice Get a specific review by index for an operator
    function getOperatorReview(address operator, uint256 index) external view returns (Review memory) {
        require(index < operatorReviewIndices[operator].length, "index out of bounds");
        return allReviews[operatorReviewIndices[operator][index]];
    }

    /// @notice Get total number of reviews across all operators
    function totalReviews() external view returns (uint256) {
        return allReviews.length;
    }
}

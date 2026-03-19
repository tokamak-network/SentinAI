// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../SentinAIFacilitator.sol";

contract MockERC20 is Test {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SentinAIFacilitatorTest is Test {
    SentinAIFacilitator public facilitator;
    MockERC20 public ton;

    uint256 internal buyerKey = 0xB0B;
    address internal buyer;
    address internal merchant = address(0xABCD);
    uint256 internal amount = 1000e18;

    function setUp() public {
        ton = new MockERC20();
        facilitator = new SentinAIFacilitator(address(ton));
        buyer = vm.addr(buyerKey);

        ton.mint(buyer, amount * 10);
        vm.prank(buyer);
        ton.approve(address(facilitator), type(uint256).max);
    }

    function _buildDigest(
        address _buyer,
        address _merchant,
        address _asset,
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
            _asset,
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

    function test_settle_validSignature() public {
        bytes32 nonce = keccak256("nonce-1");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);

        uint256 merchantBalanceBefore = ton.balanceOf(merchant);

        bool result = facilitator.settle(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore, sig);

        assertTrue(result);
        assertEq(ton.balanceOf(merchant), merchantBalanceBefore + amount);
        assertEq(ton.balanceOf(buyer), amount * 10 - amount);
        assertTrue(facilitator.usedNonces(nonce));
    }

    function test_settle_replayNonce() public {
        bytes32 nonce = keccak256("nonce-replay");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);

        facilitator.settle(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore, sig);

        // second call with same nonce must revert
        ton.mint(buyer, amount);
        vm.prank(buyer);
        ton.approve(address(facilitator), type(uint256).max);

        vm.expectRevert("nonce replay");
        facilitator.settle(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore, sig);
    }

    function test_settle_expired() public {
        vm.warp(10000); // ensure block.timestamp > 7200
        bytes32 nonce = keccak256("nonce-expired");
        uint256 validAfter = block.timestamp - 7200;
        uint256 validBefore = block.timestamp - 1; // already expired
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);

        vm.expectRevert("expired");
        facilitator.settle(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore, sig);
    }

    function test_settle_notYetValid() public {
        bytes32 nonce = keccak256("nonce-future");
        uint256 validAfter = block.timestamp + 3600; // in the future
        uint256 validBefore = block.timestamp + 7200;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);

        vm.expectRevert("not yet valid");
        facilitator.settle(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore, sig);
    }

    function test_settle_wrongSigner() public {
        bytes32 nonce = keccak256("nonce-wrong-signer");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        bytes32 digest = _buildDigest(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore);
        // sign with different key
        uint256 wrongKey = 0xDEAD;
        bytes memory sig = _sign(wrongKey, digest);

        vm.expectRevert("invalid signature");
        facilitator.settle(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore, sig);
    }

    function test_settle_insufficientAllowance() public {
        bytes32 nonce = keccak256("nonce-no-allowance");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";

        // revoke allowance
        vm.prank(buyer);
        ton.approve(address(facilitator), 0);

        bytes32 digest = _buildDigest(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);

        vm.expectRevert("insufficient allowance");
        facilitator.settle(buyer, merchant, address(ton), amount, resource, nonce, validAfter, validBefore, sig);
    }

    function test_settle_wrongAsset() public {
        bytes32 nonce = keccak256("nonce-wrong-asset");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        string memory resource = "/api/marketplace/data";
        address wrongAsset = address(0x1234);

        bytes32 digest = _buildDigest(buyer, merchant, wrongAsset, amount, resource, nonce, validAfter, validBefore);
        bytes memory sig = _sign(buyerKey, digest);

        vm.expectRevert("wrong asset");
        facilitator.settle(buyer, merchant, wrongAsset, amount, resource, nonce, validAfter, validBefore, sig);
    }
}

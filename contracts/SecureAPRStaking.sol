// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ConfidentialCoin} from "./ConfidentialCoin.sol";

contract SecureAPRStaking is ZamaEthereumConfig, ReentrancyGuard {
    uint256 public constant MICRO_ETH_WEI = 1e12;
    uint64 public constant CC_UNITS_PER_MICROETH_PER_DAY = 10;
    uint64 public constant SECONDS_PER_DAY = 86400;

    ConfidentialCoin public immutable cCoin;

    mapping(address user => euint64) private _stakedMicroEth;
    mapping(address user => uint64) private _lastAccrual;
    mapping(address user => euint64) private _pendingWithdraw;
    mapping(euint64 encryptedStake => address user) private _withdrawRequests;

    event Staked(address indexed user, uint256 amountWei);
    event InterestClaimed(address indexed user, euint64 mintedAmount);
    event WithdrawRequested(address indexed user, euint64 encryptedStakedMicroEth);
    event WithdrawFinalized(address indexed user, uint64 stakedMicroEth, uint256 amountWei);

    error PendingWithdraw(address user);
    error InvalidAmount(uint256 amountWei);
    error NoStake(address user);
    error WithdrawAlreadyRequested(address user);
    error InvalidWithdrawRequest(euint64 encryptedStake);
    error TransferFailed(address to, uint256 amountWei);

    constructor(address cCoin_) {
        require(cCoin_ != address(0));
        cCoin = ConfidentialCoin(cCoin_);
    }

    receive() external payable {
        revert InvalidAmount(msg.value);
    }

    function getEncryptedStakedMicroEth(address user) external view returns (euint64) {
        return _stakedMicroEth[user];
    }

    function getLastAccrual(address user) external view returns (uint64) {
        return _lastAccrual[user];
    }

    function getPendingWithdrawCipher(address user) external view returns (euint64) {
        return _pendingWithdraw[user];
    }

    function stake() external payable {
        _requireNoPendingWithdraw(msg.sender);
        if (msg.value == 0 || msg.value % MICRO_ETH_WEI != 0) revert InvalidAmount(msg.value);

        _accrueInterest(msg.sender);

        uint64 depositMicroEth = uint64(msg.value / MICRO_ETH_WEI);
        euint64 newStaked = FHE.add(_stakedMicroEth[msg.sender], FHE.asEuint64(depositMicroEth));
        FHE.allowThis(newStaked);
        FHE.allow(newStaked, msg.sender);
        _stakedMicroEth[msg.sender] = newStaked;

        _lastAccrual[msg.sender] = uint64(block.timestamp);
        emit Staked(msg.sender, msg.value);
    }

    function claimInterest() external {
        _requireNoPendingWithdraw(msg.sender);
        _accrueInterest(msg.sender);
    }

    function requestWithdrawAll() external {
        _requireNoPendingWithdraw(msg.sender);
        _accrueInterest(msg.sender);

        euint64 staked = _stakedMicroEth[msg.sender];
        if (!FHE.isInitialized(staked)) revert NoStake(msg.sender);
        if (_withdrawRequests[staked] != address(0)) revert WithdrawAlreadyRequested(msg.sender);

        FHE.makePubliclyDecryptable(staked);
        _withdrawRequests[staked] = msg.sender;
        _pendingWithdraw[msg.sender] = staked;

        emit WithdrawRequested(msg.sender, staked);
    }

    function finalizeWithdrawAll(
        euint64 encryptedStakedMicroEth,
        uint64 stakedMicroEthCleartext,
        bytes calldata decryptionProof
    ) external nonReentrant {
        address user = _withdrawRequests[encryptedStakedMicroEth];
        if (user == address(0) || user != msg.sender) revert InvalidWithdrawRequest(encryptedStakedMicroEth);
        if (euint64.unwrap(_pendingWithdraw[user]) != euint64.unwrap(encryptedStakedMicroEth)) {
            revert InvalidWithdrawRequest(encryptedStakedMicroEth);
        }

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint64.unwrap(encryptedStakedMicroEth);

        FHE.checkSignatures(handles, abi.encode(stakedMicroEthCleartext), decryptionProof);

        delete _withdrawRequests[encryptedStakedMicroEth];
        _pendingWithdraw[user] = euint64.wrap(bytes32(0));
        _stakedMicroEth[user] = euint64.wrap(bytes32(0));
        _lastAccrual[user] = 0;

        uint256 amountWei = uint256(stakedMicroEthCleartext) * MICRO_ETH_WEI;
        (bool ok,) = user.call{value: amountWei}("");
        if (!ok) revert TransferFailed(user, amountWei);

        emit WithdrawFinalized(user, stakedMicroEthCleartext, amountWei);
    }

    function _requireNoPendingWithdraw(address user) internal view {
        if (FHE.isInitialized(_pendingWithdraw[user])) revert PendingWithdraw(user);
    }

    function _accrueInterest(address user) internal {
        euint64 staked = _stakedMicroEth[user];
        uint64 last = _lastAccrual[user];
        uint64 nowTs = uint64(block.timestamp);

        if (!FHE.isInitialized(staked) || last == 0 || nowTs <= last) {
            _lastAccrual[user] = nowTs;
            return;
        }

        uint64 elapsed = nowTs - last;

        euint64 interest = FHE.mul(staked, CC_UNITS_PER_MICROETH_PER_DAY);
        interest = FHE.mul(interest, elapsed);
        interest = FHE.div(interest, SECONDS_PER_DAY);

        FHE.allowTransient(interest, address(cCoin));
        cCoin.mint(user, interest);
        _lastAccrual[user] = nowTs;
        emit InterestClaimed(user, interest);
    }
}

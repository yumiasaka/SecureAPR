// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {euint64} from "@fhevm/solidity/lib/FHE.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ConfidentialCoin is ERC7984, ZamaEthereumConfig, Ownable {
    address public minter;

    error UnauthorizedMinter(address caller);

    constructor() ERC7984("cCoin", "cCOIN", "") Ownable(msg.sender) {}

    function setMinter(address minter_) external onlyOwner {
        minter = minter_;
    }

    function mint(address to, euint64 amount) external returns (euint64 transferred) {
        if (msg.sender != minter) revert UnauthorizedMinter(msg.sender);
        transferred = _mint(to, amount);
    }
}

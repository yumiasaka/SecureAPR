import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

import { ConfidentialCoin, SecureAPRStaking } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
};

async function deployFixture() {
  const [deployer] = await ethers.getSigners();

  const coinFactory = await ethers.getContractFactory("ConfidentialCoin");
  const coin = (await coinFactory.connect(deployer).deploy()) as ConfidentialCoin;
  const coinAddress = await coin.getAddress();

  const stakingFactory = await ethers.getContractFactory("SecureAPRStaking");
  const staking = (await stakingFactory.connect(deployer).deploy(coinAddress)) as SecureAPRStaking;
  const stakingAddress = await staking.getAddress();

  await (await coin.connect(deployer).setMinter(stakingAddress)).wait();

  return { coin, coinAddress, staking, stakingAddress };
}

describe("SecureAPRStaking", function () {
  let signers: Signers;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }
  });

  it("stakes 1 ETH and tracks encrypted stake", async function () {
    const { staking, stakingAddress } = await deployFixture();

    await (await staking.connect(signers.alice).stake({ value: ethers.parseEther("1.0") })).wait();

    const encryptedStake = await staking.getEncryptedStakedMicroEth(signers.alice.address);
    expect(encryptedStake).to.not.eq(ethers.ZeroHash);

    const clearStakeMicroEth = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedStake,
      stakingAddress,
      signers.alice,
    );

    expect(clearStakeMicroEth).to.eq(1_000_000n);
  });

  it("mints 10 cCoin per 1 ETH per day (pro-rata)", async function () {
    const { coin, coinAddress, staking } = await deployFixture();

    await (await staking.connect(signers.alice).stake({ value: ethers.parseEther("1.0") })).wait();
    const lastAccrual = await staking.getLastAccrual(signers.alice.address);

    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);

    await (await staking.connect(signers.alice).claimInterest()).wait();
    const lastAccrualAfter = await staking.getLastAccrual(signers.alice.address);
    const elapsed = lastAccrualAfter - lastAccrual;
    const expected = (1_000_000n * 10n * elapsed) / 86_400n;

    const encryptedBal = await coin.confidentialBalanceOf(signers.alice.address);
    const clearBal = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedBal, coinAddress, signers.alice);
    expect(clearBal).to.eq(expected);
  });

  it("withdraws all staked ETH using public decryption proof", async function () {
    const { staking, stakingAddress } = await deployFixture();

    await (await staking.connect(signers.alice).stake({ value: ethers.parseEther("1.0") })).wait();

    const balBefore = await ethers.provider.getBalance(signers.alice.address);

    await (await staking.connect(signers.alice).requestWithdrawAll()).wait();
    const pending = await staking.getPendingWithdrawCipher(signers.alice.address);
    expect(pending).to.not.eq(ethers.ZeroHash);

    const decrypted = await fhevm.publicDecrypt([pending]);
    const clearStakeMicroEth = decrypted.clearValues[pending] as bigint;

    const tx = await staking
      .connect(signers.alice)
      .finalizeWithdrawAll(pending, clearStakeMicroEth, decrypted.decryptionProof);
    await tx.wait();

    const balAfter = await ethers.provider.getBalance(signers.alice.address);
    expect(balAfter).to.be.gt(balBefore);

    const encryptedStakeAfter = await staking.getEncryptedStakedMicroEth(signers.alice.address);
    expect(encryptedStakeAfter).to.eq(ethers.ZeroHash);

    expect(await ethers.provider.getBalance(stakingAddress)).to.eq(0n);
  });
});

import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:secureapr:addresses", "Prints the SecureAPR contract addresses").setAction(async function (
  _taskArguments: TaskArguments,
  hre,
) {
  const { deployments } = hre;
  const coin = await deployments.get("ConfidentialCoin");
  const staking = await deployments.get("SecureAPRStaking");
  console.log(`ConfidentialCoin: ${coin.address}`);
  console.log(`SecureAPRStaking: ${staking.address}`);
});

task("task:secureapr:stake", "Stake ETH into SecureAPRStaking")
  .addParam("eth", "Amount in ETH (ex: 0.1)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const staking = await deployments.get("SecureAPRStaking");
    const stakingContract = await ethers.getContractAt("SecureAPRStaking", staking.address);
    const [signer] = await ethers.getSigners();
    const value = ethers.parseEther(taskArguments.eth);
    const tx = await stakingContract.connect(signer).stake({ value });
    console.log(`Wait for tx:${tx.hash}...`);
    await tx.wait();
    console.log(`Staked ${taskArguments.eth} ETH`);
  });

task("task:secureapr:claim", "Claim interest (mints cCoin)")
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const staking = await deployments.get("SecureAPRStaking");
    const stakingContract = await ethers.getContractAt("SecureAPRStaking", staking.address);
    const [signer] = await ethers.getSigners();
    const tx = await stakingContract.connect(signer).claimInterest();
    console.log(`Wait for tx:${tx.hash}...`);
    await tx.wait();
    console.log(`Interest claimed`);
  });

task("task:secureapr:decrypt-stake", "Decrypt staked amount (microETH) for the active signer").setAction(async function (
  _taskArguments: TaskArguments,
  hre,
) {
  const { ethers, deployments, fhevm } = hre;
  await fhevm.initializeCLIApi();
  const staking = await deployments.get("SecureAPRStaking");
  const stakingContract = await ethers.getContractAt("SecureAPRStaking", staking.address);
  const [signer] = await ethers.getSigners();
  const encrypted = await stakingContract.getEncryptedStakedMicroEth(signer.address);
  if (encrypted === ethers.ZeroHash) {
    console.log(`Encrypted stake: ${encrypted}`);
    console.log(`Clear stake (microETH): 0`);
    return;
  }
  const clear = await fhevm.userDecryptEuint(FhevmType.euint64, encrypted, staking.address, signer);
  console.log(`Encrypted stake: ${encrypted}`);
  console.log(`Clear stake (microETH): ${clear}`);
});

task("task:secureapr:decrypt-ccoin", "Decrypt cCoin balance for the active signer").setAction(async function (
  _taskArguments: TaskArguments,
  hre,
) {
  const { ethers, deployments, fhevm } = hre;
  await fhevm.initializeCLIApi();
  const coin = await deployments.get("ConfidentialCoin");
  const coinContract = await ethers.getContractAt("ConfidentialCoin", coin.address);
  const [signer] = await ethers.getSigners();
  const encrypted = await coinContract.confidentialBalanceOf(signer.address);
  if (encrypted === ethers.ZeroHash) {
    console.log(`Encrypted cCoin balance: ${encrypted}`);
    console.log(`Clear cCoin balance (units): 0`);
    return;
  }
  const clear = await fhevm.userDecryptEuint(FhevmType.euint64, encrypted, coin.address, signer);
  console.log(`Encrypted cCoin balance: ${encrypted}`);
  console.log(`Clear cCoin balance (units): ${clear}`);
});

task("task:secureapr:request-withdraw", "Request withdrawal (starts public decryption flow)").setAction(async function (
  _taskArguments: TaskArguments,
  hre,
) {
  const { ethers, deployments } = hre;
  const staking = await deployments.get("SecureAPRStaking");
  const stakingContract = await ethers.getContractAt("SecureAPRStaking", staking.address);
  const [signer] = await ethers.getSigners();
  const tx = await stakingContract.connect(signer).requestWithdrawAll();
  console.log(`Wait for tx:${tx.hash}...`);
  await tx.wait();
  console.log(`Withdraw requested`);
});

task("task:secureapr:finalize-withdraw", "Finalize withdrawal using public decrypt proof").setAction(async function (
  _taskArguments: TaskArguments,
  hre,
) {
  const { ethers, deployments, fhevm } = hre;
  await fhevm.initializeCLIApi();
  const staking = await deployments.get("SecureAPRStaking");
  const stakingContract = await ethers.getContractAt("SecureAPRStaking", staking.address);
  const [signer] = await ethers.getSigners();

  const pending = await stakingContract.getPendingWithdrawCipher(signer.address);
  if (pending === ethers.ZeroHash) {
    console.log("No pending withdraw request.");
    return;
  }

  const decrypted = await fhevm.publicDecrypt([pending]);
  const clearMicroEth = decrypted.clearValues[pending] as bigint;

  const tx = await stakingContract.connect(signer).finalizeWithdrawAll(pending, clearMicroEth, decrypted.decryptionProof);
  console.log(`Wait for tx:${tx.hash}...`);
  await tx.wait();
  console.log("Withdraw finalized.");
});


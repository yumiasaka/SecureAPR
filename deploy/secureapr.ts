import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (hre.network.name === "sepolia" && !process.env.PRIVATE_KEY) {
    throw new Error(`Missing PRIVATE_KEY in .env (required for Sepolia deployment).`);
  }
  if (hre.network.name === "sepolia" && !process.env.INFURA_API_KEY) {
    throw new Error(`Missing INFURA_API_KEY in .env (required for Sepolia deployment).`);
  }

  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const { ethers } = hre;

  const coin = await deploy("ConfidentialCoin", {
    from: deployer,
    log: true,
  });

  const staking = await deploy("SecureAPRStaking", {
    from: deployer,
    args: [coin.address],
    log: true,
  });

  const signer = await ethers.getSigner(deployer);
  const coinContract = await ethers.getContractAt("ConfidentialCoin", coin.address, signer);
  const tx = await coinContract.setMinter(staking.address);
  await tx.wait();

  console.log(`ConfidentialCoin: ${coin.address}`);
  console.log(`SecureAPRStaking: ${staking.address}`);
};

export default func;
func.id = "deploy_secureapr";
func.tags = ["SecureAPR"];

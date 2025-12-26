import {  useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Contract, ethers } from 'ethers';

import { Header } from './Header';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { CCOIN_ABI, CCOIN_ADDRESS, STAKING_ABI, STAKING_ADDRESS } from '../config/contracts';
import '../styles/StakingApp.css';

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

function formatCcoinUnits(units: bigint) {
  const sign = units < 0n ? '-' : '';
  const abs = units < 0n ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${sign}${whole.toString()}.${frac}` : `${sign}${whole.toString()}`;
}

function microEthToEthString(microEth: bigint) {
  return (Number(microEth) / 1_000_000).toString();
}

export function StakingApp() {
  const { address, isConnected } = useAccount();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const signerPromise = useEthersSigner();

  const [stakeEth, setStakeEth] = useState('0.1');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [decryptedStakeMicroEth, setDecryptedStakeMicroEth] = useState<bigint | null>(null);
  const [decryptedCcoinUnits, setDecryptedCcoinUnits] = useState<bigint | null>(null);

  const isConfigured = true

  const stakeCipher = useReadContract({
    address: STAKING_ADDRESS,
    abi: STAKING_ABI as any,
    functionName: 'getEncryptedStakedMicroEth',
    args: [(address ) as `0x${string}`],
    query: { enabled: isConnected && isConfigured },
  });

  const pendingWithdrawCipher = useReadContract({
    address: STAKING_ADDRESS,
    abi: STAKING_ABI as any,
    functionName: 'getPendingWithdrawCipher',
    args: [(address ) as `0x${string}`],
    query: { enabled: isConnected && isConfigured },
  });

  const ccoinBalanceCipher = useReadContract({
    address: CCOIN_ADDRESS,
    abi: CCOIN_ABI as any,
    functionName: 'confidentialBalanceOf',
    args: [(address ) as `0x${string}`],
    query: { enabled: isConnected && isConfigured },
  });

  async function getSigner() {
    if (!signerPromise) throw new Error('Wallet not connected');
    return await signerPromise;
  }

  async function getStakingContract() {
    const signer = await getSigner();
    return new Contract(STAKING_ADDRESS, STAKING_ABI as any, signer);
  }

  async function userDecrypt(handle: string, contractAddress: string) {
    if (!instance) throw new Error('Encryption service not ready');
    if (!isConnected || !address) throw new Error('Wallet not connected');
    const signer = await getSigner();

    const keypair = instance.generateKeypair();
    const handleContractPairs = [{ handle, contractAddress }];

    const startTimeStamp = Math.floor(Date.now() / 1000).toString();
    const durationDays = '10';
    const contractAddresses = [contractAddress];

    const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);
    const signature = await signer.signTypedData(
      eip712.domain,
      {
        UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
      },
      eip712.message,
    );

    const result = await instance.userDecrypt(
      handleContractPairs,
      keypair.privateKey,
      keypair.publicKey,
      signature.replace('0x', ''),
      contractAddresses,
      await signer.getAddress(),
      startTimeStamp,
      durationDays,
    );

    return result[handle] as bigint;
  }

  async function onStake() {
    setError(null);
    setBusy('staking');
    try {
      const staking = await getStakingContract();
      const value = ethers.parseEther(stakeEth);
      const microUnit = 1_000_000_000_000n;
      if (value === 0n || value % microUnit !== 0n) {
        throw new Error('Amount must be a multiple of 0.000001 ETH');
      }

      const tx = await staking.stake({ value });
      await tx.wait();

      await Promise.all([
        stakeCipher.refetch(),
        ccoinBalanceCipher.refetch(),
        pendingWithdrawCipher.refetch(),
      ]);
    } catch (e) {
      setError((e as Error).message || 'Failed to stake');
    } finally {
      setBusy(null);
    }
  }

  async function onClaim() {
    setError(null);
    setBusy('claim');
    try {
      const staking = await getStakingContract();
      const tx = await staking.claimInterest();
      await tx.wait();
      await ccoinBalanceCipher.refetch();
    } catch (e) {
      setError((e as Error).message || 'Failed to claim');
    } finally {
      setBusy(null);
    }
  }

  async function onDecryptStake() {
    setError(null);
    setBusy('decryptStake');
    try {
      const handle = (stakeCipher.data as string | undefined) ?? ZERO_HASH;
      if (handle === ZERO_HASH) {
        setDecryptedStakeMicroEth(0n);
        return;
      }
      const clear = await userDecrypt(handle, STAKING_ADDRESS);
      setDecryptedStakeMicroEth(clear);
    } catch (e) {
      setError((e as Error).message || 'Failed to decrypt stake');
    } finally {
      setBusy(null);
    }
  }

  async function onDecryptCcoin() {
    setError(null);
    setBusy('decryptCcoin');
    try {
      const handle = (ccoinBalanceCipher.data as string | undefined) ?? ZERO_HASH;
      if (handle === ZERO_HASH) {
        setDecryptedCcoinUnits(0n);
        return;
      }
      const clear = await userDecrypt(handle, CCOIN_ADDRESS);
      setDecryptedCcoinUnits(clear);
    } catch (e) {
      setError((e as Error).message || 'Failed to decrypt balance');
    } finally {
      setBusy(null);
    }
  }

  async function onRequestWithdraw() {
    setError(null);
    setBusy('requestWithdraw');
    try {
      const staking = await getStakingContract();
      const tx = await staking.requestWithdrawAll();
      await tx.wait();
      await pendingWithdrawCipher.refetch();
    } catch (e) {
      setError((e as Error).message || 'Failed to request withdraw');
    } finally {
      setBusy(null);
    }
  }

  async function onFinalizeWithdraw() {
    setError(null);
    setBusy('finalizeWithdraw');
    try {
      if (!instance) throw new Error('Encryption service not ready');
      const staking = await getStakingContract();
      const handle = (pendingWithdrawCipher.data as string | undefined) ?? ZERO_HASH;
      if (handle === ZERO_HASH) throw new Error('No pending withdraw request');

      const decrypted = await instance.publicDecrypt([handle]);
      const clearMicroEth = decrypted.clearValues[handle] as bigint;

      const tx = await staking.finalizeWithdrawAll(handle, clearMicroEth, decrypted.decryptionProof);
      await tx.wait();

      setDecryptedStakeMicroEth(null);
      await Promise.all([stakeCipher.refetch(), pendingWithdrawCipher.refetch()]);
    } catch (e) {
      setError((e as Error).message || 'Failed to finalize withdraw');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="staking-app">
      <Header />
      <main className="staking-main">
        <div className="staking-container">
          {!isConfigured && (
            <div className="card warning">
              <div className="card-title">Contracts not configured</div>
              <div className="card-body">
                Deploy to Sepolia and run <code>npx hardhat task:sync-ui --networkName sepolia</code>.
              </div>
            </div>
          )}

          {zamaError && (
            <div className="card error">
              <div className="card-title">Encryption service error</div>
              <div className="card-body">{zamaError}</div>
            </div>
          )}

          {error && (
            <div className="card error">
              <div className="card-title">Error</div>
              <div className="card-body">{error}</div>
            </div>
          )}

          <div className="grid">
            <div className="card">
              <div className="card-title">Stake</div>
              <div className="card-body">
                <div className="row">
                  <label className="label" htmlFor="stakeEth">
                    Amount (ETH)
                  </label>
                  <input
                    id="stakeEth"
                    className="input"
                    value={stakeEth}
                    onChange={(e) => setStakeEth(e.target.value)}
                    placeholder="0.1"
                    inputMode="decimal"
                  />
                </div>
                <div className="actions">
                  <button
                    className="button primary"
                    disabled={!isConnected || zamaLoading || !isConfigured || busy !== null}
                    onClick={onStake}
                  >
                    {busy === 'staking' ? 'Staking...' : 'Stake ETH'}
                  </button>
                  <button
                    className="button"
                    disabled={!isConnected || zamaLoading || !isConfigured || busy !== null}
                    onClick={onClaim}
                  >
                    {busy === 'claim' ? 'Claiming...' : 'Claim interest'}
                  </button>
                </div>
                <div className="hint">Minimum precision: 0.000001 ETH</div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Balances</div>
              <div className="card-body">
                <div className="section">
                  <div className="section-title">Staked ETH (encrypted)</div>
                  <div className="mono">{(stakeCipher.data as string | undefined) ?? ZERO_HASH}</div>
                  <div className="actions">
                    <button
                      className="button"
                      disabled={!isConnected || zamaLoading || !instance || !isConfigured || busy !== null}
                      onClick={onDecryptStake}
                    >
                      {busy === 'decryptStake' ? 'Decrypting...' : 'Decrypt'}
                    </button>
                  </div>
                  <div className="value">
                    Clear: {decryptedStakeMicroEth === null ? '-' : `${microEthToEthString(decryptedStakeMicroEth)} ETH`}
                  </div>
                </div>

                <div className="section">
                  <div className="section-title">cCoin balance (encrypted)</div>
                  <div className="mono">{(ccoinBalanceCipher.data as string | undefined) ?? ZERO_HASH}</div>
                  <div className="actions">
                    <button
                      className="button"
                      disabled={!isConnected || zamaLoading || !instance || !isConfigured || busy !== null}
                      onClick={onDecryptCcoin}
                    >
                      {busy === 'decryptCcoin' ? 'Decrypting...' : 'Decrypt'}
                    </button>
                  </div>
                  <div className="value">
                    Clear: {decryptedCcoinUnits === null ? '-' : `${formatCcoinUnits(decryptedCcoinUnits)} cCoin`}
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Withdraw</div>
              <div className="card-body">
                <div className="section">
                  <div className="section-title">Pending withdraw handle</div>
                  <div className="mono">{(pendingWithdrawCipher.data as string | undefined) ?? ZERO_HASH}</div>
                  <div className="actions">
                    <button
                      className="button"
                      disabled={!isConnected || zamaLoading || !isConfigured || busy !== null}
                      onClick={onRequestWithdraw}
                    >
                      {busy === 'requestWithdraw' ? 'Requesting...' : 'Request withdraw'}
                    </button>
                    <button
                      className="button primary"
                      disabled={!isConnected || zamaLoading || !instance || !isConfigured || busy !== null}
                      onClick={onFinalizeWithdraw}
                    >
                      {busy === 'finalizeWithdraw' ? 'Finalizing...' : 'Finalize withdraw'}
                    </button>
                  </div>
                  <div className="hint">Finalize uses a public decryption proof to release ETH.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}


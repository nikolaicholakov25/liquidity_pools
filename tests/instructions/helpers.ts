import { BN, Program } from "@coral-xyz/anchor";
import { LiquidityPools } from "../../target/types/liquidity_pools";
import { ProgramTestContext } from "solana-bankrun";
import { MintLayout } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";

export async function addInitialLiquidity({
  context,
  program,
  poolCreator,
  mintA,
  mintB,
  pool_pda,
  lpMint_pda,
  poolTokenVaultA,
  poolTokenVaultB,
  amountA = 1_000_000,
  amountB = 1_000_000,
}: {
  context: ProgramTestContext;
  program: Program<LiquidityPools>;
  poolCreator: Keypair;
  mintA: PublicKey;
  mintB: PublicKey;
  pool_pda: PublicKey;
  lpMint_pda: PublicKey;
  poolTokenVaultA: PublicKey;
  poolTokenVaultB: PublicKey;
  amountA?: number;
  amountB?: number;
}) {
  let lpMintAccount = await context.banksClient.getAccount(lpMint_pda);
  let mintAAccount = await context.banksClient.getAccount(mintA);
  let mintBAccount = await context.banksClient.getAccount(mintB);
  let mintADecimals = MintLayout.decode(mintAAccount.data).decimals;
  let mintBDecimals = MintLayout.decode(mintBAccount.data).decimals;

  let amountADesired = new BN(amountA).mul(
    new BN(10).pow(new BN(mintADecimals))
  );
  let amountBDesired = new BN(amountB).mul(
    new BN(10).pow(new BN(mintBDecimals))
  ); // 1m tokens
  let amountAMin = amountADesired; // On initial deposit the desired amount is the min
  let amountBMin = amountBDesired; // On initial deposit the desired amount is the min

  const providerAtaLp = getAssociatedTokenAddressSync(
    lpMint_pda,
    poolCreator.publicKey,
    false,
    lpMintAccount.owner
  );

  const creatorTokenAAssociatedAccount = getAssociatedTokenAddressSync(
    mintA,
    poolCreator.publicKey,
    false,
    mintAAccount.owner
  );

  const creatorTokenBAssociatedAccount = getAssociatedTokenAddressSync(
    mintB,
    poolCreator.publicKey,
    false,
    mintBAccount.owner
  );

  const tx = await program.methods
    .addLiquidity(amountADesired, amountBDesired, amountAMin, amountBMin)
    .accountsStrict({
      provider: poolCreator.publicKey,
      providerAtaA: creatorTokenAAssociatedAccount,
      providerAtaB: creatorTokenBAssociatedAccount,
      providerAtaLp: providerAtaLp,
      pool: pool_pda,
      lpMint: lpMint_pda,
      poolAtaA: poolTokenVaultA,
      poolAtaB: poolTokenVaultB,
      tokenMintA: mintA,
      tokenMintB: mintB,
      tokenProgramA: mintAAccount.owner,
      tokenProgramB: mintBAccount.owner,
      tokenProgramLp: lpMintAccount.owner,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([poolCreator])
    .rpc();
}

import { assert } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { POOL_MINT_SEED, POOL_SEED } from "../utils/seeds";
import {
  airdrop,
  setUpEnv,
  createTokenMint,
  createAssociatedTokenAccount,
  mintTo,
} from "../utils/helpers";
import { ErrorCode } from "../errors";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  AccountLayout,
  MintLayout,
} from "@solana/spl-token";
import {
  bnSqrt,
  calculateOptimalAmounts,
  SlippageToleranceBP,
} from "../utils/math";
import { addInitialLiquidity } from "./helpers";

describe("instructions::add_liquidity", () => {
  it("pool creator can add initial liquidity", async () => {
    const {
      context,
      program,
      poolCreator,
      mintA,
      mintB,
      pool_pda,
      lpMint_pda,
      poolTokenVaultA,
      poolTokenVaultB,
    } = await setUpTest();

    let lpMintAccount = await context.banksClient.getAccount(lpMint_pda);
    let mintAAccount = await context.banksClient.getAccount(mintA);
    let mintBAccount = await context.banksClient.getAccount(mintB);
    let mintADecimals = MintLayout.decode(mintAAccount.data).decimals;
    let mintBDecimals = MintLayout.decode(mintBAccount.data).decimals;

    // test with realistic numbers (random numbers)
    let amountADesired = new BN(544_145).mul(
      new BN(10).pow(new BN(mintADecimals))
    );
    // test with realistic numbers (random numbers)
    let amountBDesired = new BN(23_144).mul(
      new BN(10).pow(new BN(mintBDecimals))
    );

    const { amountA, amountB, amountAMin, amountBMin } =
      calculateOptimalAmounts(
        amountADesired,
        amountBDesired,
        new BN(0),
        new BN(0),
        SlippageToleranceBP.Low
      );

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
      .addLiquidity(amountA, amountB, amountAMin, amountBMin)
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

    const poolAtaAAccount = AccountLayout.decode(
      (await context.banksClient.getAccount(poolTokenVaultA)).data
    );
    const poolAtaBAccount = AccountLayout.decode(
      (await context.banksClient.getAccount(poolTokenVaultB)).data
    );

    // Asserts that the pool has received the tokens
    assert(new BN(poolAtaAAccount.amount).eq(amountADesired));
    assert(new BN(poolAtaBAccount.amount).eq(amountBDesired));

    // Asserts that the provider has received the LP tokens
    const providerAtaLpAccount = AccountLayout.decode(
      (await context.banksClient.getAccount(providerAtaLp)).data
    );

    // Asserts that the provider has received the LP tokens
    // following first deposit formula => sqrt(amountADesired * amountBDesired)
    assert(
      new BN(providerAtaLpAccount.amount).eq(
        bnSqrt(amountADesired.mul(amountBDesired))
      )
    );

    const poolAmountA = new BN(poolAtaAAccount.amount);
    const poolAmountB = new BN(poolAtaBAccount.amount);

    // Scale the ratio by 1,000,000,000 to preserve precision
    const SCALE = new BN(10).pow(new BN(9));
    const ratioAB = poolAmountA.mul(SCALE).div(poolAmountB);
    const ratioBA = poolAmountB.mul(SCALE).div(poolAmountA);

    console.log(
      `A:B ratio: ${ratioAB.toString()} / 1,000,000 = ${(
        ratioAB.toNumber() / SCALE.toNumber()
      ).toFixed(9)}`
    );
    console.log(
      `B:A ratio: ${ratioBA.toString()} / 1,000,000 = ${(
        ratioBA.toNumber() / SCALE.toNumber()
      ).toFixed(9)}`
    );
  });

  it("pool can receive subsequent liquidity and calculate the correct amount of LP tokens to mint", async () => {
    const {
      context,
      program,
      poolCreator,
      mintA,
      mintB,
      pool_pda,
      lpMint_pda,
      poolTokenVaultA,
      poolTokenVaultB,
    } = await setUpTest();

    await addInitialLiquidity({
      context,
      program,
      poolCreator,
      mintA,
      mintB,
      pool_pda,
      lpMint_pda,
      poolTokenVaultA,
      poolTokenVaultB,
      amountA: 255_412,
      amountB: 1_555_114,
    });

    // Get current pool state after initial liquidity
    const poolTokenVaultAAccount = await context.banksClient.getAccount(
      poolTokenVaultA
    );
    const poolTokenVaultBAccount = await context.banksClient.getAccount(
      poolTokenVaultB
    );
    const poolTokenVaultAAccountData = AccountLayout.decode(
      poolTokenVaultAAccount.data
    );
    const poolTokenVaultBAccountData = AccountLayout.decode(
      poolTokenVaultBAccount.data
    );

    let lpMintAccount = await context.banksClient.getAccount(lpMint_pda);
    let mintAAccount = await context.banksClient.getAccount(mintA);
    let mintBAccount = await context.banksClient.getAccount(mintB);
    let mintADecimals = MintLayout.decode(mintAAccount.data).decimals;
    let mintBDecimals = MintLayout.decode(mintBAccount.data).decimals;

    const randomUser = Keypair.generate();
    airdrop({
      context,
      address: randomUser.publicKey,
      amount: LAMPORTS_PER_SOL * 1000,
    });

    const randomUserTokenAAssociatedAccount = createAssociatedTokenAccount({
      context,
      mint: mintA,
      owner: randomUser.publicKey,
      tokenProgram: mintAAccount.owner,
    });

    const randomUserTokenBAssociatedAccount = createAssociatedTokenAccount({
      context,
      mint: mintB,
      owner: randomUser.publicKey,
      tokenProgram: mintBAccount.owner,
    });

    await mintTo({
      context,
      ata: randomUserTokenAAssociatedAccount,
      amount: 1_000_000 * 10 ** mintADecimals,
    });
    await mintTo({
      context,
      ata: randomUserTokenBAssociatedAccount,
      amount: 1_000_000 * 10 ** mintBDecimals,
    });

    const randomUserLpAta = getAssociatedTokenAddressSync(
      lpMint_pda,
      randomUser.publicKey,
      false,
      lpMintAccount.owner
    );

    // === REALISTIC FRONTEND BEHAVIOR ===
    const userInputTokenA = "412412.1424"; // What user types in the input field

    // Frontend calculates the required Token B amount to maintain pool ratio
    const amountADesired = new BN(
      parseFloat(userInputTokenA) * 10 ** mintADecimals
    );

    // Calculate required Token B based on current pool ratio
    const amountBRequired = amountADesired
      .mul(new BN(poolTokenVaultBAccountData.amount))
      .div(new BN(poolTokenVaultAAccountData.amount));

    // Check if user has enough Token B (balance check)
    const userTokenBBalance = new BN(
      AccountLayout.decode(
        (
          await context.banksClient.getAccount(
            randomUserTokenBAssociatedAccount
          )
        ).data
      ).amount
    );

    let amountBDesired: BN;
    let finalAmountADesired: BN;

    if (amountBRequired.lte(userTokenBBalance)) {
      // User has enough Token B, use the calculated amounts
      finalAmountADesired = amountADesired;
      amountBDesired = amountBRequired;
    } else {
      // User doesn't have enough Token B, adjust down to max possible
      amountBDesired = userTokenBBalance;
      // calculate amountADesired based on the current pool ratio
      finalAmountADesired = amountBDesired
        .mul(new BN(poolTokenVaultAAccountData.amount))
        .div(new BN(poolTokenVaultBAccountData.amount));
    }

    // Calculate optimal amounts with 0.5% slippage tolerance (realistic frontend behavior)
    const { amountA, amountB, amountAMin, amountBMin } =
      calculateOptimalAmounts(
        finalAmountADesired,
        amountBDesired,
        new BN(poolTokenVaultAAccountData.amount),
        new BN(poolTokenVaultBAccountData.amount),
        SlippageToleranceBP.Low
      );

    const tx = await program.methods
      .addLiquidity(amountA, amountB, amountAMin, amountBMin) // Use calculated optimal amounts
      .accountsStrict({
        provider: randomUser.publicKey, // Use randomUser as provider
        providerAtaA: randomUserTokenAAssociatedAccount,
        providerAtaB: randomUserTokenBAssociatedAccount,
        providerAtaLp: randomUserLpAta,
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
      .signers([randomUser]) // Use randomUser as signer
      .rpc();

    const poolLpMintAccount = await context.banksClient.getAccount(lpMint_pda);
    const poolLpMintAccountData = MintLayout.decode(poolLpMintAccount.data);
    const poolTokenVaultAAccountDataAfter = AccountLayout.decode(
      (await context.banksClient.getAccount(poolTokenVaultA)).data
    );
    const poolTokenVaultBAccountDataAfter = AccountLayout.decode(
      (await context.banksClient.getAccount(poolTokenVaultB)).data
    );

    const providerAtaLpAccount = AccountLayout.decode(
      (await context.banksClient.getAccount(randomUserLpAta)).data
    );
    const shouldReceiveLpTokensByA = amountA
      .mul(new BN(poolLpMintAccountData.supply))
      .div(new BN(poolTokenVaultAAccountDataAfter.amount));
    const shouldReceiveLpTokensByB = amountB
      .mul(new BN(poolLpMintAccountData.supply))
      .div(new BN(poolTokenVaultBAccountDataAfter.amount));

    const shouldReceiveLpTokens = new BN(
      Math.min(
        shouldReceiveLpTokensByA.toNumber(),
        shouldReceiveLpTokensByB.toNumber()
      )
    );

    // Check if the provider has received the correct amount of LP tokens
    assert(
      new BN(providerAtaLpAccount.amount).eq(shouldReceiveLpTokens) ||
        new BN(providerAtaLpAccount.amount).eq(
          shouldReceiveLpTokens.add(new BN(1)) // 1 LP token may be gained due to rounding
        )
    );
  });
});

async function setUpTest() {
  const { context, program, provider } = await setUpEnv();

  const poolCreator = Keypair.generate();
  airdrop({
    context,
    address: poolCreator.publicKey,
    amount: LAMPORTS_PER_SOL * 1000,
  });

  const tokenAMint = createTokenMint({
    context,
    tokenProgram: TOKEN_PROGRAM_ID,
    decimals: 6,
  });
  const tokenBMint = createTokenMint({
    context,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    decimals: 9,
  });

  const creatorTokenAAssociatedAccount = createAssociatedTokenAccount({
    context,
    mint: tokenAMint,
    owner: poolCreator.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const creatorTokenBAssociatedAccount = createAssociatedTokenAccount({
    context,
    mint: tokenBMint,
    owner: poolCreator.publicKey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });

  await mintTo({
    context,
    ata: creatorTokenAAssociatedAccount,
    amount: 1_000_000_000 * 10 ** 6,
  });

  await mintTo({
    context,
    ata: creatorTokenBAssociatedAccount,
    amount: 1_000_000_000 * 10 ** 9,
  });

  const isFront = new BN(tokenAMint.toBuffer()).gt(
    new BN(tokenBMint.toBuffer())
  );

  let mintA = isFront ? tokenAMint : tokenBMint;
  let mintB = isFront ? tokenBMint : tokenAMint;

  const feeBp = 100; // 1%

  const [pool_pda, pool_bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(POOL_SEED),
      mintA.toBuffer(),
      mintB.toBuffer(),
      new BN(feeBp).toBuffer("le", 2), // 2 bytes for feeBp (u16)
    ],
    program.programId
  );

  const mintAAccount = await context.banksClient.getAccount(mintA);
  const mintBAccount = await context.banksClient.getAccount(mintB);

  const [lpMint_pda, lpMintBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(POOL_MINT_SEED),
      mintA.toBuffer(),
      mintB.toBuffer(),
      new BN(feeBp).toBuffer("le", 2), // 2 bytes for feeBp (u16)
    ],
    program.programId
  );

  const poolTokenVaultA = getAssociatedTokenAddressSync(
    mintA,
    pool_pda,
    true,
    mintAAccount.owner
  );
  const poolTokenVaultB = getAssociatedTokenAddressSync(
    mintB,
    pool_pda,
    true,
    mintBAccount.owner
  );

  const tx = await program.methods
    .createPool(feeBp)
    .accountsStrict({
      authority: poolCreator.publicKey,
      pool: pool_pda,
      tokenMintA: mintA,
      tokenMintB: mintB,
      tokenVaultA: poolTokenVaultA,
      tokenVaultB: poolTokenVaultB,
      lpMint: lpMint_pda,
      tokenProgramA: mintAAccount.owner,
      tokenProgramB: mintBAccount.owner,
      tokenProgramLp: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([poolCreator])
    .rpc();

  return {
    context,
    program,
    provider,
    poolCreator,
    mintA,
    mintB,
    pool_pda,
    lpMint_pda,
    poolTokenVaultA,
    poolTokenVaultB,
  };
}

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
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  AccountLayout,
  MintLayout,
} from "@solana/spl-token";
import { calculateOptimalAmounts, SlippageToleranceBP } from "../utils/math";

describe("LP Token Calculations", () => {
  it("should show LP calculations for proportional deposit", async () => {
    console.log("\n=== Test Case 1: Proportional Deposit ===");
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
      feeBp,
    } = await setUpTest();

    // Add initial liquidity: 1000:2000 ratio
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
      amountA: 1000,
      amountB: 2000,
    });

    const randomUser = await setupRandomUser(context, mintA, mintB);

    // Add liquidity maintaining exact 1:2 ratio
    console.log("Adding liquidity with exact 1:2 ratio (500:1000)");
    await addLiquidity({
      context,
      program,
      user: randomUser,
      mintA,
      mintB,
      pool_pda,
      lpMint_pda,
      poolTokenVaultA,
      poolTokenVaultB,
      amountA: 500,
      amountB: 1000,
    });
  });

  it("should show LP calculations when token A is limiting factor", async () => {
    console.log("\n=== Test Case 2: Token A Limiting Factor ===");
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

    // Add initial liquidity
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
      amountA: 1000,
      amountB: 2000,
    });

    const randomUser = await setupRandomUser(context, mintA, mintB);

    // Try to add 500:1500 (more B than needed)
    console.log(
      "Adding liquidity: desired 500:1500, but pool ratio requires 500:1000"
    );
    console.log(
      "Expected: Token A will be limiting factor, only 500:1000 will be deposited"
    );

    await addLiquidity({
      context,
      program,
      user: randomUser,
      mintA,
      mintB,
      pool_pda,
      lpMint_pda,
      poolTokenVaultA,
      poolTokenVaultB,
      amountA: 500,
      amountB: 1500, // More than needed
    });
  });

  it("should show LP calculations when token B is limiting factor", async () => {
    console.log("\n=== Test Case 3: Token B Limiting Factor ===");
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

    // Add initial liquidity
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
      amountA: 1000,
      amountB: 2000,
    });

    const randomUser = await setupRandomUser(context, mintA, mintB);

    // Try to add 1000:500 (less B than needed)
    console.log(
      "Adding liquidity: desired 1000:500, but pool ratio requires 250:500"
    );
    console.log(
      "Expected: Token B will be limiting factor, only 250:500 will be deposited"
    );

    await addLiquidity({
      context,
      program,
      user: randomUser,
      mintA,
      mintB,
      pool_pda,
      lpMint_pda,
      poolTokenVaultA,
      poolTokenVaultB,
      amountA: 1000, // More than needed
      amountB: 500,
    });
  });

  it("should show rounding differences in LP calculations", async () => {
    console.log("\n=== Test Case 4: Rounding Differences ===");
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

    // Add initial liquidity with odd numbers to create rounding scenarios
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
      amountA: 1001, // Odd number
      amountB: 2003, // Odd number
    });

    const randomUser = await setupRandomUser(context, mintA, mintB);

    // Add liquidity with amounts that will cause rounding
    console.log(
      "Adding liquidity with odd amounts that will cause rounding differences"
    );
    console.log(
      "This should show differences between lp_amount_by_a and lp_amount_by_b"
    );

    await addLiquidity({
      context,
      program,
      user: randomUser,
      mintA,
      mintB,
      pool_pda,
      lpMint_pda,
      poolTokenVaultA,
      poolTokenVaultB,
      amountA: 333,
      amountB: 667,
    });
  });
});

// Helper functions
async function setupRandomUser(
  context: any,
  mintA: PublicKey,
  mintB: PublicKey
) {
  const randomUser = Keypair.generate();
  airdrop({
    context,
    address: randomUser.publicKey,
    amount: LAMPORTS_PER_SOL * 1000,
  });

  const mintAAccount = await context.banksClient.getAccount(mintA);
  const mintBAccount = await context.banksClient.getAccount(mintB);

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

  // Mint plenty of tokens
  await mintTo({
    context,
    ata: randomUserTokenAAssociatedAccount,
    amount: 1_000_000 * 10 ** 9,
  });
  await mintTo({
    context,
    ata: randomUserTokenBAssociatedAccount,
    amount: 1_000_000 * 10 ** 9,
  });

  return {
    user: randomUser,
    tokenAAccount: randomUserTokenAAssociatedAccount,
    tokenBAccount: randomUserTokenBAssociatedAccount,
  };
}

async function addInitialLiquidity(params: {
  context: any;
  program: any;
  poolCreator: Keypair;
  mintA: PublicKey;
  mintB: PublicKey;
  pool_pda: PublicKey;
  lpMint_pda: PublicKey;
  poolTokenVaultA: PublicKey;
  poolTokenVaultB: PublicKey;
  amountA: number;
  amountB: number;
}) {
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
    amountA,
    amountB,
  } = params;

  const lpMintAccount = await context.banksClient.getAccount(lpMint_pda);
  const mintAAccount = await context.banksClient.getAccount(mintA);
  const mintBAccount = await context.banksClient.getAccount(mintB);

  const amountADesired = new BN(amountA).mul(new BN(10).pow(new BN(9)));
  const amountBDesired = new BN(amountB).mul(new BN(10).pow(new BN(9)));

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

  console.log(`Adding initial liquidity: ${amountA}:${amountB}`);

  await program.methods
    .addLiquidity(
      amountADesired,
      amountBDesired,
      amountADesired,
      amountBDesired
    )
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

async function addLiquidity(params: {
  context: any;
  program: any;
  user: any;
  mintA: PublicKey;
  mintB: PublicKey;
  pool_pda: PublicKey;
  lpMint_pda: PublicKey;
  poolTokenVaultA: PublicKey;
  poolTokenVaultB: PublicKey;
  amountA: number;
  amountB: number;
}) {
  const {
    context,
    program,
    user,
    mintA,
    mintB,
    pool_pda,
    lpMint_pda,
    poolTokenVaultA,
    poolTokenVaultB,
    amountA,
    amountB,
  } = params;

  const lpMintAccount = await context.banksClient.getAccount(lpMint_pda);
  const mintAAccount = await context.banksClient.getAccount(mintA);
  const mintBAccount = await context.banksClient.getAccount(mintB);

  // Get current pool state
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

  const amountADesired = new BN(amountA).mul(new BN(10).pow(new BN(9)));
  const amountBDesired = new BN(amountB).mul(new BN(10).pow(new BN(9)));

  // Calculate optimal amounts
  const {
    amountA: optimalAmountA,
    amountB: optimalAmountB,
    amountAMin,
    amountBMin,
  } = calculateOptimalAmounts(
    amountADesired,
    amountBDesired,
    new BN(poolTokenVaultAAccountData.amount),
    new BN(poolTokenVaultBAccountData.amount),
    SlippageToleranceBP.Low
  );

  const providerAtaLp = getAssociatedTokenAddressSync(
    lpMint_pda,
    user.user.publicKey,
    false,
    lpMintAccount.owner
  );

  console.log(`Attempting to add liquidity: ${amountA}:${amountB}`);
  console.log(
    `Optimal amounts: ${optimalAmountA.toNumber() / 1e9}:${
      optimalAmountB.toNumber() / 1e9
    }`
  );

  await program.methods
    .addLiquidity(optimalAmountA, optimalAmountB, amountAMin, amountBMin)
    .accountsStrict({
      provider: user.user.publicKey,
      providerAtaA: user.tokenAAccount,
      providerAtaB: user.tokenBAccount,
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
    .signers([user.user])
    .rpc();
}

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
    decimals: 9,
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
    amount: 1_000_000_000 * 10 ** 9,
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
      new BN(feeBp).toBuffer("le", 2),
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
      new BN(feeBp).toBuffer("le", 2),
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

  await program.methods
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
    feeBp,
  };
}

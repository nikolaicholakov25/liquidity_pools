import { assert } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  Account,
  Context,
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
  calculateMinimumAmountOut,
  calculateOptimalAmounts,
  calculateRemoveLiquidityAmounts,
  calculateSwapPriceImpact,
  SlippageToleranceBP,
} from "../utils/math";
import { addInitialLiquidity } from "./helpers";
import { AccountInfoBytes, ProgramTestContext } from "solana-bankrun";

describe("instructions::remove_liquidity", () => {
  it("pool creator can remove initial liquidity", async () => {
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
      amountADeposited,
      amountBDeposited,
    } = await setUpTest();

    const lpMintAccount = await context.banksClient.getAccount(lpMint_pda);
    const mintAAccount = await context.banksClient.getAccount(mintA);
    const mintBAccount = await context.banksClient.getAccount(mintB);
    const mintADecimals = MintLayout.decode(mintAAccount.data).decimals;
    const mintBDecimals = MintLayout.decode(mintBAccount.data).decimals;

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

    const providerAtaLp = getAssociatedTokenAddressSync(
      lpMint_pda,
      poolCreator.publicKey,
      false,
      lpMintAccount.owner
    );
    const providerAtaLpAccount = AccountLayout.decode(
      (await context.banksClient.getAccount(providerAtaLp)).data
    );

    const tx = await program.methods
      .removeLiquidity(
        new BN(providerAtaLpAccount.amount),
        amountADeposited,
        amountBDeposited
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

    const poolAtaAAccount = AccountLayout.decode(
      (await context.banksClient.getAccount(poolTokenVaultA)).data
    );
    const poolAtaBAccount = AccountLayout.decode(
      (await context.banksClient.getAccount(poolTokenVaultB)).data
    );
    const providerAtaLpAccountAfter = AccountLayout.decode(
      (await context.banksClient.getAccount(providerAtaLp)).data
    );
    const providerAtaAAccountAfter = AccountLayout.decode(
      (await context.banksClient.getAccount(creatorTokenAAssociatedAccount))
        .data
    );
    const providerAtaBAccountAfter = AccountLayout.decode(
      (await context.banksClient.getAccount(creatorTokenBAssociatedAccount))
        .data
    );

    const initialMintedAmountA = new BN(1_000_000_000).mul(
      new BN(10).pow(new BN(mintADecimals))
    );
    const initialMintedAmountB = new BN(1_000_000_000).mul(
      new BN(10).pow(new BN(mintBDecimals))
    );
    assert.isTrue(new BN(poolAtaAAccount.amount).eq(new BN(0)));
    assert.isTrue(new BN(poolAtaBAccount.amount).eq(new BN(0)));
    assert.isTrue(new BN(providerAtaLpAccountAfter.amount).eq(new BN(0)));
    assert.isTrue(
      new BN(providerAtaAAccountAfter.amount).eq(initialMintedAmountA)
    );
    assert.isTrue(
      new BN(providerAtaBAccountAfter.amount).eq(initialMintedAmountB)
    );
  });

  it("pool creator receives more tokens than they deposited after pool swaps", async () => {
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
      amountADeposited,
      amountBDeposited,
      feeBp,
      creatorTokenAAssociatedAccount,
      creatorTokenBAssociatedAccount,
    } = await setUpTest();

    const mintAAccount = await context.banksClient.getAccount(mintA);
    const mintBAccount = await context.banksClient.getAccount(mintB);
    const mintADecimals = MintLayout.decode(mintAAccount.data).decimals;
    const mintBDecimals = MintLayout.decode(mintBAccount.data).decimals;

    const {
      trader,
      traderTokenAAssociatedAccount,
      traderTokenBAssociatedAccount,
    } = await createTraderAccounts(
      context,
      mintA,
      mintB,
      mintAAccount,
      mintBAccount,
      mintADecimals,
      mintBDecimals
    );

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

    const PRECISION_SCALE = new BN(10).pow(new BN(9));

    const ratio =
      new BN(poolTokenVaultAAccountData.amount)
        .mul(PRECISION_SCALE)
        .div(new BN(poolTokenVaultBAccountData.amount))
        .toNumber() / PRECISION_SCALE.toNumber();

    const amountIn = new BN(10_000).mul(new BN(10).pow(new BN(mintADecimals)));
    const priceImpact = calculateSwapPriceImpact(
      amountIn,
      new BN(poolTokenVaultAAccountData.amount),
      new BN(poolTokenVaultBAccountData.amount)
    );
    const { amountOutMinAfterSlippage, expectedAmountOut, feeAmount } =
      calculateMinimumAmountOut({
        amountIn,
        reserveIn: new BN(poolTokenVaultAAccountData.amount),
        reserveOut: new BN(poolTokenVaultBAccountData.amount),
        feeBp,
        slippageTolerance: SlippageToleranceBP.None,
      });

    console.log({
      feeAmount: feeAmount.toNumber(),
      tokenAVault: poolTokenVaultAAccountData.amount,
      tokenBVault: poolTokenVaultBAccountData.amount,
      ratio: ratio,
      priceImpact: `${priceImpact}%`,
      tokensBefore:
        poolTokenVaultAAccountData.amount + poolTokenVaultBAccountData.amount,
      tokensInRaw: amountIn.toNumber(),
      tokensIn: amountIn.div(new BN(10 ** mintADecimals)).toNumber(),
      amountOutMinAfterSlippageRaw: amountOutMinAfterSlippage.toNumber(),
      amountOutMinAfterSlippage: amountOutMinAfterSlippage
        .div(new BN(10 ** mintBDecimals))
        .toNumber(),
      expectedAmountOutRaw: expectedAmountOut.toNumber(),
      expectedAmountOut: expectedAmountOut
        .div(new BN(10 ** mintBDecimals))
        .toNumber(),
    });

    const tx = await program.methods
      .swap(amountIn, amountOutMinAfterSlippage)
      .accountsStrict({
        payer: trader.publicKey,
        pool: pool_pda,
        payerAtaInput: traderTokenAAssociatedAccount,
        payerAtaOutput: traderTokenBAssociatedAccount,
        poolAtaInput: poolTokenVaultA,
        poolAtaOutput: poolTokenVaultB,
        tokenMintInput: mintA,
        tokenMintOutput: mintB,
        tokenProgramInput: mintAAccount.owner,
        tokenProgramOutput: mintBAccount.owner,
        tokenProgramLp: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    const poolTokenVaultAAccountAfter = await context.banksClient.getAccount(
      poolTokenVaultA
    );
    const poolTokenVaultBAccountAfter = await context.banksClient.getAccount(
      poolTokenVaultB
    );
    const poolTokenVaultAAccountDataAfter = AccountLayout.decode(
      poolTokenVaultAAccountAfter.data
    );
    const poolTokenVaultBAccountDataAfter = AccountLayout.decode(
      poolTokenVaultBAccountAfter.data
    );

    const ratioAfter =
      new BN(poolTokenVaultAAccountDataAfter.amount)
        .mul(PRECISION_SCALE)
        .div(new BN(poolTokenVaultBAccountDataAfter.amount))
        .toNumber() / PRECISION_SCALE.toNumber();

    console.log({
      tokenAVault: poolTokenVaultAAccountDataAfter.amount,
      tokenBVault: poolTokenVaultBAccountDataAfter.amount,
      tokensAfter:
        poolTokenVaultAAccountDataAfter.amount +
        poolTokenVaultBAccountDataAfter.amount,
      ratioAfter: ratioAfter,
    });

    assert.isTrue(
      ratioAfter > ratio,
      "ratio should increase (token A is less valuable after swap)"
    );
    assert.isTrue(
      poolTokenVaultAAccountDataAfter.amount >
        poolTokenVaultAAccountData.amount,
      "pool token vault A should increase after swap"
    );
    assert.isTrue(
      poolTokenVaultBAccountDataAfter.amount <
        poolTokenVaultBAccountData.amount,
      "pool token vault B should decrease after swap"
    );

    const lpMintAccount = await context.banksClient.getAccount(lpMint_pda);
    const lpMintAccountData = MintLayout.decode(lpMintAccount.data);
    const providerAtaLp = getAssociatedTokenAddressSync(
      lpMint_pda,
      poolCreator.publicKey,
      false,
      lpMintAccount.owner
    );
    const providerAtaLpAccount = AccountLayout.decode(
      (await context.banksClient.getAccount(providerAtaLp)).data
    );

    const { minARemoved, minBRemoved } = calculateRemoveLiquidityAmounts({
      lpAmount: new BN(providerAtaLpAccount.amount),
      lpSupply: new BN(lpMintAccountData.supply),
      reserveA: new BN(poolTokenVaultAAccountDataAfter.amount),
      reserveB: new BN(poolTokenVaultBAccountDataAfter.amount),
      slippageTolerance: SlippageToleranceBP.None,
    });

    const removeLiquidity = await program.methods
      .removeLiquidity(
        new BN(providerAtaLpAccount.amount), // remove all liquidity
        minARemoved,
        minBRemoved
      )
      .accountsStrict({
        provider: poolCreator.publicKey,
        providerAtaA: creatorTokenAAssociatedAccount,
        providerAtaB: creatorTokenBAssociatedAccount,
        providerAtaLp: providerAtaLp,
        pool: pool_pda,
        tokenMintA: mintA,
        tokenMintB: mintB,
        tokenProgramA: mintAAccount.owner,
        tokenProgramB: mintBAccount.owner,
        tokenProgramLp: lpMintAccount.owner,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        lpMint: lpMint_pda,
        poolAtaA: poolTokenVaultA,
        poolAtaB: poolTokenVaultB,
        systemProgram: SystemProgram.programId,
      })
      .signers([poolCreator])
      .rpc();

    const poolTokenVaultAAccountAfter2 = await context.banksClient.getAccount(
      poolTokenVaultA
    );
    const poolTokenVaultBAccountAfter2 = await context.banksClient.getAccount(
      poolTokenVaultB
    );
    const poolTokenVaultAAccountDataAfter2 = AccountLayout.decode(
      poolTokenVaultAAccountAfter2.data
    );
    const poolTokenVaultBAccountDataAfter2 = AccountLayout.decode(
      poolTokenVaultBAccountAfter2.data
    );

    assert.isTrue(
      new BN(poolTokenVaultAAccountDataAfter2.amount).eq(new BN(0)),
      "pool token vault A should be 0"
    );
    assert.isTrue(
      new BN(poolTokenVaultBAccountDataAfter2.amount).eq(new BN(0)),
      "pool token vault B should be 0"
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
    decimals: 9,
  });
  const tokenBMint = createTokenMint({
    context,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    decimals: 9,
  });

  const isFront = new BN(tokenAMint.toBuffer()).gt(
    new BN(tokenBMint.toBuffer())
  );

  let mintA = isFront ? tokenAMint : tokenBMint;
  let mintB = isFront ? tokenBMint : tokenAMint;

  const mintAAccount = await context.banksClient.getAccount(mintA);
  const mintBAccount = await context.banksClient.getAccount(mintB);
  const mintADecimals = MintLayout.decode(mintAAccount.data).decimals;
  const mintBDecimals = MintLayout.decode(mintBAccount.data).decimals;

  const creatorTokenAAssociatedAccount = createAssociatedTokenAccount({
    context,
    mint: mintA,
    owner: poolCreator.publicKey,
    tokenProgram: mintAAccount.owner,
  });
  const creatorTokenBAssociatedAccount = createAssociatedTokenAccount({
    context,
    mint: mintB,
    owner: poolCreator.publicKey,
    tokenProgram: mintBAccount.owner,
  });

  await mintTo({
    context,
    ata: creatorTokenAAssociatedAccount,
    amount: 1_000_000_000 * 10 ** mintADecimals,
  });

  await mintTo({
    context,
    ata: creatorTokenBAssociatedAccount,
    amount: 1_000_000_000 * 10 ** mintBDecimals,
  });

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

  const lpMintAccount = await context.banksClient.getAccount(lpMint_pda);

  // test with realistic numbers (random numbers)
  let amountADesired = new BN(100_000).mul(
    new BN(10).pow(new BN(mintADecimals))
  );
  // test with realistic numbers (random numbers)
  let amountBDesired = new BN(100_000).mul(
    new BN(10).pow(new BN(mintBDecimals))
  );

  const { amountA, amountB, amountAMin, amountBMin } = calculateOptimalAmounts(
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

  const tx2 = await program.methods
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
    amountADeposited: amountA,
    amountBDeposited: amountB,
    feeBp,
    creatorTokenAAssociatedAccount,
    creatorTokenBAssociatedAccount,
  };
}

const createTraderAccounts = async (
  context: ProgramTestContext,
  mintA: PublicKey,
  mintB: PublicKey,
  mintAAccount: AccountInfoBytes,
  mintBAccount: AccountInfoBytes,
  mintADecimals: number,
  mintBDecimals: number
) => {
  const trader = Keypair.generate();
  airdrop({
    context,
    address: trader.publicKey,
    amount: LAMPORTS_PER_SOL * 1000,
  });

  const traderTokenAAssociatedAccount = createAssociatedTokenAccount({
    context,
    mint: mintA,
    owner: trader.publicKey,
    tokenProgram: mintAAccount.owner,
  });

  const traderTokenBAssociatedAccount = createAssociatedTokenAccount({
    context,
    mint: mintB,
    owner: trader.publicKey,
    tokenProgram: mintBAccount.owner,
  });

  await mintTo({
    context,
    ata: traderTokenAAssociatedAccount,
    amount: 1_000_000 * 10 ** mintADecimals,
  });
  await mintTo({
    context,
    ata: traderTokenBAssociatedAccount,
    amount: 1_000_000 * 10 ** mintBDecimals,
  });

  return {
    trader,
    traderTokenAAssociatedAccount,
    traderTokenBAssociatedAccount,
  };
};

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
  calculateMinimumAmountOut,
  calculateSwapOutput,
  calculateSwapPriceImpact,
  SlippageToleranceBP,
} from "../utils/math";
import { addInitialLiquidity } from "./helpers";

describe("instructions::swap", () => {
  it("random user can swap tokens", async () => {
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
      amountA: 92_495.61,
      amountB: 33_053_283.35,
    });

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

    const amountIn = new BN(150).mul(new BN(10).pow(new BN(mintADecimals)));
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

    const inputMintAccount = mintAAccount;
    const inputMint = mintA;
    const outputMintAccount = mintBAccount;
    const outputMint = mintB;

    const randomUserTokenInputAccountBeforeSwap = AccountLayout.decode(
      (await context.banksClient.getAccount(randomUserTokenAAssociatedAccount))
        .data
    );
    const randomUserTokenOutputAccountBeforeSwap = AccountLayout.decode(
      (await context.banksClient.getAccount(randomUserTokenBAssociatedAccount))
        .data
    );

    console.log({
      priceImpact: `${priceImpact}%`,
      tokensInRaw: amountIn.toNumber(),
      tokensIn: amountIn.div(new BN(10 ** mintADecimals)).toNumber(),
      amountOutMinAfterSlippageRaw: amountOutMinAfterSlippage.toNumber(),
      expectedAmountOutRaw: expectedAmountOut.toNumber(),
      expectedAmountOut: expectedAmountOut
        .div(new BN(10 ** mintBDecimals))
        .toNumber(),
    });

    const tx = await program.methods
      .swap(amountIn, amountOutMinAfterSlippage)
      .accountsStrict({
        payer: randomUser.publicKey,
        pool: pool_pda,
        payerAtaInput: randomUserTokenAAssociatedAccount,
        payerAtaOutput: randomUserTokenBAssociatedAccount,
        poolAtaInput: poolTokenVaultA,
        poolAtaOutput: poolTokenVaultB,
        tokenMintInput: inputMint,
        tokenMintOutput: outputMint,
        tokenProgramInput: inputMintAccount.owner,
        tokenProgramOutput: outputMintAccount.owner,
        tokenProgramLp: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([randomUser])
      .rpc();

    const randomUserTokenInputAccountAfterSwap = AccountLayout.decode(
      (await context.banksClient.getAccount(randomUserTokenAAssociatedAccount))
        .data
    );
    const randomUserTokenOutputAccountAfterSwap = AccountLayout.decode(
      (await context.banksClient.getAccount(randomUserTokenBAssociatedAccount))
        .data
    );

    // user sent exactly amountIn tokens
    assert(
      new BN(randomUserTokenInputAccountBeforeSwap.amount)
        .sub(new BN(randomUserTokenInputAccountAfterSwap.amount))
        .eq(new BN(amountIn))
    );

    // user received exactly expectedAmountOut tokens (before slippage because of testing environment)
    // + 1 because of rounding errors (ceil)
    const tokensReceived = new BN(
      randomUserTokenOutputAccountAfterSwap.amount
    ).sub(new BN(randomUserTokenOutputAccountBeforeSwap.amount));
    console.log({
      tokensReceivedRaw: tokensReceived.toNumber(),
      tokensReceived: tokensReceived
        .div(new BN(10 ** mintBDecimals))
        .toNumber(),
    });
    assert(
      tokensReceived.eq(new BN(amountOutMinAfterSlippage)) ||
        tokensReceived.eq(new BN(amountOutMinAfterSlippage.add(new BN(1))))
    );

    // Get current pool state after swap
    const poolTokenVaultAAccountAfterSwap =
      await context.banksClient.getAccount(poolTokenVaultA);
    const poolTokenVaultBAccountAfterSwap =
      await context.banksClient.getAccount(poolTokenVaultB);
    const poolTokenVaultAAccountDataAfterSwap = AccountLayout.decode(
      poolTokenVaultAAccountAfterSwap.data
    );
    const poolTokenVaultBAccountDataAfterSwap = AccountLayout.decode(
      poolTokenVaultBAccountAfterSwap.data
    );

    const amountInAfterSwap = amountIn;
    const amountOutAfterSwap = calculateSwapOutput({
      amountIn: amountInAfterSwap,
      reserveIn: new BN(poolTokenVaultAAccountDataAfterSwap.amount),
      reserveOut: new BN(poolTokenVaultBAccountDataAfterSwap.amount),
      feeBp,
    });

    const amountOutBeforeSwap = calculateSwapOutput({
      amountIn: amountIn,
      reserveIn: new BN(poolTokenVaultAAccountData.amount),
      reserveOut: new BN(poolTokenVaultBAccountData.amount),
      feeBp,
    });

    console.log({
      amountOutBeforeSwap: amountOutBeforeSwap.amountOut.toNumber(),
      amountOutAfterSwap: amountOutAfterSwap.amountOut.toNumber(),
    });
    // ratio has changed after swap
    assert(amountOutAfterSwap.amountOut.lte(amountOutBeforeSwap.amountOut));
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
    amount: 100_000_000 * 10 ** 9,
  });

  await mintTo({
    context,
    ata: creatorTokenBAssociatedAccount,
    amount: 100_000_000 * 10 ** 9,
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
    feeBp,
  };
}

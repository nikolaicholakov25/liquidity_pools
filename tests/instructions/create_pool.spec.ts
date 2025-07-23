import { assert } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { CONFIG_SEED, POOL_MINT_SEED, POOL_SEED } from "../utils/seeds";
import {
  airdrop,
  setUpEnv,
  createTokenMint,
  createAssociatedTokenAccount,
  mintTo,
} from "../utils/helpers";
import { ErrorCode } from "../errors";
import {
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("instructions::create_pool", () => {
  it("can create a pool", async () => {
    const { context, program, provider, poolCreator, tokenAMint, tokenBMint } =
      await setUpTest();

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
        systemProgram: SystemProgram.programId,
        tokenProgramA: mintAAccount.owner,
        tokenProgramB: mintBAccount.owner,
        tokenProgramLp: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([poolCreator])
      .rpc();

    // Pool assertions
    const poolAccount = await program.account.pool.fetch(pool_pda);
    assert.equal(poolAccount.tokenMintA.toBase58(), mintA.toBase58());
    assert.equal(poolAccount.tokenMintB.toBase58(), mintB.toBase58());
    assert.equal(
      poolAccount.tokenVaultA.toBase58(),
      poolTokenVaultA.toBase58()
    );
    assert.equal(
      poolAccount.tokenVaultB.toBase58(),
      poolTokenVaultB.toBase58()
    );
    assert.equal(poolAccount.feeBp, feeBp);
    assert.equal(poolAccount.bump, pool_bump);

    // LP Mint assertions
    const poolLpMintAccount = await context.banksClient.getAccount(lpMint_pda);
    const poolLpMint = MintLayout.decode(poolLpMintAccount.data);
    assert.equal(poolLpMint.decimals, 9);
    assert.equal(poolLpMint.supply, BigInt(0));
    assert.equal(poolLpMint.mintAuthority.toBase58(), pool_pda.toBase58());
    assert.equal(poolLpMint.freezeAuthority.toBase58(), pool_pda.toBase58());
    assert.equal(poolLpMint.isInitialized, true);
  });

  it("fails if token A < token B", async () => {
    const { context, program, provider, poolCreator, tokenAMint, tokenBMint } =
      await setUpTest();

    const isFront = new BN(tokenAMint.toBuffer()).lt(
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
        systemProgram: SystemProgram.programId,
        tokenProgramA: mintAAccount.owner,
        tokenProgramB: mintBAccount.owner,
        tokenProgramLp: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([poolCreator])
      .rpc()
      .then(() => assert.fail("should have failed"))
      .catch((err) =>
        assert.equal(err.error.errorCode.number, ErrorCode.InvalidTokenOrder)
      );
  });

  it("fails if seeds order is incorrect", async () => {
    const { context, program, provider, poolCreator, tokenAMint, tokenBMint } =
      await setUpTest();
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
        tokenMintA: mintB, // wrong order
        tokenMintB: mintA, // wrong order
        tokenVaultA: poolTokenVaultA,
        tokenVaultB: poolTokenVaultB,
        lpMint: lpMint_pda,
        tokenProgramA: mintAAccount.owner,
        tokenProgramB: mintBAccount.owner,
        tokenProgramLp: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([poolCreator])
      .rpc()
      .then(() => assert.fail("should have failed"))
      .catch((err) =>
        assert.equal(err.error.errorCode.number, ErrorCode.ConstraintSeeds)
      );
  });

  it("can create multiple pools with the same tokens (different fee)", async () => {
    const { context, program, provider, poolCreator, tokenAMint, tokenBMint } =
      await setUpTest();
    const isFront = new BN(tokenAMint.toBuffer()).gt(
      new BN(tokenBMint.toBuffer())
    );
    let mintA = isFront ? tokenAMint : tokenBMint;
    let mintB = isFront ? tokenBMint : tokenAMint;

    const feeBp1 = 100; // 1%
    const [pool_pda_1, pool_bump_1] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(POOL_SEED),
        mintA.toBuffer(),
        mintB.toBuffer(),
        new BN(feeBp1).toBuffer("le", 2), // 2 bytes for feeBp (u16)
      ],
      program.programId
    );

    const feeBp2 = 200; // 2%
    const [pool_pda_2, pool_bump_2] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(POOL_SEED),
        mintA.toBuffer(),
        mintB.toBuffer(),
        new BN(feeBp2).toBuffer("le", 2), // 2 bytes for feeBp (u16)
      ],
      program.programId
    );

    const mintAAccount = await context.banksClient.getAccount(mintA);
    const mintBAccount = await context.banksClient.getAccount(mintB);

    const [lpMint1_pda, lpMint1Bump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(POOL_MINT_SEED),
        mintA.toBuffer(),
        mintB.toBuffer(),
        new BN(feeBp1).toBuffer("le", 2), // 2 bytes for feeBp (u16)
      ],
      program.programId
    );

    const [lpMint2_pda, lpMint2Bump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(POOL_MINT_SEED),
        mintA.toBuffer(),
        mintB.toBuffer(),
        new BN(feeBp2).toBuffer("le", 2), // 2 bytes for feeBp (u16)
      ],
      program.programId
    );

    const pool1TokenVaultA = getAssociatedTokenAddressSync(
      mintA,
      pool_pda_1,
      true,
      mintAAccount.owner
    );
    const pool1TokenVaultB = getAssociatedTokenAddressSync(
      mintB,
      pool_pda_1,
      true,
      mintBAccount.owner
    );
    const pool2TokenVaultA = getAssociatedTokenAddressSync(
      mintA,
      pool_pda_2,
      true,
      mintAAccount.owner
    );
    const pool2TokenVaultB = getAssociatedTokenAddressSync(
      mintB,
      pool_pda_2,
      true,
      mintBAccount.owner
    );

    const poolTx1 = await program.methods
      .createPool(feeBp1)
      .accountsStrict({
        authority: poolCreator.publicKey,
        pool: pool_pda_1,
        tokenMintA: mintA,
        tokenMintB: mintB,
        tokenVaultA: pool1TokenVaultA,
        tokenVaultB: pool1TokenVaultB,
        lpMint: lpMint1_pda,
        tokenProgramA: mintAAccount.owner,
        tokenProgramB: mintBAccount.owner,
        tokenProgramLp: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([poolCreator])
      .rpc();

    const poolTx2 = await program.methods
      .createPool(feeBp2)
      .accountsStrict({
        authority: poolCreator.publicKey,
        pool: pool_pda_2,
        tokenMintA: mintA,
        tokenMintB: mintB,
        tokenVaultA: pool2TokenVaultA,
        tokenVaultB: pool2TokenVaultB,
        lpMint: lpMint2_pda,
        tokenProgramA: mintAAccount.owner,
        tokenProgramB: mintBAccount.owner,
        tokenProgramLp: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([poolCreator])
      .rpc();

    const pool1Account = await program.account.pool.fetch(pool_pda_1);
    const pool2Account = await program.account.pool.fetch(pool_pda_2);

    assert.equal(
      pool1Account.tokenMintA.toBase58(),
      pool2Account.tokenMintA.toBase58()
    );
    assert.equal(
      pool1Account.tokenMintB.toBase58(),
      pool2Account.tokenMintB.toBase58()
    );
    assert.equal(pool1Account.feeBp, feeBp1);
    assert.equal(pool2Account.feeBp, feeBp2);
    assert.equal(pool1Account.bump, pool_bump_1);
    assert.equal(pool2Account.bump, pool_bump_2);
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
  });
  const tokenBMint = createTokenMint({
    context,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
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
    amount: 100 * 10 ** 9, // 100 tokens
  });

  await mintTo({
    context,
    ata: creatorTokenBAssociatedAccount,
    amount: 100 * 10 ** 9, // 100 tokens
  });

  return {
    context,
    program,
    provider,
    poolCreator,
    tokenAMint,
    tokenBMint,
    creatorTokenAAssociatedAccount,
    creatorTokenBAssociatedAccount,
  };
}

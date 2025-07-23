import { AnchorProvider, Program, Wallet, web3, BN } from "@coral-xyz/anchor";
import {
  Clock,
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "../../litesvm/crates/node-litesvm/litesvm";
import IDL from "../target/idl/liquidity_pools.json";
import { assert } from "chai";
import { describe, it, before, test } from "mocha";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TransactionErrorInstructionError } from "../../litesvm/crates/node-litesvm/litesvm/internal";
import {
  airdrop,
  createAssociatedTokenAccount,
  createTokenMint,
  mintTo,
  setUpEnv,
} from "./utils/helpers";
import { CONFIG_SEED } from "./utils/seeds";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MintLayout,
} from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { LiquidityPools } from "../target/types/liquidity_pools";

describe("instructions::coverage", () => {
  let svm: LiteSVM;
  let payer: Keypair;
  let programId: PublicKey;
  let program: Program<LiquidityPools>;

  before(async () => {
    svm = new LiteSVM();
    payer = new Keypair();
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    const provider = new AnchorProvider(svm as any, new Wallet(payer), {
      commitment: "confirmed",
    });
    program = new Program(IDL, provider);
    programId = program.programId;
    svm.addProgramFromFile(programId, "target/deploy/liquidity_pools.so");

    // Add coverage generation
    svm.withCoverage(
      [["liquidity_pools", programId.toBuffer()]],
      [],
      payer.secretKey
    );
  });

  it("should initialize the program config account", async () => {
    const admin = new Keypair();

    // Airdrop SOL to the generated admin
    svm.airdrop(admin.publicKey, BigInt(LAMPORTS_PER_SOL * 1000));

    // Create a protocol fee recipient keypair
    const protocolFeeRecipientKeypair = new Keypair();
    const protocolFeeBp = 100; // 1%

    const [config_pda, config_bump] = PublicKey.findProgramAddressSync(
      [Buffer.from(CONFIG_SEED)],
      program.programId
    );

    // Initialize the program with the admin as the authority
    // and 100 basis points for protocol fees (1%)
    const instruction = await program.methods
      .initialize(protocolFeeRecipientKeypair.publicKey, protocolFeeBp)
      .accountsStrict({
        authority: admin.publicKey,
        config: config_pda,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    const blockhash = svm.latestBlockhash();
    const tx = new web3.Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(instruction);
    tx.sign(admin);

    const result = svm.sendTransaction(tx);

    // Fetch the config account
    const rawAccount = svm.getAccount(config_pda);

    // Decode the raw account data using the program's coder
    const configAccount = program.coder.accounts.decode(
      "config",
      Buffer.from(rawAccount.data)
    );

    // Check that the config account was initialized correctly
    assert.equal(
      configAccount.authority.toBase58(),
      admin.publicKey.toBase58()
    );

    // Check that the protocol fee recipient is correct
    assert.equal(
      configAccount.protocolFeeRecipient.toBase58(),
      protocolFeeRecipientKeypair.publicKey.toBase58()
    );

    // Check the protocol fee basis points is 100 (1%)
    assert.equal(configAccount.protocolFeeBp, protocolFeeBp);
    assert.equal(configAccount.bump, config_bump);

    const poolCreator = new Keypair();

    // Airdrop SOL to the pool creator
    svm.airdrop(poolCreator.publicKey, BigInt(LAMPORTS_PER_SOL * 1000));

    // Create token mints
    const tokenAMint = createTokenMint({
      context: svm as any,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    const tokenBMint = createTokenMint({
      context: svm as any,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });

    // Determine token order (A must be greater than B)
    const isFront = new BN(tokenAMint.toBuffer()).gt(
      new BN(tokenBMint.toBuffer())
    );
    let mintA = isFront ? tokenAMint : tokenBMint;
    let mintB = isFront ? tokenBMint : tokenAMint;

    const feeBp = 100; // 1%

    // Generate pool PDA
    const [pool_pda, pool_bump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"), // POOL_SEED
        mintA.toBuffer(),
        mintB.toBuffer(),
        new BN(feeBp).toBuffer("le", 2), // 2 bytes for feeBp (u16)
      ],
      program.programId
    );

    // Generate LP mint PDA
    const [lpMint_pda, lpMintBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("mint"), // POOL_MINT_SEED
        mintA.toBuffer(),
        mintB.toBuffer(),
        new BN(feeBp).toBuffer("le", 2), // 2 bytes for feeBp (u16)
      ],
      program.programId
    );

    // Get mint account info to determine token programs
    const mintAAccount = svm.getAccount(mintA);
    const mintBAccount = svm.getAccount(mintB);

    // Calculate token vault addresses
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

    // Create pool instruction
    const instruction2 = await program.methods
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
        systemProgram: web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .instruction();

    const blockhash2 = svm.latestBlockhash();
    const tx2 = new web3.Transaction();
    tx2.recentBlockhash = blockhash2;
    tx2.add(instruction2);
    tx2.sign(poolCreator);

    const result2 = svm.sendTransaction(tx2);

    // Fetch and decode the pool account
    const rawPoolAccount = svm.getAccount(pool_pda);
    const poolAccount = program.coder.accounts.decode(
      "pool",
      Buffer.from(rawPoolAccount.data)
    );

    // Pool assertions
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
    const poolLpMintAccount = svm.getAccount(lpMint_pda);
    const poolLpMint = MintLayout.decode(poolLpMintAccount.data);
    assert.equal(poolLpMint.decimals, 9);
    assert.equal(poolLpMint.supply, BigInt(0));
    assert.equal(poolLpMint.mintAuthority.toBase58(), pool_pda.toBase58());
    assert.equal(poolLpMint.freezeAuthority.toBase58(), pool_pda.toBase58());
    assert.equal(poolLpMint.isInitialized, true);

    console.log("Pool created successfully:", {
      poolPda: pool_pda.toBase58(),
      tokenMintA: mintA.toBase58(),
      tokenMintB: mintB.toBase58(),
      feeBp: feeBp,
      lpMint: lpMint_pda.toBase58(),
    });
  });

  it.skip("can create a pool", async () => {
    const poolCreator = new Keypair();

    // Airdrop SOL to the pool creator
    svm.airdrop(poolCreator.publicKey, BigInt(LAMPORTS_PER_SOL * 1000));

    // Create token mints
    const tokenAMint = createTokenMint({
      context: svm as any,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    const tokenBMint = createTokenMint({
      context: svm as any,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });

    // Determine token order (A must be greater than B)
    const isFront = new BN(tokenAMint.toBuffer()).gt(
      new BN(tokenBMint.toBuffer())
    );
    let mintA = isFront ? tokenAMint : tokenBMint;
    let mintB = isFront ? tokenBMint : tokenAMint;

    const feeBp = 100; // 1%

    // Generate pool PDA
    const [pool_pda, pool_bump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"), // POOL_SEED
        mintA.toBuffer(),
        mintB.toBuffer(),
        new BN(feeBp).toBuffer("le", 2), // 2 bytes for feeBp (u16)
      ],
      program.programId
    );

    // Generate LP mint PDA
    const [lpMint_pda, lpMintBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("mint"), // POOL_MINT_SEED
        mintA.toBuffer(),
        mintB.toBuffer(),
        new BN(feeBp).toBuffer("le", 2), // 2 bytes for feeBp (u16)
      ],
      program.programId
    );

    // Get mint account info to determine token programs
    const mintAAccount = svm.getAccount(mintA);
    const mintBAccount = svm.getAccount(mintB);

    // Calculate token vault addresses
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

    // Create pool instruction
    const instruction = await program.methods
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
        systemProgram: web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .instruction();

    const blockhash = svm.latestBlockhash();
    const tx = new web3.Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(instruction);
    tx.sign(poolCreator);

    const result = svm.sendTransaction(tx);

    // Fetch and decode the pool account
    const rawPoolAccount = svm.getAccount(pool_pda);
    const poolAccount = program.coder.accounts.decode(
      "pool",
      Buffer.from(rawPoolAccount.data)
    );

    // Pool assertions
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
    const poolLpMintAccount = svm.getAccount(lpMint_pda);
    const poolLpMint = MintLayout.decode(poolLpMintAccount.data);
    assert.equal(poolLpMint.decimals, 9);
    assert.equal(poolLpMint.supply, BigInt(0));
    assert.equal(poolLpMint.mintAuthority.toBase58(), pool_pda.toBase58());
    assert.equal(poolLpMint.freezeAuthority.toBase58(), pool_pda.toBase58());
    assert.equal(poolLpMint.isInitialized, true);

    console.log("Pool created successfully:", {
      poolPda: pool_pda.toBase58(),
      tokenMintA: mintA.toBase58(),
      tokenMintB: mintB.toBase58(),
      feeBp: feeBp,
      lpMint: lpMint_pda.toBase58(),
    });
  });
});

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
import { CONFIG_SEED, POOL_MINT_SEED } from "./utils/seeds";
import { ErrorCode } from "./errors";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MintLayout,
  AccountLayout,
} from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { LiquidityPools } from "../target/types/liquidity_pools";
import {
  bnSqrt,
  calculateOptimalAmounts,
  SlippageToleranceBP,
} from "./utils/math";

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
  });

  it("can create a pool", async () => {
    const poolCreator = new Keypair();

    // Airdrop SOL to the pool creator
    svm.airdrop(poolCreator.publicKey, BigInt(LAMPORTS_PER_SOL * 1000));

    // Create token mints
    const tokenAMint = createTokenMint({
      context: svm,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    const tokenBMint = createTokenMint({
      context: svm,
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

  it("fails if token A < token B", async () => {
    const poolCreator = new Keypair();

    // Airdrop SOL to the pool creator
    svm.airdrop(poolCreator.publicKey, BigInt(LAMPORTS_PER_SOL * 1000));

    // Create token mints
    const tokenAMint = createTokenMint({
      context: svm,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    const tokenBMint = createTokenMint({
      context: svm,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });

    // Intentionally use wrong order (A < B) to trigger error
    const isFront = new BN(tokenAMint.toBuffer()).lt(
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

    // Create pool instruction that should fail
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

    // This transaction should fail with InvalidTokenOrder error
    if (result instanceof FailedTransactionMetadata) {
      assert.isTrue(result.err().toString().includes("code: 6004")); // InvalidTokenOrder error code
    } else {
      throw new Error("Transaction should fail");
    }

    console.log(
      "Successfully caught InvalidTokenOrder error for wrong token order"
    );
  });

  it("can add initial liquidity to a pool", async () => {
    const poolCreator = new Keypair();

    // Airdrop SOL to the pool creator
    svm.airdrop(poolCreator.publicKey, BigInt(LAMPORTS_PER_SOL * 1000));

    // Create token mints
    const tokenAMint = createTokenMint({
      context: svm,
      decimals: 9,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    const tokenBMint = createTokenMint({
      context: svm,
      decimals: 6,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });

    // Determine token order (A must be greater than B)
    const isFront = new BN(tokenAMint.toBuffer()).gt(
      new BN(tokenBMint.toBuffer())
    );
    let mintA = isFront ? tokenAMint : tokenBMint;
    let mintB = isFront ? tokenBMint : tokenAMint;

    const mintAAccount = svm.getAccount(mintA);
    const mintBAccount = svm.getAccount(mintB);

    const mintADecoded = MintLayout.decode(mintAAccount.data);
    const mintBDecoded = MintLayout.decode(mintBAccount.data);

    // Create associated token accounts for the pool creator
    const creatorTokenAAssociatedAccount = createAssociatedTokenAccount({
      context: svm,
      mint: mintA,
      owner: poolCreator.publicKey,
      tokenProgram: mintAAccount.owner,
    });
    const creatorTokenBAssociatedAccount = createAssociatedTokenAccount({
      context: svm,
      mint: mintB,
      owner: poolCreator.publicKey,
      tokenProgram: mintBAccount.owner,
    });

    await mintTo({
      context: svm,
      ata: creatorTokenAAssociatedAccount,
      amount: 1_000_000 * 10 ** mintADecoded.decimals,
    });

    await mintTo({
      context: svm,
      ata: creatorTokenBAssociatedAccount,
      amount: 1_000_000 * 10 ** mintBDecoded.decimals,
    });

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
        Buffer.from(POOL_MINT_SEED), // POOL_MINT_SEED
        mintA.toBuffer(),
        mintB.toBuffer(),
        new BN(feeBp).toBuffer("le", 2), // 2 bytes for feeBp (u16)
      ],
      program.programId
    );

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

    let blockhash = svm.latestBlockhash();
    let tx = new web3.Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(instruction);
    tx.sign(poolCreator);

    svm.sendTransaction(tx);

    // Calculate the LP token account address (will be created by init_if_needed)
    const providerAtaLp = getAssociatedTokenAddressSync(
      lpMint_pda,
      poolCreator.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // test with realistic numbers (random numbers)
    let amountADesired = new BN(533_133).mul(
      new BN(10).pow(new BN(mintADecoded.decimals))
    );
    // test with realistic numbers (random numbers)
    let amountBDesired = new BN(23_414).mul(
      new BN(10).pow(new BN(mintBDecoded.decimals))
    );

    const { amountA, amountB, amountAMin, amountBMin } =
      calculateOptimalAmounts(
        amountADesired,
        amountBDesired,
        new BN(0),
        new BN(0),
        SlippageToleranceBP.Low
      );

    // Add liquidity instruction
    const addLiquidityInstruction = await program.methods
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
        tokenProgramLp: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    blockhash = svm.latestBlockhash();
    tx = new web3.Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(addLiquidityInstruction);
    tx.sign(poolCreator);

    const result = svm.sendTransaction(tx);

    // Verify the pool received the tokens
    const poolAtaAAccount = AccountLayout.decode(
      svm.getAccount(poolTokenVaultA).data
    );
    const poolAtaBAccount = AccountLayout.decode(
      svm.getAccount(poolTokenVaultB).data
    );

    // Check that tokens were transferred to the pool
    assert(new BN(poolAtaAAccount.amount).eq(amountA));
    assert(new BN(poolAtaBAccount.amount).eq(amountB));

    // Verify the provider received LP tokens
    const providerAtaLpAccount = AccountLayout.decode(
      svm.getAccount(providerAtaLp).data
    );

    // Asserts that the provider has received the LP tokens
    // following first deposit formula => sqrt(amountADesired * amountBDesired)
    assert(
      new BN(providerAtaLpAccount.amount).eq(
        bnSqrt(amountADesired.mul(amountBDesired))
      )
    );

    console.log("Successfully added initial liquidity to pool:", {
      poolPda: pool_pda.toBase58(),
      amountA: amountA.toString(),
      amountB: amountB.toString(),
      lpTokensReceived: providerAtaLpAccount.amount.toString(),
    });
  });
});

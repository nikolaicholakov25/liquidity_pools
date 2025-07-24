import * as anchor from "@coral-xyz/anchor";
import {
  AccountLayout,
  createMint,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BankrunProvider } from "anchor-bankrun";
import { ProgramTestContext, startAnchor } from "solana-bankrun";
import IDL from "../../target/idl/liquidity_pools.json";
import { LiquidityPools } from "../../target/types/liquidity_pools";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { LiteSVM } from "../../../litesvm/crates/node-litesvm/litesvm";

export const setUpEnv = async () => {
  const context = await startAnchor("", [], []);
  const provider = new BankrunProvider(context);
  anchor.setProvider(provider);

  const program = new anchor.Program<LiquidityPools>(IDL as LiquidityPools);

  return { context, provider, program };
};

export const airdrop = ({
  context,
  address,
  amount,
}: {
  context: ProgramTestContext;
  address: anchor.web3.PublicKey;
  amount: number;
}) => {
  context.setAccount(address, {
    data: new Uint8Array([]),
    executable: false,
    lamports: amount,
    owner: anchor.web3.SystemProgram.programId,
  });
};

export const createTokenMint = ({
  context,
  decimals = 9,
  tokenProgram = TOKEN_PROGRAM_ID,
  publicKey,
}: {
  context: ProgramTestContext | LiteSVM;
  decimals?: number;
  tokenProgram?: PublicKey;
  publicKey?: PublicKey;
}) => {
  const mint = publicKey ? { publicKey } : Keypair.generate();
  const mintAccountData = Buffer.alloc(MintLayout.span);

  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: Keypair.generate().publicKey,
      supply: BigInt(0),
      decimals: decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    mintAccountData
  );

  // Insert mint account into bankrun context
  context.setAccount(mint.publicKey, {
    data: mintAccountData,
    executable: false,
    lamports: LAMPORTS_PER_SOL,
    owner: tokenProgram,
  });

  return mint.publicKey;
};

export const createAssociatedTokenAccount = ({
  context,
  mint,
  owner,
  allowOwnerOffCurve = false,
  tokenProgram = TOKEN_PROGRAM_ID,
}: {
  context: ProgramTestContext;
  mint: anchor.web3.PublicKey;
  owner: anchor.web3.PublicKey;
  allowOwnerOffCurve?: boolean;
  tokenProgram?: PublicKey;
}) => {
  const associatedTokenAccount = getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    tokenProgram
  );

  const accountData = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount: BigInt(0),
      delegateOption: 0,
      delegate: PublicKey.default,
      delegatedAmount: BigInt(0),
      state: 1, // Initialized
      isNativeOption: 0,
      isNative: BigInt(0),
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    accountData
  );

  context.setAccount(associatedTokenAccount, {
    data: accountData,
    executable: false,
    lamports: LAMPORTS_PER_SOL,
    owner: tokenProgram,
  });

  return associatedTokenAccount;
};

export const mintTo = async ({
  context,
  ata,
  amount,
}: {
  context: ProgramTestContext;
  ata: anchor.web3.PublicKey;
  amount: number;
}) => {
  const accountData = await context.banksClient.getAccount(ata);
  const account = AccountLayout.decode(accountData.data);

  // Update the account data
  account.amount += BigInt(amount);

  const newAccountData = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(account, newAccountData);

  // Update the account in the context
  context.setAccount(ata, {
    data: newAccountData,
    executable: false,
    lamports: LAMPORTS_PER_SOL,
    owner: accountData.owner,
  });
};

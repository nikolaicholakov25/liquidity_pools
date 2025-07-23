import { assert } from "chai";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { CONFIG_SEED } from "../utils/seeds";
import { airdrop, setUpEnv } from "../utils/helpers";

describe("instructions::initialize", () => {
  it("should initialize the program config account", async () => {
    const { context, program, provider } = await setUpEnv();
    const admin = Keypair.generate();

    // Airdrop SOL to the generated admin
    airdrop({
      context,
      address: admin.publicKey,
      amount: LAMPORTS_PER_SOL * 1000,
    });

    // Create a protocol fee recipient keypair
    const protocolFeeRecipientKeypair = Keypair.generate();
    const protocolFeeBp = 100; // 1%

    const [config_pda, config_bump] = PublicKey.findProgramAddressSync(
      [Buffer.from(CONFIG_SEED)],
      program.programId
    );

    // Initialize the program with the admin as the authority
    // and 100 basis points for protocol fees (1%)
    const tx = await program.methods
      .initialize(protocolFeeRecipientKeypair.publicKey, protocolFeeBp)
      .accountsStrict({
        authority: admin.publicKey,
        config: config_pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Fetch the config account
    const configAccount = await program.account.config.fetch(config_pda);

    // Check that the config account was initialized correctly
    assert.equal(
      configAccount.authority.toBase58(),
      admin.publicKey.toBase58()
    );

    // Check that the protocol fee recipient is the admin
    assert.equal(
      configAccount.protocolFeeRecipient.toBase58(),
      protocolFeeRecipientKeypair.publicKey.toBase58()
    );

    // Check the protocol fee basis points is 100 (1%)
    assert.equal(configAccount.protocolFeeBp, protocolFeeBp);
    assert.equal(configAccount.bump, config_bump);
  });
});

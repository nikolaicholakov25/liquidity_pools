import { assert } from "chai";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { CONFIG_SEED } from "../utils/seeds";
import { airdrop, setUpEnv } from "../utils/helpers";
import { ErrorCode } from "../errors";

describe("instructions::update_config", () => {
  it("should update the program config account", async () => {
    const { context, program, provider, admin, config_pda } = await setUpTest();

    const protocolFeeRecipientKeypair = Keypair.generate();
    const protocolFeeBp = 50; // 0.5%

    const tx = await program.methods
      .updateConfig(protocolFeeRecipientKeypair.publicKey, protocolFeeBp)
      .accountsStrict({
        authority: admin.publicKey,
        config: config_pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // fetch the config account
    const configAccount = await program.account.config.fetch(config_pda);

    // check that the protocol fee recipient is the new one
    assert.equal(
      configAccount.protocolFeeRecipient.toBase58(),
      protocolFeeRecipientKeypair.publicKey.toBase58()
    );

    // check that the protocol fee basis points is the new one
    assert.equal(configAccount.protocolFeeBp, protocolFeeBp);
  });

  it("should prevent updating the config account if the signer is not the admin", async () => {
    const { context, program, provider, admin, config_pda } = await setUpTest();

    const nonAdmin = Keypair.generate();
    airdrop({
      context,
      address: nonAdmin.publicKey,
      amount: LAMPORTS_PER_SOL * 1000,
    });

    const protocolFeeRecipientKeypair = Keypair.generate();
    const protocolFeeBp = 50; // 0.5%

    const tx = await program.methods
      .updateConfig(protocolFeeRecipientKeypair.publicKey, protocolFeeBp)
      .accountsStrict({
        authority: nonAdmin.publicKey,
        config: config_pda,
        systemProgram: SystemProgram.programId,
      })
      .signers([nonAdmin])
      .rpc()
      .then(() => assert.fail("Transaction should have failed"))
      .catch((err) =>
        assert.equal(err.error.errorCode.number, ErrorCode.InvalidAuthority)
      );
  });
});

async function setUpTest() {
  const { context, program, provider } = await setUpEnv();

  const admin = Keypair.generate();
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

  return { context, program, provider, admin, config_pda };
}

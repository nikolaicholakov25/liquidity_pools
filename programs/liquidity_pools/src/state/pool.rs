use anchor_lang::prelude::*;

#[account]
#[derive(Default, Debug, InitSpace)]
pub struct Pool {
    pub token_mint_a: Pubkey,
    pub token_mint_b: Pubkey,
    pub token_vault_a: Pubkey,
    pub token_vault_b: Pubkey,
    pub fee_bp: u16,
    pub bump: u8,
}

impl Pool {
    pub const SEED: &'static [u8] = b"pool";
    pub const MINT_SEED: &'static [u8] = b"mint";
}

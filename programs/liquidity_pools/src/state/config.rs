use anchor_lang::prelude::*;

#[account]
#[derive(Default, Debug, InitSpace)]
pub struct Config {
    pub authority: Pubkey,              // Address able to update config account
    pub protocol_fee_recipient: Pubkey, // Address able to claim protocol fees
    pub protocol_fee_bp: u16,           // Basis points for protocol fees (100 = 1%)
    pub bump: u8,
}

impl Config {
    pub const SEED: &[u8] = b"config";
}

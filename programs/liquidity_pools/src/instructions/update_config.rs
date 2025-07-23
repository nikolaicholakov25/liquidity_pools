use crate::error::ErrorCode;
use crate::state::config::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    // CHECK: The signer is the authority of the program
    #[account(
        mut,
        constraint = authority.key() == config.authority @ ErrorCode::InvalidAuthority,
    )]
    pub authority: Signer<'info>,

    // The config account is used to store the config for the program
    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

pub fn update_config(
    ctx: Context<UpdateConfig>,
    protocol_fee_recipient: Option<Pubkey>,
    protocol_fee_bp: Option<u16>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(protocol_fee_recipient) = protocol_fee_recipient {
        config.protocol_fee_recipient = protocol_fee_recipient;
    }

    if let Some(protocol_fee_bp) = protocol_fee_bp {
        config.protocol_fee_bp = protocol_fee_bp;
    }

    Ok(())
}

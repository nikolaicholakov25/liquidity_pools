use crate::state::config::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The authority is the owner of the program
    /// Will be able to create/update config account and collect protocol fees
    #[account(
        mut,
        // Prevent frontrunning the initialize instruction (allow the authority to initialize the program)
        // constraint = Some(authority.key()) == program_data.upgrade_authority_address
    )]
    pub authority: Signer<'info>,

    /// The config account is used to store the config for the program
    /// It will be used to store the config for the fees
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    // pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(
    ctx: Context<Initialize>,
    protocol_fee_recipient: Pubkey,
    protocol_fee_bp: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let authority = &mut ctx.accounts.authority;

    config.authority = authority.key();
    config.protocol_fee_recipient = protocol_fee_recipient;
    config.protocol_fee_bp = protocol_fee_bp;
    config.bump = ctx.bumps.config;

    Ok(())
}

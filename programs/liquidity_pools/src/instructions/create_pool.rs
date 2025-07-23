use crate::error::ErrorCode;
use crate::state::Pool;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
#[instruction(fee_bp: u16)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [
            Pool::SEED,
            token_mint_a.key().as_ref(),
            token_mint_b.key().as_ref(),
            fee_bp.to_le_bytes().as_ref(),
        ],
        constraint = token_mint_a.key() > token_mint_b.key() @ ErrorCode::InvalidTokenOrder,
        bump,
    )]
    pub pool: Account<'info, Pool>,

    // Token A (should be the larger key)
    #[account(
        constraint = *token_mint_a.to_account_info().owner == token_program_a.key() @ ErrorCode::InvalidTokenProgram
    )]
    pub token_mint_a: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = token_mint_a,
        associated_token::authority = pool,
        associated_token::token_program = token_program_a,
    )]
    pub token_vault_a: InterfaceAccount<'info, TokenAccount>,

    // Token B (should be the smaller key)
    #[account(
        constraint = *token_mint_b.to_account_info().owner == token_program_b.key() @ ErrorCode::InvalidTokenProgram
    )]
    pub token_mint_b: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = token_mint_b,
        associated_token::authority = pool,
        associated_token::token_program = token_program_b,
    )]
    pub token_vault_b: InterfaceAccount<'info, TokenAccount>,

    // LP Mint (given to the user, represents the pool shares)
    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = pool,
        mint::freeze_authority = pool,
        mint::token_program = token_program_lp,
        seeds = [
            Pool::MINT_SEED,
            token_mint_a.key().as_ref(),
            token_mint_b.key().as_ref(),
            fee_bp.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub lp_mint: InterfaceAccount<'info, Mint>,

    // Separate token programs for each token (support for tokens with different token programs)
    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,
    // LP Token Program
    pub token_program_lp: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn create_pool(ctx: Context<CreatePool>, fee_bp: u16) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Initialize pool state
    pool.token_mint_a = ctx.accounts.token_mint_a.key();
    pool.token_mint_b = ctx.accounts.token_mint_b.key();
    pool.token_vault_a = ctx.accounts.token_vault_a.key();
    pool.token_vault_b = ctx.accounts.token_vault_b.key();
    pool.fee_bp = fee_bp;
    pool.bump = ctx.bumps.pool;

    Ok(())
}

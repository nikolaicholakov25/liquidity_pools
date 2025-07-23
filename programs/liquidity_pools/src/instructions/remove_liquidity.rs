use crate::error::ErrorCode as CustomErrorCode;
use crate::helpers::transfer::{mint_lp_tokens, transfer_token_to_pool};
use crate::state::Pool;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use spl_math::approximations::sqrt;
use spl_math::precise_number::PreciseNumber;

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    // Provider accounts
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = token_mint_a,
        associated_token::authority = provider,
        associated_token::token_program = token_program_a,
    )]
    pub provider_ata_a: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint_b,
        associated_token::authority = provider,
        associated_token::token_program = token_program_b,
    )]
    pub provider_ata_b: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = provider,
        associated_token::mint = lp_mint,
        associated_token::authority = provider,
        associated_token::token_program = token_program_lp,
    )]
    pub provider_ata_lp: InterfaceAccount<'info, TokenAccount>,

    // Pool accounts
    #[account(
        mut,
        seeds = [
            Pool::SEED,
            pool.token_mint_a.key().as_ref(),
            pool.token_mint_b.key().as_ref(),
            pool.fee_bp.to_le_bytes().as_ref(),
        ],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    // Pool Token A accounts
    pub token_mint_a: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = token_mint_a,
        associated_token::authority = pool,
        associated_token::token_program = token_program_a,
    )]
    pub pool_ata_a: InterfaceAccount<'info, TokenAccount>,

    // Pool Token B accounts
    pub token_mint_b: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = token_mint_b,
        associated_token::authority = pool,
        associated_token::token_program = token_program_b,
    )]
    pub pool_ata_b: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        mint::decimals = 9,
        mint::authority = pool,
        mint::freeze_authority = pool,
        mint::token_program = token_program_lp,
        seeds = [
            Pool::MINT_SEED,
            pool.token_mint_a.key().as_ref(),
            pool.token_mint_b.key().as_ref(),
            pool.fee_bp.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub lp_mint: InterfaceAccount<'info, Mint>,

    // System accounts
    // Separate token programs for each token (support for tokens with different token programs)
    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,
    pub token_program_lp: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn remove_liquidity(
    ctx: Context<RemoveLiquidity>,
    lp_amount: u64,
    amount_a_min: u64,
    amount_b_min: u64,
) -> Result<()> {
    let provider = &mut ctx.accounts.provider;
    let provider_ata_a = &mut ctx.accounts.provider_ata_a;
    let provider_ata_b = &mut ctx.accounts.provider_ata_b;
    let provider_ata_lp = &mut ctx.accounts.provider_ata_lp;

    let token_mint_a = &mut ctx.accounts.token_mint_a;
    let token_mint_b = &mut ctx.accounts.token_mint_b;
    let lp_mint = &mut ctx.accounts.lp_mint;

    let pool = &mut ctx.accounts.pool;
    let pool_ata_a = &mut ctx.accounts.pool_ata_a;
    let pool_ata_b = &mut ctx.accounts.pool_ata_b;

    let token_program_a = &mut ctx.accounts.token_program_a;
    let token_program_b = &mut ctx.accounts.token_program_b;
    let token_program_lp = &mut ctx.accounts.token_program_lp;

    // Validate amounts
    require!(lp_amount > 0, CustomErrorCode::MustBeGreaterThanZero);
    require!(amount_a_min > 0, CustomErrorCode::MustBeGreaterThanZero);
    require!(amount_b_min > 0, CustomErrorCode::MustBeGreaterThanZero);

    // Get current pool reserves
    let reserve_a = pool_ata_a.amount;
    let reserve_b = pool_ata_b.amount;

    // Check pool has liquidity
    require!(reserve_a > 0 && reserve_b > 0, CustomErrorCode::EmptyPool);

    Ok(())
}

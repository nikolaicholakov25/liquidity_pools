use crate::error::ErrorCode;
use crate::helpers::fees::Fees;
use crate::helpers::transfer::{transfer_token_from_pool, transfer_token_to_pool};
use crate::state::Pool;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use spl_math::precise_number::PreciseNumber;

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

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
    pub pool: Account<'info, Pool>,

    // Payer accounts
    #[account(
        mut,
        constraint = payer_ata_input.mint == pool.token_mint_a || payer_ata_input.mint == pool.token_mint_b,
        constraint = payer_ata_input.mint != payer_ata_output.mint,
    )]
    pub payer_ata_input: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = payer_ata_output.mint == pool.token_mint_a || payer_ata_output.mint == pool.token_mint_b,
    )]
    pub payer_ata_output: InterfaceAccount<'info, TokenAccount>,

    // Pool accounts
    #[account(
        mut,
        constraint = pool_ata_input.mint == payer_ata_input.mint,
    )]
    pub pool_ata_input: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = pool_ata_output.mint == payer_ata_output.mint,
    )]
    pub pool_ata_output: InterfaceAccount<'info, TokenAccount>,

    // Token mints for transfer_checked calls
    pub token_mint_input: InterfaceAccount<'info, Mint>,
    pub token_mint_output: InterfaceAccount<'info, Mint>,

    // Separate token programs for each token (support for tokens with different token programs)
    pub token_program_input: Interface<'info, TokenInterface>,
    pub token_program_output: Interface<'info, TokenInterface>,
    // LP Token Program
    pub token_program_lp: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let payer = &mut ctx.accounts.payer;
    let payer_ata_input = &mut ctx.accounts.payer_ata_input;
    let payer_ata_output = &mut ctx.accounts.payer_ata_output;
    let pool_ata_input = &mut ctx.accounts.pool_ata_input;
    let pool_ata_output = &mut ctx.accounts.pool_ata_output;
    let token_mint_input = &mut ctx.accounts.token_mint_input;
    let token_mint_output = &mut ctx.accounts.token_mint_output;
    let token_program_input = &mut ctx.accounts.token_program_input;
    let token_program_output = &mut ctx.accounts.token_program_output;

    // Validate inputs
    require!(amount_in > 0, ErrorCode::MustBeGreaterThanZero);
    require!(min_amount_out > 0, ErrorCode::MustBeGreaterThanZero);

    // Get current pool reserves
    let reserve_in = pool_ata_input.amount;
    let reserve_out = pool_ata_output.amount;

    // Check pool has liquidity
    require!(reserve_in > 0 && reserve_out > 0, ErrorCode::EmptyPool);

    // Calculate fee amount and amount after fee
    let fee_amount = Fees::calculate_fee_tokens(amount_in as u128, pool.fee_bp)? as u64;
    let amount_in_after_fee = amount_in - fee_amount;

    msg!("amount_in: {}", amount_in);
    msg!("fee_amount: {}", fee_amount);
    msg!("amount_in_after_fee: {}", amount_in_after_fee);

    // Constant Product Formula: amount_out = (amount_in_after_fee * reserve_out) / (reserve_in + amount_in_after_fee)
    let amount_in_after_fee_precise = PreciseNumber::new(amount_in_after_fee as u128).unwrap();
    let reserve_in_precise = PreciseNumber::new(reserve_in as u128).unwrap();
    let reserve_out_precise = PreciseNumber::new(reserve_out as u128).unwrap();

    let numerator = amount_in_after_fee_precise
        .checked_mul(&reserve_out_precise)
        .unwrap();
    let denominator = reserve_in_precise
        .checked_add(&amount_in_after_fee_precise)
        .unwrap();
    let amount_out = numerator
        .checked_div(&denominator)
        .unwrap()
        .to_imprecise()
        .unwrap() as u64;

    msg!("amount_out: {}", amount_out);
    // Check slippage protection
    require!(
        amount_out >= min_amount_out,
        ErrorCode::InsufficientOutputAmount
    );

    // Ensure we don't drain the pool
    require!(amount_out < reserve_out, ErrorCode::InsufficientLiquidity);

    // Transfer tokens from payer to pool
    transfer_token_to_pool(
        payer,
        token_mint_input,
        payer_ata_input,
        pool_ata_input,
        token_program_input,
        amount_in,
    )?;

    // Transfer tokens from pool to payer
    transfer_token_from_pool(
        pool,
        token_mint_output,
        pool_ata_output,
        payer_ata_output,
        token_program_output,
        amount_out,
    )?;

    Ok(())
}

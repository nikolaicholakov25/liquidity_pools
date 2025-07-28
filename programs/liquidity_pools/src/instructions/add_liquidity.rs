use crate::error::ErrorCode as CustomErrorCode;
use crate::helpers::transfer::{mint_lp_tokens, transfer_token_to_pool};
use crate::state::Pool;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use spl_math::approximations::sqrt;
use spl_math::precise_number::PreciseNumber;

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
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

pub fn add_liquidity(
    ctx: Context<AddLiquidity>,
    amount_a_desired: u64,
    amount_b_desired: u64,
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
    require!(amount_a_desired > 0, CustomErrorCode::MustBeGreaterThanZero);
    require!(amount_b_desired > 0, CustomErrorCode::MustBeGreaterThanZero);

    // Initial liquidity provision
    // Don't validate tokens deposited ratio
    if pool_ata_a.amount == 0 || pool_ata_b.amount == 0 {
        // Transfer token A to pool
        transfer_token_to_pool(
            provider,
            token_mint_a,
            provider_ata_a,
            pool_ata_a,
            token_program_a,
            amount_a_desired,
        )?;

        // Transfer token B to pool
        transfer_token_to_pool(
            provider,
            token_mint_b,
            provider_ata_b,
            pool_ata_b,
            token_program_b,
            amount_b_desired,
        )?;

        let lp_amount = sqrt(amount_a_desired as u128 * amount_b_desired as u128).unwrap() as u64;

        // Mint LP tokens to the provider
        mint_lp_tokens(lp_mint, provider_ata_lp, pool, lp_amount, token_program_lp)?;

        return Ok(());
    }

    // Calculate optimal amounts
    // Following math logic from https://github.com/Uniswap/v2-periphery/blob/master/contracts/UniswapV2Router01.sol#L46
    // + lps to mint https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol#L110
    let amount_a_desired = PreciseNumber::new(amount_a_desired as u128).unwrap();
    let amount_b_desired = PreciseNumber::new(amount_b_desired as u128).unwrap();
    let reserve_a_pool = PreciseNumber::new(pool_ata_a.amount as u128).unwrap();
    let reserve_b_pool = PreciseNumber::new(pool_ata_b.amount as u128).unwrap();
    let lp_total_supply = PreciseNumber::new(lp_mint.supply as u128).unwrap();

    // Calculate optimal amount of token B to transfer (a_desired * reserve_b / reserve_a)
    let amount_b_optimal = amount_a_desired
        .checked_mul(&reserve_b_pool)
        .unwrap()
        .checked_div(&reserve_a_pool)
        .unwrap();

    // if amount_b_optimal is within desired and amount_b_min, then we can transfer that amount
    if amount_b_optimal.less_than_or_equal(&amount_b_desired) {
        let amount_b_min = PreciseNumber::new(amount_b_min as u128).unwrap();

        // make sure the optimal amount is greater than the minimum amount
        require!(
            amount_b_optimal.greater_than_or_equal(&amount_b_min),
            CustomErrorCode::InsufficientBAmount
        );

        let amount_a_transferred = &amount_a_desired;
        let amount_b_transferred = &amount_b_optimal;
        // transfer token B to pool
        transfer_token_to_pool(
            provider,
            token_mint_b,
            provider_ata_b,
            pool_ata_b,
            token_program_b,
            amount_b_transferred.to_imprecise().unwrap() as u64,
        )?;

        msg!("Transferred token B to pool");

        // transfer token A to pool
        transfer_token_to_pool(
            provider,
            token_mint_a,
            provider_ata_a,
            pool_ata_a,
            token_program_a,
            amount_a_transferred.to_imprecise().unwrap() as u64,
        )?;

        msg!("Transferred token A to pool");

        let lp_amount_by_a = amount_a_transferred
            .checked_mul(&lp_total_supply)
            .unwrap()
            .checked_div(&reserve_a_pool)
            .unwrap()
            .to_imprecise()
            .unwrap() as u64;

        let lp_amount_by_b = amount_b_transferred
            .checked_mul(&lp_total_supply)
            .unwrap()
            .checked_div(&reserve_b_pool)
            .unwrap()
            .to_imprecise()
            .unwrap() as u64;

        msg!("Minted LP tokens");

        mint_lp_tokens(
            lp_mint,
            provider_ata_lp,
            pool,
            std::cmp::min(lp_amount_by_a, lp_amount_by_b),
            token_program_lp,
        )?;

        return Ok(());
    }

    let amount_a_optimal = amount_b_desired
        .checked_mul(&reserve_a_pool)
        .unwrap()
        .checked_div(&reserve_b_pool)
        .unwrap();
    let amount_a_min = PreciseNumber::new(amount_a_min as u128).unwrap();

    assert!(&amount_a_optimal.less_than_or_equal(&amount_a_desired));
    // make sure the optimal amount is greater than the minimum amount
    require!(
        amount_a_optimal.greater_than_or_equal(&amount_a_min),
        CustomErrorCode::InsufficientAAmount
    );

    let amount_a_transferred = &amount_a_optimal;
    let amount_b_transferred = &amount_b_desired;

    // transfer token B to pool
    transfer_token_to_pool(
        provider,
        token_mint_b,
        provider_ata_b,
        pool_ata_b,
        token_program_b,
        amount_b_transferred.to_imprecise().unwrap() as u64,
    )?;

    // transfer token A to pool
    transfer_token_to_pool(
        provider,
        token_mint_a,
        provider_ata_a,
        pool_ata_a,
        token_program_a,
        amount_a_transferred.to_imprecise().unwrap() as u64,
    )?;

    let lp_amount_by_a = amount_a_transferred
        .checked_mul(&lp_total_supply)
        .unwrap()
        .checked_div(&reserve_a_pool)
        .unwrap()
        .to_imprecise()
        .unwrap() as u64;

    let lp_amount_by_b = amount_b_transferred
        .checked_mul(&lp_total_supply)
        .unwrap()
        .checked_div(&reserve_b_pool)
        .unwrap()
        .to_imprecise()
        .unwrap() as u64;

    mint_lp_tokens(
        lp_mint,
        provider_ata_lp,
        pool,
        std::cmp::min(lp_amount_by_a, lp_amount_by_b),
        token_program_lp,
    )?;

    Ok(())
}

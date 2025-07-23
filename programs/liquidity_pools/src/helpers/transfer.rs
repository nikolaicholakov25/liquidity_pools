use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::Pool;

pub fn transfer_token_to_pool<'info>(
    provider: &mut Signer<'info>,
    token_mint: &mut InterfaceAccount<'info, Mint>,
    provider_ata: &mut InterfaceAccount<'info, TokenAccount>,
    pool_ata: &mut InterfaceAccount<'info, TokenAccount>,
    token_program: &mut Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    token_2022::transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            token_2022::TransferChecked {
                from: provider_ata.to_account_info(),
                to: pool_ata.to_account_info(),
                authority: provider.to_account_info(),
                mint: token_mint.to_account_info(),
            },
        ),
        amount,
        token_mint.decimals,
    )?;

    return Ok(());
}

pub fn transfer_token_from_pool<'info>(
    pool: &Account<'info, Pool>,
    token_mint: &InterfaceAccount<'info, Mint>,
    pool_ata: &mut InterfaceAccount<'info, TokenAccount>,
    user_ata: &mut InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    token_2022::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token_2022::TransferChecked {
                from: pool_ata.to_account_info(),
                to: user_ata.to_account_info(),
                authority: pool.to_account_info(),
                mint: token_mint.to_account_info(),
            },
            &[&[
                Pool::SEED,
                pool.token_mint_a.key().as_ref(),
                pool.token_mint_b.key().as_ref(),
                pool.fee_bp.to_le_bytes().as_ref(),
                &[pool.bump],
            ]],
        ),
        amount,
        token_mint.decimals,
    )?;

    Ok(())
}

pub fn mint_lp_tokens<'info>(
    lp_mint: &mut InterfaceAccount<'info, Mint>,
    provider_ata_lp: &mut InterfaceAccount<'info, TokenAccount>,
    pool: &mut Account<'info, Pool>,
    amount: u64,
    token_program: &mut Interface<'info, TokenInterface>,
) -> Result<()> {
    token_2022::mint_to_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token_2022::MintToChecked {
                mint: lp_mint.to_account_info(),
                to: provider_ata_lp.to_account_info(),
                authority: pool.to_account_info(),
            },
            &[&[
                Pool::SEED,
                pool.token_mint_a.key().as_ref(),
                pool.token_mint_b.key().as_ref(),
                pool.fee_bp.to_le_bytes().as_ref(),
                &[pool.bump],
            ]],
        ),
        amount,
        lp_mint.decimals,
    )?;

    return Ok(());
}

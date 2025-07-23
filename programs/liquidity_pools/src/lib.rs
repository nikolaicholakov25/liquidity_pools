mod error;
mod helpers;
mod instructions;
mod state;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("DEWi9FJQE9tjqvTxPtLiEQ9yyHT7JnR5FXLA3GMpx3Np");

#[cfg(not(target_os = "solana"))]
mod coverage {
    use super::*;
    use anchor_lang::solana_program::program_stubs::{set_syscall_stubs, SyscallStubs};
    use anchor_lang::solana_program::{entrypoint::ProgramResult, instruction::Instruction};
    // call coverage macro
    solana_coverage::anchor_coverage!();
}

#[program]
pub mod liquidity_pools {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        protocol_fee_recipient: Pubkey,
        protocol_fee_bp: u16,
    ) -> Result<()> {
        instructions::initialize(ctx, protocol_fee_recipient, protocol_fee_bp)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        protocol_fee_recipient: Option<Pubkey>,
        protocol_fee_bp: Option<u16>,
    ) -> Result<()> {
        instructions::update_config(ctx, protocol_fee_recipient, protocol_fee_bp)
    }

    pub fn create_pool(ctx: Context<CreatePool>, fee_bp: u16) -> Result<()> {
        instructions::create_pool(ctx, fee_bp)
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_a: u64,
        amount_b: u64,
        amount_a_min: u64,
        amount_b_min: u64,
    ) -> Result<()> {
        instructions::add_liquidity(ctx, amount_a, amount_b, amount_a_min, amount_b_min)
    }

    pub fn remove_liquidity(_ctx: Context<RemoveLiquidity>) -> Result<()> {
        Ok(())
    }

    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64) -> Result<()> {
        instructions::swap(ctx, amount_in, min_amount_out)
    }

    pub fn claim_fees(_ctx: Context<ClaimFees>) -> Result<()> {
        Ok(())
    }

    pub fn update_pool(_ctx: Context<UpdatePool>) -> Result<()> {
        Ok(())
    }

    pub fn claim_rewards(_ctx: Context<ClaimRewards>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RemoveLiquidity {}

#[derive(Accounts)]
pub struct ClaimFees {}

#[derive(Accounts)]
pub struct UpdatePool {}

#[derive(Accounts)]
pub struct ClaimRewards {}

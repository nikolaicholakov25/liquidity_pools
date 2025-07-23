use anchor_lang::prelude::*;

// Represents 100%
const FEE_DENOMINATOR: u128 = 10000;

pub struct Fees {}

impl Fees {
    // Calculates: ceil((amount * fee_bp) / 10000)
    pub fn calculate_fee_tokens(amount: u128, fee_bp: u16) -> Result<u128> {
        let tokens_fee = amount
            .checked_mul(fee_bp as u128)
            .unwrap()
            .checked_add(FEE_DENOMINATOR - 1u128)
            .unwrap()
            .checked_div(FEE_DENOMINATOR)
            .unwrap();

        Ok(tokens_fee)
    }
}

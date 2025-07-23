use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid authority")]
    InvalidAuthority = 1,
    #[msg("Invalid protocol fee recipient")]
    InvalidProtocolFeeRecipient = 2,
    #[msg("Invalid token program - token program must match mint owner")]
    InvalidTokenProgram = 3,
    #[msg("Invalid token order - token mint A must be greater than token mint B")]
    InvalidTokenOrder = 4,
    #[msg("Invalid amount - amount must be greater than 0")]
    MustBeGreaterThanZero = 5,
    #[msg("Invalid amount - amount must be greater than 0")]
    InvalidAmount = 6,
    #[msg("Insufficient A amount - amount is below minimum required")]
    InsufficientAAmount = 7,
    #[msg("Insufficient B amount - amount is below minimum required")]
    InsufficientBAmount = 8,
    #[msg("Overflow - operation resulted in an overflow")]
    Overflow = 9,
    #[msg("Underflow - operation resulted in an underflow")]
    Underflow = 10,
    #[msg("Insufficient liquidity in pool for this swap")]
    InsufficientLiquidity = 11,
    #[msg("Output amount below minimum - slippage tolerance exceeded")]
    InsufficientOutputAmount = 12,
    #[msg("Pool has no liquidity")]
    EmptyPool = 13,
}

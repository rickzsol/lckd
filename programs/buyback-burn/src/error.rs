use pinocchio::error::ProgramError;

#[repr(u32)]
pub enum BuybackError {
    InvalidProgramId = 1,
    InvalidInstruction = 2,
    InvalidAccountCount = 3,
    InvalidAccountKey = 4,
    InvalidAccountOwner = 5,
    InvalidAccountFlags = 6,
    InvalidPda = 7,
    InvalidTokenAccount = 8,
    InvalidInitialBalance = 9,
    InvalidFundedBalance = 10,
    MinimumOutputNotMet = 11,
    QuoteNotConsumed = 12,
    BalanceNotRestored = 13,
    ArithmeticOverflow = 14,
}

impl From<BuybackError> for ProgramError {
    fn from(error: BuybackError) -> Self {
        ProgramError::Custom(error as u32)
    }
}

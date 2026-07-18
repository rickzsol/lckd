use pinocchio::{error::ProgramError, AccountView, Address};

use crate::{
    constants::{Pubkey, LCKD_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM},
    error::BuybackError,
};

pub const TOKEN_ACCOUNT_LEN: usize = 165;
const MINT_LEN: usize = 82;
const TOKEN_OWNER_OFFSET: usize = 32;
const TOKEN_AMOUNT_OFFSET: usize = 64;
const TOKEN_STATE_OFFSET: usize = 108;
const MINT_DECIMALS_OFFSET: usize = 44;
const MINT_INITIALIZED_OFFSET: usize = 45;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TokenAccountState {
    pub mint: [u8; 32],
    pub authority: [u8; 32],
    pub amount: u64,
}

pub fn parse_token_account(data: &[u8]) -> Result<TokenAccountState, ProgramError> {
    if data.len() < TOKEN_ACCOUNT_LEN || data[TOKEN_STATE_OFFSET] != 1 {
        return Err(BuybackError::InvalidTokenAccount.into());
    }
    Ok(TokenAccountState {
        mint: data[..32]
            .try_into()
            .map_err(|_| BuybackError::InvalidTokenAccount)?,
        authority: data[TOKEN_OWNER_OFFSET..TOKEN_OWNER_OFFSET + 32]
            .try_into()
            .map_err(|_| BuybackError::InvalidTokenAccount)?,
        amount: u64::from_le_bytes(
            data[TOKEN_AMOUNT_OFFSET..TOKEN_AMOUNT_OFFSET + 8]
                .try_into()
                .map_err(|_| BuybackError::InvalidTokenAccount)?,
        ),
    })
}

pub fn read_token_account(
    account: &AccountView,
    token_program: &Pubkey,
) -> Result<TokenAccountState, ProgramError> {
    if !account.owned_by(&Address::new_from_array(*token_program)) {
        return Err(BuybackError::InvalidAccountOwner.into());
    }
    let data = account.try_borrow()?;
    if !has_valid_token_account_layout(&data, token_program) {
        return Err(BuybackError::InvalidTokenAccount.into());
    }
    parse_token_account(&data)
}

fn has_valid_token_account_layout(data: &[u8], token_program: &Pubkey) -> bool {
    (token_program == &TOKEN_PROGRAM && data.len() == TOKEN_ACCOUNT_LEN)
        || (token_program == &TOKEN_2022_PROGRAM
            && data.len() == 170
            && data[165..] == [2, 7, 0, 0, 0])
}

pub fn validate_mint(
    account: &AccountView,
    token_program: &Pubkey,
    expected_decimals: u8,
) -> Result<(), ProgramError> {
    if !account.owned_by(&Address::new_from_array(*token_program)) {
        return Err(BuybackError::InvalidAccountOwner.into());
    }
    let data = account.try_borrow()?;
    if data.len() < MINT_LEN
        || data[MINT_DECIMALS_OFFSET] != expected_decimals
        || data[MINT_INITIALIZED_OFFSET] != 1
        || data[..4] != [0; 4]
        || data[46..50] != [0; 4]
    {
        return Err(BuybackError::InvalidTokenAccount.into());
    }
    if token_program == &TOKEN_PROGRAM && data.len() != MINT_LEN {
        return Err(BuybackError::InvalidTokenAccount.into());
    }
    if token_program == &TOKEN_2022_PROGRAM && !is_immutable_lckd_mint(&data) {
        return Err(BuybackError::InvalidTokenAccount.into());
    }
    Ok(())
}

fn is_immutable_lckd_mint(data: &[u8]) -> bool {
    const MINT_ACCOUNT_TYPE_OFFSET: usize = 165;
    const METADATA_POINTER_OFFSET: usize = 166;
    const TOKEN_METADATA_OFFSET: usize = 234;
    data.len() == 406
        && data[MINT_ACCOUNT_TYPE_OFFSET] == 1
        && data[METADATA_POINTER_OFFSET..METADATA_POINTER_OFFSET + 4] == [18, 0, 64, 0]
        && data[METADATA_POINTER_OFFSET + 4..METADATA_POINTER_OFFSET + 36] == [0; 32]
        && data[METADATA_POINTER_OFFSET + 36..METADATA_POINTER_OFFSET + 68] == LCKD_MINT
        && data[TOKEN_METADATA_OFFSET..TOKEN_METADATA_OFFSET + 4] == [19, 0, 168, 0]
        && data[TOKEN_METADATA_OFFSET + 4..TOKEN_METADATA_OFFSET + 36] == [0; 32]
        && data[TOKEN_METADATA_OFFSET + 36..TOKEN_METADATA_OFFSET + 68] == LCKD_MINT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_token_account_fields() {
        let mut data = [0u8; TOKEN_ACCOUNT_LEN];
        data[..32].copy_from_slice(&[7; 32]);
        data[TOKEN_OWNER_OFFSET..TOKEN_OWNER_OFFSET + 32].copy_from_slice(&[8; 32]);
        data[TOKEN_AMOUNT_OFFSET..TOKEN_AMOUNT_OFFSET + 8].copy_from_slice(&999u64.to_le_bytes());
        data[TOKEN_STATE_OFFSET] = 1;
        assert_eq!(
            parse_token_account(&data).unwrap(),
            TokenAccountState {
                mint: [7; 32],
                authority: [8; 32],
                amount: 999,
            }
        );
    }

    #[test]
    fn rejects_wrong_length_or_uninitialized_account() {
        assert!(parse_token_account(&[0; TOKEN_ACCOUNT_LEN - 1]).is_err());
        assert!(parse_token_account(&[0; TOKEN_ACCOUNT_LEN]).is_err());
    }

    #[test]
    fn recognizes_only_the_token_2022_immutable_owner_tail() {
        let mut data = [0u8; 170];
        data[TOKEN_STATE_OFFSET] = 1;
        data[165..].copy_from_slice(&[2, 7, 0, 0, 0]);
        assert!(has_valid_token_account_layout(&data, &TOKEN_2022_PROGRAM));
        data[166] = 8;
        assert!(!has_valid_token_account_layout(&data, &TOKEN_2022_PROGRAM));
    }
}

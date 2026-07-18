use pinocchio::{error::ProgramError, AccountView, Address};

use crate::{
    constants::*,
    error::BuybackError,
    token::{read_token_account, validate_mint},
};

pub const OUTER_ACCOUNT_COUNT: usize = 27;
pub const PUMP_ACCOUNT_COUNT: usize = 26;
const USER_VOLUME_ACCOUNT_LEN: usize = 137;
const USER_VOLUME_DISCRIMINATOR: [u8; 8] = [86, 255, 112, 14, 102, 53, 154, 250];

pub struct BuybackAccounts<'a> {
    pub launcher: &'a AccountView,
    pub pump: [&'a AccountView; PUMP_ACCOUNT_COUNT],
    pub authority_bump: u8,
}

impl<'a> BuybackAccounts<'a> {
    pub fn parse(program_id: &Address, accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
        if program_id.as_array() != &PROGRAM_ID {
            return Err(BuybackError::InvalidProgramId.into());
        }
        let [launcher, pool, user, global_config, base_mint, quote_mint, user_base, user_quote, pool_base, pool_quote, protocol_recipient, protocol_quote, base_token_program, quote_token_program, system_program, associated_token_program, event_authority, pump_program, creator_quote, creator_authority, global_volume, user_volume, fee_config, fee_program, pool_v2, buyback_recipient, buyback_quote] =
            accounts
        else {
            return Err(BuybackError::InvalidAccountCount.into());
        };

        require_flags(launcher, true, true)?;
        require_owner(launcher, &SYSTEM_PROGRAM)?;

        let (authority, authority_bump) =
            Address::find_program_address(&[AUTHORITY_SEED], program_id);
        require_key(user, authority.as_array())?;
        require_flags(user, true, false)?;

        require_fixed(pool, &LCKD_POOL, true, false)?;
        require_fixed(global_config, &GLOBAL_CONFIG, false, false)?;
        require_fixed(base_mint, &LCKD_MINT, true, false)?;
        require_fixed(quote_mint, &WSOL_MINT, false, false)?;
        require_fixed(pool_base, &POOL_LCKD_ACCOUNT, true, false)?;
        require_fixed(pool_quote, &POOL_WSOL_ACCOUNT, true, false)?;
        require_fixed(protocol_recipient, &PROTOCOL_FEE_RECIPIENT, true, false)?;
        require_fixed(protocol_quote, &PROTOCOL_FEE_WSOL_ACCOUNT, true, false)?;
        require_program(base_token_program, &TOKEN_2022_PROGRAM)?;
        require_program(quote_token_program, &TOKEN_PROGRAM)?;
        require_program(system_program, &SYSTEM_PROGRAM)?;
        require_program(associated_token_program, &ASSOCIATED_TOKEN_PROGRAM)?;
        require_fixed(event_authority, &PUMP_EVENT_AUTHORITY, false, false)?;
        require_program(pump_program, &PUMP_AMM_PROGRAM)?;
        require_fixed(creator_quote, &CREATOR_VAULT_WSOL_ACCOUNT, true, false)?;
        require_fixed(creator_authority, &CREATOR_VAULT_AUTHORITY, false, false)?;
        require_fixed(global_volume, &GLOBAL_VOLUME_ACCUMULATOR, false, false)?;
        require_fixed(fee_config, &FEE_CONFIG, false, false)?;
        require_program(fee_program, &PUMP_FEE_PROGRAM)?;
        require_fixed(pool_v2, &LCKD_POOL_V2, false, false)?;
        require_fixed(buyback_recipient, &BUYBACK_FEE_RECIPIENT, true, false)?;
        require_fixed(buyback_quote, &BUYBACK_FEE_WSOL_ACCOUNT, true, false)?;

        let expected_user_base = derive_ata(&authority, &LCKD_MINT, &TOKEN_2022_PROGRAM);
        let expected_user_quote = derive_ata(&authority, &WSOL_MINT, &TOKEN_PROGRAM);
        let expected_user_volume = Address::find_program_address(
            &[b"user_volume_accumulator", authority.as_ref()],
            &Address::new_from_array(PUMP_AMM_PROGRAM),
        )
        .0;
        require_fixed(user_base, expected_user_base.as_array(), true, false)?;
        require_fixed(user_quote, expected_user_quote.as_array(), true, false)?;
        require_fixed(user_volume, expected_user_volume.as_array(), true, false)?;

        require_owner(pool, &PUMP_AMM_PROGRAM)?;
        require_owner(global_config, &PUMP_AMM_PROGRAM)?;
        require_owner(global_volume, &PUMP_AMM_PROGRAM)?;
        validate_user_volume_account(user_volume, authority.as_array())?;
        require_owner(fee_config, &PUMP_FEE_PROGRAM)?;
        validate_mint(base_mint, &TOKEN_2022_PROGRAM, 6)?;
        validate_mint(quote_mint, &TOKEN_PROGRAM, 9)?;

        validate_token(
            user_base,
            &TOKEN_2022_PROGRAM,
            &LCKD_MINT,
            authority.as_array(),
        )?;
        validate_token(user_quote, &TOKEN_PROGRAM, &WSOL_MINT, authority.as_array())?;
        validate_token(pool_base, &TOKEN_2022_PROGRAM, &LCKD_MINT, &LCKD_POOL)?;
        validate_token(pool_quote, &TOKEN_PROGRAM, &WSOL_MINT, &LCKD_POOL)?;
        validate_token(
            protocol_quote,
            &TOKEN_PROGRAM,
            &WSOL_MINT,
            &PROTOCOL_FEE_RECIPIENT,
        )?;
        validate_token(
            creator_quote,
            &TOKEN_PROGRAM,
            &WSOL_MINT,
            &CREATOR_VAULT_AUTHORITY,
        )?;
        validate_token(
            buyback_quote,
            &TOKEN_PROGRAM,
            &WSOL_MINT,
            &BUYBACK_FEE_RECIPIENT,
        )?;

        Ok(Self {
            launcher,
            pump: [
                pool,
                user,
                global_config,
                base_mint,
                quote_mint,
                user_base,
                user_quote,
                pool_base,
                pool_quote,
                protocol_recipient,
                protocol_quote,
                base_token_program,
                quote_token_program,
                system_program,
                associated_token_program,
                event_authority,
                pump_program,
                creator_quote,
                creator_authority,
                global_volume,
                user_volume,
                fee_config,
                fee_program,
                pool_v2,
                buyback_recipient,
                buyback_quote,
            ],
            authority_bump,
        })
    }

    pub fn authority(&self) -> &AccountView {
        self.pump[1]
    }

    pub fn lckd_mint(&self) -> &AccountView {
        self.pump[3]
    }

    pub fn lckd_account(&self) -> &AccountView {
        self.pump[5]
    }

    pub fn wsol_account(&self) -> &AccountView {
        self.pump[6]
    }

    pub fn protocol_wsol_account(&self) -> &AccountView {
        self.pump[10]
    }

    pub fn user_volume(&self) -> &AccountView {
        self.pump[20]
    }
}

fn validate_user_volume_account(
    account: &AccountView,
    expected_user: &Pubkey,
) -> Result<(), ProgramError> {
    if !account.owned_by(&Address::new_from_array(PUMP_AMM_PROGRAM)) {
        return Err(BuybackError::InvalidAccountOwner.into());
    }
    let data = account.try_borrow()?;
    if !has_valid_user_volume_layout(&data, expected_user) {
        return Err(BuybackError::InvalidTokenAccount.into());
    }
    Ok(())
}

fn has_valid_user_volume_layout(data: &[u8], expected_user: &Pubkey) -> bool {
    data.len() == USER_VOLUME_ACCOUNT_LEN
        && data[..8] == USER_VOLUME_DISCRIMINATOR
        && data[8..40] == *expected_user
}

fn derive_ata(authority: &Address, mint: &Pubkey, token_program: &Pubkey) -> Address {
    Address::find_program_address(
        &[authority.as_ref(), token_program.as_ref(), mint.as_ref()],
        &Address::new_from_array(ASSOCIATED_TOKEN_PROGRAM),
    )
    .0
}

fn validate_token(
    account: &AccountView,
    token_program: &Pubkey,
    expected_mint: &Pubkey,
    expected_authority: &Pubkey,
) -> Result<(), ProgramError> {
    let state = read_token_account(account, token_program)?;
    if &state.mint != expected_mint || &state.authority != expected_authority {
        return Err(BuybackError::InvalidTokenAccount.into());
    }
    Ok(())
}

fn require_key(account: &AccountView, expected: &Pubkey) -> Result<(), ProgramError> {
    if account.address().as_array() != expected {
        return Err(BuybackError::InvalidAccountKey.into());
    }
    Ok(())
}

fn require_flags(
    account: &AccountView,
    is_writable: bool,
    is_signer: bool,
) -> Result<(), ProgramError> {
    if account.is_writable() != is_writable || account.is_signer() != is_signer {
        return Err(BuybackError::InvalidAccountFlags.into());
    }
    Ok(())
}

fn require_fixed(
    account: &AccountView,
    expected: &Pubkey,
    is_writable: bool,
    is_signer: bool,
) -> Result<(), ProgramError> {
    require_key(account, expected)?;
    require_flags(account, is_writable, is_signer)
}

fn require_owner(account: &AccountView, owner: &Pubkey) -> Result<(), ProgramError> {
    if !account.owned_by(&Address::new_from_array(*owner)) {
        return Err(BuybackError::InvalidAccountOwner.into());
    }
    Ok(())
}

fn require_program(account: &AccountView, expected: &Pubkey) -> Result<(), ProgramError> {
    require_fixed(account, expected, false, false)?;
    if !account.executable() {
        return Err(BuybackError::InvalidAccountFlags.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_exact_user_volume_layout() {
        let user = [7; 32];
        let mut data = [0u8; USER_VOLUME_ACCOUNT_LEN];
        data[..8].copy_from_slice(&USER_VOLUME_DISCRIMINATOR);
        data[8..40].copy_from_slice(&user);
        assert!(has_valid_user_volume_layout(&data, &user));
        data[40] = 1;
        assert!(has_valid_user_volume_layout(&data, &user));
        data[8] = 8;
        assert!(!has_valid_user_volume_layout(&data, &user));
    }
}

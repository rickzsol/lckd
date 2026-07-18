use pinocchio::error::ProgramError;

use crate::{constants::PUMP_BUY_EXACT_QUOTE_IN_DISCRIMINATOR, error::BuybackError};

pub const EXECUTE_DISCRIMINATOR: u8 = 0;
pub const EXECUTE_DATA_LEN: usize = 9;
pub const PUMP_DATA_LEN: usize = 25;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExecuteArgs {
    pub min_base_amount_out: u64,
}

pub fn parse_execute_args(data: &[u8]) -> Result<ExecuteArgs, ProgramError> {
    if data.len() != EXECUTE_DATA_LEN || data[0] != EXECUTE_DISCRIMINATOR {
        return Err(BuybackError::InvalidInstruction.into());
    }
    let amount = u64::from_le_bytes(
        data[1..]
            .try_into()
            .map_err(|_| BuybackError::InvalidInstruction)?,
    );
    if amount == 0 {
        return Err(BuybackError::InvalidInstruction.into());
    }
    Ok(ExecuteArgs {
        min_base_amount_out: amount,
    })
}

pub fn build_pump_data(spendable_quote_in: u64, min_base_amount_out: u64) -> [u8; 25] {
    let mut data = [0u8; PUMP_DATA_LEN];
    data[..8].copy_from_slice(&PUMP_BUY_EXACT_QUOTE_IN_DISCRIMINATOR);
    data[8..16].copy_from_slice(&spendable_quote_in.to_le_bytes());
    data[16..24].copy_from_slice(&min_base_amount_out.to_le_bytes());
    data[24] = 0; // OptionBool(false): do not initialize or update volume tracking.
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_exact_execute_layout() {
        let mut data = [0u8; EXECUTE_DATA_LEN];
        data[1..].copy_from_slice(&123u64.to_le_bytes());
        assert_eq!(
            parse_execute_args(&data).unwrap(),
            ExecuteArgs {
                min_base_amount_out: 123
            }
        );
    }

    #[test]
    fn rejects_zero_or_trailing_data() {
        assert!(parse_execute_args(&[0; EXECUTE_DATA_LEN]).is_err());
        assert!(parse_execute_args(&[0; EXECUTE_DATA_LEN + 1]).is_err());
        let mut data = [0u8; EXECUTE_DATA_LEN];
        data[0] = 1;
        data[1] = 1;
        assert!(parse_execute_args(&data).is_err());
    }

    #[test]
    fn encodes_pump_exact_quote_in_without_client_controlled_fields() {
        let data = build_pump_data(100_000_000, 77);
        assert_eq!(&data[..8], &PUMP_BUY_EXACT_QUOTE_IN_DISCRIMINATOR);
        assert_eq!(
            u64::from_le_bytes(data[8..16].try_into().unwrap()),
            100_000_000
        );
        assert_eq!(u64::from_le_bytes(data[16..24].try_into().unwrap()), 77);
        assert_eq!(data[24], 0);
    }
}

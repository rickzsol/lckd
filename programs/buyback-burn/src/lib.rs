#![cfg_attr(target_os = "solana", no_std)]

pub mod accounts;
pub mod constants;
pub mod error;
pub mod instruction;
pub mod token;

use accounts::BuybackAccounts;
use constants::{
    AUTHORITY_SEED, BUYBACK_LAMPORTS, PUMP_AMM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM,
};
use error::BuybackError;
use instruction::{build_pump_data, parse_execute_args};
use pinocchio::{
    cpi::{invoke_signed, Seed, Signer},
    default_allocator,
    instruction::{InstructionAccount, InstructionView},
    nostd_panic_handler, program_entrypoint, AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::Transfer as SystemTransfer;
use pinocchio_token::instructions::{SyncNative, Transfer as TokenTransfer};
use token::read_token_account;

#[cfg(not(feature = "no-entrypoint"))]
program_entrypoint!(process_instruction);
#[cfg(not(feature = "no-entrypoint"))]
default_allocator!();
#[cfg(not(feature = "no-entrypoint"))]
nostd_panic_handler!();

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let args = parse_execute_args(instruction_data)?;
    let ctx = BuybackAccounts::parse(program_id, accounts)?;
    execute(ctx, args.min_base_amount_out)
}

fn execute(ctx: BuybackAccounts<'_>, min_base_amount_out: u64) -> ProgramResult {
    let lckd_before = read_token_account(ctx.lckd_account(), &TOKEN_2022_PROGRAM)?.amount;
    let bump = [ctx.authority_bump];
    let signer_seeds = [Seed::from(AUTHORITY_SEED), Seed::from(&bump)];
    let signer = Signer::from(&signer_seeds);

    SyncNative {
        native_token: ctx.wsol_account(),
    }
    .invoke()?;
    let donated_wsol = read_token_account(ctx.wsol_account(), &TOKEN_PROGRAM)?.amount;
    if let Some(sweep_amount) = donated_wsol_sweep(donated_wsol) {
        TokenTransfer {
            from: ctx.wsol_account(),
            to: ctx.protocol_wsol_account(),
            authority: ctx.authority(),
            amount: sweep_amount,
        }
        .invoke_signed(core::slice::from_ref(&signer))?;
    }
    if read_token_account(ctx.wsol_account(), &TOKEN_PROGRAM)?.amount != 0 {
        return Err(BuybackError::InvalidInitialBalance.into());
    }

    ctx.launcher
        .lamports()
        .checked_sub(BUYBACK_LAMPORTS)
        .ok_or(BuybackError::ArithmeticOverflow)?;

    SystemTransfer {
        from: ctx.launcher,
        to: ctx.wsol_account(),
        lamports: BUYBACK_LAMPORTS,
    }
    .invoke()?;
    SyncNative {
        native_token: ctx.wsol_account(),
    }
    .invoke()?;
    if read_token_account(ctx.wsol_account(), &TOKEN_PROGRAM)?.amount != BUYBACK_LAMPORTS {
        return Err(BuybackError::InvalidFundedBalance.into());
    }

    invoke_pump_buy(&ctx, min_base_amount_out, core::slice::from_ref(&signer))?;

    if !ctx
        .user_volume()
        .owned_by(&Address::new_from_array(PUMP_AMM_PROGRAM))
        || ctx.user_volume().is_data_empty()
    {
        return Err(BuybackError::InvalidAccountOwner.into());
    }
    if read_token_account(ctx.wsol_account(), &TOKEN_PROGRAM)?.amount != 0 {
        return Err(BuybackError::QuoteNotConsumed.into());
    }
    let lckd_after_buy = read_token_account(ctx.lckd_account(), &TOKEN_2022_PROGRAM)?.amount;
    let acquired = lckd_after_buy
        .checked_sub(lckd_before)
        .ok_or(BuybackError::ArithmeticOverflow)?;
    if acquired == 0 || acquired < min_base_amount_out {
        return Err(BuybackError::MinimumOutputNotMet.into());
    }

    burn_lckd(&ctx, acquired, &[signer])?;

    if read_token_account(ctx.lckd_account(), &TOKEN_2022_PROGRAM)?.amount != lckd_before
        || read_token_account(ctx.wsol_account(), &TOKEN_PROGRAM)?.amount != 0
    {
        return Err(BuybackError::BalanceNotRestored.into());
    }
    Ok(())
}

fn donated_wsol_sweep(amount: u64) -> Option<u64> {
    (amount > 0).then_some(amount)
}

fn burn_lckd(ctx: &BuybackAccounts<'_>, amount: u64, signers: &[Signer]) -> ProgramResult {
    let accounts = [
        InstructionAccount::writable(ctx.lckd_account().address()),
        InstructionAccount::writable(ctx.lckd_mint().address()),
        InstructionAccount::readonly_signer(ctx.authority().address()),
    ];
    let mut data = [0u8; 9];
    data[0] = 8;
    data[1..].copy_from_slice(&amount.to_le_bytes());
    let token_program = Address::new_from_array(TOKEN_2022_PROGRAM);
    let instruction = InstructionView {
        program_id: &token_program,
        accounts: &accounts,
        data: &data,
    };
    invoke_signed(
        &instruction,
        &[ctx.lckd_account(), ctx.lckd_mint(), ctx.authority()],
        signers,
    )
}

fn invoke_pump_buy(
    ctx: &BuybackAccounts<'_>,
    min_base_amount_out: u64,
    signers: &[Signer],
) -> ProgramResult {
    let p = &ctx.pump;
    let metas = [
        InstructionAccount::writable(p[0].address()),
        InstructionAccount::writable_signer(p[1].address()),
        InstructionAccount::readonly(p[2].address()),
        InstructionAccount::readonly(p[3].address()),
        InstructionAccount::readonly(p[4].address()),
        InstructionAccount::writable(p[5].address()),
        InstructionAccount::writable(p[6].address()),
        InstructionAccount::writable(p[7].address()),
        InstructionAccount::writable(p[8].address()),
        InstructionAccount::readonly(p[9].address()),
        InstructionAccount::writable(p[10].address()),
        InstructionAccount::readonly(p[11].address()),
        InstructionAccount::readonly(p[12].address()),
        InstructionAccount::readonly(p[13].address()),
        InstructionAccount::readonly(p[14].address()),
        InstructionAccount::readonly(p[15].address()),
        InstructionAccount::readonly(p[16].address()),
        InstructionAccount::writable(p[17].address()),
        InstructionAccount::readonly(p[18].address()),
        InstructionAccount::readonly(p[19].address()),
        InstructionAccount::writable(p[20].address()),
        InstructionAccount::readonly(p[21].address()),
        InstructionAccount::readonly(p[22].address()),
        InstructionAccount::readonly(p[23].address()),
        InstructionAccount::readonly(p[24].address()),
        InstructionAccount::writable(p[25].address()),
    ];
    let data = build_pump_data(BUYBACK_LAMPORTS, min_base_amount_out);
    let instruction = InstructionView {
        program_id: p[16].address(),
        accounts: &metas,
        data: &data,
    };
    invoke_signed(&instruction, p, signers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sweeps_the_full_donated_wsol_balance_before_funding() {
        assert_eq!(donated_wsol_sweep(0), None);
        assert_eq!(donated_wsol_sweep(1), Some(1));
        assert_eq!(donated_wsol_sweep(u64::MAX), Some(u64::MAX));
    }
}

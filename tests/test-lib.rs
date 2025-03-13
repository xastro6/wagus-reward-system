use solana_program::pubkey::Pubkey;
use solana_program::account_info::AccountInfo;
use solana_program::entrypoint::ProgramResult;
use solana_program::msg;
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Debug, Default, PartialEq)]
pub struct RewardAccount {
    pub rewards_claimed: u32,
    pub mint: Pubkey,
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    msg!("Test Reward System Program Entry");

    let accounts_iter = &mut accounts.iter();
    let account = accounts_iter.next().ok_or(solana_program::program_error::ProgramError::NotEnoughAccountKeys)?;

    if account.owner != program_id {
        msg!("Account has incorrect program ID.");
        return Err(solana_program::program_error::ProgramError::IncorrectProgramId);
    }

    let mut reward_account = RewardAccount::try_from_slice(&account.data.borrow())?;

    if instruction_data.len() < 1 {
        return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
    }

    match instruction_data[0] {
        1 => {
            reward_account.rewards_claimed += 1;
            msg!("Reward claimed: {}", reward_account.rewards_claimed);
        }
        _ => {
            msg!("Invalid instruction.");
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }
    }

    reward_account.serialize(&mut &mut account.data.borrow_mut()[..])?;

    Ok(())
}

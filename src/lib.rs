#![no_std]

extern crate alloc;
use alloc::format;

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    program_pack::Pack,
};
use spl_token::{
    instruction::mint_to,
    state::Account as TokenAccount,
    ID as TOKEN_PROGRAM_ID, // Use the official SPL Token program ID
};
use borsh::{BorshDeserialize, BorshSerialize};

// Define instructions
#[derive(BorshSerialize, BorshDeserialize)]
pub enum RewardInstruction {
    MintToken { amount: u64 },
}

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    msg!("WAGUS Token Minting Program");

    let accounts_iter = &mut accounts.iter();
    let signer = next_account_info(accounts_iter)?;
    let mint_account = next_account_info(accounts_iter)?;
    let user_token_account = next_account_info(accounts_iter)?;
    let mint_authority = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;

    // Ensure the signer is valid
    if !signer.is_signer {
        msg!("Signer must sign the transaction.");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Check if the token program ID is correct
    if *token_program.key != TOKEN_PROGRAM_ID {
        msg!("Invalid token program ID.");
        return Err(ProgramError::IncorrectProgramId);
    }

    // Check if the user's token account is correctly associated with the mint account
    let token_account_data = TokenAccount::unpack(&user_token_account.data.borrow())?;
    if token_account_data.mint != *mint_account.key {
        msg!("User token account does not match the mint.");
        return Err(ProgramError::InvalidAccountData);
    }

    // Log mint and user token account keys for debugging
    msg!("Mint account key: {}", mint_account.key);
    msg!("User token account key: {}", user_token_account.key);

    // Ensure the mint authority is correct (using PDA)
    let (expected_pda, bump_seed) = Pubkey::find_program_address(&[b"mint_auth"], program_id);
    if *mint_authority.key != expected_pda {
        msg!("Incorrect mint authority.");
        return Err(ProgramError::InvalidAccountData);
    }

    // Deserialize the instruction data
    let instruction = RewardInstruction::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // Handle the minting instruction
    match instruction {
        RewardInstruction::MintToken { amount } => {
            // Log the amount being minted
            msg!("Minting {} WAGUS tokens to user token account", amount);

            // Define signer seeds for invoking the instruction
            let signer_seeds: &[&[u8]] = &[b"mint_auth", &[bump_seed]];

            // Create the minting instruction
            let mint_ix = mint_to(
                token_program.key,
                mint_account.key,
                user_token_account.key,
                mint_authority.key,
                &[],
                amount,
            )?;

            // Invoke the mint instruction
            invoke_signed(
                &mint_ix,
                &[
                    mint_account.clone(),
                    user_token_account.clone(),
                    mint_authority.clone(),
                    token_program.clone(),
                ],
                &[signer_seeds],
            )?;

            // Log the successful minting
            msg!("Successfully minted {} WAGUS tokens to {}", amount, user_token_account.key);
        }
    }

    Ok(())
}

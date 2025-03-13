import {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SystemProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, getMint, getMinimumBalanceForRentExemptMint, MINT_SIZE } from '@solana/spl-token';
import { readFileSync } from 'fs';
import { serialize } from 'borsh';

// Connection configuration
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Load payer keypair
let payer;
try {
    payer = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(readFileSync('./payer-keypair.json', 'utf8')))
    );
} catch (error) {
    console.error('Failed to load keypair:', error);
    process.exit(1);
}

// Constants
const PROGRAM_ID = new PublicKey("2ga161fxHesc8YATYz2CconNkTSpCJVABrjbBKGtRYGF");
let MINT_ADDRESS; // Will be set dynamically after creation

// Function to send transaction
async function sendTransaction(instruction) {
    try {
        const transaction = new Transaction();
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        
        transaction.feePayer = payer.publicKey;
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        transaction.add(instruction);

        const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
        console.log('Transaction confirmed:', signature);
        return signature;
    } catch (error) {
        console.error('Transaction failed:', error);
        throw error;
    }
}

// Create a new mint with PDA as authority
async function createTokenMintIfNeeded() {
    try {
        if (MINT_ADDRESS) {
            await getMint(connection, MINT_ADDRESS);
            console.log('Mint already exists:', MINT_ADDRESS.toBase58());
        } else {
            console.log('Mint does not exist, creating a new one with PDA authority...');
            const mintKeypair = Keypair.generate();
            MINT_ADDRESS = mintKeypair.publicKey;

            const [mintAuthority, bump] = PublicKey.findProgramAddressSync(
                [Buffer.from("mint_auth")],
                PROGRAM_ID
            );

            // Log values for debugging
            console.log('Mint Address:', MINT_ADDRESS.toBase58());
            console.log('Mint Authority (PDA):', mintAuthority.toBase58());
            console.log('Program ID:', PROGRAM_ID.toBase58());
            console.log('TOKEN_PROGRAM_ID:', TOKEN_PROGRAM_ID.toBase58());

            const lamports = await getMinimumBalanceForRentExemptMint(connection);

            // Manually construct InitializeMint instruction data
            const decimals = 9;
            const instructionData = Buffer.alloc(1 + 1 + 32 + 1 + 32); // Instruction ID + Decimals + Mint Authority + Freeze Option + Freeze Authority
            let offset = 0;
            instructionData.writeUInt8(0, offset); // Instruction ID: InitializeMint (0)
            offset += 1;
            instructionData.writeUInt8(decimals, offset); // Decimals
            offset += 1;
            instructionData.fill(mintAuthority.toBytes(), offset, offset + 32); // Mint Authority (PDA)
            offset += 32;
            instructionData.writeUInt8(1, offset); // Freeze Authority Option: Present (1)
            offset += 1;
            instructionData.fill(mintAuthority.toBytes(), offset, offset + 32); // Freeze Authority (same PDA)

            const transaction = new Transaction().add(
                SystemProgram.createAccount({
                    fromPubkey: payer.publicKey,
                    newAccountPubkey: MINT_ADDRESS,
                    space: MINT_SIZE,
                    lamports,
                    programId: TOKEN_PROGRAM_ID,
                }),
                new TransactionInstruction({
                    keys: [
                        { pubkey: MINT_ADDRESS, isSigner: false, isWritable: true }, // Mint account
                        { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false }, // Rent sysvar
                    ],
                    programId: TOKEN_PROGRAM_ID,
                    data: instructionData,
                })
            );

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.lastValidBlockHeight = lastValidBlockHeight;
            transaction.feePayer = payer.publicKey;

            const signature = await sendAndConfirmTransaction(connection, transaction, [payer, mintKeypair]);
            console.log('New mint created with PDA authority:', MINT_ADDRESS.toBase58(), 'Tx:', signature);
        }
    } catch (error) {
        console.error('Error creating mint:', error);
        throw error;
    }
    return MINT_ADDRESS;
}

// Mint and send tokens
async function mintAndSendTokens(userWallet, amount = 1000n) {
    try {
        console.log(`Attempting to get or create ATA for mint: ${MINT_ADDRESS.toBase58()} and owner: ${userWallet.toBase58()}`);
        
        // Verify the mint exists
        const mintInfo = await getMint(connection, MINT_ADDRESS);
        console.log('Mint account verified. Decimals:', mintInfo.decimals);

        // Get or create user's associated token account
        const userTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            payer,
            MINT_ADDRESS,
            userWallet,
            false,
            'confirmed'
        );
        const userTokenAddress = userTokenAccount.address;
        console.log('User ATA:', userTokenAddress.toBase58());

        // Use the PDA as the mint authority
        const [mintAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_auth")],
            PROGRAM_ID
        );
        console.log('Mint Authority (PDA):', mintAuthority.toBase58());

        // Define the instruction data correctly
        const instructionData = Buffer.alloc(9); // 1 byte for enum discriminant + 8 bytes for u64
        instructionData.writeUInt8(0, 0); // Discriminant for MintToken (assuming 0)
        instructionData.writeBigUInt64LE(BigInt(amount), 1); // Write amount as little-endian u64

        // Log the instruction data for debugging
        console.log('Instruction Data (hex):', instructionData.toString('hex'));

        // Verify the data is not empty
        if (instructionData.length === 0) {
            throw new Error('Instruction data is empty!');
        }

        // Create program instruction
        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: false },         // Signer
                { pubkey: MINT_ADDRESS, isSigner: false, isWritable: true },            // Mint account
                { pubkey: userTokenAddress, isSigner: false, isWritable: true },        // User token account
                { pubkey: mintAuthority, isSigner: false, isWritable: false },          // Mint authority (PDA)
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },       // Token program
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });

        // Send the transaction
        return await sendTransaction(instruction);
    } catch (error) {
        console.error('Error minting and sending tokens:', error);
        throw error;
    }
}

// Check payer balance
async function checkPayerBalance() {
    try {
        const balance = await connection.getBalance(payer.publicKey);
        console.log(`Payer Public Key: ${payer.publicKey.toBase58()}`);
        console.log(`Balance: ${balance / 1e9} SOL`);
        return balance;
    } catch (error) {
        console.error('Error checking balance:', error);
        throw error;
    }
}

// Main execution
async function main() {
    try {
        console.log('Starting mint and send operation...');
        
        await checkPayerBalance();

        // Create or verify the mint
        await createTokenMintIfNeeded();

        const userWallet = new PublicKey("nbmoqeQTPMzjU4rXs9XDPGaWkGtanjYxtXx7RWi4T9n");
        const mintTxSignature = await mintAndSendTokens(userWallet, 1000n);
        console.log(`Tokens minted and sent to user wallet with tx signature: ${mintTxSignature}`);
        
        console.log('Operation completed successfully');
    } catch (error) {
        console.error('Main execution failed:', error);
        process.exit(1);
    }
}

if (import.meta.url === new URL(import.meta.url).href) {
    main().catch(console.error);
}

export { mintAndSendTokens, checkPayerBalance };

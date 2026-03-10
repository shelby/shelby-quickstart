# Shelby Quick-Start Guide for Users

Welcome to Shelby! This interactive guide helps you set up your account and start interacting with the protocol on Aptos.

### Phase 1: Wallet Setup
- Install an Aptos Wallet: Download Petra or Pontem.
- Secure your Secret Phrase: Never share your recovery phrase with anyone!
- Get APT for Gas: Transfer a small amount of APT to your wallet to cover transaction fees.

### Phase 2: Technical Verification
If you are a power user, you can verify your account status using this Aptos SDK snippet:

import { AptosClient } from "aptos";
const client = new AptosClient("https://fullnode.mainnet.aptoslabs.com");
async function checkAccount(address: string) {
  try {
    const resources = await client.getAccountResources(address);
    console.log("Status: Your account is ready for Shelby!");
  } catch (e) {
    console.error("Status: Account not found. Please fund your wallet with APT.");
  }
}

### Phase 3: Exploring Features
- Connect your wallet to the Shelby Dashboard.
- Explore available Real-World Assets (RWA).
- Monitor your portfolio and rewards.

Found a bug? Open an Issue or join our Discord community!

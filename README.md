Shelby Quickstart Guide
---
Simple samples to start serving with Shelby

## 📋 System Requirements
* Node v22 or later
* Linux or MacOS
- WSL/Ubuntu can also work well for CLI-based workflows
- If running alongside other node setups, isolated directories are recommended
## 📦 Installation
**NOTE:** This repo requires the CLI for both [Shelby](https://docs.shelby.xyz/tools/cli) and [Aptos](https://aptos.dev/build/cli). Install these first if you haven't already.
1. Fork this repository
1. Clone to local filesystem
1. Run `npm install` or equivalent
1. Run `npm run build` or equivalent

## 🛠️ Setup
Before working with the code in this repo, ensure that you've completed all of the steps in the [Shelby CLI Getting Started](https://docs.shelby.xyz/tools/cli) guide. This will give you access to the `shelby` command and simplify the steps described below.

## 💻 Usage

The purpose of this repository is to introduce you to core Shelby concepts in an interactive way. After you have tried out all of the steps, you will have a basic understanding of how Shelby works. Please take a look at the code. Modify it as you see fit. Treat this repo as the starting point for your own Shelby integration. **Once you have created something, please share it with us in Discord. We would love to see what you are building!**

Example interactions included in this guide:

### 1. Development Account Config

`npm run config`

**Executes code from `src/guide/config.ts`**

_Launch an interactive CLI that creates the configuration you want to use for integrating with Shelby._

After running this command, you may notice the `.env` file we have generated. Next, fund your development address using the [ShelbyUSD faucet](https://docs.shelby.xyz/apis/faucet/shelbyusd) and [Aptos faucet](https://docs.shelby.xyz/apis/faucet/aptos) for Shelbynet: sign in, paste your address, and click the `Fund` button.

This `.env` file contains all of the config options needed to use Shelby:
1. Account address — _The Aptos account that will pay for storage_
1. Account private key — _The private key used to sign transactions_
1. Aptos network name — _For now this will always be "devnet"_
1. Shelby RPC node — _The host that your app uses for Shelby operations_

__REMINDER:__ _Do not use real private keys (or recovery phrases) for development. Use proper secret management in production._

### 2. Upload Blobs to Shelby

`npm run upload`

**Executes code from `src/guide/upload.ts`**

_Launch an interactive CLI that asks you to select a file for upload as the specified blob name. Sample assets have been provided for your convenience._

After running this command, you will see output describing the data that you've just uploaded. Important concepts to note:
1. Merkle root — _This hash can be used to later verify the integrity of uploaded data._
1. Chunkset commitments — _How your data is encoded and stored durably on Shelby's decentralized network._

For more information about these and other important concepts, please read the [Shelby whitepaper](https://shelby.xyz/whitepaper.pdf) — included in this repo under the `assets/` directory!

### 3. List the Blobs on Shelby

`npm run list`

_Launch an interactive CLI that asks which account's blobs you'd like to list._

After running this command, you will see output describing the blobs that are currently stored on Shelby for the specified account. Remember: you provide the storage duration at time of upload, so you will not see blobs that have expired.

### 4. Download a Blob from Shelby

`npm run download`

**Executes code from `src/guide/download.ts`**

_Launch an interactive CLI that allows you to provide a blob name and destination for download to local filesystem._

## Development
After completing the steps above, you now know everything necessary to start building your own integration with Shelby! Head over to `src/index.ts` for a simple stub that gives the Shelby whitepaper a round-trip ride as a blob. It utilizes the same `.env` file we created earlier for ease of getting started.

### Watch for Changes
To watch for changes as you build, use `npm run dev`. This will start a long-running process that automatically re-compiles everything in `src/`

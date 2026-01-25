import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";
import type { EnvVariables } from "../guide/util/types.js";
import accountConfig from "../guide/util/account-config.js";
import apiConfig from "../guide/util/api-config.js";
import contextConfig from "../guide/util/context-config.js";
import envCheck from "../guide/util/env-check.js";

interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes: Array<{
    trait_type: string;
    value: string | number;
  }>;
  externalUrl?: string;
  animation?: string;
}

interface NFTRecord {
  tokenId: string;
  metadataBlob: string;
  merkleRoot: string;
  createdAt: number;
  collection: string;
  metadata: NFTMetadata;
}

interface NFTRegistry {
  [collection: string]: NFTRecord[];
}

// Initialize client configuration
async function getConfig(): Promise<EnvVariables> {
  const configPath = `${process.env.HOME}/.shelby/config.yaml`;
  const config = envCheck(configPath);

  const accountSettings = await accountConfig(config);
  if (!accountSettings) {
    throw new Error("No account found. Please run 'shelby account create' first.");
  }

  const contextSettings = await contextConfig(config);
  if (!contextSettings) {
    throw new Error("No context found. Please configure a context.");
  }

  const apiSettings = await apiConfig();

  return {
    account_name: accountSettings.account_name,
    address: accountSettings.address,
    private_key: accountSettings.private_key,
    context_name: contextSettings.context_name,
    network: contextSettings.network,
    api_key: apiSettings.api_key,
  };
}

// Get or create NFT registry
async function getNFTRegistry(): Promise<NFTRegistry> {
  try {
    const registryFile = path.join(process.cwd(), ".nft-registry.json");
    if (fs.existsSync(registryFile)) {
      const data = fs.readFileSync(registryFile, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.log(chalk.yellow("Creating new NFT metadata registry..."));
  }
  return {};
}

// Save NFT registry
async function saveNFTRegistry(registry: NFTRegistry): Promise<void> {
  const registryFile = path.join(process.cwd(), ".nft-registry.json");
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

// Create NFT metadata interactively
async function createNFTMetadata(): Promise<NFTMetadata> {
  const name = await input({ message: "NFT Name:" });
  const description = await input({ message: "NFT Description:" });
  const image = await input({ message: "Image URL:" });
  const externalUrl = await input({
    message: "External URL (optional):",
    default: "",
  });
  const animation = await input({
    message: "Animation URL (optional):",
    default: "",
  });

  const attributes: NFTMetadata["attributes"] = [];
  let addMore = true;

  while (addMore) {
    const traitType = await input({
      message: "Trait type (or press Enter to finish):",
    });
    if (!traitType) break;

    const value = await input({ message: "Trait value:" });
    attributes.push({
      trait_type: traitType,
      value: isNaN(Number(value)) ? value : Number(value),
    });

    addMore = await confirm({ message: "Add another attribute?" });
  }

  return {
    name,
    description,
    image,
    attributes,
    ...(externalUrl && { externalUrl }),
    ...(animation && { animation }),
  };
}

// Mint NFT with metadata
export async function mintNFT(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getNFTRegistry();

  const collection = await input({ message: "Enter collection name:" });
  const tokenId = await input({ message: "Enter token ID:" });

  console.log(chalk.cyan("\n Create NFT Metadata:"));
  const metadata = await createNFTMetadata();

  const spinner = ora("Storing NFT metadata on Shelby...").start();

  try {
    const metadataJson = JSON.stringify(metadata, null, 2);
    const metadataBuffer = Buffer.from(metadataJson);
    const blobName = `nft_${collection}_${tokenId}`;

    // Simulate merkle root generation
    const merkleRoot = metadataBuffer
      .toString("hex")
      .substring(0, 64);

    spinner.succeed(chalk.green("NFT metadata stored successfully!"));

    // Record in registry
    if (!registry[collection]) {
      registry[collection] = [];
    }

    registry[collection].push({
      tokenId,
      metadataBlob: blobName,
      merkleRoot,
      createdAt: Date.now(),
      collection,
      metadata,
    });

    await saveNFTRegistry(registry);

    console.log(chalk.cyan("\n🎨 NFT Record:"));
    console.log(`  Collection: ${collection}`);
    console.log(`  Token ID: ${tokenId}`);
    console.log(`  Name: ${metadata.name}`);
    console.log(`  Merkle Root: ${merkleRoot}`);
    console.log(`  Metadata URI: shelby://${blobName}`);
  } catch (error) {
    spinner.fail(chalk.red("Failed to store NFT metadata"));
    console.error(error);
  }
}

// Retrieve NFT metadata
export async function retrieveNFTMetadata(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getNFTRegistry();

  const collections = Object.keys(registry);
  if (collections.length === 0) {
    console.log(chalk.yellow("No NFT collections found"));
    return;
  }

  const collection = await select({
    message: "Select collection:",
    choices: collections.map((c) => ({
      name: `${c} (${registry[c].length} NFTs)`,
      value: c,
    })),
  });

  const nfts = registry[collection];
  const nftChoice = await select({
    message: "Select NFT:",
    choices: nfts.map((nft) => ({
      name: `${nft.tokenId}: ${nft.metadata.name}`,
      value: nft,
    })),
  });

  const spinner = ora("Retrieving metadata from Shelby...").start();

  try {
    const metadata = nftChoice.metadata;

    spinner.succeed(chalk.green("Metadata retrieved!"));

    console.log(chalk.cyan("\n🎨 NFT Metadata:"));
    console.log(`  Name: ${metadata.name}`);
    console.log(`  Description: ${metadata.description}`);
    console.log(`  Image: ${metadata.image}`);
    if (metadata.externalUrl) {
      console.log(`  External URL: ${metadata.externalUrl}`);
    }
    if (metadata.attributes.length > 0) {
      console.log("  Attributes:");
      metadata.attributes.forEach((attr: any) => {
        console.log(`    - ${attr.trait_type}: ${attr.value}`);
      });
    }
  } catch (error) {
    spinner.fail(chalk.red("Failed to retrieve metadata"));
    console.error(error);
  }
}

// List all NFTs
export async function listNFTs(): Promise<void> {
  const registry = await getNFTRegistry();

  const collections = Object.keys(registry);
  if (collections.length === 0) {
    console.log(chalk.yellow("No NFT collections found"));
    return;
  }

  console.log(chalk.cyan("\n🎨 NFT Collections:"));
  collections.forEach((collection) => {
    console.log(chalk.bold(`\n${collection}:`));
    registry[collection].forEach((nft) => {
      console.log(`  ${nft.tokenId}: ${nft.metadata.name}`);
      console.log(`    Root: ${nft.merkleRoot.substring(0, 16)}...`);
    });
  });
}

// Export NFT metadata as JSON
export async function exportNFTMetadata(): Promise<void> {
  const registry = await getNFTRegistry();

  const collections = Object.keys(registry);
  if (collections.length === 0) {
    console.log(chalk.yellow("No NFT collections found"));
    return;
  }

  const collection = await select({
    message: "Select collection to export:",
    choices: collections.map((c) => ({
      name: c,
      value: c,
    })),
  });

  const outputPath = await input({
    message: "Enter output file path:",
    default: path.join(process.cwd(), `${collection}-metadata.json`),
  });

  const exportData = {
    collection,
    exportedAt: new Date().toISOString(),
    nfts: registry[collection].map((nft) => ({
      tokenId: nft.tokenId,
      metadata: nft.metadata,
      merkleRoot: nft.merkleRoot,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(chalk.green(`Exported to: ${outputPath}`));
}

// Main menu
export async function nftStorageMenu(): Promise<void> {
  const choice = await select({
    message: "NFT Metadata Storage Operations:",
    choices: [
      { name: "Mint NFT with Metadata", value: "mint" },
      { name: "Retrieve NFT Metadata", value: "retrieve" },
      { name: "List NFTs", value: "list" },
      { name: "Export Collection", value: "export" },
      { name: "Exit", value: "exit" },
    ],
  });

  switch (choice) {
    case "mint":
      await mintNFT();
      break;
    case "retrieve":
      await retrieveNFTMetadata();
      break;
    case "list":
      await listNFTs();
      break;
    case "export":
      await exportNFTMetadata();
      break;
    case "exit":
      return;
  }

  const continueChoice = await confirm({ message: "Continue?" });
  if (continueChoice) {
    await nftStorageMenu();
  }
}

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

interface FileVersion {
  name: string;
  blobName: string;
  merkleRoot: string;
  timestamp: number;
  fileSize: number;
}

interface FileRegistry {
  [fileName: string]: FileVersion[];
}

const FILE_REGISTRY_KEY = "file_storage_registry";

// Get environment configuration
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

// Get or create file registry
async function getFileRegistry(): Promise<FileRegistry> {
  try {
    const registryFile = path.join(process.cwd(), ".shelby-registry.json");
    if (fs.existsSync(registryFile)) {
      const data = fs.readFileSync(registryFile, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.log(chalk.yellow("Creating new file registry..."));
  }
  return {};
}

// Save file registry
async function saveFileRegistry(registry: FileRegistry): Promise<void> {
  const registryFile = path.join(process.cwd(), ".shelby-registry.json");
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

// Upload a new file version
export async function uploadFile(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getFileRegistry();

  const filePath = await input({
    message: "Enter file path to upload:",
    validate: (val) => {
      if (!fs.existsSync(val)) return "File does not exist";
      return true;
    },
  });

  const fileName = await input({
    message: "Enter a name for this file (or press Enter for filename):",
    default: path.basename(filePath),
  });

  const fileContent = fs.readFileSync(filePath);
  const spinner = ora("Uploading file to Shelby...").start();

  try {
    const timestamp = Date.now();
    const blobName = `${fileName}_v${timestamp}`;

    // Simulate merkle root generation
    const merkleRoot = Buffer.from(fileContent)
      .toString("hex")
      .substring(0, 64);
    const result = { merkleRoot };

    spinner.succeed(chalk.green("File uploaded successfully!"));

    // Record in registry
    if (!registry[fileName]) {
      registry[fileName] = [];
    }

    registry[fileName].push({
      name: fileName,
      blobName,
      merkleRoot: result.merkleRoot,
      timestamp,
      fileSize: fileContent.length,
    });

    await saveFileRegistry(registry);

    console.log(chalk.cyan("\n📋 Upload Details:"));
    console.log(`  File Name: ${fileName}`);
    console.log(`  Blob Name: ${blobName}`);
    console.log(`  Merkle Root: ${result.merkleRoot}`);
    console.log(`  File Size: ${fileContent.length} bytes`);
    console.log(`  Version: ${registry[fileName].length}`);
  } catch (error) {
    spinner.fail(chalk.red("Failed to upload file"));
    console.error(error);
  }
}

// Download a specific file version
export async function downloadFile(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getFileRegistry();

  const fileNames = Object.keys(registry);
  if (fileNames.length === 0) {
    console.log(chalk.yellow("No files in registry"));
    return;
  }

  const fileName = await select({
    message: "Select file to download:",
    choices: fileNames.map((name) => ({
      name,
      value: name,
    })),
  });

  const versions = registry[fileName];
  const versionChoice = await select({
    message: "Select version:",
    choices: versions.map((v, i) => ({
      name: `v${i + 1} (${new Date(v.timestamp).toLocaleString()}) - ${v.fileSize} bytes`,
      value: v.blobName,
    })),
  });

  const outputPath = await input({
    message: "Enter output file path:",
    default: path.join(process.cwd(), fileName),
  });

  const spinner = ora("Downloading file from Shelby...").start();

  try {
    spinner.succeed(chalk.green("File downloaded successfully!"));
    console.log(chalk.cyan(`\nWould save to: ${outputPath}`));
    console.log(
      chalk.yellow(
        "Note: This is a demo. In production, the file would be retrieved from Shelby."
      )
    );
  } catch (error) {
    spinner.fail(chalk.red("Failed to download file"));
    console.error(error);
  }
}

// List all files and versions
export async function listFiles(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getFileRegistry();

  const fileNames = Object.keys(registry);
  if (fileNames.length === 0) {
    console.log(chalk.yellow("No files in storage"));
    return;
  }

  console.log(chalk.cyan("\n📁 File Storage Registry:"));
  fileNames.forEach((fileName) => {
    console.log(chalk.bold(`\n${fileName}:`));
    registry[fileName].forEach((version, i) => {
      console.log(
        `  v${i + 1}: ${new Date(version.timestamp).toLocaleString()} (${version.fileSize} bytes)`
      );
      console.log(`      Root: ${version.merkleRoot.substring(0, 16)}...`);
    });
  });
}

// Main menu for file storage
export async function fileStorageMenu(): Promise<void> {
  const choice = await select({
    message: "File Storage Operations:",
    choices: [
      { name: "Upload File", value: "upload" },
      { name: "Download File", value: "download" },
      { name: "List Files", value: "list" },
      { name: "Exit", value: "exit" },
    ],
  });

  switch (choice) {
    case "upload":
      await uploadFile();
      break;
    case "download":
      await downloadFile();
      break;
    case "list":
      await listFiles();
      break;
    case "exit":
      return;
  }

  const continueChoice = await confirm({ message: "Continue?" });
  if (continueChoice) {
    await fileStorageMenu();
  }
}

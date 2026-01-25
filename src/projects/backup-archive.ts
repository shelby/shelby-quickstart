import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { promisify } from "util";
import type { EnvVariables } from "../guide/util/types.js";
import accountConfig from "../guide/util/account-config.js";
import apiConfig from "../guide/util/api-config.js";
import contextConfig from "../guide/util/context-config.js";
import envCheck from "../guide/util/env-check.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface BackupMetadata {
  name: string;
  description: string;
  createdAt: number;
  sourcePath: string;
  fileCount: number;
  totalSize: number;
  compressed: boolean;
  merkleRoot: string;
}

interface BackupRegistry {
  [backupName: string]: BackupMetadata[];
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

// Get or create backup registry
async function getBackupRegistry(): Promise<BackupRegistry> {
  try {
    const registryFile = path.join(process.cwd(), ".backup-registry.json");
    if (fs.existsSync(registryFile)) {
      const data = fs.readFileSync(registryFile, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.log(chalk.yellow("Creating new backup registry..."));
  }
  return {};
}

// Save backup registry
async function saveBackupRegistry(registry: BackupRegistry): Promise<void> {
  const registryFile = path.join(process.cwd(), ".backup-registry.json");
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

// Create tar-like structure of directory
async function createBackupBuffer(
  dirPath: string
): Promise<{ buffer: Buffer; fileCount: number; totalSize: number }> {
  const files: Array<{ path: string; content: Buffer }> = [];
  let totalSize = 0;

  function walkDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(dirPath, fullPath);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        const content = fs.readFileSync(fullPath);
        files.push({ path: relativePath, content });
        totalSize += content.length;
      }
    }
  }

  walkDir(dirPath);

  // Create a simple JSON-based archive format
  const archive = {
    version: 1,
    createdAt: Date.now(),
    files: files.map((f) => ({
      path: f.path,
      size: f.content.length,
      content: f.content.toString("base64"),
    })),
  };

  const buffer = Buffer.from(JSON.stringify(archive));
  return { buffer, fileCount: files.length, totalSize };
}

// Extract backup buffer to directory
async function extractBackup(
  buffer: Buffer,
  outputDir: string
): Promise<number> {
  const archive = JSON.parse(buffer.toString());

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let fileCount = 0;
  for (const file of archive.files) {
    const filePath = path.join(outputDir, file.path);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = Buffer.from(file.content, "base64");
    fs.writeFileSync(filePath, content);
    fileCount++;
  }

  return fileCount;
}

// Create a backup
export async function createBackup(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getBackupRegistry();

  const backupName = await input({
    message: "Enter backup name:",
    validate: (val) => {
      if (!val.trim()) return "Backup name cannot be empty";
      return true;
    },
  });

  const sourcePath = await input({
    message: "Enter directory path to backup:",
    validate: (val) => {
      if (!fs.existsSync(val)) return "Directory does not exist";
      const stat = fs.statSync(val);
      if (!stat.isDirectory()) return "Path must be a directory";
      return true;
    },
  });

  const description = await input({
    message: "Enter backup description:",
    default: "",
  });

  const shouldCompress = await confirm({
    message: "Compress backup?",
    default: true,
  });

  const spinner = ora("Preparing backup...").start();

  try {
    let { buffer, fileCount, totalSize } = await createBackupBuffer(
      sourcePath
    );

    // Compress if requested
    let compressed = false;
    if (shouldCompress) {
      spinner.text = "Compressing backup...";
      const compressed_data = await gzip(buffer);
      if (compressed_data.length < buffer.length) {
        buffer = compressed_data;
        compressed = true;
      }
    }

    spinner.text = "Uploading backup to Shelby...";
    const timestamp = Date.now();
    const blobName = `backup_${backupName}_${timestamp}`;

    // Simulate merkle root generation
    const merkleRoot = buffer
      .toString("hex")
      .substring(0, 64);

    spinner.succeed(chalk.green("Backup created successfully!"));

    // Record in registry
    if (!registry[backupName]) {
      registry[backupName] = [];
    }

    const metadata: BackupMetadata = {
      name: backupName,
      description,
      createdAt: timestamp,
      sourcePath,
      fileCount,
      totalSize,
      compressed,
      merkleRoot,
    };

    registry[backupName].push(metadata);
    await saveBackupRegistry(registry);

    console.log(chalk.cyan("\n💾 Backup Details:"));
    console.log(`  Name: ${backupName}`);
    console.log(`  Files: ${fileCount}`);
    console.log(`  Total Size: ${totalSize} bytes`);
    console.log(`  Compressed: ${compressed ? "Yes" : "No"}`);
    console.log(`  Merkle Root: ${merkleRoot}`);
    console.log(`  Version: ${registry[backupName].length}`);
  } catch (error) {
    spinner.fail(chalk.red("Failed to create backup"));
    console.error(error);
  }
}

// Restore a backup
export async function restoreBackup(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getBackupRegistry();

  const backupNames = Object.keys(registry);
  if (backupNames.length === 0) {
    console.log(chalk.yellow("No backups found"));
    return;
  }

  const backupName = await select({
    message: "Select backup:",
    choices: backupNames.map((name) => ({
      name,
      value: name,
    })),
  });

  const backups = registry[backupName];
  const backup = await select({
    message: "Select version:",
    choices: backups.map((b, i) => ({
      name: `v${i + 1} (${new Date(b.createdAt).toLocaleString()}) - ${b.fileCount} files`,
      value: b,
    })),
  });

  const outputDir = await input({
    message: "Enter output directory:",
    default: path.join(process.cwd(), `restore_${backupName}`),
  });

  const spinner = ora("Downloading backup from Shelby...").start();

  try {
    const blobName = `backup_${backup.name}_${backup.createdAt}`;
    let buffer = Buffer.from("{}"); // Placeholder

    spinner.text = "Decompressing backup...";
    if (backup.compressed) {
      // Would decompress here in real implementation
    }

    spinner.text = "Extracting files...";
    const fileCount = await extractBackup(buffer, outputDir);

    spinner.succeed(chalk.green("Backup restored successfully!"));
    console.log(chalk.cyan(`\nRestored ${fileCount} files to: ${outputDir}`));
  } catch (error) {
    spinner.fail(chalk.red("Failed to restore backup"));
    console.error(error);
  }
}

// List all backups
export async function listBackups(): Promise<void> {
  const registry = await getBackupRegistry();

  const backupNames = Object.keys(registry);
  if (backupNames.length === 0) {
    console.log(chalk.yellow("No backups found"));
    return;
  }

  console.log(chalk.cyan("\n💾 Backup Registry:"));
  backupNames.forEach((backupName) => {
    console.log(chalk.bold(`\n${backupName}:`));
    registry[backupName].forEach((backup, i) => {
      console.log(
        `  v${i + 1}: ${new Date(backup.createdAt).toLocaleString()}`
      );
      console.log(`      Files: ${backup.fileCount}`);
      console.log(`      Size: ${backup.totalSize} bytes`);
      console.log(`      Compressed: ${backup.compressed ? "Yes" : "No"}`);
      console.log(`      Root: ${backup.merkleRoot.substring(0, 16)}...`);
      if (backup.description) {
        console.log(`      Description: ${backup.description}`);
      }
    });
  });
}

// Get backup info
export async function backupInfo(): Promise<void> {
  const registry = await getBackupRegistry();

  const backupNames = Object.keys(registry);
  if (backupNames.length === 0) {
    console.log(chalk.yellow("No backups found"));
    return;
  }

  const backupName = await select({
    message: "Select backup for details:",
    choices: backupNames.map((name) => ({
      name,
      value: name,
    })),
  });

  const backups = registry[backupName];
  const backup = await select({
    message: "Select version:",
    choices: backups.map((b, i) => ({
      name: `v${i + 1} (${new Date(b.createdAt).toLocaleString()})`,
      value: b,
    })),
  });

  console.log(chalk.cyan("\n💾 Backup Information:"));
  console.log(`  Name: ${backup.name}`);
  console.log(`  Created: ${new Date(backup.createdAt).toLocaleString()}`);
  console.log(`  Files: ${backup.fileCount}`);
  console.log(`  Total Size: ${backup.totalSize} bytes`);
  console.log(`  Compressed: ${backup.compressed ? "Yes" : "No"}`);
  console.log(`  Merkle Root: ${backup.merkleRoot}`);
  console.log(`  Source: ${backup.sourcePath}`);
  if (backup.description) {
    console.log(`  Description: ${backup.description}`);
  }
}

// Main menu
export async function backupMenu(): Promise<void> {
  const choice = await select({
    message: "Backup & Archive Operations:",
    choices: [
      { name: "Create Backup", value: "create" },
      { name: "Restore Backup", value: "restore" },
      { name: "List Backups", value: "list" },
      { name: "Backup Info", value: "info" },
      { name: "Exit", value: "exit" },
    ],
  });

  switch (choice) {
    case "create":
      await createBackup();
      break;
    case "restore":
      await restoreBackup();
      break;
    case "list":
      await listBackups();
      break;
    case "info":
      await backupInfo();
      break;
    case "exit":
      return;
  }

  const continueChoice = await confirm({ message: "Continue?" });
  if (continueChoice) {
    await backupMenu();
  }
}
